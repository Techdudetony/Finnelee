// The guided tour end to end: offered once to new accounts only, one modal with real
// focus behavior, real highlights, Show me, Explore all features, and Replay.
import { expect, test } from "@playwright/test";

const tour = (page) => page.locator("dialog.tour[open]");

/** Sign up; stops when the welcome summary is open (the tour comes after it). */
async function signUp(page, { sample = true } = {}) {
  await page.clock.setFixedTime(new Date("2026-11-02T10:00:00"));
  await page.goto("/");
  await page
    .locator(".segmented button", { hasText: "Create account" })
    .click();
  await page.fill("input[name=name]", "Tester");
  const email = `tour${Date.now()}${Math.random()}@example.com`;
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "correct-horse-9");
  if (sample) await page.check("input[name=withSampleData]");
  await page.locator("form button.btn-primary").click();
  const key = page.locator("dialog[open]");
  await key.locator("input[type=checkbox]").check();
  await key.locator(".btn-primary").click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.locator("dialog.summary-dialog[open]")).toBeVisible();
  return email;
}

const onboarding = (page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith(".settings"));
    return JSON.parse(localStorage.getItem(key)).onboarding;
  });

async function signInAgain(page, email) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "correct-horse-9");
  await page.locator("form button.btn-primary").click();
  await expect(page.locator("dialog.summary-dialog[open]")).toBeVisible();
  await page.keyboard.press("Escape");
}

for (const sample of [true, false]) {
  test(`a new account ${sample ? "with" : "without"} sample data is offered the tour once, after the summary`, async ({
    page,
  }) => {
    const email = await signUp(page, { sample });
    await expect(tour(page)).toHaveCount(0); // not while the summary is open
    await page.keyboard.press("Escape");
    await expect(tour(page)).toBeVisible();
    await expect(tour(page)).toHaveAccessibleName("Finnelee in three ideas");
    await expect(
      page.getByRole("button", { name: "Take the tour" }),
    ).toBeFocused();
    expect((await onboarding(page)).offeredAt).toBeTruthy();

    await page.getByRole("button", { name: "Not now" }).click();
    await expect(tour(page)).toHaveCount(0);
    expect(await onboarding(page)).toMatchObject({
      newAccount: true,
      outcome: "skipped",
    });
    await page.reload();
    await page.waitForTimeout(500);
    await expect(tour(page)).toHaveCount(0);
    await signInAgain(page, email);
    await page.waitForTimeout(500);
    await expect(tour(page)).toHaveCount(0);
  });
}

test("existing accounts never get it automatically, but can replay it", async ({
  page,
}) => {
  const email = await signUp(page, { sample: false });
  // Turn this into an account from before the tour: no onboarding record at all.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith(".settings"));
    const s = JSON.parse(localStorage.getItem(key));
    delete s.onboarding;
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  await page.waitForTimeout(300);
  await signInAgain(page, email);
  await page.waitForTimeout(500);
  await expect(tour(page)).toHaveCount(0);

  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await page.getByRole("button", { name: "Replay tour" }).click();
  await expect(tour(page)).toBeVisible();
  await expect(page.locator("main h1")).toHaveText(/^Good/); // on the Dashboard
  // A replay isn't an offer: Skip tour and Next.
  await expect(page.getByRole("button", { name: "Skip tour" })).toBeVisible();
  await expect(
    tour(page).getByRole("button", { name: "Next", exact: true }),
  ).toBeFocused();
  expect(await onboarding(page)).toBeUndefined();
});

test("it is the only modal: focus stays inside, Escape skips, focus comes back", async ({
  page,
}) => {
  await signUp(page);
  await page.keyboard.press("Escape");
  await expect(tour(page)).toBeVisible();
  await page.getByRole("button", { name: "Take the tour" }).click();

  // Tab never leaves the dialog, and the highlighted element can't take focus.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        document.querySelector("dialog.tour").contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await expect(page.locator(".orb-hero")).toBeVisible();
  expect(
    await page.evaluate(() => {
      const r = document.querySelector(".orb-hero").getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + 20, r.y + 20);
      return document.querySelector("dialog.tour").contains(hit);
    }),
  ).toBe(true);
  await expect(page.locator(".tour-ring")).toHaveCount(1);
  await expect(page.locator(".tour-shade")).toHaveAttribute(
    "aria-hidden",
    "true",
  );

  // Each step change is announced once, in one live region.
  const live = page.locator("dialog.tour [aria-live]");
  await expect(live).toHaveCount(1);
  await expect(live).toContainText("Step 2 of 8: Your financial health");
  await page.keyboard.press("ArrowRight");
  await expect(live).toContainText("Step 3 of 8: Each area needs enough data");
  await expect(tour(page)).toHaveAccessibleName("Each area needs enough data");

  await page.keyboard.press("Escape");
  await expect(tour(page)).toHaveCount(0);
  expect((await onboarding(page)).outcome).toBe("skipped");
  await expect(page.locator("main h1")).toBeFocused();
});

test("desktop: menu steps ring the real menu items, each one on its own", async ({
  page,
}) => {
  await signUp(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Take the tour" }).click();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect(tour(page)).toHaveAccessibleName("What you own and owe");
  await expect(page.locator(".tour-ring")).toHaveCount(2);
  const item = await page.locator('[data-tour="networth"]').boundingBox();
  await expect // the ring glides there at Full motion
    .poll(
      async () => (await page.locator(".tour-ring").first().boundingBox()).y,
    )
    .toBeCloseTo(item.y - 6, 0);
  // The card sits beside the menu, not over it.
  const card = await page.locator(".tour-card").boundingBox();
  expect(card.x).toBeGreaterThan(item.x + item.width);
});

test("Show me ends the tour and puts focus in the real field", async ({
  page,
}) => {
  await signUp(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Take the tour" }).click();
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight");
  await page
    .getByRole("button", { name: "Show me: Add a transaction" })
    .click();
  await expect(tour(page)).toHaveCount(0);
  await expect(page.locator("main h1")).toHaveText("Transactions");
  await expect(
    page.locator('[data-focus-target="add-transaction"]'),
  ).toBeFocused();
  expect((await onboarding(page)).outcome).toBe("showme");
});

test("Done, and Explore all features opens a page", async ({ page }) => {
  await signUp(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Take the tour" }).click();
  for (let i = 0; i < 6; i++)
    await tour(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    tour(page).getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explore all features" }).click();
  await expect(tour(page)).toHaveAccessibleName("More in Finnelee");
  await tour(page)
    .getByRole("button", { name: /^Goals/ })
    .click();
  await expect(tour(page)).toHaveCount(0);
  await expect(page.locator("main h1")).toHaveText("Goals");
  expect((await onboarding(page)).outcome).toBe("done");
});

test("a missing target gives a centered card with no highlight", async ({
  page,
}) => {
  await signUp(page);
  await page.addStyleTag({ content: ".orb-hero { display: none !important }" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Take the tour" }).click();
  await expect(tour(page)).toHaveAccessibleName("Your financial health");
  await expect(page.locator(".tour-ring")).toHaveCount(0);
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  await expect
    .poll(async () => {
      const card = await page.locator(".tour-card").boundingBox();
      return Math.abs(card.x + card.width / 2 - vw / 2);
    })
    .toBeLessThan(2);
});

test.describe("phones", () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true });

  test("the menu stays closed: the menu button is ringed and the card previews the menu", async ({
    page,
  }) => {
    await signUp(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Take the tour" }).click();
    for (let i = 0; i < 4; i++)
      await tour(page)
        .getByRole("button", { name: "Next", exact: true })
        .click();
    await expect(tour(page)).toHaveAccessibleName("What you own and owe");
    await expect(page.locator(".layout.drawer-open")).toHaveCount(0);
    await expect(page.locator("#sidebar")).toHaveAttribute("inert", "");
    await expect(
      page.getByText("Menu preview: Net Worth and Debt Planner"),
    ).toBeVisible();
    await expect(page.locator(".tour-menu ul")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(page.locator(".tour-menu li.is-on")).toHaveText([
      "Net Worth",
      "Debt Planner",
    ]);
    // The ring surrounds the real menu button (6px out, clipped 4px from the edge).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const rings = [...document.querySelectorAll(".tour-ring")];
          const m = document
            .querySelector(".menu-button")
            .getBoundingClientRect();
          const r = rings[0]?.getBoundingClientRect();
          return r
            ? [
                rings.length,
                r.left - Math.max(4, m.left - 6),
                r.top - (m.top - 6),
              ]
            : [0];
        }),
      )
      .toEqual([1, 0, 0]);
    // The footer buttons stay on screen and in place.
    const next = await tour(page)
      .getByRole("button", { name: "Next", exact: true })
      .boundingBox();
    expect(next.y + next.height).toBeLessThanOrEqual(640);
  });

  test("under a Dashboard card, the card stays at about half the screen", async ({
    page,
  }) => {
    await signUp(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Take the tour" }).click();
    const card = await page.locator(".tour-card").boundingBox();
    expect(card.height).toBeLessThanOrEqual(640 * 0.46 + 1);
    await expect
      .poll(async () => {
        const ring = await page.locator(".tour-ring").boundingBox();
        return ring.y + ring.height <= card.y;
      })
      .toBe(true);
  });
});

test("Motion Off and Calm are followed", async ({ page }) => {
  await signUp(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Not now" }).click();
  for (const [level, cls] of [
    ["Off", "tour-off"],
    ["Calm", "tour-calm"],
  ]) {
    await page.locator(".nav-item", { hasText: "Settings" }).click();
    await page.locator(".choice", { hasText: level }).first().click();
    await page.getByRole("button", { name: "Replay tour" }).click();
    await expect(tour(page)).toHaveClass(new RegExp(cls));
    await page.keyboard.press("Escape");
  }
});
