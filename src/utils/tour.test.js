import { describe, expect, it } from "vitest";
import {
  placeCard,
  previewRows,
  stepTargets,
  TOUR_FEATURES,
  TOUR_STEPS,
  unionRect,
  visibleHighlight,
} from "./tour";

describe("the steps", () => {
  it("has eight steps, with Show me on steps 4, 5 and 6 only", () => {
    expect(TOUR_STEPS).toHaveLength(8);
    expect(
      TOUR_STEPS.map((s, i) => (s.showMe ? i + 1 : null)).filter(Boolean),
    ).toEqual([4, 5, 6]);
    expect(TOUR_STEPS.map((s) => s.showMe?.focus)).toEqual([
      undefined,
      undefined,
      undefined,
      ["add-transaction"],
      ["planned-income"],
      ["add-account"],
      undefined,
      undefined,
    ]);
  });

  it("calls the Orb an educational indicator, not a credit score", () => {
    expect(TOUR_STEPS[1].text).toContain(
      "educational planning indicator, not a credit score",
    );
    expect(TOUR_STEPS.map((s) => s.text).join(" ")).not.toMatch(/3D|WebGL/);
  });

  it("phones point at the menu button for menu pages, never inside the drawer", () => {
    const nav = TOUR_STEPS.filter((s) => s.nav);
    expect(nav.map((s) => s.nav)).toEqual([
      ["transactions"],
      ["budget"],
      ["networth", "debt"],
      ["settings"],
    ]);
    for (const s of nav) {
      expect(stepTargets(s, true)).toEqual([".menu-button"]);
      expect(stepTargets(s, false)).toEqual(
        s.nav.map((id) => `[data-tour="${id}"]`),
      );
    }
    expect(stepTargets(TOUR_STEPS[6], true)).toEqual([".palette-phone"]);
    expect(stepTargets(TOUR_STEPS[0], false)).toEqual([]);
  });

  it("Explore all features covers the pages the tour skips", () => {
    expect(TOUR_FEATURES.map((f) => f.page)).toEqual([
      "forecast",
      "goals",
      "bills",
      "categories",
      "settings",
    ]);
  });
});

describe("geometry", () => {
  const box = (left, top, width, height) => ({ left, top, width, height });

  it("unites several targets", () => {
    expect(unionRect([])).toBe(null);
    expect(unionRect([box(10, 100, 200, 40), box(10, 150, 200, 40)])).toEqual(
      box(10, 100, 200, 90),
    );
  });

  it("clips the highlight to what is visible, or drops it", () => {
    const view = { width: 390, bottom: 400 };
    expect(visibleHighlight(box(20, 100, 300, 100), view)).toEqual(
      box(14, 94, 312, 112),
    );
    // Partly under the docked card: only the visible part is ringed.
    expect(visibleHighlight(box(20, 300, 300, 300), view)).toEqual(
      box(14, 294, 312, 106),
    );
    // Barely visible: no highlight (the card centers instead), no forced minimum.
    expect(visibleHighlight(box(20, 380, 300, 300), view)).toBe(null);
    expect(visibleHighlight(null, view)).toBe(null);
  });

  it("places the desktop card beside, then below or above, else centered", () => {
    const card = { width: 380, height: 300 };
    const view = { width: 1366, height: 800 };
    expect(placeCard(box(20, 300, 200, 44), card, view)).toMatchObject({
      side: "right",
      left: 240,
      top: 300,
    });
    expect(placeCard(box(1100, 100, 200, 44), card, view).side).toBe("left");
    expect(placeCard(box(100, 40, 1200, 200), card, view)).toMatchObject({
      side: "below",
      top: 260,
    });
    expect(placeCard(box(100, 420, 1200, 300), card, view)).toMatchObject({
      side: "above",
      top: 100,
    });
    expect(placeCard(box(16, 16, 1334, 770), card, view).side).toBe("center");
    expect(placeCard(null, card, view)).toEqual({
      left: 493,
      top: 250,
      side: "center",
    });
  });

  it("keeps the card on screen next to a target near the bottom", () => {
    const pos = placeCard(
      box(20, 740, 200, 44),
      { width: 380, height: 300 },
      { width: 1366, height: 800 },
    );
    expect(pos.top).toBe(484);
  });
});

describe("the phone menu preview", () => {
  const pages = [
    "dashboard",
    "networth",
    "transactions",
    "budget",
    "debt",
    "forecast",
    "goals",
    "bills",
    "categories",
    "settings",
  ].map((id) => ({ id, label: id }));
  const ids = (nav) => previewRows(pages, nav).map((p) => p.id);
  const on = (nav) =>
    previewRows(pages, nav)
      .filter((p) => p.on)
      .map((p) => p.id);

  it("shows every highlighted page with its neighbours", () => {
    expect(ids(["transactions"])).toEqual([
      "networth",
      "transactions",
      "budget",
      "debt",
    ]);
    expect(ids(["networth", "debt"])).toEqual([
      "dashboard",
      "networth",
      "transactions",
      "budget",
      "debt",
      "forecast",
    ]);
    expect(on(["networth", "debt"])).toEqual(["networth", "debt"]);
    expect(ids(["settings"])).toEqual([
      "goals",
      "bills",
      "categories",
      "settings",
    ]);
  });
});
