// The optional pay schedule step right after sign-up.
import { expect, test } from "@playwright/test";

async function signUp(page) {
  await page.clock.setFixedTime(new Date("2026-11-02T10:00:00"));
  await page.goto("/");
  await page
    .locator(".segmented button", { hasText: "Create account" })
    .click();
  await page.fill("input[name=name]", "Tester");
  await page.fill("input[name=email]", `onb${Date.now()}@example.com`);
  await page.fill("input[name=password]", "correct-horse-9");
  await page.locator("form button.btn-primary").click();
  // Recovery key first: tick and continue.
  const key = page.locator("dialog[open]");
  await key.locator("input[type=checkbox]").check();
  await key.locator(".btn-primary").click();
  return page.locator("dialog[open]");
}

test("sign-up offers the pay schedule, explains bad input, and saves it", async ({
  page,
}) => {
  const step = await signUp(page);
  await expect(step.getByRole("heading")).toHaveText("When do you get paid?");
  await step.getByLabel("How often").selectOption("twice-monthly");
  await step.getByLabel("Next payday").fill("2026-11-06");
  await step.getByLabel("First payday of the month").fill("15");
  await step.getByLabel("Second payday of the month").fill("31");
  await step.getByRole("button", { name: "Save schedule" }).click();
  // Nov 6 isn't the 15th or the 30th (31 clamps): explained, not saved.
  await expect(step.getByRole("status")).toContainText(
    "Your next payday should fall on one of the two paydays.",
  );
  await step.getByLabel("Next payday").fill("2026-11-15");
  await step.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText("When do you get paid?")).toHaveCount(0);

  await page.keyboard.press("Escape"); // welcome summary
  await page.getByRole("button", { name: "Not now" }).click(); // tour offer
  await page.locator(".nav-item", { hasText: "Bills" }).click();
  await expect(page.locator(".pay-upcoming")).toContainText(
    "Next paydays: Nov 15, 2026, Nov 30, 2026, Dec 15, 2026",
  );
});

test("the step can be skipped and doesn't come back", async ({ page }) => {
  const step = await signUp(page);
  await step.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("When do you get paid?")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("When do you get paid?")).toHaveCount(0);
});
