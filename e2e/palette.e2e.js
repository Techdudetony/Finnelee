// Command palette end to end: the shortcut, searching, keyboard movement, focus going
// to the right place, the Motion setting, and where the shortcut must not work.
import { expect, test } from "@playwright/test";

const TODAY = "2026-11-02";
const MOD = process.platform === "darwin" ? "Meta" : "Control";

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
  await page.fill("input[name=email]", `palette${Date.now()}@example.com`);
  await page.fill("input[name=password]", "correct-horse-9");
  await page.locator("form button.btn-primary").click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await closeDialogs(page);
}

const palette = (page) => page.getByRole("dialog", { name: "Command palette" });
const search = (page) => palette(page).getByRole("combobox");
const title = (page) => page.locator("main h1");
test("Ctrl K opens it; typing and Enter goes to the best match", async ({
  page,
}) => {
  await signUp(page);
  await page.keyboard.press(`${MOD}+k`);
  await expect(palette(page)).toBeVisible();
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("listbox")).toBeVisible();

  await search(page).fill("dbt"); // letters in order
  const first = page.getByRole("option").first();
  await expect(first).toContainText("Debt Planner");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(search(page)).toHaveAttribute(
    "aria-activedescendant",
    (await first.getAttribute("id")) ?? "",
  );
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator(".page-title")).toHaveText("Debt Planner");
  await expect(title(page)).toBeFocused(); // a plain "Go to" focuses the heading
});

test("arrows wrap, Home and End jump, and the count is announced", async ({
  page,
}) => {
  await signUp(page);
  await page.keyboard.press(`${MOD}+k`);
  await search(page).fill("add");
  await expect(palette(page).getByRole("status")).toHaveText("4 results");
  const options = page.getByRole("option");
  const selected = palette(page).locator('[aria-selected="true"]');
  await expect(selected).toContainText("Add a transaction");
  await page.keyboard.press("ArrowDown");
  await expect(selected).toContainText("Add a bill");
  await page.keyboard.press("End");
  await expect(selected).toContainText("Add a debt");
  await page.keyboard.press("ArrowDown"); // wraps to the top
  await expect(selected).toContainText("Add a transaction");
  await page.keyboard.press("ArrowUp"); // and back to the bottom
  await expect(selected).toContainText("Add a debt");
  await page.keyboard.press("Home");
  await expect(selected).toContainText("Add a transaction");
  await expect(options).toHaveCount(4);

  await search(page).fill("zzzz");
  await expect(palette(page).getByRole("status")).toHaveText("No matches");
  await expect(search(page)).toHaveAttribute("aria-expanded", "false");
  await palette(page)
    .getByRole("button", { name: "Show all pages and tasks" })
    .click();
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("");
});

test("Esc closes it and puts focus back where it was", async ({ page }) => {
  await signUp(page);
  await page.locator(".nav-item", { hasText: "Goals" }).focus();
  await page.keyboard.press(`${MOD}+k`);
  await expect(search(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator(".nav-item", { hasText: "Goals" })).toBeFocused();

  // The shortcut again closes it too, with the same focus return.
  await page.keyboard.press(`${MOD}+k`);
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press(`${MOD}+k`);
  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator(".nav-item", { hasText: "Goals" })).toBeFocused();
});

test("tasks open the page with focus in the field, once", async ({ page }) => {
  await signUp(page);
  await page.keyboard.press(`${MOD}+k`);
  await search(page).fill("add a transaction");
  await page.keyboard.press("Enter");
  await expect(page.locator(".page-title")).toHaveText("Transactions");
  await expect(
    page.locator('[data-focus-target="add-transaction"]'),
  ).toBeFocused();

  // From the same page: still works.
  await page.keyboard.press(`${MOD}+k`);
  await search(page).fill("import");
  await page.keyboard.press("Enter");
  await expect(
    page.locator('[data-focus-target="import-statement"]'),
  ).toBeFocused();

  // Another page's field, then normal navigation: the request is gone, so nothing
  // steals focus when Goals is opened again later.
  await page.keyboard.press(`${MOD}+k`);
  await search(page).fill("paycheck");
  await page.keyboard.press("Enter");
  await expect(page.locator(".page-title")).toHaveText("Bills");
  await expect(
    page.locator('[data-focus-target="pay-schedule"]'),
  ).toBeFocused();
  await page.locator(".nav-item", { hasText: "Goals" }).click();
  await page.locator(".nav-item", { hasText: "Bills" }).click();
  await page.waitForTimeout(300);
  await expect(page.locator(".nav-item", { hasText: "Bills" })).toBeFocused();

  // "Update your checking balance": the first cash account, else the add-account form.
  await page.keyboard.press(`${MOD}+k`);
  await search(page).fill("checking");
  await page.keyboard.press("Enter");
  await expect(page.locator(".page-title")).toHaveText("Net Worth");
  await expect(page.locator('[data-focus-target="add-account"]')).toBeFocused();
});

test("import a statement after an earlier import focuses Import another file", async ({
  page,
}) => {
  await signUp(page);
  await page.locator(".nav-item", { hasText: "Transactions" }).click();
  await page.locator('[data-focus-target="import-statement"]').setInputFiles({
    name: "bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Description,Amount\n2026-10-30,Coffee,-4.50\n"),
  });
  await page.getByRole("button", { name: /^Import 1 transaction/ }).click();
  await expect(
    page.getByRole("button", { name: "Import another file" }),
  ).toBeVisible();

  await page.keyboard.press(`${MOD}+k`);
  await search(page).fill("import");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Import another file" }),
  ).toBeFocused();
});

test("checking balance focuses the first cash account when there is one", async ({
  page,
}) => {
  await signUp(page);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith(".accounts"));
    localStorage.setItem(
      key,
      JSON.stringify([
        {
          id: "sav",
          type: "asset",
          kind: "savings",
          name: "Savings",
          balance: 900,
        },
        {
          id: "chk",
          type: "asset",
          kind: "cash",
          name: "Checking",
          balance: 1200,
        },
      ]),
    );
  });
  await page.reload();
  await closeDialogs(page);
  await page.keyboard.press(`${MOD}+k`);
  await search(page).fill("checking");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Checking balance")).toBeFocused();
});

test("Motion commands change only the Motion setting, and say so", async ({
  page,
}) => {
  await signUp(page);
  const stored = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((k) => !k.endsWith(".settings"))
          .map((k) => [k, localStorage.getItem(k)]),
      ),
    );
  const before = await stored();
  await page.locator(".nav-item", { hasText: "Budget" }).focus();
  await page.keyboard.press(`${MOD}+k`);
  await search(page).fill("motion off");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await expect(page.locator(".layout > [role=status]")).toHaveText(
    "Motion set to Off.",
  );
  await expect(page.locator(".nav-item", { hasText: "Budget" })).toBeFocused();
  expect(await stored()).toEqual(before); // no record changed

  await page.keyboard.press(`${MOD}+k`);
  await search(page).fill("motion full");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await expect(page.getByRole("radio", { name: /^Full/ })).toBeChecked();
});

test("the shortcut does nothing over another dialog or before signing in", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press(`${MOD}+k`);
  await expect(palette(page)).toHaveCount(0);

  await page
    .locator(".segmented button", { hasText: "Create account" })
    .click();
  await page.fill("input[name=name]", "Tester");
  await page.fill("input[name=email]", `modal${Date.now()}@example.com`);
  await page.fill("input[name=password]", "correct-horse-9");
  await page.locator("form button.btn-primary").click();
  await expect(page.locator("dialog[open]")).toBeVisible(); // the recovery key
  await page.keyboard.press(`${MOD}+k`);
  await page.waitForTimeout(200);
  await expect(palette(page)).toHaveCount(0);
});

test("on a phone, the search button opens it and Esc returns focus to it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page);
  const button = page.getByRole("button", { name: "Search pages and tasks" });
  await button.click();
  await expect(palette(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  );
  expect(overflow).toBe(0);
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();

  // The phone menu is open: the shortcut stays off.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.keyboard.press(`${MOD}+k`);
  await page.waitForTimeout(200);
  await expect(palette(page)).toHaveCount(0);
});

/** Run a command by typing its exact label in the palette. */
async function run(page, label) {
  await page.keyboard.press(`${MOD}+k`);
  await search(page).fill(label);
  await expect(palette(page).getByRole("option").first()).toContainText(label);
  await page.keyboard.press("Enter");
}

test("all seven tasks focus their field", async ({ page }) => {
  await signUp(page);
  const tasks = [
    ["Add a transaction", "Transactions", "add-transaction"],
    ["Import a statement", "Transactions", "import-statement"],
    ["Add a bill", "Bills", "add-bill"],
    ["Add a goal", "Goals", "add-goal"],
    ["Add a debt", "Debt Planner", "add-debt"],
    ["Update your checking balance", "Net Worth", "add-account"], // no accounts yet
    ["Set your pay schedule", "Bills", "pay-schedule"],
  ];
  for (const [label, pageTitle, target] of tasks) {
    await run(page, label);
    await expect(page.locator(".page-title")).toHaveText(pageTitle);
    await expect(page.locator(`[data-focus-target="${target}"]`)).toBeFocused();
  }
});

test("Cmd K works too", async ({ page }) => {
  await signUp(page);
  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toHaveCount(0);
});

test("opened from a focused sidebar button, a command moves focus to its page", async ({
  page,
}) => {
  await signUp(page);
  const goals = page.locator(".nav-item", { hasText: "Goals" });

  // Go to: the destination heading keeps focus (the opener doesn't take it back).
  await goals.focus();
  await run(page, "Budget");
  await expect(page.locator(".page-title")).toHaveText("Budget");
  await expect(title(page)).toBeFocused();
  await page.waitForTimeout(500);
  await expect(title(page)).toBeFocused();

  // A task: its field keeps focus.
  await goals.focus();
  await run(page, "Add a bill");
  await expect(page.locator('[data-focus-target="add-bill"]')).toBeFocused();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-focus-target="add-bill"]')).toBeFocused();

  // From the Search button, same result.
  await page.locator(".palette-open").click();
  await search(page).fill("Forecast");
  await page.keyboard.press("Enter");
  await expect(page.locator(".page-title")).toHaveText("Forecast");
  await page.waitForTimeout(500);
  await expect(title(page)).toBeFocused();

  // Closing without a command still goes back to the opener.
  await goals.focus();
  await page.keyboard.press(`${MOD}+k`);
  await page.keyboard.press("Escape");
  await expect(goals).toBeFocused();
});

/** Hides the Goals name field's focus target until `restore()` runs in the page. */
async function holdBackGoalField(page, ms) {
  await page.evaluate((ms) => {
    const strip = (el) => {
      el.removeAttribute("data-focus-target");
      el.dataset.heldBack = "add-goal";
      if (ms !== null)
        setTimeout(() => el.setAttribute("data-focus-target", "add-goal"), ms);
    };
    window.__holdBack = new MutationObserver(() => {
      const el = document.querySelector('[data-focus-target="add-goal"]');
      if (el && !el.dataset.heldBack) strip(el);
    });
    window.__holdBack.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }, ms);
}

test("a field that appears late still gets focus", async ({ page }) => {
  await signUp(page);
  await holdBackGoalField(page, 800); // appears 0.8 s after the page renders
  await run(page, "Add a goal");
  await expect(page.locator(".page-title")).toHaveText("Goals");
  await expect(page.locator('[data-focus-target="add-goal"]')).toBeFocused({
    timeout: 2500,
  });
});

test("a field that never appears: heading, an announcement, and no focus stolen later", async ({
  page,
}) => {
  await signUp(page);
  await holdBackGoalField(page, null);
  await run(page, "Add a goal");
  await expect(page.locator(".page-title")).toHaveText("Goals");
  await expect(title(page)).toBeFocused({ timeout: 4000 });
  await expect(page.locator(".layout > [role=status]")).toHaveText(
    "Add a goal: that field isn't available right now, so focus is on the page heading.",
  );

  // The request is gone: the field turning up later doesn't take focus.
  await page.evaluate(() => {
    window.__holdBack.disconnect();
    document
      .querySelector("[data-held-back]")
      ?.setAttribute("data-focus-target", "add-goal");
  });
  const nav = page.locator(".nav-item", { hasText: "Dashboard" });
  await nav.click();
  await page.locator(".nav-item", { hasText: "Goals" }).click();
  await page.waitForTimeout(500);
  await expect(page.locator(".nav-item", { hasText: "Goals" })).toBeFocused();
});
