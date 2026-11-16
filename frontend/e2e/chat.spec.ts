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

test("confirm retry reuses its idempotency key after a temporary failure", async ({ page }) => {
  const confirmKeys: string[] = [];

  await openChat(page);
  await page.route("**/api/chat/messages", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ kind: "intake", message: "Draft ready.", proposals: [proposal], errors: [] }),
  }));
  await page.route("**/api/proposals/proposal-test-1/confirm", async (route) => {
    confirmKeys.push(route.request().headers()["idempotency-key"]);
    if (confirmKeys.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary server failure" }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        proposal: { ...proposal, state: "confirmed", confirmedTransactionId: "transaction-test-1" },
        transaction: {
          id: "transaction-test-1",
          version: 1,
          deleted: false,
          amount: "1000",
          currency: "VND",
          direction: "expense",
          description: "coffee",
          category: "food_drink",
          occurredDate: "2026-11-13",
          occurredTime: "07:00",
          period: "morning",
          timeSource: "default",
        },
      }),
    });
  });

  await page.getByRole("textbox", { name: "Message" }).fill("I spent 1,000 VND on coffee");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Could not confirm.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  expect(confirmKeys).toHaveLength(2);
  expect(confirmKeys[0]).toBeTruthy();
  expect(confirmKeys[1]).toBe(confirmKeys[0]);
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

test("chat message timeout displays error with safe retry guidance and resends with same idempotency key", async ({ page }) => {
  const requestKeys: string[] = [];

  await openChat(page);
  await page.route("**/api/chat/messages", async (route) => {
    requestKeys.push(route.request().headers()["idempotency-key"]);
    if (requestKeys.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Gemini is unreachable after retrying temporary failures" }),
      });
      return;
    }
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

  const messageBox = page.getByRole("textbox", { name: "Message" });
  await messageBox.fill("Mua banh mi 25000");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Gemini is unreachable after retrying temporary failures")).toBeVisible();
  await expect(page.getByText("Your message is back in the composer; resend to retry safely.")).toBeVisible();
  await expect(messageBox).toHaveValue("Mua banh mi 25000");

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Draft preview")).toBeVisible();

  expect(requestKeys).toHaveLength(2);
  expect(requestKeys[0]).toBeTruthy();
  expect(requestKeys[1]).toBe(requestKeys[0]);
  await expect(page.getByText("Draft preview")).toHaveCount(1);
});

test("image intake timeout displays error with safe retry guidance and resends with same idempotency key", async ({ page }) => {
  const requestKeys: string[] = [];

  await openChat(page);
  await page.route("**/api/chat/image-intake", async (route) => {
    requestKeys.push(route.request().headers()["idempotency-key"]);
    if (requestKeys.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Gemini is unreachable after retrying temporary failures" }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        kind: "image_intake",
        message: "Receipt preview ready.",
        proposal,
      }),
    });
  });

  const messageBox = page.getByRole("textbox", { name: "Message" });
  await messageBox.evaluate((element) => {
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
  await messageBox.fill("Receipt caption");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Gemini is unreachable after retrying temporary failures")).toBeVisible();
  await expect(page.getByText("The image is back in the composer; resend to retry safely.")).toBeVisible();
  await expect(page.locator("form").getByRole("img", { name: "Attached receipt" })).toBeVisible();
  await expect(messageBox).toHaveValue("Receipt caption");

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Receipt preview ready.")).toBeVisible();

  expect(requestKeys).toHaveLength(2);
  expect(requestKeys[0]).toBeTruthy();
  expect(requestKeys[1]).toBe(requestKeys[0]);
});

test("chat sidebar lists previous chats and toggles collapse", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ username: "owner" }),
  }));
  await page.route("**/api/chats", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      items: [
        { id: "chat-123", title: "Cà phê sáng nay", createdAt: "2026-11-16T08:00:00Z" },
        { id: "chat-456", title: "Tiền phòng trọ", createdAt: "2026-11-15T10:00:00Z" },
      ],
    }),
  }));

  await page.goto("/chat");
  const sidebar = page.getByRole("complementary", { name: "Chat history" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("Cà phê sáng nay")).toBeVisible();
  await expect(sidebar.getByText("Tiền phòng trọ")).toBeVisible();

  // Test collapsing sidebar
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveClass(/lg:w-0/);

  // Test expanding sidebar
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(sidebar).not.toHaveClass(/lg:w-0/);

  // Test New chat button in sidebar
  await sidebar.getByRole("button", { name: "New chat" }).click();
  await expect(page).toHaveURL(/\/chat$/);
});
