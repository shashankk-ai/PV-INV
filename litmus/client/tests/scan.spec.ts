import { test, expect } from '@playwright/test';
import { setUpForPage, mockWarehouses, mockSession, mockItems, mockHealth, MOCK_WAREHOUSE, MOCK_SESSION } from './helpers';

test.describe('Site Select', () => {
  test.beforeEach(async ({ page }) => {
    await setUpForPage(page, 'ops', false);
    await mockHealth(page);
    await mockWarehouses(page);
    await mockSession(page);
  });

  test('shows warehouse list', async ({ page }) => {
    await page.goto('/sites');
    await expect(page.getByText('Bengaluru Storage Facility')).toBeVisible();
    await expect(page.getByText('BLR-SF-01')).toBeVisible();
  });

  test('search filters warehouses', async ({ page }) => {
    await page.route(/\/api\/warehouses(\?|$)/, (route) =>
      route.fulfill({
        json: {
          data: [
            MOCK_WAREHOUSE,
            { id: 'wh2', name: 'Mumbai Central Warehouse', location_code: 'MUM-CW-01', created_at: '2024-01-01T00:00:00Z' },
          ],
          error: null,
          meta: { requestId: 'r1', timestamp: new Date().toISOString() },
        },
      })
    );
    await page.goto('/sites');
    await page.fill('input[type="search"]', 'Mumbai');
    await expect(page.getByText('Mumbai Central Warehouse')).toBeVisible();
    await expect(page.getByText('Bengaluru Storage Facility')).not.toBeVisible();
  });

  test('selecting a warehouse navigates to /scan', async ({ page }) => {
    await mockItems(page);
    await page.route(/\/api\/sessions\/sess1\/entries/, (route) =>
      route.fulfill({ json: { data: [], error: null, meta: { requestId: 'r1', timestamp: new Date().toISOString() }, pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } } })
    );
    await page.goto('/sites');
    await page.getByText('Bengaluru Storage Facility').click();
    await expect(page).toHaveURL('/scan');
    await expect(page.getByText('Rack Scan')).toBeVisible();
  });
});

test.describe('Rack Scan Form', () => {
  test.beforeEach(async ({ page }) => {
    // Use setUpForPage with site+session in ONE addInitScript call (avoids the single-arg limit bug)
    await setUpForPage(page, 'ops', true);
    await mockHealth(page);
    await mockItems(page);
  });

  test('renders all form fields', async ({ page }) => {
    await page.goto('/scan');
    await expect(page.getByPlaceholder('e.g. AB-001')).toBeVisible();
    await expect(page.getByPlaceholder('Search chemical name...')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. BATCH-2025-001')).toBeVisible();
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
    await expect(page.locator('input[type="date"]').nth(1)).toBeVisible();
  });

  test('shows validation errors on empty submit', async ({ page }) => {
    await page.goto('/scan');
    // Click the fixed-bottom submit button
    await page.getByRole('button', { name: 'Log Scan' }).click();
    await expect(page.getByText('Rack number is required')).toBeVisible();
    // item_name defaults to undefined → zod emits 'Required' (exact) before the custom min(1) message
    await expect(page.getByText('Required', { exact: true })).toBeVisible();
  });

  test('shows site name in header', async ({ page }) => {
    await page.goto('/scan');
    await expect(page.getByText('Bengaluru Storage Facility')).toBeVisible();
  });

  test('total quantity display is visible', async ({ page }) => {
    await page.goto('/scan');
    await expect(page.getByText('Total Quantity')).toBeVisible();
  });

  test('item combobox shows search results', async ({ page }) => {
    await page.goto('/scan');
    await page.getByPlaceholder('Search chemical name...').pressSequentially('Acet', { delay: 30 });
    await expect(page.getByText('Acetone')).toBeVisible();
    await expect(page.getByText('SCI001')).toBeVisible();
  });
});

test.describe('Scan Log', () => {
  test.beforeEach(async ({ page }) => {
    // Single addInitScript call sets auth + site + session together
    await setUpForPage(page, 'ops', true);
    await mockHealth(page);
  });

  test('shows empty state when no scans', async ({ page }) => {
    await page.route(/\/api\/sessions\/sess1\/entries/, (route) =>
      route.fulfill({ json: { data: [], error: null, meta: { requestId: 'r1', timestamp: new Date().toISOString() }, pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } } })
    );
    await page.goto('/log');
    await expect(page.getByText('No scans yet')).toBeVisible();
  });

  test('shows scan entries', async ({ page }) => {
    await page.route(/\/api\/sessions\/sess1\/entries/, (route) =>
      route.fulfill({
        json: {
          data: [{
            id: 'e1', rack_number: 'AB-001', item_name: 'Acetone', item_key: 'SCI001',
            batch_number: 'BATCH-001', units: 5, packing_size: 20, uom: 'L',
            packing_type: 'drums', total_quantity: 100, mfg_date: '2025-01-01T00:00:00Z',
            expiry_date: '2027-01-01T00:00:00Z', is_potential_duplicate: false,
            user: { username: 'ops_user' },
          }],
          error: null,
          meta: { requestId: 'r1', timestamp: new Date().toISOString() },
          pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
        },
      })
    );
    await page.goto('/log');
    await expect(page.getByText('AB-001')).toBeVisible();
    await expect(page.getByText('Acetone')).toBeVisible();
  });

  test('shows bottom navigation with scan and log tabs', async ({ page }) => {
    await page.route(/\/api\/sessions\/sess1\/entries/, (route) =>
      route.fulfill({ json: { data: [], error: null, meta: { requestId: 'r1', timestamp: new Date().toISOString() }, pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } } })
    );
    await page.goto('/log');
    // BottomNav renders the text labels
    const nav = page.locator('nav');
    await expect(nav.getByText('Scan')).toBeVisible();
    await expect(nav.getByText('Log')).toBeVisible();
  });
});
