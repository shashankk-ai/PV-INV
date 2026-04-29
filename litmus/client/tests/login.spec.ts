import { test, expect } from '@playwright/test';
import { mockLogin, mockWarehouses, mockSession, mockHealth } from './helpers';

test.describe('Login', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealth(page);
    await mockLogin(page);
    await mockWarehouses(page);
    await mockSession(page);
  });

  test('renders login form at 375px', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    expect(page.viewportSize()?.width).toBe(375);
  });

  test('shows LITMUS logo', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('svg').first()).toBeVisible();
  });

  test('shows validation errors on empty submit', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Username is required')).toBeVisible();
    await expect(page.getByText('Password is required')).toBeVisible();
  });

  test('shows server error on wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'ops_user');
    await page.fill('#password', 'wrong');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Invalid username or password')).toBeVisible();
  });

  test('successful login redirects to /sites and shows warehouses', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'ops_user');
    await page.fill('#password', 'password123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('/sites');
    await expect(page.getByText('Bengaluru Storage Facility')).toBeVisible();
  });

  test('root / redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });
});
