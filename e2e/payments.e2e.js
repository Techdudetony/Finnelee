// Payments end to end: linked installments, Mark paid, Undo and projected balances,
// through the real UI. The clock is fixed so every date and amount is predictable.
import { expect, test } from "@playwright/test";

const TODAY = "2026-11-02";

// A car loan paid in two installment bills (both linked to the debt), an ordinary bill,
// recently updated cash and a pay schedule. Payday Nov 6, so the spending window is
// Nov 2-5 and holds only installment 1 ($200).
const seed = {
  accounts: [
    {
      id: "chk",
      type: "asset",
      kind: "cash",
      name: "Checking",
      balance: 3000,
      updated: TODAY,
    },
  ],
  debts: [
    { id: "car", name: "Car loan", balance: 9000, apr: 6.5, minPayment: 400 },
  ],
  bills: [
    {
      id: "p1",
      name: "Car installment 1",
      amount: 200,
      dueDay: 5,
      category: "Transport",
      payFor: { type: "debt", id: "car" },
    },
    {
      id: "p2",
      name: "Car installment 2",
      amount: 200,
      dueDay: 12,
      category: "Transport",
      payFor: { type: "debt", id: "car" },
    },
    {
      id: "net",
      name: "Internet",
      amount: 65,
      dueDay: 8,
      category: "Utilities",
    },
  ],
  transactions: [],
  paySchedule: { cadence: "biweekly", next: "2026-11-06", amount: 2000 },
};

/** Closes whatever dialog is open (recovery key needs its box ticked first). */
async function closeDialogs(page) {
  for (let i = 0; i < 4; i++) {
    const dialog = page.locator("dialog[open]");
    if (!(await dialog.count())) return;
    const tick = dialog.locator("input[type=checkbox]");
    if (await tick.count()) {
      await tick.check();
      await dialog.locator(".btn-primary").click();
    } else if (
      await dialog.getByRole("button", { name: "Skip for now" }).count()
    ) {
      await dialog.getByRole("button", { name: "Skip for now" }).click();
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(200);
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00`));
  await page.goto("/");
  await page
    .locator(".segmented button", { hasText: "Create account" })
    .click();
  await page.fill("input[name=name]", "Tester");
  await page.fill("input[name=email]", `e2e${Date.now()}@example.com`);
  await page.fill("input[name=password]", "correct-horse-9");
  await page.locator("form button.btn-primary").click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await closeDialogs(page);

  // Put the scenario into this user's storage, then reload so the app reads it.
  await page.evaluate((data) => {
    const key = Object.keys(localStorage).find((k) => k.endsWith(".settings"));
    const prefix = key.slice(0, -"settings".length);
    for (const slice of ["accounts", "debts", "bills", "transactions"])
      localStorage.setItem(prefix + slice, JSON.stringify(data[slice]));
    const settings = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...settings, paySchedule: data.paySchedule }),
    );
  }, seed);
  await page.reload();
  await closeDialogs(page);
});

const nav = (page, name) =>
  page.locator(".nav-item", { hasText: name }).click();
const spending = (page) => page.locator(".spend-card");
const runway = (page) => page.locator(".runway");

test("linked installments are counted once, each on its own date", async ({
  page,
}) => {
  await expect(spending(page)).toContainText("Estimated spendable amount");
  await expect(spending(page)).toContainText("$2,800.00"); // 3,000 − installment 1
  // Both installments are on the runway; the $400 minimum is not added on top.
  const list = runway(page).locator(".runway-list");
  await expect(list).toContainText("Car installment 1");
  await expect(list).toContainText("Car installment 2");
  await expect(list).not.toContainText("minimum payment");
  await spending(page).getByText("How this is worked out").click();
  await expect(spending(page).locator(".spend-lines li")).toHaveCount(2); // cash, installment 1
});

test("projected balance steps down at bills and up at the payday", async ({
  page,
}) => {
  await expect(runway(page).locator(".runway-projection")).toBeVisible();
  await expect(runway(page)).toContainText(
    "Projection from your records: from $3,000.00 recently updated cash, lowest $2,800.00 on Nov 5, 2026.",
  );
  // Tapping a day says what's due, in words.
  await runway(page)
    .getByRole("button", { name: /^Nov 6, 2026: Payday, \$2,000\.00/ })
    .click();
  await expect(runway(page).locator(".runway-detail")).toHaveText(
    "Nov 6, 2026: Payday, $2,000.00",
  );
});

test("Mark paid on an installment, then Undo, restores everything", async ({
  page,
}) => {
  await nav(page, "Bills");
  const mark = page.getByRole("button", {
    name: "Mark paid for Nov 2026, Car installment 1",
  });
  await mark.dblclick(); // a double click still records one payment
  await expect(
    page.getByText("Paid for Nov 2026 (marked Nov 2)"),
  ).toBeVisible();

  await nav(page, "Transactions");
  await expect(page.getByText("Car installment 1")).toHaveCount(1);

  await nav(page, "Dashboard");
  await expect(spending(page)).toContainText("$3,000.00"); // installment 1 no longer owed
  await expect(runway(page)).toContainText("lowest $3,000.00");

  await nav(page, "Bills");
  await page
    .getByRole("button", { name: "Undo paid for Nov 2026, Car installment 1" })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Mark paid for Nov 2026, Car installment 1",
    }),
  ).toBeFocused();

  await nav(page, "Transactions");
  await expect(page.getByText("Car installment 1")).toHaveCount(0);
  await nav(page, "Dashboard");
  await expect(spending(page)).toContainText("$2,800.00");
  await expect(runway(page)).toContainText("lowest $2,800.00 on Nov 5, 2026");
});

test("marking the loan paid covers every linked installment, and survives a reload", async ({
  page,
}) => {
  await nav(page, "Debt Planner");
  await page
    .getByRole("button", { name: "Mark paid for Nov 2026, Car loan" })
    .click();
  await page.reload();
  await closeDialogs(page);
  await nav(page, "Debt Planner");
  await expect(
    page.getByText("Paid for Nov 2026 (marked Nov 2)"),
  ).toBeVisible();

  await nav(page, "Dashboard");
  const list = runway(page).locator(".runway-list");
  await expect(list).not.toContainText("Car installment");
  await expect(list).toContainText("Internet");
  await expect(spending(page)).toContainText("$3,000.00");

  await nav(page, "Debt Planner");
  await page
    .getByRole("button", { name: "Undo paid for Nov 2026, Car loan" })
    .click();
  await nav(page, "Dashboard");
  await expect(runway(page).locator(".runway-list")).toContainText(
    "Car installment 2",
  );
});

test("without a pay schedule: 14-day window, no paydays and no projection", async ({
  page,
}) => {
  await nav(page, "Bills");
  await page.getByRole("button", { name: "Remove schedule" }).click();
  await nav(page, "Dashboard");
  await expect(runway(page)).toContainText(
    "Paydays aren't shown. Add your pay schedule on the Bills page.",
  );
  await expect(runway(page).locator(".runway-projection")).toHaveCount(0);
  // Without a schedule the window is 14 days: both installments and Internet are owed.
  await expect(spending(page)).toContainText("$2,535.00");
  await spending(page).getByText("How this is worked out").click();
  await expect(spending(page)).toContainText(
    "Counting payments in the next 14 days",
  );
});
