import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://uselessfacts.jsph.pl/**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "f1", text: "Starfish have no brains.", source: "djtech.net",
      source_url: "https://www.djtech.net/humor/shorty_useless_facts.htm", language: "en" }),
  }));
});

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
  const appNavigation = page.locator("header nav[aria-label='App']");
  await expect(appNavigation).toBeVisible();
  await expect(appNavigation.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(appNavigation.getByRole("link", { name: "AI Chat" })).toBeVisible();
  await expect(appNavigation.getByRole("link", { name: "Transactions" })).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(appNavigation).toBeHidden();
  const mobileNavigation = page.getByRole("navigation", { name: "Mobile app" });
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "AI Chat" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "Transactions" })).toBeVisible();
  await expect(page.locator("nav.fixed")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(appNavigation).toBeVisible();

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

test("login page shows Google sign-in option and displays errors from query params", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "Authentication required" }),
  }));

  await page.goto("/login?error=Google%20sign-in%20was%20cancelled%20or%20failed");
  const googleBtn = page.getByRole("link", { name: "Sign in with Google" });
  await expect(googleBtn).toBeVisible();
  await expect(googleBtn).toHaveAttribute("href", "/api/auth/google");
  await expect(page.locator("p[role='alert']")).toHaveText("Google sign-in was cancelled or failed");
});

test("a transient network failure on launch retries instead of signing the owner out", async ({ page }) => {
  let sessionChecks = 0;
  await page.route("**/api/auth/me", (route) => {
    sessionChecks += 1;
    if (sessionChecks === 1) return route.abort("internetdisconnected");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ username: "owner" }) });
  });
  await page.route("**/api/reports/summary?months=**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ start: "2026-11-01", end: "2026-11-30", totals: { income: "0", expense: "0" }, months: [], categories: {} }),
  }));
  await page.route("**/api/transactions", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/chat/pins", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) }));

  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(sessionChecks).toBe(2);
});

test("dashboard shows a useless fact instead of the AI shortcuts and can fetch another", async ({ page }) => {
  const facts = ["Starfish have no brains.", "Honey never spoils."];
  let requests = 0;
  await page.unrouteAll();
  await page.route("https://uselessfacts.jsph.pl/**", (route) => {
    const text = facts[Math.min(requests++, facts.length - 1)];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: String(requests), text, source: "example.org", source_url: "https://example.org" }) });
  });
  await page.route("**/api/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ username: "owner" }) }));
  await page.route("**/api/reports/summary?months=**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ start: "2026-11-01", end: "2026-11-30", totals: { income: "0", expense: "0" }, months: [], categories: {} }),
  }));
  await page.route("**/api/transactions", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/chat/pins", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) }));

  await page.goto("/dashboard");
  const card = page.getByRole("region", { name: "Useless fact" }).first();
  await expect(card).toContainText("Starfish have no brains.");
  await expect(page.getByText("Add with AI")).toHaveCount(0);
  await expect(page.getByText(/Ask or log anything/)).toHaveCount(0);
  await card.getByRole("button", { name: "Show another fact" }).click();
  await expect(card).toContainText("Honey never spoils.");
});
