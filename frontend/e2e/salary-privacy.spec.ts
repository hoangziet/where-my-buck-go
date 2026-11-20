import { expect, test } from "@playwright/test";

test("salary privacy setting toggles salary visibility across settings and transactions", async ({ page }) => {
  let salaryModeEnabled = false;
  const putRequests: { enabled: boolean }[] = [];

  await page.route("**/api/auth/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ username: "owner", salaryModeEnabled }),
  }));

  await page.route("**/api/settings/telegram", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ connected: false, botUsername: null, paired: false }),
  }));

  await page.route("**/api/settings/salary-mode", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = JSON.parse(route.request().postData() || "{}");
      putRequests.push(payload);
      salaryModeEnabled = Boolean(payload.enabled);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ salaryModeEnabled }),
      });
    } else {
      await route.fallback();
    }
  });

  await page.route("**/api/transactions", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [] }),
  }));

  // 1. Open settings page and verify switch starts off
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Salary privacy" })).toBeVisible();

  const salarySwitch = page.getByRole("switch", { name: "Enable salary mode" });
  await expect(salarySwitch).toBeVisible();
  await expect(salarySwitch).not.toBeChecked();

  // 2. Toggle switch on: sends PUT /api/settings/salary-mode with enabled: true and reflects checked state
  const putPromise = page.waitForRequest(
    (req) => req.url().includes("/api/settings/salary-mode") && req.method() === "PUT",
  );
  await salarySwitch.click();
  const putRequest = await putPromise;
  expect(JSON.parse(putRequest.postData() || "{}")).toEqual({ enabled: true });
  await expect(salarySwitch).toBeChecked();
  expect(putRequests.at(-1)).toEqual({ enabled: true });

  // 3. Navigate to Transactions: verify the Salary category option appears
  await page.locator("header nav[aria-label='App']").getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  await expect(page.locator("select option[value='salary']").first()).toBeAttached();
  await expect(page.locator("select option[value='salary']").first()).toHaveText("Salary");

  // 4. Return to Settings and switch back off
  await page.getByLabel("Settings").click();
  await expect(page.getByRole("heading", { name: "Salary privacy" })).toBeVisible();
  await expect(salarySwitch).toBeChecked();

  const putOffPromise = page.waitForRequest(
    (req) => req.url().includes("/api/settings/salary-mode") && req.method() === "PUT",
  );
  await salarySwitch.click();
  const putOffRequest = await putOffPromise;
  expect(JSON.parse(putOffRequest.postData() || "{}")).toEqual({ enabled: false });
  await expect(salarySwitch).not.toBeChecked();
  expect(putRequests.at(-1)).toEqual({ enabled: false });

  // 5. Navigate to Transactions: verify Salary option disappears
  await page.locator("header nav[aria-label='App']").getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  await expect(page.locator("select option[value='salary']")).toHaveCount(0);
});
