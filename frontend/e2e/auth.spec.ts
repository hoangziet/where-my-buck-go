import { expect, test } from "@playwright/test";

test("owner can sign in, load the dashboard, and sign out", async ({ page }) => {
  let authenticated = false;

  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: authenticated ? 200 : 401,
    contentType: "application/json",
    body: JSON.stringify(authenticated ? { username: "owner" } : { error: "Authentication required" }),
  }));
  await page.route("**/api/auth/login", async (route) => {
    authenticated = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ username: "owner", csrfToken: "e2e-csrf-token" }),
    });
  });
  await page.route("**/api/auth/logout", async (route) => {
    authenticated = false;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/reports/summary?months=**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      start: "2026-11-01",
      end: "2026-11-30",
      totals: { income: "0", expense: "0" },
      months: [],
      categories: {},
    }),
  }));
  await page.route("**/api/transactions", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [] }),
  }));
  await page.route("**/api/chat/pins", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [] }),
  }));

  await page.goto("/login");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill("test-only-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Good to see you, owner", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("a 401 from a mid-session API call redirects to login with an explanation", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ username: "owner" }),
  }));
  await page.route("**/api/reports/summary?months=**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      start: "2026-11-01",
      end: "2026-11-30",
      totals: { income: "0", expense: "0" },
      months: [],
      categories: {},
    }),
  }));
  await page.route("**/api/transactions", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "Authentication required" }),
  }));
  await page.route("**/api/chat/pins", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [] }),
  }));

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?expired=1$/);
  await expect(page.getByText("Your session expired. Please sign in again.")).toBeVisible();
});
