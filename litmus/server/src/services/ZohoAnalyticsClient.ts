import axios from 'axios';
import { ZohoChemical, ZohoWarehouse, ZohoInventoryRecord } from '@litmus/shared';
import { logger } from '../utils/logger';
import { redis } from './redis';
import chemicals from '../mocks/chemicals.json';

const MOCK_WAREHOUSES: ZohoWarehouse[] = [
  { warehouse_id: 'WH-MUM', warehouse_name: 'Mumbai Central Warehouse',    location_code: 'MUM-CW-01' },
  { warehouse_id: 'WH-HYD', warehouse_name: 'Hyderabad Distribution Center', location_code: 'HYD-DC-01' },
  { warehouse_id: 'WH-BLR', warehouse_name: 'Bengaluru Storage Facility',   location_code: 'BLR-SF-01' },
];

function randomQty(seed: number): number {
  return 50 + ((seed * 137 + 31) % 4950);
}

function buildMockInventory(warehouseId: string): ZohoInventoryRecord[] {
  return (chemicals as ZohoChemical[]).map((c, i) => ({
    item_key: c.item_key,
    warehouse_id: warehouseId,
    quantity: randomQty(i + warehouseId.charCodeAt(3)),
    uom: c.uom_options[0],
  }));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const isRetryable = status === 429 || (status !== undefined && status >= 500);
      if (!isRetryable || attempt === retries) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      logger.warn({ attempt, delay }, 'Zoho API retry');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

const ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in';
const API_BASE     = process.env.ZOHO_API_BASE     || 'https://analyticsapi.zoho.in/restapi/v2';
const TOKEN_CACHE_KEY = 'zoho:access_token';

export class ZohoAnalyticsClient {
  private readonly clientId     = process.env.ZOHO_CLIENT_ID;
  private readonly clientSecret = process.env.ZOHO_CLIENT_SECRET;
  private readonly refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  private readonly orgId        = process.env.ZOHO_ORG_ID;

  // Per-view IDs — fall back to shared ZOHO_VIEW_ID for the items view
  private readonly itemsViewId     = process.env.ZOHO_ITEMS_VIEW_ID     || process.env.ZOHO_VIEW_ID;
  private readonly warehousesViewId= process.env.ZOHO_WAREHOUSES_VIEW_ID;
  private readonly inventoryViewId = process.env.ZOHO_INVENTORY_VIEW_ID;

  get useMock(): boolean {
    return !this.clientId || !this.clientSecret || !this.refreshToken;
  }

  /** Get (or refresh) an OAuth access token, cached in Redis for 55 minutes. */
  private async getAccessToken(): Promise<string> {
    const cached = await redis.get(TOKEN_CACHE_KEY);
    if (cached) return cached;

    logger.info('ZohoClient: refreshing OAuth access token');
    const res = await axios.post(
      `${ACCOUNTS_URL}/oauth/v2/token`,
      new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     this.clientId!,
        client_secret: this.clientSecret!,
        refresh_token: this.refreshToken!,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 }
    );

    const token: string = res.data.access_token;
    if (!token) throw new Error('Zoho OAuth: no access_token in response');

    // Cache for 55 min (tokens last 60 min)
    await redis.setEx(TOKEN_CACHE_KEY, 55 * 60, token);
    return token;
  }

  private authHeaders(token: string) {
    return {
      Authorization: `Zoho-oauthtoken ${token}`,
      'ZANALYTICS-ORGID': this.orgId!,
    };
  }

  async fetchItems(): Promise<ZohoChemical[]> {
    if (this.useMock) {
      logger.debug('ZohoClient: using mock chemicals');
      return chemicals as ZohoChemical[];
    }
    return withRetry(async () => {
      const token = await this.getAccessToken();
      const res = await axios.get(
        `${API_BASE}/workspaces/${this.orgId}/views/${this.itemsViewId}/rows`,
        { headers: this.authHeaders(token), timeout: 10_000 }
      );
      return (res.data?.data?.rows ?? res.data?.rows ?? []) as ZohoChemical[];
    });
  }

  async fetchWarehouses(): Promise<ZohoWarehouse[]> {
    if (this.useMock) return MOCK_WAREHOUSES;
    if (!this.warehousesViewId) {
      logger.warn('ZohoClient: ZOHO_WAREHOUSES_VIEW_ID not set, using mock warehouses');
      return MOCK_WAREHOUSES;
    }
    return withRetry(async () => {
      const token = await this.getAccessToken();
      const res = await axios.get(
        `${API_BASE}/workspaces/${this.orgId}/views/${this.warehousesViewId}/rows`,
        { headers: this.authHeaders(token), timeout: 10_000 }
      );
      return (res.data?.data?.rows ?? res.data?.rows ?? []) as ZohoWarehouse[];
    });
  }

  async fetchSystemInventory(warehouseId: string): Promise<ZohoInventoryRecord[]> {
    if (this.useMock) return buildMockInventory(warehouseId);
    if (!this.inventoryViewId) {
      logger.warn('ZohoClient: ZOHO_INVENTORY_VIEW_ID not set, using mock inventory');
      return buildMockInventory(warehouseId);
    }
    return withRetry(async () => {
      const token = await this.getAccessToken();
      const res = await axios.get(
        `${API_BASE}/workspaces/${this.orgId}/views/${this.inventoryViewId}/rows`,
        {
          headers: this.authHeaders(token),
          params: { warehouse_id: warehouseId },
          timeout: 10_000,
        }
      );
      return (res.data?.data?.rows ?? res.data?.rows ?? []) as ZohoInventoryRecord[];
    });
  }
}

export const zohoClient = new ZohoAnalyticsClient();
