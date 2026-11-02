// The Dashboard's Getting Started checklist end to end: who sees it, steps ticking
// themselves off from real data, Hide and restore, the one-time "all set up" card,
// permanent retirement, and phone layouts.
import { expect, test } from "@playwright/test";

const card = (page) => page.locator(".getting-started");
const PASSWORD = "correct-horse-9";

/** Sign up and get past the recovery key, pay schedule, summary and tour offer. */
async function signUp(page, { sample = false, runningClockAt = null } = {}) {
  // Usually a frozen date; runningClockAt starts a fake clock that keeps moving, so a
  // test can jump it forward (timers included).
  if (runningClockAt) await page.clock.install({ time: new Date(runningClockAt) });
  else await page.clock.setFixedTime(new Date("2026-11-02T10:00:00"));
  await page.goto("/");
  await page
    .locator(".segmented button", { hasText: "Create account" })
    .click();
  await page.fill("input[name=name]", "Tester");
  const email = `gs${Date.now()}${Math.random()}@example.com`;
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  if (sample) await page.check("input[name=withSampleData]");
  await page.locator("form button.btn-primary").click();
  const key = page.locator("dialog[open]");
  await key.locator("input[type=checkbox]").check();
  await key.locator(".btn-primary").click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.locator("dialog.summary-dialog[open]")).toBeVisible();
  await page.keyboard.press("Escape");
  return { email, toString: () => email };
}
const skipTour = (page) =>
  page.getByRole("button", { name: "Not now" }).click();

// Read or change this user's saved slices (finnelee.<userId>.<slice>).
const readSlice = (page, slice) =>
  page.evaluate((slice) => {
    const key = Object.keys(localStorage).find((k) =>
      k.endsWith(`.${slice}`),
    );
    return JSON.parse(localStorage.getItem(key));
  }, slice);
const writeSlices = (page, slices) =>
  page.evaluate((slices) => {
    const prefix = Object.keys(localStorage)
      .find((k) => k.endsWith(".settings"))
      .slice(0, -".settings".length);
    for (const [slice, value] of Object.entries(slices))
      localStorage.setItem(`${prefix}.${slice}`, JSON.stringify(value));
  }, slices);
const record = async (page) => (await readSlice(page, "settings")).gettingStarted;
// The record is saved by an effect just after the step's data: wait for it.
const completed = (page) =>
  expect
    .poll(async () => (await record(page))?.completedAt ?? null)
    .not.toBeNull();

// Four of five steps, written straight to storage (as if added on earlier visits).
const FOUR_DONE = {
  transactions: [
    {
      id: "t1",
      date: "2026-11-01",
      description: "Paycheck",
      category: "Salary",
      type: "income",
      amount: 2000,
    },
  ],
  accounts: [
    {
      id: "a1",
      name: "Checking",
      kind: "asset",
      type: "cash",
      balance: 900,
      updatedAt: "2026-11-01",
    },
  ],
  bills: [{ id: "b1", name: "Rent", amount: 1200, dueDay: 1, category: "Housing" }],
  budgets: { Groceries: 400 },
};

async function addGoal(page) {
  await page.locator(".nav-item", { hasText: "Goals" }).click();
  await page.getByLabel("Name").fill("Trip");
  await page.getByLabel("Target").fill("1000");
  await page.getByLabel("Deadline").fill("2027-06-01");
  await page.getByRole("button", { name: "Add goal" }).click();
}

const palette = (page) =>
  page.getByRole("dialog", { name: "Command palette" });
async function searchPalette(page, text) {
  await page.keyboard.press("Control+k");
  await palette(page).getByRole("combobox").fill(text);
}

test("a new account sees it after the tour, never under it", async ({ page }) => {
  await signUp(page);
  // The tour is the only modal: the card is ordinary page content behind it (inert),
  // never a second dialog.
  await expect(page.locator("dialog.tour[open]")).toBeVisible();
  expect(
    await page.evaluate(() => document.querySelector("dialog.tour").matches(":modal")),
  ).toBe(true);
  await expect(page.locator("dialog .getting-started")).toHaveCount(0);
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await skipTour(page);
  const region = page.getByRole("region", { name: "Getting started" });
  await expect(region).toBeVisible();
  await expect(region.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    "0 of 5 steps done",
  );
  await expect(region.getByRole("heading", { level: 3 })).toHaveText([
    "Track your first transaction",
    "Plan this month's budget",
    "Add an account",
    "Add a recurring bill",
    "Set a goal",
  ]);
  // Above the Health Orb.
  const cardBox = await card(page).boundingBox();
  const orbBox = await page.locator(".orb-hero").boundingBox();
  expect(cardBox.y).toBeLessThan(orbBox.y);
  // The tour was skipped, so a quiet way back to it.
  await expect(region.getByRole("button", { name: "Take the tour" })).toBeVisible();
  // It doesn't touch the tour's record.
  expect((await readSlice(page, "settings")).onboarding).toMatchObject({
    newAccount: true,
    outcome: "skipped",
  });
});

test("each button opens the right page with focus in the real field", async ({
  page,
}) => {
  await signUp(page);
  await skipTour(page);
  const cases = [
    ["Add a transaction", "Transactions", "add-transaction"],
    ["Plan your budget", "Budget", "planned-income"],
    ["Add an account", "Net Worth", "add-account"],
    ["Add a bill", "Bills", "add-bill"],
    ["Add a goal", "Goals", "add-goal"],
  ];
  for (const [button, title, target] of cases) {
    await page.locator(".nav-item", { hasText: "Dashboard" }).click();
    await card(page).getByRole("button", { name: button }).click();
    await expect(page.locator("h1.page-title")).toHaveText(title);
    await expect(page.locator(`[data-focus-target="${target}"]`)).toBeFocused();
  }
});

test("steps tick themselves off from data, including this month's budget", async ({
  page,
}) => {
  await signUp(page);
  await skipTour(page);
  // A confirmed income for this month counts.
  await card(page).getByRole("button", { name: "Plan your budget" }).click();
  await page.locator('[data-focus-target="planned-income"]').fill("3000");
  await expect(page.getByRole("status").filter({ hasText: "Getting started" })).toHaveText(
    "Getting started: Plan this month's budget done. 1 of 5 steps done.",
  );
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  const budgetRow = card(page).locator(".gs-item").nth(1);
  await expect(budgetRow).toHaveClass(/is-done/);
  await expect(budgetRow).toContainText("Done");
  await expect(card(page).getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  // Clearing it un-ticks the step (still derived, not ticked by hand).
  await page.locator(".nav-item", { hasText: "Budget" }).click();
  await page.locator('[data-focus-target="planned-income"]').fill("");
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  await expect(card(page).locator(".gs-item").nth(1)).not.toHaveClass(/is-done/);
});

test("Hide, then bring it back from Settings and from the palette", async ({
  page,
}) => {
  await signUp(page);
  await skipTour(page);
  // Nothing to restore while it's showing.
  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await expect(page.getByRole("button", { name: "Show Getting Started" })).toHaveCount(0);
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();

  await card(page).getByRole("button", { name: "Hide" }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator("main.content h1")).toBeFocused();
  expect((await record(page)).hiddenAt).toBeTruthy();
  await page.reload();
  await expect(page.locator(".orb-hero")).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await page.getByRole("button", { name: "Show Getting Started" }).click();
  await expect(page.locator('[data-focus-target="getting-started"]')).toBeFocused();
  expect((await record(page)).hiddenAt).toBe(null);

  await card(page).getByRole("button", { name: "Hide" }).click();
  await searchPalette(page, "getting started");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-focus-target="getting-started"]')).toBeFocused();
});

test("the fifth step on another page gives exactly one acknowledgement", async ({
  page,
}) => {
  await signUp(page);
  await skipTour(page);
  await writeSlices(page, FOUR_DONE);
  await page.reload();
  await expect(card(page).getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "4",
  );

  await addGoal(page);
  await completed(page);
  expect((await record(page)).acknowledgedAt).toBe(null);
  const completedAt = (await record(page)).completedAt;

  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  const done = page.getByRole("region", { name: "You're all set up" });
  await expect(done).toBeVisible();
  // It waits for Done across a reload (without a second burst)...
  await page.reload();
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Done" }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator("main.content h1")).toBeFocused();
  // ...and never shows again.
  await page.reload();
  await page.locator(".nav-item", { hasText: "Goals" }).click();
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  await expect(card(page)).toHaveCount(0);
  expect((await record(page)).completedAt).toBe(completedAt);

  // Deleting data afterwards doesn't bring it back, and nothing offers to restore it.
  await page.locator(".nav-item", { hasText: "Bills" }).click();
  await page.getByRole("button", { name: "Delete Rent" }).click();
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  await expect(card(page)).toHaveCount(0);
  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await expect(page.getByRole("button", { name: "Show Getting Started" })).toHaveCount(0);
  await searchPalette(page, "getting started");
  await expect(
    palette(page).getByRole("option", { name: /Show Getting Started/ }),
  ).toHaveCount(0);
  expect((await record(page)).completedAt).toBe(completedAt);
});

test("a hidden checklist still retires for good, quietly", async ({ page }) => {
  await signUp(page);
  await skipTour(page);
  await card(page).getByRole("button", { name: "Hide" }).click();
  await writeSlices(page, {
    ...FOUR_DONE,
    settings: {
      ...(await readSlice(page, "settings")),
    },
  });
  await page.reload();
  await addGoal(page);
  await completed(page);
  const saved = await record(page);
  expect(saved.completedAt).toBeTruthy();
  expect(saved.acknowledgedAt).toBe(saved.completedAt);
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  await expect(card(page)).toHaveCount(0);
  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await expect(page.getByRole("button", { name: "Show Getting Started" })).toHaveCount(0);
});

test("sample data never shows the checklist or a celebration", async ({ page }) => {
  await signUp(page, { sample: true });
  await skipTour(page);
  await expect(page.locator(".orb-hero")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator("canvas.confetti")).toHaveCount(0);
  const saved = await record(page);
  expect(saved.completedAt).toBeTruthy();
  expect(saved.acknowledgedAt).toBe(saved.completedAt); // retired quietly
});

test("sample data loaded from Settings doesn't celebrate or show it", async ({
  page,
}) => {
  await signUp(page);
  await skipTour(page);
  await expect(card(page)).toBeVisible();
  await page.locator(".nav-item", { hasText: "Settings" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /sample data/i }).click();
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  await expect(page.locator(".orb-hero")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator("canvas.confetti")).toHaveCount(0);
});

test("existing accounts: empty ones get it, ones with bills or goals don't", async ({
  page,
}) => {
  await signUp(page);
  await skipTour(page);
  // An account from before the checklist and the tour: no records at all.
  const settings = await readSlice(page, "settings");
  delete settings.onboarding;
  delete settings.gettingStarted;
  await writeSlices(page, { settings });
  await page.reload();
  await expect(card(page)).toBeVisible(); // genuinely empty

  delete settings.gettingStarted;
  await writeSlices(page, {
    settings,
    bills: FOUR_DONE.bills,
    goals: [{ id: "g1", name: "Trip", target: 1000, saved: 0, deadline: "2027-06-01" }],
  });
  await page.reload();
  await expect(page.locator(".orb-hero")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

for (const width of [320, 390]) {
  test(`usable on a ${width}px phone`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await signUp(page);
    await skipTour(page);
    await expect(card(page)).toBeVisible();
    // No sideways scrolling, and every button is on screen at full size.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const buttons = card(page).locator(".gs-action .btn");
    await expect(buttons).toHaveCount(5);
    for (const b of await buttons.all()) {
      const box = await b.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThanOrEqual(38);
    }
    if (width === 320) {
      // The button gets its own full-width line instead of squeezing the title.
      const item = await card(page).locator(".gs-item").first().boundingBox();
      const button = await buttons.first().boundingBox();
      expect(button.width).toBeGreaterThan(item.width - 40);
    }
    // Tapping a step works on a phone too, without the menu drawer.
    await buttons.first().click();
    await expect(page.locator('[data-focus-target="add-transaction"]')).toBeFocused();
  });
}

async function signOutAndIn(page, email) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.locator("form button.btn-primary").click();
  await expect(page.locator("dialog.summary-dialog[open]")).toBeVisible();
  await page.keyboard.press("Escape");
}

test("the acknowledgement survives signing out, without replaying the celebration", async ({
  page,
}) => {
  const { email } = await signUp(page);
  await skipTour(page);
  await writeSlices(page, FOUR_DONE);
  await page.reload();
  await expect(card(page).getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "4",
  );
  // The fifth step, on another page; the Dashboard isn't visited before signing out.
  await addGoal(page);
  await completed(page);
  await signOutAndIn(page, email);

  const done = page.getByRole("region", { name: "You're all set up" });
  await expect(done).toBeVisible();
  // No celebration in a new session: no confetti, no glow, nothing announced.
  await page.waitForTimeout(300);
  await expect(page.locator("canvas.confetti")).toHaveCount(0);
  await expect(page.locator(".gs-complete.celebrate-glow")).toHaveCount(0);
  await expect(page.locator(".gs-complete")).not.toContainText("all five steps");

  await done.getByRole("button", { name: "Done" }).click();
  await expect(card(page)).toHaveCount(0);
  await signOutAndIn(page, email);
  await expect(page.locator(".orb-hero")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test("Clear all data keeps a finished checklist retired", async ({ page }) => {
  await signUp(page);
  await skipTour(page);
  await writeSlices(page, FOUR_DONE);
  await page.reload();
  await addGoal(page);
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  await page
    .getByRole("region", { name: "You're all set up" })
    .getByRole("button", { name: "Done" })
    .click();
  const finished = await record(page);

  await page.locator(".nav-item", { hasText: "Settings" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Clear all data" }).click();
  expect(await readSlice(page, "goals")).toEqual([]); // the data really is gone
  expect(await record(page)).toMatchObject({
    completedAt: finished.completedAt,
    acknowledgedAt: finished.acknowledgedAt,
  });
  await expect(page.getByRole("button", { name: "Show Getting Started" })).toHaveCount(0);
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  await expect(page.locator(".orb-hero")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".orb-hero")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test("an unfinished checklist starts fresh after Clear all data", async ({ page }) => {
  await signUp(page);
  await skipTour(page);
  await card(page).getByRole("button", { name: "Hide" }).click();
  await page.locator(".nav-item", { hasText: "Settings" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Clear all data" }).click();
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  await expect(card(page)).toBeVisible();
});

test("the budget step is checked again when the month changes, with the app left open", async ({
  page,
}) => {
  await signUp(page, { runningClockAt: "2026-11-30T23:55:00" });
  await skipTour(page);
  await card(page).getByRole("button", { name: "Plan your budget" }).click();
  await page.locator('[data-focus-target="planned-income"]').fill("3000");
  await page.locator(".nav-item", { hasText: "Dashboard" }).click();
  const budgetRow = card(page).locator(".gs-item").nth(1);
  await expect(budgetRow).toHaveClass(/is-done/);

  // Past midnight into December, without touching any data: November's income
  // doesn't plan December, so the step is open again.
  await page.clock.fastForward("10:00");
  await expect(budgetRow).not.toHaveClass(/is-done/);
  await expect(card(page).getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
});
