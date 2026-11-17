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
  await expect(page.getByLabel("Amount")).toHaveValue("1.000");
  await expect(page.getByLabel("Type")).toHaveValue("expense");
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

  // The sidebar has no duplicate brand or toggle; the chat header owns the toggle.
  await expect(sidebar.getByText("Where My Buck Go")).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Collapse sidebar" })).toHaveCount(0);
  await expect(page.getByRole("main").getByText("AI Chat", { exact: true })).toHaveCount(0);

  // Test collapsing sidebar
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveClass(/lg:w-0/);

  // Test expanding sidebar
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(sidebar).not.toHaveClass(/lg:w-0/);

  // Test New chat button in sidebar
  await sidebar.getByRole("button", { name: "New chat" }).click();
  await expect(page).toHaveURL(/\/chat$/);
});

test("draft fields are editable inline and saved before confirming", async ({ page }) => {
  const draft = { ...proposal, amount: "42000", description: "ăn hủ tiếu", occurredDate: null, canConfirm: false };
  let amendBody: Record<string, unknown> | null = null;
  let confirmedVersion: unknown = null;

  await openChat(page);
  await page.route("**/api/chat/messages", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ kind: "intake", message: "Draft ready.", proposals: [draft], errors: [] }),
  }));
  await page.route("**/api/proposals/proposal-test-1", async (route) => {
    amendBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...draft, version: 2, amount: "45000", category: "shopping", occurredDate: "2026-11-12",
        occurredTime: "19:00", period: "tối", timeSource: "explicit", canConfirm: true,
      }),
    });
  });
  await page.route("**/api/proposals/proposal-test-1/confirm", async (route) => {
    confirmedVersion = route.request().postDataJSON().expectedVersion;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        proposal: { ...draft, version: 3, state: "confirmed" },
        transaction: { id: "t1", version: 1, deleted: false, amount: "45000", currency: "VND", direction: "expense",
          description: "ăn hủ tiếu", category: "shopping", occurredDate: "2026-11-12", occurredTime: "19:00",
          period: "tối", timeSource: "explicit" },
      }),
    });
  });

  await page.getByRole("textbox", { name: "Message" }).fill("ăn hủ tiếu 42k");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Pick a date (or tell me in chat) to confirm.")).toBeVisible();
  await page.getByLabel("Amount").fill("45.000");
  await page.getByLabel("Category").selectOption("shopping");
  await page.getByLabel("Date", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Time").fill("19:00");
  await page.getByRole("button", { name: "Save & confirm" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  expect(amendBody).toMatchObject({
    expectedVersion: 1, amount: "45000", category: "shopping", occurredDate: "2026-11-12",
    occurredTime: "19:00", period: null, description: "ăn hủ tiếu", direction: "expense",
  });
  expect(confirmedVersion).toBe(2);
});

test("a follow-up message sends pending drafts and replaces the revised card", async ({ page }) => {
  const draft = { ...proposal, description: "ăn hủ tiếu", occurredDate: null, canConfirm: false };
  const bodies: Record<string, unknown>[] = [];

  await openChat(page);
  await page.route("**/api/chat/messages", async (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    const response = bodies.length === 1
      ? { kind: "intake", message: "Đã tạo bản nháp.", proposals: [draft], errors: [] }
      : { kind: "intake", message: "Đã cập nhật bản nháp.", revisedProposalIds: [draft.id], errors: [],
          proposals: [{ ...draft, version: 2, occurredDate: "2026-11-12", occurredTime: "19:00", canConfirm: true }] };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });

  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("ăn hủ tiếu 42k");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Đã tạo bản nháp.")).toBeVisible();
  await composer.fill("tối qua 7h");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Đã cập nhật bản nháp.")).toBeVisible();

  expect(bodies[0].pendingProposalIds).toBeUndefined();
  expect(bodies[1].pendingProposalIds).toEqual([draft.id]);
  const history = bodies[1].history as { role: string; text: string }[];
  expect(history[1].text).toContain(`[Draft ${draft.id}] ăn hủ tiếu`);
  await expect(page.getByText("Draft preview")).toHaveCount(1);
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2026-11-12");
});

test("starter questions show only on a new, empty chat and send when picked", async ({ page }) => {
  const sent: string[] = [];
  await openChat(page);
  await page.route("**/api/chat/messages", async (route) => {
    sent.push(route.request().postDataJSON().text);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      kind: "qa", message: "Tuần này bạn đã chi 450.000 ₫.", start: "2026-11-16", end: "2026-11-22",
      totals: { income: "0", expense: "450000" },
    }) });
  });

  const starters = page.getByRole("navigation", { name: "Suggested questions" });
  await expect(starters.getByRole("button")).toHaveCount(4);
  await starters.getByRole("button", { name: "Tuần này tôi đã chi bao nhiêu?" }).click();

  await expect(page.getByText("Tuần này bạn đã chi 450.000 ₫.")).toBeVisible();
  expect(sent).toEqual(["Tuần này tôi đã chi bao nhiêu?"]);
  await expect(starters).toHaveCount(0);
});
