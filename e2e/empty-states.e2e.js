// Empty, not-enough-data and error states end to end: a new account with no sample data
// shows each one, its button opens the right page with focus in the right field, and a
// page that fails to draw is contained without touching saved data.
import { expect, test } from "@playwright/test";

const TODAY = "2026-11-02";

/** Closes whatever dialog is open (recovery key, pay schedule step, welcome summary). */
async function closeDialogs(page) {
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(250);
    const dialog = page.locator("dialog[open]");
    if (!(await dialog.count())) return;
    const tick = dialog.locator("input[type=checkbox]");
    const skip = dialog.getByRole("button", { name: "Skip for now" });
    if (await tick.count()) {
      await tick.check();
      await dialog.locator(".btn-primary").click();
    } else if (await skip.count()) await skip.click();
    else await page.keyboard.press("Escape");
  }
}

async function signUp(page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00`));
  await page.goto("/");
  await page
    .locator(".segmented button", { hasText: "Create account" })
    .click();
  await page.fill("input[name=name]", "Tester");
  await page.fill("input[name=email]", `empty${Date.now()}@example.com`);
  await page.fill("input[name=password]", "correct-horse-9");
  await page.locator("form button.btn-primary").click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await closeDialogs(page);
}

/** Replaces one stored slice (e.g. "transactions") for the signed-in user, then reloads. */
async function store(page, slice, value) {
  await page.evaluate(
    ([slice, value]) => {
      const key = Object.keys(localStorage).find((k) =>
        k.endsWith(`.${slice}`),
      );
      localStorage.setItem(key, JSON.stringify(value));
    },
    [slice, value],
  );
  await page.reload();
  await closeDialogs(page);
}

const readSlice = (page, slice) =>
  page.evaluate(
    (slice) =>
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.endsWith(`.${slice}`)),
      ),
    slice,
  );

async function goTo(page, name) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".nav-item", { hasText: name }).first().click();
  await expect(heading(page)).toHaveText(name === "Dashboard" ? /^Good/ : name);
}

const heading = (page) => page.locator("main h1");

const focused = (page) =>
  page.evaluate(() => document.activeElement?.dataset.focusTarget ?? null);

const expense = (date, amount) => ({
  id: `t${date}`,
  date,
  description: "Groceries",
  type: "expense",
  category: "Groceries",
  amount,
});

test("each empty state's button opens the right page with focus in the field", async ({
  page,
}) => {
  await signUp(page);
  const main = page.locator("main");
  const cases = [
    // [page, empty state title, button, page it lands on, focused field]
    [
      "Dashboard",
      "No income or spending yet",
      "Add a transaction",
      "Transactions",
      "add-transaction",
    ],
    [
      "Dashboard",
      "No spending this month yet",
      "Add an expense",
      "Transactions",
      "add-transaction",
    ],
    ["Dashboard", "No recurring bills yet", "Add a bill", "Bills", "add-bill"],
    [
      "Transactions",
      "No transactions yet",
      "Add a transaction",
      "Transactions",
      "add-transaction",
    ],
    [
      "Transactions",
      "No transactions yet",
      "Import a statement",
      "Transactions",
      "import-statement",
    ],
    ["Bills", "No recurring bills yet", "Add a bill", "Bills", "add-bill"],
    ["Goals", "No goals yet", "Add a goal", "Goals", "add-goal"],
    [
      "Net Worth",
      "No assets yet",
      "Add an account",
      "Net Worth",
      "add-account",
    ],
    [
      "Forecast",
      "Nothing to project yet",
      "Enter your savings",
      "Forecast",
      "current-savings",
    ],
    [
      "Forecast",
      "No spending recorded yet",
      "Add a transaction",
      "Transactions",
      "add-transaction",
    ],
    [
      "Budget",
      "Plan Nov 2026",
      "Enter planned income",
      "Budget",
      "planned-income",
    ],
    [
      "Budget",
      "Plan Nov 2026",
      "Set a category limit",
      "Budget",
      "category-limit",
    ],
  ];
  for (const [from, title, button, to, field] of cases) {
    await goTo(page, from);
    const state = main.locator(".empty-state", { hasText: title });
    await expect(state, `${from}: ${title}`).toBeVisible();
    await page.locator("main").click({ position: { x: 5, y: 5 } }); // focus starts elsewhere
    await state.getByRole("button", { name: button }).click();
    await expect(heading(page)).toHaveText(to);
    await expect.poll(() => focused(page), `${from} → ${button}`).toBe(field);
  }
  // "Set a category limit" lands on the first category row.
  await expect(page.locator(":focus")).toHaveAttribute(
    "aria-label",
    "Housing allocation for Nov 2026",
  );
});

test("an unplanned budget month never says every dollar is assigned", async ({
  page,
}) => {
  await signUp(page);
  await goTo(page, "Budget");
  const left = page.locator(".grid-stats .card", { hasText: "Left to assign" });
  await expect(left).toContainText("Add planned income to start");
  await expect(left).not.toContainText("Every dollar assigned");

  await page.getByLabel("Income for Nov 2026").fill("100");
  // Income but nothing assigned: the plan card stays, now offering category limits.
  const plan = page.locator(".empty-state", { hasText: "Plan Nov 2026" });
  await expect(plan).toBeVisible();
  await expect(left).toContainText("$100.00 to assign");

  await page.getByLabel("Housing allocation for Nov 2026").fill("100");
  await expect(left).toContainText("Every dollar assigned");
  await expect(plan).toHaveCount(0);
});

test("not enough data is told apart from no data", async ({ page }) => {
  await signUp(page);
  await goTo(page, "Forecast");
  const forecast = page.locator(".card", { hasText: "Spending forecast" });
  await expect(forecast.locator(".empty-empty")).toContainText(
    "No spending recorded yet",
  );

  // One full month of spending (October): not enough for a trend yet.
  await store(page, "transactions", [expense("2026-10-05", 80)]);
  await goTo(page, "Forecast");
  const notYet = forecast.locator(".empty-insufficient");
  await expect(notYet).toContainText("Not enough spending history yet");
  await expect(notYet).toContainText("You have 1 so far");
  await expect(notYet.locator(".empty-art-arc.filled")).toHaveCount(1);

  // Spending in the current month alone doesn't count: it isn't finished.
  await store(page, "transactions", [expense("2026-11-01", 30)]);
  await goTo(page, "Forecast");
  await expect(notYet).toContainText("You have 0 so far");

  // Two full months: the real forecast appears.
  await store(page, "transactions", [
    expense("2026-09-05", 70),
    expense("2026-10-05", 80),
  ]);
  await goTo(page, "Forecast");
  await expect(forecast).toContainText("Based on your trend");
  await expect(forecast.locator(".empty-state")).toHaveCount(0);

  // Net worth: one month of balances starts the history; the chart needs two.
  await goTo(page, "Net Worth");
  await expect(page.getByText("Net worth over time")).toHaveCount(0);
  await page.getByPlaceholder("e.g. Ally savings").fill("Checking");
  await page
    .locator(".card", { hasText: "Add an account" })
    .locator("input[type=number]")
    .first()
    .fill("500");
  await page.getByRole("button", { name: "Add account" }).click();
  const history = page.locator(".card", { hasText: "Net worth over time" });
  await expect(history.locator(".empty-insufficient")).toContainText(
    "2 months are recorded (1 so far)",
  );
});

test("a page that fails to draw is contained, and saved data is untouched", async ({
  page,
}) => {
  await signUp(page);
  await store(page, "goals", [null]); // a damaged record the Goals page can't draw
  const before = await readSlice(page, "goals");

  await goTo(page, "Goals");
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "couldn't be shown" });
  await expect(alert).toContainText("Goals couldn't be shown");
  await expect(alert).toContainText("Your saved data hasn't been changed");

  await alert.getByRole("button", { name: "Try again" }).click(); // still damaged
  await expect(alert).toBeVisible();

  // The Dashboard reads goals too, so it is contained the same way (no "Go to Dashboard"
  // there, since that's where you are).
  await alert.getByRole("button", { name: "Go to Dashboard" }).click();
  await expect(alert).toContainText("Dashboard couldn't be shown");
  await expect(
    alert.getByRole("button", { name: "Go to Dashboard" }),
  ).toHaveCount(0);
  await goTo(page, "Bills"); // the rest of the app keeps working
  await expect(page.getByText("No recurring bills yet")).toBeVisible();

  expect(await readSlice(page, "goals")).toBe(before);
});

test("debt-only users see net worth history start, not a hidden card", async ({
  page,
}) => {
  await signUp(page);
  const debt = {
    id: "d1",
    name: "Car loan",
    balance: 8000,
    apr: 6.5,
    minPayment: 250,
  };
  await store(page, "debts", [debt]);
  await goTo(page, "Net Worth");
  const history = page.locator(".card", { hasText: "Net worth over time" });
  const notYet = history.locator(".empty-insufficient");
  await expect(notYet).toContainText("Your Debt Planner debts already count");
  await expect(notYet).toContainText("(0 so far)");
  await expect(history.locator(".recharts-wrapper")).toHaveCount(0);

  // One snapshot from an earlier month (an account that was later removed): still
  // short of the two the chart needs.
  const settings = JSON.parse(await readSlice(page, "settings"));
  await store(page, "settings", {
    ...settings,
    netWorthHistory: { "2026-10": { assets: 0, liabilities: 8000 } },
  });
  await goTo(page, "Net Worth");
  await expect(notYet).toContainText("(1 so far)");
  await expect(history.locator(".recharts-wrapper")).toHaveCount(0);

  await notYet.getByRole("button", { name: "Add an account" }).click();
  await expect.poll(() => focused(page)).toBe("add-account");
});

test("going to Dashboard from the palette puts focus on its greeting", async ({
  page,
}) => {
  await signUp(page);
  await goTo(page, "Bills");
  const opener = page.locator(".nav-item", { hasText: "Goals" });
  await opener.focus();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Dashboard");
  await page.keyboard.press("Enter");
  await expect(heading(page)).toHaveText(/^Good/);
  await expect(heading(page)).toBeFocused();
  await page.waitForTimeout(400); // the closing palette must not pull focus back
  await expect(heading(page)).toBeFocused();
  await expect(opener).not.toBeFocused();

  // When the Dashboard can't be drawn there's no greeting: focus goes to the error.
  await store(page, "goals", [null]);
  await goTo(page, "Bills");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Dashboard");
  await page.keyboard.press("Enter");
  await expect(page.locator("main .empty-error")).toBeFocused();
});

test("the illustration fades in at Full motion only", async ({ page }) => {
  await signUp(page);
  const art = page.locator("main .empty-art").first();
  const animation = () =>
    art.evaluate((el) => getComputedStyle(el).animationName);
  for (const [level, expected] of [
    ["full", "rise"],
    ["calm", "none"],
    ["off", "none"],
  ]) {
    await page.evaluate((level) => {
      document.documentElement.dataset.motion = level;
    }, level);
    await goTo(page, "Goals");
    await expect.poll(animation, level).toBe(expected);
    await goTo(page, "Bills");
  }
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("empty states fit and their buttons still work", async ({ page }) => {
    await signUp(page);
    await goTo(page, "Goals");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    expect(overflow).toBe(0);
    await page
      .locator(".empty-state", { hasText: "No goals yet" })
      .getByRole("button", { name: "Add a goal" })
      .click();
    await expect.poll(() => focused(page)).toBe("add-goal");
  });
});
