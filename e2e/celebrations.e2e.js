// Celebrations end to end: a goal reached by adding money, and a zero-based month
// fully assigned. Each plays once, from the user's own action, and is announced at
// every Motion level. Nothing is saved, so a reload never replays it.
import { expect, test } from "@playwright/test";

const TODAY = "2026-11-02";

/** Signs up a fresh user (no sample data) and closes the sign-up dialogs. */
async function signUp(page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00`));
  await page.goto("/");
  await page
    .locator(".segmented button", { hasText: "Create account" })
    .click();
  await page.fill("input[name=name]", "Tester");
  await page.fill("input[name=email]", `party${Date.now()}@example.com`);
  await page.fill("input[name=password]", "correct-horse-9");
  await page.locator("form button.btn-primary").click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await closeDialogs(page);
}

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

/** Stores goals for this user, then reloads so the app reads them. */
async function seedGoals(page, goals) {
  await page.evaluate((goals) => {
    const key = Object.keys(localStorage).find((k) => k.endsWith(".goals"));
    localStorage.setItem(key, JSON.stringify(goals));
  }, goals);
  await page.reload();
  await closeDialogs(page);
}

const nav = (page, name) =>
  page.locator(".nav-item", { hasText: name }).click();
const announced = (page) => page.locator("main [role=status].sr-only");
const confetti = (page) => page.locator("canvas.confetti");

/** Fails if a confetti canvas shows up at any point during `ms` (no retry hides it). */
async function expectNoConfettiFor(page, ms = 1500) {
  for (let t = 0; t < ms; t += 100) {
    expect(await confetti(page).count()).toBe(0);
    await page.waitForTimeout(100);
  }
}

const emergency = {
  id: "ef",
  name: "Emergency fund",
  target: 5000,
  saved: 4100,
  deadline: "2027-06-01",
};

/** Adds money to a goal through its card. */
async function addMoney(page, goal, amount) {
  await page.getByLabel(`Contribute to ${goal}`).fill(String(amount));
  await page
    .locator(".card", { hasText: goal })
    .getByRole("button", { name: "Add money" })
    .click();
}

test("adding the last dollars to a goal celebrates once, and a reload doesn't replay it", async ({
  page,
}) => {
  await signUp(page);
  await seedGoals(page, [emergency]);
  await nav(page, "Goals");
  await expect(confetti(page)).toHaveCount(0); // nothing on load

  await addMoney(page, "Emergency fund", 900);
  await expect(announced(page)).toHaveText(
    "Emergency fund goal reached: $5,000.00 saved.",
  );
  await expect(confetti(page)).toHaveCount(1);
  await expect(page.locator(".card.celebrate-glow")).toHaveCount(1);
  // The burst ends on its own and leaves nothing behind.
  await expect(confetti(page)).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator(".celebrate-glow")).toHaveCount(0);
  await expect(page.getByText("Goal reached!")).toBeVisible();

  // Already reached: more money is saved but doesn't celebrate again.
  await addMoney(page, "Emergency fund", 50);
  await expect(
    page.locator(".card", { hasText: "Emergency fund" }),
  ).toContainText("$5,050.00");
  await expect(confetti(page)).toHaveCount(0);

  await page.reload();
  await closeDialogs(page);
  await nav(page, "Goals");
  await expect(announced(page)).toHaveText("");
  await expect(confetti(page)).toHaveCount(0);
});

test("money added that stays short of the target, or taken out, doesn't celebrate", async ({
  page,
}) => {
  await signUp(page);
  await seedGoals(page, [emergency]);
  await nav(page, "Goals");
  await addMoney(page, "Emergency fund", 899.99);
  await addMoney(page, "Emergency fund", -100);
  await expect(
    page.locator(".card", { hasText: "Emergency fund" }),
  ).toContainText("$4,899.99");
  await page.waitForTimeout(300);
  await expect(confetti(page)).toHaveCount(0);
  await expect(announced(page)).toHaveText("");
});

test("with reduced motion: no confetti, but the glow and the announcement", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signUp(page);
  await seedGoals(page, [emergency]);
  await nav(page, "Goals");
  await addMoney(page, "Emergency fund", 900);
  await expect(announced(page)).toHaveText(
    "Emergency fund goal reached: $5,000.00 saved.",
  );
  await expect(page.locator(".card.celebrate-glow")).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(confetti(page)).toHaveCount(0);

  // Turning reduced motion off afterwards doesn't start confetti for that old goal.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expectNoConfettiFor(page);
});

test("a burst stopped by reduced motion mid-way doesn't come back", async ({
  page,
}) => {
  await signUp(page);
  await seedGoals(page, [emergency]);
  await nav(page, "Goals");
  await addMoney(page, "Emergency fund", 900);
  await expect(confetti(page)).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(confetti(page)).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expectNoConfettiFor(page);
});

test("Motion Off: the announcement only", async ({ page }) => {
  await signUp(page);
  await nav(page, "Settings");
  await page.getByRole("radio", { name: /^Off/ }).check();
  await seedGoals(page, [emergency]);
  await nav(page, "Goals");
  await addMoney(page, "Emergency fund", 900);
  await expect(announced(page)).toHaveText(
    "Emergency fund goal reached: $5,000.00 saved.",
  );
  await page.waitForTimeout(300);
  await expect(confetti(page)).toHaveCount(0);
});

test("assigning every dollar celebrates after typing pauses, never on the way", async ({
  page,
}) => {
  await signUp(page);
  await nav(page, "Budget");
  const income = page.getByLabel("Income for Nov 2026");
  const housing = page.getByLabel("Housing allocation for Nov 2026");
  await income.fill("100");

  // Typing 1000 passes through $100 (left $0.00), but ends over-assigned: no celebration.
  await housing.click();
  await page.keyboard.type("1000", { delay: 80 });
  await expect(page.locator(".stat-value").nth(2)).toHaveText("-$900.00");
  await page.waitForTimeout(1000);
  await expect(confetti(page)).toHaveCount(0);
  await expect(announced(page)).toHaveText("");

  // Back to exactly $100: every dollar assigned.
  await housing.fill("100");
  await expect(announced(page)).toHaveText(
    "Every dollar assigned for Nov 2026.",
  );
  await expect(confetti(page)).toHaveCount(1);
  await expect(page.locator(".card.celebrate-glow")).toHaveCount(1);
  await expect(
    page.getByText("Every dollar assigned", { exact: true }),
  ).toBeVisible();

  // Staying at $0.00 doesn't celebrate again; a reload doesn't either.
  await expect(confetti(page)).toHaveCount(0, { timeout: 3000 });
  await income.fill("100");
  await page.waitForTimeout(1000);
  await expect(confetti(page)).toHaveCount(0);
  await page.reload();
  await closeDialogs(page);
  await nav(page, "Budget");
  await expect(announced(page)).toHaveText("");
});

test("a suggested (unconfirmed) income at $0.00 left doesn't celebrate", async ({
  page,
}) => {
  await signUp(page);
  await nav(page, "Budget");
  // No confirmed income and no suggestion: income is $0, so $0.00 left isn't "every dollar".
  const housing = page.getByLabel("Housing allocation for Nov 2026");
  await housing.fill("50");
  await housing.fill("");
  await page.waitForTimeout(1000);
  await expect(confetti(page)).toHaveCount(0);
  await expect(announced(page)).toHaveText("");
});
