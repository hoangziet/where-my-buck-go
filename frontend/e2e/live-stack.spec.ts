import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("real owner session persists a ledger entry through reports, export, deletion, and logout", async ({ page }) => {
  test.skip(process.env.RUN_LIVE_E2E !== "1", "Run only against the disposable Docker stack");

  const username = process.env.E2E_OWNER_USERNAME;
  const password = process.env.E2E_OWNER_PASSWORD;
  if (!username || !password) throw new Error("Live stack owner credentials are required");

  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  const loginResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/login"));
  await page.getByRole("button", { name: "Sign in" }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
  const { csrfToken } = await loginResponse.json() as { csrfToken: string };
  await expect(page).toHaveURL(/\/dashboard$/);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const proposalKey = randomUUID();
  const proposal = await page.evaluate(async ({ csrf, idempotencyKey, occurredDate }) => {
    const response = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        expectedVersion: 0,
        amount: "12345",
        currency: "VND",
        direction: "expense",
        description: "CI LIVE VERIFY cafe",
        category: "food_drink",
        occurredDate,
        occurredTime: "08:30",
        period: "sáng",
        timeSource: "explicit",
        evidenceText: "Disposable CI-only test transaction",
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { csrf: csrfToken, idempotencyKey: proposalKey, occurredDate: today });
  expect(proposal.status, JSON.stringify(proposal.body)).toBe(201);

  const proposalId = (proposal.body as { id: string }).id;
  const confirmation = await page.evaluate(async ({ csrf, identifier, idempotencyKey }) => {
    const response = await fetch(`/api/proposals/${identifier}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    return { status: response.status, body: await response.json() };
  }, { csrf: csrfToken, identifier: proposalId, idempotencyKey: randomUUID() });
  expect(confirmation.status, JSON.stringify(confirmation.body)).toBe(200);

  await page.goto("/transactions");
  const transactionRow = page.getByRole("row", { name: /CI LIVE VERIFY cafe/ });
  await expect(transactionRow).toContainText("−12.345 ₫");
  await page.getByRole("button", { name: "Expenses" }).last().click();
  await page.getByRole("combobox", { name: "Category" }).last().selectOption("food_drink");
  await expect(page.getByText("1 transactions", { exact: true })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  const csvPath = await download.path();
  if (!csvPath) throw new Error("CSV export did not create a file");
  const csv = await readFile(csvPath, "utf8");
  expect(csv).toContain("CI LIVE VERIFY cafe");
  expect(csv).toContain(",expense,food_drink,12345,VND,");

  await page.goto("/dashboard");
  const expensesKpi = page.getByText("Expenses", { exact: true }).first().locator("..");
  await expect(expensesKpi).toContainText("−12.345 ₫");
  const report = await page.evaluate(async () => {
    const response = await fetch("/api/reports/summary?months=1");
    return { status: response.status, body: await response.json() };
  });
  expect(report.status).toBe(200);
  expect((report.body as { totals: { expense: string } }).totals.expense).toBe("12345");
  await expect(page.getByText("CI LIVE VERIFY cafe").first()).toBeVisible();

  await page.goto("/transactions");
  const cleanupRow = page.getByRole("row", { name: /CI LIVE VERIFY cafe/ });
  await cleanupRow.getByRole("button", { name: "Delete transaction" }).click();
  await expect(page.getByRole("heading", { name: "Review transaction deletion" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByText("Deleted “CI LIVE VERIFY cafe”")).toBeVisible();
  await expect(page.getByRole("row", { name: /CI LIVE VERIFY cafe/ })).toHaveCount(0);

  await page.goto("/dashboard");
  const cleanup = await page.evaluate(async () => {
    const [transactionsResponse, reportResponse] = await Promise.all([
      fetch("/api/transactions"),
      fetch("/api/reports/summary?months=1"),
    ]);
    return {
      transactions: await transactionsResponse.json(),
      report: await reportResponse.json(),
    };
  });
  expect((cleanup.transactions as { items: unknown[] }).items).toHaveLength(0);
  expect((cleanup.report as { totals: { expense: string } }).totals.expense).toBe("0");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
