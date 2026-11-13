import { expect, test } from "@playwright/test";

const proposal = {
  id: "proposal-test-1",
  version: 1,
  state: "draft",
  operation: "create",
  targetId: null,
  baseVersion: null,
  resultDeleted: false,
  amount: "1000",
  currency: "VND",
  direction: "expense",
  description: "coffee",
  category: "food_drink",
  occurredDate: "2026-11-13",
  occurredTime: "07:00",
  period: "morning",
  timeSource: "default",
  canConfirm: true,
  confirmedTransactionId: null,
  evidenceIds: [],
};

async function openChat(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ username: "owner" }),
  }));
  await page.route("**/api/chats", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [] }),
  }));
  await page.goto("/chat");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
}

test("text intake shows a draft and discard never confirms it", async ({ page }) => {
  let discardKey = "";
  let confirmRequests = 0;

  await openChat(page);
  await page.route("**/api/chat/messages", async (route) => {
    const request = route.request();
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.postDataJSON().text).toContain("coffee");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        kind: "intake",
        message: "Draft ready for review.",
        proposals: [proposal],
        errors: [],
      }),
    });
  });
  await page.route("**/api/proposals/proposal-test-1/discard", async (route) => {
    discardKey = route.request().headers()["idempotency-key"];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ proposal: { ...proposal, state: "discarded", canConfirm: false } }),
    });
  });
  await page.route("**/api/proposals/proposal-test-1/confirm", async (route) => {
    confirmRequests += 1;
    await route.fulfill({ status: 500 });
  });

  await page.getByRole("textbox", { name: "Message" }).fill("I spent 1,000 VND on coffee this morning");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Draft preview")).toBeVisible();
  await expect(page.getByText(/−1[.,]000 ₫/)).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Discarded")).toBeVisible();

  expect(discardKey).toBeTruthy();
  expect(confirmRequests).toBe(0);
});

test("pasted image stays in composer until sent with its caption", async ({ page }) => {
  let imageRequestBody = "";
  let imageRequestKey = "";

  await openChat(page);
  await page.route("**/api/chat/image-intake", async (route) => {
    imageRequestBody = route.request().postData() ?? "";
    imageRequestKey = route.request().headers()["idempotency-key"];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ kind: "image_intake", message: "Receipt preview ready.", proposal }),
    });
  });

  await page.getByRole("textbox", { name: "Message" }).evaluate((element) => {
    const transfer = new DataTransfer();
    const image = Uint8Array.from(atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/QioAAAAASUVORK5CYII=",
    ), (character) => character.charCodeAt(0));
    transfer.items.add(new File([image], "receipt.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }));
  });

  await expect(page.getByRole("img", { name: "Attached receipt" })).toBeVisible();
  await page.getByRole("textbox", { name: "Message" }).fill("Read this receipt");
  await expect(page.getByRole("img", { name: "Attached receipt" })).toBeVisible();
  expect(imageRequestBody).toBe("");

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Receipt preview ready.")).toBeVisible();
  expect(imageRequestBody).toContain("Read this receipt");
  expect(imageRequestBody).toContain("receipt.png");
  expect(imageRequestKey).toBeTruthy();
});
