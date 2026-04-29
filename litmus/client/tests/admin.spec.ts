import { test, expect } from '@playwright/test';
import { setUpForPage, mockHealth, MOCK_WAREHOUSE } from './helpers';

const MOCK_STATS = {
  sessions_today: 3, scans_today: 42, active_users: 2,
  unlisted_items: 1, total_entries: 150, warehouses: 3,
};

const MOCK_RECONCILIATION = {
  warehouse: MOCK_WAREHOUSE,
  date: '2026-04-29',
  rows: [
    { item_key: 'SCI001', item_name: 'Acetone', system_quantity: 100, litmus_quantity: 95, variance: -5, status: 'short' },
    { item_key: 'SCI002', item_name: 'Ethanol', system_quantity: 50, litmus_quantity: 50, variance: 0, status: 'matching' },
    { item_key: 'SCI003', item_name: 'Benzene', system_quantity: 30, litmus_quantity: 0, variance: -30, status: 'missing' },
  ],
  summary: { total: 3, matching: 1, short: 1, excess: 0, missing: 1, accuracy_pct: 33 },
};

function mockAdminRoutes(page: ReturnType<typeof test['info']> extends never ? never : import('@playwright/test').Page) {
  return Promise.all([
    page.route(/\/api\/admin\/stats(\?|$)/, (route) =>
      route.fulfill({ json: { data: MOCK_STATS, error: null, meta: { requestId: 'r1', timestamp: new Date().toISOString() } } })
    ),
    page.route(/\/api\/admin\/sessions(\?|$)/, (route) =>
      route.fulfill({ json: { data: [], error: null, meta: { requestId: 'r1', timestamp: new Date().toISOString() }, pagination: { page: 1, limit: 30, total: 0, totalPages: 0 } } })
    ),
    page.route(/\/api\/warehouses(\?|$)/, (route) =>
      route.fulfill({ json: { data: [MOCK_WAREHOUSE], error: null, meta: { requestId: 'r1', timestamp: new Date().toISOString() } } })
    ),
  ]);
}

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await setUpForPage(page, 'admin', false);
    await mockHealth(page);
    await mockAdminRoutes(page);
  });

  test('shows admin dashboard header', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('LITMUS Command')).toBeVisible();
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
    await expect(page.getByText('admin_user')).toBeVisible();
  });

  test('shows stat cards with values', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Sessions Today')).toBeVisible();
    await expect(page.getByText('Scans Today')).toBeVisible();
    await expect(page.getByText('Active Users')).toBeVisible();
    await expect(page.getByText('Unlisted Items')).toBeVisible();
    // Specific stat values
    await expect(page.getByText('42')).toBeVisible();
  });

  test('shows truth report button per warehouse', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Truth Reports')).toBeVisible();
    await expect(page.getByText('Bengaluru Storage Facility')).toBeVisible();
    await expect(page.getByText('View Report')).toBeVisible();
  });

  test('navigates to truth report page', async ({ page }) => {
    await page.route(/\/api\/reconciliation\/wh1/, (route) =>
      route.fulfill({ json: { data: MOCK_RECONCILIATION, error: null, meta: { requestId: 'r1', timestamp: new Date().toISOString() } } })
    );
    await page.goto('/admin');
    await page.getByText('View Report').click();
    await expect(page).toHaveURL(/\/admin\/truth\/wh1/);
    // Use exact text to avoid matching "LITMUS Truth Report" in the print header
    await expect(page.getByText('Truth Report', { exact: true })).toBeVisible();
  });

  test('ops user is redirected away from admin', async ({ page }) => {
    // Override to ops role in a single combined call
    await page.addInitScript((u: { id: string; username: string; role: string }) => {
      sessionStorage.setItem('litmus_access_token', 'mock-token');
      sessionStorage.setItem('litmus_user', JSON.stringify(u));
    }, { id: 'u1', username: 'ops_user', role: 'ops' });
    await page.goto('/admin');
    // ProtectedRoute redirects ops away from admin (to /scan then /sites)
    await expect(page).not.toHaveURL('/admin');
  });
});

test.describe('Truth Report', () => {
  test.beforeEach(async ({ page }) => {
    await setUpForPage(page, 'admin', false);
    await mockHealth(page);
    await page.route(/\/api\/reconciliation\/wh1/, (route) => {
      const url = route.request().url();
      if (url.includes('export/csv')) {
        return route.fulfill({
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="litmus-truth-BLR-SF-01-2026-04-29.csv"',
          },
          body: 'Item Key,Item Name,System Qty,Scanned Qty,Variance,Status\nSCI001,Acetone,100,95,-5,SHORT\n',
        });
      }
      return route.fulfill({ json: { data: MOCK_RECONCILIATION, error: null, meta: { requestId: 'r1', timestamp: new Date().toISOString() } } });
    });
  });

  test('shows reconciliation table', async ({ page }) => {
    await page.goto('/admin/truth/wh1');
    await expect(page.getByText('Acetone')).toBeVisible();
    await expect(page.getByText('Ethanol')).toBeVisible();
    await expect(page.getByText('Benzene')).toBeVisible();
  });

  test('shows accuracy summary cards', async ({ page }) => {
    await page.goto('/admin/truth/wh1');
    // Use exact: true to avoid matching partial text in status badges / filter tabs
    await expect(page.getByText('Accuracy', { exact: true })).toBeVisible();
    await expect(page.getByText('33%', { exact: true })).toBeVisible();
    await expect(page.getByText('Matching', { exact: true })).toBeVisible();
    await expect(page.getByText('Missing', { exact: true })).toBeVisible();
  });

  test('shows correct status badges in rows', async ({ page }) => {
    await page.goto('/admin/truth/wh1');
    // Scope to the table area (not filter tabs) by targeting spans specifically
    // Status badges render as <span> while filter tabs are <button>
    const spans = page.locator('span.rounded-full');
    await expect(spans.filter({ hasText: 'Short ↓' })).toBeVisible();
    await expect(spans.filter({ hasText: 'Match ✓' })).toBeVisible();
    await expect(spans.filter({ hasText: 'Missing —' })).toBeVisible();
  });

  test('filter tabs narrow visible rows', async ({ page }) => {
    await page.goto('/admin/truth/wh1');
    // Click the Short filter button
    await page.getByRole('button', { name: 'Short ↓' }).click();
    await expect(page.getByText('Acetone')).toBeVisible();
    await expect(page.getByText('Ethanol')).not.toBeVisible();
  });

  test('back button returns to /admin', async ({ page }) => {
    await page.goto('/admin/truth/wh1');
    // First button in the header is the back button (SVG chevron)
    await page.locator('header button').first().click();
    await expect(page).toHaveURL('/admin');
  });
});
