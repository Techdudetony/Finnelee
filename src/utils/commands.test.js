import { describe, expect, it } from "vitest";
import {
  buildCommands,
  isPaletteShortcut,
  isSubsequence,
  matchRank,
  moveActive,
  rankCommands,
  resultCount,
  waitForElement,
} from "./commands";

const PAGES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "networth", label: "Net Worth" },
  { id: "transactions", label: "Transactions" },
  { id: "budget", label: "Budget" },
  { id: "debt", label: "Debt Planner" },
  { id: "forecast", label: "Forecast" },
  { id: "goals", label: "Goals" },
  { id: "bills", label: "Bills" },
  { id: "categories", label: "Categories" },
  { id: "settings", label: "Settings" },
];
const commands = buildCommands(PAGES);
const labels = (query) => rankCommands(commands, query).map((c) => c.label);

describe("buildCommands", () => {
  it("lists every page, then tasks, then Motion settings", () => {
    expect(commands.slice(0, 10).map((c) => c.action)).toEqual(
      PAGES.map((p) => ({ type: "page", page: p.id })),
    );
    expect(commands.filter((c) => c.group === "Start a task")).toHaveLength(7);
    expect(
      commands.filter((c) => c.group === "Settings").map((c) => c.action),
    ).toEqual([
      { type: "motion", level: "full" },
      { type: "motion", level: "calm" },
      { type: "motion", level: "off" },
    ]);
  });

  it("only opens pages, focuses fields or sets Motion: nothing edits records", () => {
    for (const c of commands) {
      expect(["page", "motion"]).toContain(c.action.type);
      expect(Object.keys(c.action).sort()).toEqual(
        c.action.type === "page"
          ? c.action.focus
            ? ["focus", "page", "type"]
            : ["page", "type"]
          : ["level", "type"],
      );
    }
  });

  it("gives every command a unique id", () => {
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
  });
});

describe("matchRank", () => {
  const debt = commands.find((c) => c.id === "page:debt");

  it("ranks exact, prefix, word prefix, alias, then letters in order", () => {
    expect(matchRank(debt, "debt planner")).toBe(0);
    expect(matchRank(debt, "LOAN")).toBe(0); // an exact alias, any case
    expect(matchRank(debt, "debt")).toBe(1);
    expect(matchRank(debt, "plan")).toBe(2);
    expect(matchRank(debt, "credit")).toBe(3);
    expect(matchRank(debt, "dbt")).toBe(4);
    expect(matchRank(debt, "xyz")).toBeNull();
  });

  it("ignores extra spaces and matches everything when empty", () => {
    expect(matchRank(debt, "  debt   planner ")).toBe(0);
    expect(matchRank(debt, "")).toBe(0);
    expect(matchRank(debt, "d p")).toBe(4); // letters in order, spaces ignored
  });
});

describe("rankCommands", () => {
  it("shows every command in order when nothing is typed", () => {
    expect(labels("")).toEqual(commands.map((c) => c.label));
  });

  it("puts an exact match first, then prefixes, then aliases, then fuzzy", () => {
    expect(labels("bills")[0]).toBe("Bills");
    expect(labels("budget")[0]).toBe("Budget");
    // "add" starts four task labels, kept in their listed order.
    expect(labels("add")).toEqual([
      "Add a transaction",
      "Add a bill",
      "Add a goal",
      "Add a debt",
    ]);
  });

  it("finds pages by alias and by letters in order", () => {
    expect(labels("loan")).toEqual(["Debt Planner", "Add a debt"]);
    // The alias first; a letters-in-order match comes after it.
    expect(labels("paycheck")).toEqual([
      "Set your pay schedule",
      "Update your checking balance",
    ]);
    expect(labels("dbt")[0]).toBe("Debt Planner");
    expect(labels("nwth")).toEqual(["Net Worth"]);
  });

  it("returns nothing for text that matches nothing", () => {
    expect(labels("zzzz")).toEqual([]);
  });

  it("is stable: the same text always gives the same list", () => {
    expect(labels("a")).toEqual(labels("a"));
  });
});

describe("helpers", () => {
  it("isSubsequence", () => {
    expect(isSubsequence("dbt", "debt")).toBe(true);
    expect(isSubsequence("tbd", "debt")).toBe(false);
  });

  it("resultCount", () => {
    expect(resultCount(0)).toBe("No matches");
    expect(resultCount(1)).toBe("1 result");
    expect(resultCount(4)).toBe("4 results");
  });

  it("isPaletteShortcut: Ctrl K or ⌘K only", () => {
    expect(isPaletteShortcut({ ctrlKey: true, key: "k" })).toBe(true);
    expect(isPaletteShortcut({ metaKey: true, key: "K" })).toBe(true);
    expect(isPaletteShortcut({ key: "k" })).toBe(false);
    expect(isPaletteShortcut({ ctrlKey: true, shiftKey: true, key: "k" })).toBe(
      false,
    );
    expect(isPaletteShortcut({ ctrlKey: true, altKey: true, key: "k" })).toBe(
      false,
    );
  });

  it("moveActive wraps with arrows and jumps with Home and End", () => {
    expect(moveActive("ArrowDown", 2, 3)).toBe(0);
    expect(moveActive("ArrowUp", 0, 3)).toBe(2);
    expect(moveActive("Home", 2, 3)).toBe(0);
    expect(moveActive("End", 0, 3)).toBe(2);
    expect(moveActive("Enter", 0, 3)).toBeNull();
    expect(moveActive("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("waitForElement", () => {
  /** A fake clock and frame queue: step() runs the next frame `ms` later. */
  function fakeFrames() {
    let time = 0;
    let queued = null;
    return {
      now: () => time,
      next: (fn) => ((queued = fn), 1),
      cancel: () => (queued = null),
      step(ms = 16) {
        time += ms;
        const fn = queued;
        queued = null;
        fn?.();
      },
      pending: () => queued !== null,
    };
  }

  it("finds an element that is already there at once", () => {
    const frames = fakeFrames();
    const found = [];
    waitForElement(() => "field", {
      ...frames,
      onFound: (el) => found.push(el),
      onTimeout: () => found.push("timeout"),
    });
    expect(found).toEqual(["field"]);
    expect(frames.pending()).toBe(false);
  });

  it("keeps checking until a late element appears (past 10 frames)", () => {
    const frames = fakeFrames();
    let element = null;
    const found = [];
    waitForElement(() => element, {
      ...frames,
      timeout: 3000,
      onFound: (el) => found.push(el),
      onTimeout: () => found.push("timeout"),
    });
    for (let i = 0; i < 30; i++) frames.step(16); // ~480 ms, nothing yet
    expect(found).toEqual([]);
    element = "field";
    frames.step(16);
    expect(found).toEqual(["field"]);
    expect(frames.pending()).toBe(false);
  });

  it("gives up once at the timeout and never checks again", () => {
    const frames = fakeFrames();
    const found = [];
    waitForElement(() => null, {
      ...frames,
      timeout: 100,
      onFound: (el) => found.push(el),
      onTimeout: () => found.push("timeout"),
    });
    for (let i = 0; i < 10; i++) frames.step(16);
    expect(found).toEqual(["timeout"]);
    expect(frames.pending()).toBe(false);
  });

  it("stops when cancelled, so a later element is never focused", () => {
    const frames = fakeFrames();
    let element = null;
    const found = [];
    const stop = waitForElement(() => element, {
      ...frames,
      onFound: (el) => found.push(el),
      onTimeout: () => found.push("timeout"),
    });
    frames.step();
    stop();
    element = "field";
    frames.step();
    expect(found).toEqual([]);
  });
});
