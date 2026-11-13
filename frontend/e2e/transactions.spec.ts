import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const original = {
  id: "transaction-test-1",
  version: 1,
  deleted: false,
  amount: "17500",
  currency: "VND",
  direction: "expense",
  description: "Coffee",
  category: "food_drink",
  occurredDate: "2026-11-12",
  occurredTime: "08:30",
  period: "morning",
  timeSource: "explicit",
};

function proposal(operation: "edit" | "delete" | "undo", overrides: Record<string, unknown> = {}) {
  return {
    id: `proposal-${operation}`,
    version: 1,
    state: "draft",
    operation,
    targetId: original.id,
    baseVersion: original.version,
    resultDeleted: operation === "delete",
    amount: original.amount,
    currency: original.currency,
    direction: original.direction,
    description: original.description,
    category: original.category,
    occurredDate: original.occurredDate,
    occurredTime: original.occurredTime,
    period: original.period,
    timeSource: original.timeSource,
    canConfirm: true,
    confirmedTransactionId: null,
    evidenceIds: [],
    ...overrides,
  };
}

async function openTransactions(
  page: import("@playwright/test").Page,
  transactions: Record<string, unknown>[] = [original],
) {
  await page.route("**/api/auth/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ username: "owner" }),
  }));
  await page.route("**/api/transactions", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: transactions }),
  }));
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Coffee/ })).toBeVisible();
}

test("type and category filters scope the CSV export and formula-like text stays inert", async ({ page }) => {
  const formulaText = { ...original, id: "transaction-formula", description: "=SUM(1,1)" };
  const income = {
    ...original,
    id: "transaction-income",
    direction: "income",
    amount: "5000000",
    description: "Salary",
    category: "income",
  };

  await openTransactions(page, [original, formulaText, income]);
  await page.getByRole("button", { name: "Expenses" }).last().click();
  await page.getByRole("combobox", { name: "Category" }).last().selectOption("food_drink");
  await expect(page.getByText("2 transactions", { exact: true })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^transactions-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  if (!path) throw new Error("CSV download did not produce a file");
  const csv = await readFile(path, "utf8");

  expect(csv).toContain("Coffee");
  expect(csv).toContain('"\t=SUM(1,1)"');
  expect(csv).not.toContain("Salary");
});

test("edit creates a preview and waits for explicit confirmation", async ({ page }) => {
  let confirmRequests = 0;
  let changeBody: Record<string, unknown> | undefined;

  await openTransactions(page);
  await page.route("**/api/proposals/changes", async (route) => {
    changeBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(proposal("edit", { amount: "20000", description: "Coffee and pastry" })),
    });
  });
  await page.route("**/api/proposals/proposal-edit/confirm", async (route) => {
    confirmRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        proposal: proposal("edit", { state: "confirmed", amount: "20000", description: "Coffee and pastry" }),
        transaction: { ...original, version: 2, amount: "20000", description: "Coffee and pastry" },
      }),
    });
  });

  await page.getByRole("button", { name: "Edit transaction" }).click();
  await page.getByLabel("Description").fill("Coffee and pastry");
  await page.getByLabel("Amount (VND)").fill("20000");
  await page.getByRole("button", { name: "Review changes" }).click();

  await expect(page.getByRole("dialog", { name: "Review transaction changes" })).toBeVisible();
  await expect(page.getByText("Coffee and pastry", { exact: true })).toBeVisible();
  expect(changeBody?.operation).toBe("edit");
  expect(confirmRequests).toBe(0);

  await page.getByRole("button", { name: "Confirm edit" }).click();
  await expect(page.getByRole("row", { name: /Coffee and pastry/ })).toBeVisible();
  expect(confirmRequests).toBe(1);
});

test("a stale version conflict on confirm refreshes the list instead of applying blindly", async ({ page }) => {
  let transactionsRequests = 0;

  await openTransactions(page);
  await page.route("**/api/transactions", async (route) => {
    transactionsRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [{ ...original, amount: "99000", description: "Coffee (edited on another device)" }],
      }),
    });
  });
  await page.route("**/api/proposals/changes", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(proposal("edit", { amount: "20000", description: "Coffee and pastry" })),
    });
  });
  await page.route("**/api/proposals/proposal-edit/confirm", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Version conflict" }),
    });
  });

  await page.getByRole("button", { name: "Edit transaction" }).click();
  await page.getByLabel("Description").fill("Coffee and pastry");
  await page.getByLabel("Amount (VND)").fill("20000");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("dialog", { name: "Review transaction changes" })).toBeVisible();

  await page.getByRole("button", { name: "Confirm edit" }).click();

  await expect(page.getByText("This transaction changed elsewhere. The list has been refreshed — please try again.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Coffee \(edited on another device\)/ })).toBeVisible();
  expect(transactionsRequests).toBe(1);
});

test("delete and undo each require their own explicit confirmation", async ({ page }) => {
  let confirmRequests = 0;
  const confirmOperation: string[] = [];

  await openTransactions(page);
  await page.route("**/api/proposals/changes", async (route) => {
    const body = route.request().postDataJSON();
    const operation = body.operation as "delete" | "undo";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(proposal(operation)),
    });
  });
  await page.route("**/api/proposals/proposal-delete/confirm", async (route) => {
    confirmRequests += 1;
    confirmOperation.push("delete");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        proposal: proposal("delete", { state: "confirmed" }),
        transaction: { ...original, version: 2, deleted: true },
      }),
    });
  });
  await page.route("**/api/proposals/proposal-undo/confirm", async (route) => {
    confirmRequests += 1;
    confirmOperation.push("undo");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        proposal: proposal("undo", { state: "confirmed", resultDeleted: false }),
        transaction: { ...original, version: 3, deleted: false },
      }),
    });
  });

  await page.getByRole("button", { name: "Delete transaction" }).click();
  await expect(page.getByRole("dialog", { name: "Review transaction deletion" })).toBeVisible();
  expect(confirmRequests).toBe(0);
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByText("Deleted “Coffee”")).toBeVisible();
  await expect(page.getByRole("row", { name: /Coffee/ })).toHaveCount(0);
  expect(confirmRequests).toBe(1);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("dialog", { name: "Review transaction restoration" })).toBeVisible();
  expect(confirmRequests).toBe(1);
  await page.getByRole("button", { name: "Confirm undo" }).click();
  await expect(page.getByRole("row", { name: /Coffee/ })).toBeVisible();
  expect(confirmRequests).toBe(2);
  expect(confirmOperation).toEqual(["delete", "undo"]);
});
