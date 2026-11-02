// The What-If page end to end: it sits after Forecast, starts at zero, never writes to
// storage, labels overcommitted plans, works by keyboard and screen reader, honors the
// saved Debt Planner extra, and keeps the phone results bar in view.
import { expect, test } from "@playwright/test";

const PASSWORD = "correct-horse-9";

/** Sign up with sample data and get past the recovery key, pay schedule, summary and tour. */
async function signUp(page) {
  await page.clock.setFixedTime(new Date("2026-11-02T10:00:00"));
  await page.goto("/");
  await page
    .locator(".segmented button", { hasText: "Create account" })
    .click();
  await page.fill("input[name=name]", "Tester");
  await page.fill(
    "input[name=email]",
    `wi${Date.now()}${Math.random()}@example.com`,
  );
  await page.fill("input[name=password]", PASSWORD);
  await page.check("input[name=withSampleData]");
  await page.locator("form button.btn-primary").click();
  const key = page.locator("dialog[open]");
  await key.locator("input[type=checkbox]").check();
  await key.locator(".btn-primary").click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.locator("dialog.summary-dialog[open]")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Not now" }).click();
}

// Opens a page from the sidebar, or from the phone menu.
async function openPage(page, label) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".nav-item", { hasText: label }).click();
  await expect(page.locator("h1.page-title")).toHaveText(label);
}

// Every saved key of this user, as text.
const storage = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("finnelee."))
        .sort()
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  );

test("sits right after Forecast and starts with both paths equal", async ({
  page,
}) => {
  await signUp(page);
  const labels = await page.locator(".nav-item").allInnerTexts();
  const i = labels.findIndex((t) => t.includes("Forecast"));
  expect(labels[i + 1]).toContain("What-If");
  await openPage(page, "What-If");
  await expect(
    page.getByText("Sandbox: nothing here changes your records."),
  ).toBeVisible();
  await expect(page.getByText("Unfunded")).toHaveCount(0);
  const rings = page.locator(".whatif-ring");
  await expect(rings).toHaveCount(2);
  expect(await rings.nth(0).innerText()).toBe(await rings.nth(1).innerText());
  await expect(page.getByText("Financial Health in 12 months")).toBeVisible();
  await expect(
    page.getByText(/Educational planning indicator/).first(),
  ).toBeVisible();
});

test("never changes localStorage or any financial record", async ({ page }) => {
  await signUp(page);
  await openPage(page, "What-If");
  await page.waitForTimeout(300); // let page-open effects settle
  const before = await storage(page);

  await page.locator("#whatif-savings").fill("400");
  await page.getByRole("button", { name: "Add a cut" }).click();
  await page.locator("#whatif-cut-0").fill("50");
  await page.locator("#whatif-debt").fill("300");
  await page.getByLabel("Snowball (smallest balance first)").check();
  await page.getByRole("radio", { name: "Yes" }).check();
  await page.locator("#whatif-income").fill("250");
  await page.getByLabel("Starting").selectOption({ index: 3 });
  await page.getByLabel(/Grow general savings/).uncheck();
  await page.getByLabel("Years").selectOption("10");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.waitForTimeout(300);

  expect(await storage(page)).toEqual(before);
  // Leaving and coming back starts at zero again (nothing was saved).
  await page.locator("#whatif-savings").fill("400");
  await openPage(page, "Goals");
  await openPage(page, "What-If");
  await expect(page.locator("#whatif-savings")).toHaveValue("0");
});

test("labels an overcommitted plan as an unfunded hypothetical", async ({
  page,
}) => {
  await signUp(page);
  await openPage(page, "What-If");
  await page.locator("#whatif-savings").fill("10000");
  await expect(
    page.getByText(/more than your estimated cash flow can fund/),
  ).toBeVisible();
  await expect(page.locator(".whatif-tag").first()).toHaveText("Unfunded plan");
  await expect(
    page
      .getByText("Shows only what your estimated cash flow can fund.")
      .first(),
  ).toBeVisible();
  // Requested, funded and not funded add up.
  const flow = page.locator(".whatif-flow dd");
  const value = async (i) =>
    Number((await flow.nth(i).innerText()).replace(/[^0-9.]/g, ""));
  // Requested is capped at what the goals still need ($8,050 in the sample data).
  expect(await value(0)).toBe(8050);
  expect((await value(1)) + (await value(2))).toBe(8050);
  expect(await value(2)).toBeGreaterThan(0);
  // Dates are from funded money, and the full-funding date is labeled.
  await expect(page.getByText(/Could be reached/).first()).toBeVisible();
  await expect(page.getByText(/unfunded hypothetical/).first()).toBeVisible();
});

test("works by keyboard and announces results politely", async ({ page }) => {
  await signUp(page);
  await openPage(page, "What-If");
  const slider = page.getByRole("slider", {
    name: "Extra debt payment per month slider",
  });
  await slider.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect(page.locator("#whatif-debt")).toHaveValue("100");
  const live = page.locator("[aria-live=polite]", {
    hasText: /Debt-free about/,
  });
  await expect(live).toHaveCount(1);
  await page.getByRole("button", { name: "Reset" }).press("Enter");
  await expect(page.locator("#whatif-debt")).toHaveValue("0");
});

test("adds the What-If lever on top of the saved Debt Planner extra", async ({
  page,
}) => {
  await signUp(page);
  await openPage(page, "What-If");
  await expect(page.getByText(/\$200 is only a suggestion/)).toBeVisible();
  await openPage(page, "Debt Planner");
  // The $200 starting value is labeled a suggestion, never a plan.
  await expect(
    page.getByText(/is a suggestion, not your plan yet/),
  ).toBeVisible();
  await page.getByLabel("Extra payment", { exact: true }).fill("150");
  await expect(page.getByText("Saved as your plan")).toBeVisible();
  await page.getByRole("button", { name: "See it next to your goals" }).click();
  await expect(page.locator("#whatif-debt")).toBeFocused();
  await expect(
    page.getByText(/on top of the \$150 extra saved as your plan/),
  ).toBeVisible();
});

test("Debt Planner can save its suggestion as a plan, or clear the plan", async ({
  page,
}) => {
  await signUp(page);
  await openPage(page, "Debt Planner");
  const settings = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.endsWith(".settings"),
      );
      return JSON.parse(localStorage.getItem(key));
    });
  expect((await settings()).debtPlanner).toBeUndefined();
  await page.getByRole("button", { name: "Save $200.00 as my plan" }).click();
  await expect
    .poll(async () => (await settings()).debtPlanner?.extra)
    .toBe(200);
  await page.getByRole("button", { name: "Clear plan" }).click();
  await expect.poll(async () => (await settings()).debtPlanner).toBeUndefined();
  await expect(
    page.getByText(/is a suggestion, not your plan yet/),
  ).toBeVisible();
});

test("Goals opens the savings lever, and goals never get an invented date", async ({
  page,
}) => {
  await signUp(page);
  await openPage(page, "Goals");
  await page.getByRole("button", { name: "Try a what-if" }).click();
  await expect(page.locator("#whatif-savings")).toBeFocused();
  await expect(
    page.getByText(/Today's path: not projected/).first(),
  ).toBeVisible();
  await expect(page.getByText(/Could be reached/)).toHaveCount(0);
});

for (const width of [320, 390]) {
  test(`phone ${width}: one column, no sideways scroll, results bar in view`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await signUp(page);
    await openPage(page, "What-If");
    await page.locator("#whatif-debt").fill("300");
    const bar = page.locator(".whatif-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("Debt-free about");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await bar.click();
    await expect(page.locator("#whatif-results")).toBeFocused();
  });
}

for (const width of [1366, 1920]) {
  test(`desktop ${width}: levers beside results`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signUp(page);
    await openPage(page, "What-If");
    const levers = await page.locator(".whatif-levers").boundingBox();
    const results = await page.locator(".whatif-results").boundingBox();
    expect(levers.x + levers.width).toBeLessThanOrEqual(results.x);
    await expect(page.locator(".whatif-bar")).toHaveCount(0);
  });
}
