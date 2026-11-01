// The experimental 3D Orb (Settings > 3D Orb) end to end: off by default with nothing
// downloaded, shown only after it has drawn and warmed up, paused offscreen and in a
// hidden tab, released at Calm/Off and when leaving the Dashboard, and the flat Orb for
// the rest of the session after any failure.
import { expect, test } from "@playwright/test";

// Before any page script: count animation frames and every WebGL context made.
function instrument() {
  window.__raf = 0;
  window.__gl = [];
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => {
    window.__raf++;
    return raf(fn);
  };
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, options) {
    const ctx = get.call(this, type, options);
    if (/webgl/.test(type) && ctx && !window.__gl.includes(ctx))
      window.__gl.push(ctx);
    return ctx;
  };
}

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
  await page.addInitScript(instrument);
  await page.goto("/");
  await page
    .locator(".segmented button", { hasText: "Create account" })
    .click();
  await page.fill("input[name=name]", "Tester");
  await page.fill("input[name=email]", `orb${Date.now()}@example.com`);
  await page.fill("input[name=password]", "correct-horse-9");
  await page.check("input[name=withSampleData]"); // gives the Orb a score
  await page.locator("form button.btn-primary").click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await closeDialogs(page);
}

async function goTo(page, name) {
  await page.locator(".nav-item", { hasText: name }).first().click();
  await expect(page.locator("main h1")).toHaveText(
    name === "Dashboard" ? /^Good/ : name,
  );
}

const glCanvas = (page) => page.locator(".orb canvas.orb-gl");
const switch3d = (page) => page.getByRole("checkbox", { name: /3D Orb/ });
const contexts = (page) =>
  page.evaluate(() =>
    window.__gl.map((g) => (g.isContextLost() ? "released" : "live")),
  );

async function turnOn(page) {
  await goTo(page, "Settings");
  await page.locator(".choice", { hasText: "Full" }).first().click();
  await switch3d(page).check();
  await goTo(page, "Dashboard");
}

async function framesOver(page, ms) {
  const before = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(ms);
  return (await page.evaluate(() => window.__raf)) - before;
}

/** Whether the flat (2D) canvas has the Orb drawn at its centre. */
const flatDrawn = (page) =>
  page.evaluate(() => {
    const c = document.querySelector(".orb canvas:not(.orb-gl)");
    const d = c
      .getContext("2d")
      .getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return d[3] > 0;
  });

test("the 3D Orb is off by default: nothing downloaded, no WebGL", async ({
  page,
}) => {
  const chunks = [];
  page.on("request", (r) => /orbGl/.test(r.url()) && chunks.push(r.url()));
  await signUp(page);
  await page.waitForTimeout(3000);
  expect(chunks).toEqual([]);
  expect(await contexts(page)).toEqual([]);
  await expect(glCanvas(page)).toHaveCount(0);
  await goTo(page, "Settings");
  await expect(switch3d(page)).not.toBeChecked();
});

test("the flat Orb stays until the 3D one has drawn, then one context, paused and released", async ({
  page,
}) => {
  // Hold the shader back a moment, to see what shows while it loads.
  await page.route(/orbGl/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await signUp(page);
  await turnOn(page);
  await page.waitForTimeout(1000);
  expect(await flatDrawn(page)).toBe(true);
  await expect(page.locator(".orb canvas.orb-gl.is-live")).toHaveCount(0);

  await expect(page.locator(".orb canvas.orb-gl.is-live")).toBeVisible({
    timeout: 15_000,
  });
  expect(await contexts(page)).toEqual(["live"]);
  const size = await glCanvas(page).evaluate((c) => [c.width, c.height]);
  expect(size[0]).toBeLessThanOrEqual(312); // capped at 2x the 156 px it covers
  // The score and its description are unchanged, and still on top.
  const orb = page.locator(".orb");
  await expect(orb).toHaveAttribute("role", "img");
  await expect(orb).toHaveAttribute(
    "aria-label",
    /^Financial health 85 of 100/,
  );
  await expect(glCanvas(page)).toHaveAttribute("aria-hidden", "true");
  expect(await framesOver(page, 1000)).toBeGreaterThan(10);

  // Offscreen: paused, no frames.
  await page.locator(".orb-pillars li").last().scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    for (const el of [
      document.scrollingElement,
      document.querySelector("main"),
    ])
      if (el) el.scrollTop = el.scrollHeight;
  });
  expect(
    await page.evaluate(
      () => document.querySelector(".orb").getBoundingClientRect().bottom < 0,
    ),
  ).toBe(true);
  await page.waitForTimeout(300); // the visibility observer reports asynchronously
  expect(await framesOver(page, 1000)).toBe(0);
  await orb.scrollIntoViewIfNeeded();

  // Hidden tab: paused, and the same context carries on afterwards.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await framesOver(page, 1000)).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await framesOver(page, 500)).toBeGreaterThan(5);
  expect(await contexts(page)).toEqual(["live"]);

  // Leaving the Dashboard releases it.
  await goTo(page, "Bills");
  await expect.poll(() => contexts(page)).toEqual(["released"]);
});

test("Calm and Off release the 3D Orb; Full brings it back", async ({
  page,
}) => {
  await signUp(page);
  await turnOn(page);
  await expect(page.locator(".orb canvas.orb-gl.is-live")).toBeVisible({
    timeout: 15_000,
  });
  for (const level of ["Calm", "Off"]) {
    await page.keyboard.press("Control+k");
    await page.keyboard.type(`motion ${level}`);
    await page.keyboard.press("Enter");
    await expect(glCanvas(page)).toHaveCount(0);
    await expect.poll(() => contexts(page)).not.toContain("live");
    await page.waitForTimeout(500);
    expect(await framesOver(page, 1000)).toBe(0);
    expect(await flatDrawn(page)).toBe(true);
  }
  await page.keyboard.press("Control+k");
  await page.keyboard.type("motion Full");
  await page.keyboard.press("Enter");
  await expect(page.locator(".orb canvas.orb-gl.is-live")).toBeVisible({
    timeout: 15_000,
  });
  const all = await contexts(page);
  expect(all.filter((c) => c === "live")).toHaveLength(1);
});

test("without WebGL the flat Orb stays, and Settings says why", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, options) {
      return /webgl/.test(type) ? null : get.call(this, type, options);
    };
  });
  await signUp(page);
  await turnOn(page);
  await page.waitForTimeout(3000);
  await expect(glCanvas(page)).toHaveCount(0);
  expect(await flatDrawn(page)).toBe(true);
  await goTo(page, "Settings");
  await expect(
    page.getByText(
      "This device couldn't run it, so the standard Orb is shown.",
    ),
  ).toBeVisible();
});

test("a lost graphics context falls back for the rest of the session", async ({
  page,
}) => {
  await signUp(page);
  await turnOn(page);
  await expect(page.locator(".orb canvas.orb-gl.is-live")).toBeVisible({
    timeout: 15_000,
  });
  await page.evaluate(() =>
    window.__gl[0].getExtension("WEBGL_lose_context").loseContext(),
  );
  await expect(glCanvas(page)).toHaveCount(0);
  expect(await framesOver(page, 500)).toBeGreaterThan(5); // the flat Orb keeps moving
  expect(await flatDrawn(page)).toBe(true);
  await goTo(page, "Bills");
  await goTo(page, "Dashboard");
  await page.waitForTimeout(3000);
  await expect(glCanvas(page)).toHaveCount(0);
  expect(await contexts(page)).toHaveLength(1); // no second try this session
  await goTo(page, "Settings");
  await expect(page.getByText("This device couldn't run it")).toBeVisible();
});

test("a slow warm-up keeps the flat Orb", async ({ page }) => {
  // Every pixel read (one per warm-up frame) takes 15 ms: over the 12 ms average.
  await page.addInitScript(() => {
    for (const proto of [
      WebGLRenderingContext.prototype,
      WebGL2RenderingContext.prototype,
    ]) {
      const read = proto.readPixels;
      proto.readPixels = function (...args) {
        const end = performance.now() + 15;
        while (performance.now() < end);
        return read.apply(this, args);
      };
    }
  });
  await signUp(page);
  await turnOn(page);
  await expect
    .poll(() => contexts(page), { timeout: 15_000 })
    .toEqual(["released"]);
  await expect(glCanvas(page)).toHaveCount(0);
  expect(await flatDrawn(page)).toBe(true);
  await goTo(page, "Settings");
  await expect(
    page.getByText("This device ran it slowly, so the standard Orb is shown."),
  ).toBeVisible();
});

test("the switch is saved, travels with backups, and needs Full motion", async ({
  page,
}) => {
  await signUp(page);
  await goTo(page, "Settings");
  await page.locator(".choice", { hasText: "Full" }).first().click();
  await switch3d(page).check();
  await page.reload();
  await closeDialogs(page);
  await goTo(page, "Settings");
  await expect(switch3d(page)).toBeChecked();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup (.json)" }).click();
  const backup = JSON.parse(
    await (await (await download).createReadStream())
      .toArray()
      .then((b) => Buffer.concat(b).toString()),
  );
  expect(backup.settings.orb3d).toBe(true);

  // A backup from before this switch existed reads as off.
  delete backup.settings.orb3d;
  page.once("dialog", (d) => d.accept());
  await page.locator("input[type=file]").setInputFiles({
    name: "old.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByText(/^Imported/)).toBeVisible();
  await expect(switch3d(page)).not.toBeChecked();

  await page.locator(".choice", { hasText: "Calm" }).first().click();
  await expect(switch3d(page)).toBeDisabled();
  await expect(page.getByText("Available at Full motion.")).toBeVisible();
});
