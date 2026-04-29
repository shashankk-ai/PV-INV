import { Page } from '@playwright/test';

export const MOCK_OPS_USER = { id: 'u1', username: 'ops_user', role: 'ops' };
export const MOCK_ADMIN_USER = { id: 'a1', username: 'admin_user', role: 'admin' };
export const MOCK_WAREHOUSE = { id: 'wh1', name: 'Bengaluru Storage Facility', location_code: 'BLR-SF-01', created_at: '2024-01-01T00:00:00Z' };
export const MOCK_SESSION = { id: 'sess1', warehouse_id: 'wh1', user_id: 'u1', started_at: '2024-01-01T00:00:00Z' };

export function meta() {
  return { requestId: 'r1', timestamp: new Date().toISOString() };
}
export function ok(data: unknown) {
  return { data, error: null, meta: meta() };
}
export function paginated(data: unknown[]) {
  return { data, error: null, meta: meta(), pagination: { page: 1, limit: 50, total: data.length, totalPages: 1 } };
}

export async function mockLogin(page: Page, role: 'ops' | 'admin' = 'ops') {
  const user = role === 'admin' ? MOCK_ADMIN_USER : MOCK_OPS_USER;
  await page.route(/\/api\/auth\/login$/, async (route) => {
    const body = route.request().postDataJSON() as { username: string; password: string };
    if (body.password === 'password123') {
      await route.fulfill({ json: ok({ user, access_token: `mock-${role}-token`, refresh_token: 'mock-refresh' }) });
    } else {
      await route.fulfill({ status: 401, json: { data: null, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' }, meta: meta() } });
    }
  });
}

export async function mockWarehouses(page: Page) {
  await page.route(/\/api\/warehouses(\?|$)/, (route) =>
    route.fulfill({ json: ok([MOCK_WAREHOUSE]) })
  );
}

export async function mockSession(page: Page) {
  await page.route(/\/api\/sessions(\?|$)/, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, json: ok(MOCK_SESSION) });
    }
    return route.fulfill({ json: paginated([MOCK_SESSION]) });
  });
}

export async function mockItems(page: Page) {
  await page.route('**/api/items**', (route) =>
    route.fulfill({
      json: ok([
        { item_key: 'SCI001', item_name: 'Acetone', cas_number: '67-64-1', uom_options: ['L', 'KG'] },
        { item_key: 'SCI002', item_name: 'Ethanol', cas_number: '64-17-5', uom_options: ['L'] },
      ]),
    })
  );
}

export async function mockHealth(page: Page) {
  await page.route(/\/api\/health(\?|$)/, (route) =>
    route.fulfill({ json: { status: 'ok', app: 'litmus', version: '1.0.0', uptime: 100, db: 'connected', cache: 'connected' } })
  );
}

/** Pre-set auth in sessionStorage via addInitScript (runs before page JS). */
export async function authenticateAs(page: Page, role: 'ops' | 'admin' = 'ops') {
  const user = role === 'admin' ? MOCK_ADMIN_USER : MOCK_OPS_USER;
  // addInitScript only accepts ONE serializable arg — pass a single object
  await page.addInitScript((u: typeof MOCK_OPS_USER) => {
    sessionStorage.setItem('litmus_access_token', 'mock-token');
    sessionStorage.setItem('litmus_user', JSON.stringify(u));
  }, user);
}

/** Pre-set auth + site + session in ONE addInitScript call to avoid the single-arg limit. */
export async function setUpForPage(
  page: Page,
  role: 'ops' | 'admin' = 'ops',
  withSite = false,
) {
  const user = role === 'admin' ? MOCK_ADMIN_USER : MOCK_OPS_USER;
  await page.addInitScript((args: { user: typeof MOCK_OPS_USER; wh: typeof MOCK_WAREHOUSE; sess: typeof MOCK_SESSION }) => {
    sessionStorage.setItem('litmus_access_token', 'mock-token');
    sessionStorage.setItem('litmus_user', JSON.stringify(args.user));
    if (args.wh) sessionStorage.setItem('litmus_site', JSON.stringify(args.wh));
    if (args.sess) sessionStorage.setItem('litmus_session', JSON.stringify(args.sess));
  }, { user, wh: withSite ? MOCK_WAREHOUSE : null as unknown as typeof MOCK_WAREHOUSE, sess: withSite ? MOCK_SESSION : null as unknown as typeof MOCK_SESSION });
}
