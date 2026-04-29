import { ZohoChemical, ZohoWarehouse, ZohoInventoryRecord } from '@litmus/shared';
import { logger } from '../utils/logger';
import chemicals from '../mocks/chemicals.json';

const MOCK_WAREHOUSES: ZohoWarehouse[] = [
  { warehouse_id: 'WH-MUM', warehouse_name: 'Mumbai Central Warehouse',    location_code: 'MUM-CW-01' },
  { warehouse_id: 'WH-HYD', warehouse_name: 'Hyderabad Distribution Center', location_code: 'HYD-DC-01' },
  { warehouse_id: 'WH-BLR', warehouse_name: 'Bengaluru Storage Facility',   location_code: 'BLR-SF-01' },
];

function randomQty(seed: number): number {
  // Deterministic-ish quantity for consistent mock data
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

export class ZohoAnalyticsClient {
  private readonly apiKey: string | undefined;
  private readonly viewId: string | undefined;
  private readonly orgId: string | undefined;
  private readonly timeout = 10_000;

  constructor() {
    this.apiKey = process.env.ZOHO_API_KEY || undefined;
    this.viewId = process.env.ZOHO_VIEW_ID || undefined;
    this.orgId = process.env.ZOHO_ORG_ID || undefined;
  }

  get useMock(): boolean {
    return !this.apiKey;
  }

  async fetchItems(): Promise<ZohoChemical[]> {
    if (this.useMock) {
      logger.debug('ZohoClient: using mock chemicals');
      return chemicals as ZohoChemical[];
    }
    return withRetry(async () => {
      const { default: axios } = await import('axios');
      const res = await axios.get(
        `https://analyticsapi.zoho.com/api/v2/${this.orgId}/views/${this.viewId}/rows`,
        {
          headers: { 'ZANALYTICS-ORGID': this.orgId!, Authorization: `Zoho-oauthtoken ${this.apiKey}` },
          timeout: this.timeout,
        }
      );
      return res.data.data.rows as ZohoChemical[];
    });
  }

  async fetchWarehouses(): Promise<ZohoWarehouse[]> {
    if (this.useMock) {
      return MOCK_WAREHOUSES;
    }
    return withRetry(async () => {
      const { default: axios } = await import('axios');
      const res = await axios.get(
        `https://analyticsapi.zoho.com/api/v2/${this.orgId}/views/warehouses/rows`,
        {
          headers: { 'ZANALYTICS-ORGID': this.orgId!, Authorization: `Zoho-oauthtoken ${this.apiKey}` },
          timeout: this.timeout,
        }
      );
      return res.data.data.rows as ZohoWarehouse[];
    });
  }

  async fetchSystemInventory(warehouseId: string): Promise<ZohoInventoryRecord[]> {
    if (this.useMock) {
      return buildMockInventory(warehouseId);
    }
    return withRetry(async () => {
      const { default: axios } = await import('axios');
      const res = await axios.get(
        `https://analyticsapi.zoho.com/api/v2/${this.orgId}/views/inventory/rows`,
        {
          headers: { 'ZANALYTICS-ORGID': this.orgId!, Authorization: `Zoho-oauthtoken ${this.apiKey}` },
          params: { warehouse_id: warehouseId },
          timeout: this.timeout,
        }
      );
      return res.data.data.rows as ZohoInventoryRecord[];
    });
  }
}

export const zohoClient = new ZohoAnalyticsClient();
