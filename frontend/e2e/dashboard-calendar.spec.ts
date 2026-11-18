import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ username: "owner" }),
  }));
  await page.route("**/api/chat/pins", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ items: [] }),
  }));
});

test("dashboard period updates figures and chart values", async ({ page }) => {
  await page.route("**/api/reports/dashboard?period=**", (route) => {
    const week = new URL(route.request().url()).searchParams.get("period") === "week";
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      start: week ? "2026-11-16" : "2026-11-01", end: "2026-11-18",
      totals: { income: week ? "50000" : "100000", expense: week ? "25000" : "40000" },
      days: [{ date: "2026-11-18", income: "50000", expense: "25000" }],
      categories: { food_drink: week ? "25000" : "40000" },
      balance: { income: "300000", expense: "100000" },
    }) });
  });
  await page.route("**/api/transactions", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ items: [] }),
  }));

  await page.goto("/dashboard");
  await expect(page.getByText("Current balance")).toBeVisible();
  await page.getByRole("button", { name: "This week" }).click();
  await expect(page.getByText("Daily totals this week")).toBeVisible();
  const incomeBar = page.getByRole("button", { name: /Nov 18 · Income: 50\.000 ₫/ });
  await incomeBar.hover();
  await expect(page.getByText("Nov 18 · Income: 50.000 ₫", { exact: true })).toBeVisible();
});

test("calendar day list opens a specific transaction", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  const items = Array.from({ length: 4 }, (_, index) => ({
    id: `tx-${index + 1}`, version: 1, deleted: false, amount: String((index + 1) * 10000),
    currency: "VND", direction: "expense", description: `Transaction ${index + 1}`,
    category: "food_drink", occurredDate: today, occurredTime: "12:00", period: "today", timeSource: "explicit",
    evidenceIds: index === 3 ? ["evidence-4"] : [],
  }));
  await page.route("**/api/transactions", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ items }),
  }));

  await page.goto("/transactions");
  await page.getByRole("button", { name: "Calendar view" }).click();
  await page.getByRole("button", { name: "+1 more" }).click();
  await expect(page.getByRole("dialog", { name: `Transactions on ${today}` })).toBeVisible();
  await page.getByRole("dialog", { name: `Transactions on ${today}` }).getByRole("button", { name: /Transaction 4/ }).click();
  const details = page.getByRole("dialog", { name: "Transaction 4" });
  await expect(details).toContainText("−40.000 ₫");
  await expect(details.getByRole("button", { name: "Edit transaction" })).toBeVisible();
  await expect(details.getByRole("button", { name: "View original evidence" })).toBeVisible();
});
