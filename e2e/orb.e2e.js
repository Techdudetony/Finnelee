// Health Orb end to end, on a phone (390 px, DPR 3): the still layers are drawn once and
// only the liquid moves (issue #25), and the pause rules still hold: Calm, Off and a
// hidden tab ask for no frames at all.
import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  // window.gc() lets the lifecycle test check that old layer canvases are released.
  launchOptions: { args: ["--js-flags=--expose-gc"] },
});

/** Counts requestAnimationFrame calls from page start (window.__rafCalls). */
const countFrames = () => {
  window.__rafCalls = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => {
    window.__rafCalls++;
    return raf(fn);
  };
};

/** Signs up a fresh user with sample data and closes the sign-up dialogs. */
async function signUp(page) {
  await page.addInitScript(countFrames);
  await page.goto("/");
  await page
    .locator(".segmented button", { hasText: "Create account" })
    .click();
  await page.fill("input[name=name]", "Tester");
  await page.fill("input[name=email]", `orb${Date.now()}@example.com`);
  await page.fill("input[name=password]", "correct-horse-9");
  await page.check("input[name=withSampleData]");
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

/** Saves a Motion level and reloads straight into the Dashboard. */
async function setMotion(page, motion) {
  await page.evaluate((motion) => {
    const key = Object.keys(localStorage).find((k) => k.endsWith(".settings"));
    const settings = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...settings, motion }));
  }, motion);
  await page.reload();
  await closeDialogs(page);
  await expect(page.locator(".orb canvas")).toBeVisible();
}

/** The canvas pixels, plus one pixel on the ring and one in the liquid. */
const readCanvas = (page) =>
  page.locator(".orb canvas").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
    const w = canvas.width;
    return {
      size: [canvas.width, canvas.height],
      data: canvas.toDataURL(),
      ring: at(w / 2, Math.round(w * 0.04) + 1), // top of the ring track
      liquid: at(w / 2, Math.round(w * 0.85)), // low in the sphere
    };
  });

const framesOver = async (page, ms) => {
  const before = await page.evaluate(() => window.__rafCalls);
  await page.waitForTimeout(ms);
  return (await page.evaluate(() => window.__rafCalls)) - before;
};

test("at Full the liquid moves while the ring and glass stay drawn", async ({
  page,
}) => {
  await signUp(page);
  await setMotion(page, "full");
  await page.locator(".orb").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1600); // the 1.2 s fill, plus a margin

  const a = await readCanvas(page);
  await page.waitForTimeout(400);
  const b = await readCanvas(page);
  expect(a.size).toEqual([400, 400]); // 200 CSS px at the 2x cap
  expect(a.data).not.toBe(b.data); // still moving
  expect(a.ring[3]).toBeGreaterThan(0); // the cached ring is on every frame
  expect(b.ring).toEqual(a.ring); // and never changes
  expect(a.liquid[3]).toBeGreaterThan(200); // liquid over the glass, opaque

  // The words are unchanged: the label and the score are text, not canvas.
  const label = await page.locator(".orb").getAttribute("aria-label");
  expect(label).toMatch(/^Financial health (about )?\d+ of 100/);
  const score = await page.locator(".orb-number").textContent();
  expect(label).toContain(`${score} of 100`);
});

test("Calm, Off and a hidden tab draw one frame and ask for no more", async ({
  page,
}) => {
  await signUp(page);
  for (const motion of ["calm", "off"]) {
    await setMotion(page, motion);
    await page.waitForTimeout(500);
    const still = await readCanvas(page);
    expect(still.ring[3]).toBeGreaterThan(0); // the finished frame is drawn
    expect(await framesOver(page, 1500)).toBe(0);
  }

  await setMotion(page, "full");
  await page.waitForTimeout(1600);
  expect(await framesOver(page, 500)).toBeGreaterThan(0); // moving
  // Headless tabs never hide, so the signal the Orb listens for is simulated.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(200);
  expect(await framesOver(page, 1500)).toBe(0);
});

test("offscreen, the Orb asks for no frames, and it moves again when back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 500 }); // room to scroll it away
  await signUp(page);
  await setMotion(page, "full");
  await page.locator(".orb").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1600);
  expect(await framesOver(page, 500)).toBeGreaterThan(0);

  // Scroll whatever holds the page to the bottom, past the Orb.
  await page.evaluate(() => {
    const scroller = (n) =>
      !n
        ? document.scrollingElement
        : n.scrollHeight > n.clientHeight + 10 &&
            getComputedStyle(n).overflowY !== "visible"
          ? n
          : scroller(n.parentElement);
    const box = scroller(document.querySelector(".orb").parentElement);
    box.scrollTop = box.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(400);
  const onScreen = await page.evaluate(() => {
    const r = document.querySelector(".orb").getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  });
  expect(onScreen).toBe(false);
  expect(await framesOver(page, 1500)).toBe(0);

  await page.locator(".orb").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  expect(await framesOver(page, 500)).toBeGreaterThan(0);
});

test.describe("cached layers", () => {
  /** Tracks every canvas the page creates; the page's own get marked when added. */
  const trackCanvases = () => {
    window.__canvases = [];
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (tag, ...rest) {
      const el = create.call(this, tag, ...rest);
      if (String(tag).toLowerCase() === "canvas")
        window.__canvases.push(new WeakRef(el));
      return el;
    };
    new MutationObserver((list) => {
      for (const m of list)
        for (const n of m.addedNodes)
          for (const c of n.querySelectorAll
            ? [n, ...n.querySelectorAll("canvas")]
            : [])
            if (c.tagName === "CANVAS") c.__inPage = true;
    }).observe(document, { childList: true, subtree: true });
  };

  /**
   * After garbage collection: [layer canvases still alive, all layer canvases made].
   * Collection timing isn't guaranteed, so callers poll; a real leak never clears.
   */
  const layerCanvases = async (page) => {
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.gc());
      await page.waitForTimeout(100);
    }
    return page.evaluate(() => {
      const layers = window.__canvases.filter((w) => {
        const el = w.deref();
        return !el || !el.__inPage; // collected, or never in the page
      });
      return [layers.filter((w) => w.deref()).length, layers.length];
    });
  };

  test("theme, score and page changes keep only the current two layers", async ({
    page,
  }) => {
    await page.addInitScript(trackCanvases);
    await signUp(page);
    await setMotion(page, "full");
    await page.waitForTimeout(1600);
    const alive = async () => (await layerCanvases(page))[0];
    await expect.poll(alive).toBe(2); // under + over

    // Theme changes repaint the layers in the new colors; the old ones are let go.
    for (const colorScheme of ["dark", "light", "dark", "light"]) {
      await page.emulateMedia({ colorScheme });
      await page.waitForTimeout(300);
    }
    // Leaving the Dashboard and coming back mounts a fresh Orb each time.
    const nav = async (name) => {
      const menu = page.getByRole("button", { name: "Open menu" });
      if (await menu.isVisible()) await menu.click();
      await page.locator(".nav-item", { hasText: name }).first().click();
    };
    for (let i = 0; i < 3; i++) {
      await nav("Bills");
      await nav("Dashboard");
      await expect(page.locator(".orb canvas")).toBeVisible();
    }
    // A settings change recomputes health while the Orb stays on screen (Motion from
    // the command palette), which rebuilds the layers.
    const [, made] = await layerCanvases(page);
    for (const level of ["calm", "full", "calm", "full"]) {
      await page.keyboard.press("Control+k");
      await page
        .getByRole("dialog")
        .getByRole("combobox")
        .fill(`motion ${level}`);
      await page.keyboard.press("Enter");
      await expect(page.locator("html")).toHaveAttribute("data-motion", level);
      await page.waitForTimeout(200);
    }
    expect((await layerCanvases(page))[1]).toBeGreaterThan(made); // repainted
    await expect.poll(alive).toBe(2); // and only the current pair is kept

    // A different score: delete this month's income, then come back.
    const before = await page.locator(".orb").getAttribute("aria-label");
    await nav("Transactions");
    const incomeRows = page.locator("tr", {
      has: page.locator(".amount-income"),
    });
    while (await incomeRows.count())
      await incomeRows
        .first()
        .getByRole("button", { name: /^Delete / })
        .click();
    await nav("Dashboard");
    await expect(page.locator(".orb canvas")).toBeVisible();
    await page.waitForTimeout(1600);
    const after = await page.locator(".orb").getAttribute("aria-label");
    expect(after).not.toBe(before);
    await expect.poll(alive).toBe(2);

    // Off the Dashboard, no layer canvas is left at all.
    await nav("Bills");
    await page.waitForTimeout(300);
    await expect.poll(alive).toBe(0);
  });
});
