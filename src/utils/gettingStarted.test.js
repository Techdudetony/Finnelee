import { describe, expect, it } from "vitest";
import {
  GETTING_STARTED_ITEMS,
  budgetPlanned,
  canRestore,
  checklistDone,
  checklistView,
  doneCount,
  isEligible,
  markAcknowledged,
  markHidden,
  markShown,
  newlyDone,
  readGettingStarted,
  trackChecklist,
} from "./gettingStarted";
import { markNewAccount } from "./onboarding";
import { setLimit, setPlannedIncome } from "./budgeting";
import { emptyData, fromBackup, generateSampleData } from "../data/sampleData";

const TODAY = new Date(2026, 10, 2); // Nov 2, 2026
const NOW = "2026-11-02T10:00:00.000Z";
const LATER = "2026-11-03T10:00:00.000Z";

// A store-shaped object: empty data plus whatever the test adds.
const store = (extra = {}) => ({ ...emptyData(), ...extra });
const done = (data) => checklistDone(data, TODAY);
const ALL = { transaction: true, budget: true, account: true, bill: true, goal: true };
const FOUR = { ...ALL, goal: false };
const NONE = { transaction: false, budget: false, account: false, bill: false, goal: false };

describe("the five steps", () => {
  it("keeps a fixed order", () => {
    expect(GETTING_STARTED_ITEMS.map((i) => i.id)).toEqual([
      "transaction",
      "budget",
      "account",
      "bill",
      "goal",
    ]);
  });

  it("each step is done exactly when its data exists", () => {
    expect(done(store())).toEqual(NONE);
    expect(done(store({ transactions: [{ id: 1 }] })).transaction).toBe(true);
    expect(done(store({ accounts: [{ id: 1 }] })).account).toBe(true);
    expect(done(store({ bills: [{ id: 1 }] })).bill).toBe(true);
    expect(done(store({ goals: [{ id: 1 }] })).goal).toBe(true);
    expect(doneCount(done(store({ goals: [{ id: 1 }], bills: [{}] })))).toBe(2);
  });

  it("follows the data both ways: deleting the only bill un-ticks it", () => {
    expect(done(store({ bills: [{ id: 1 }] })).bill).toBe(true);
    expect(done(store({ bills: [] })).bill).toBe(false);
  });

  it("tolerates missing or malformed slices (old backups)", () => {
    expect(checklistDone({}, TODAY)).toEqual(NONE);
    expect(checklistDone({ transactions: "x", settings: null }, TODAY)).toEqual(NONE);
  });
});

describe("this month's budget", () => {
  const base = emptyData();

  it("counts confirmed planned income above $0 for this month only", () => {
    const nov = setPlannedIncome(base.settings, "2026-11", "5200", TODAY);
    expect(budgetPlanned({}, nov, "2026-11")).toBe(true);
    const dec = setPlannedIncome(base.settings, "2026-12", "5200", TODAY);
    expect(budgetPlanned({}, dec, "2026-11")).toBe(false); // next month only
    const zero = setPlannedIncome(base.settings, "2026-11", "0", TODAY);
    expect(budgetPlanned({}, zero, "2026-11")).toBe(false);
  });

  it("never counts a suggested income (suggestions aren't saved)", () => {
    // Income in the last 3 months makes the Budget page suggest an amount, but
    // nothing is stored until it's confirmed.
    const data = store({
      transactions: [{ id: 1, type: "income", amount: 3000, date: "2026-10-01" }],
    });
    expect(done(data).budget).toBe(false);
  });

  it("counts a category limit above $0 for this month", () => {
    const { budgets, settings } = setLimit(
      { budgets: {}, settings: base.settings },
      "Groceries",
      "2026-11",
      "450",
      TODAY,
    );
    expect(budgetPlanned(budgets, settings, "2026-11")).toBe(true);
  });

  it("ignores a limit that was only active in a past month", () => {
    // Groceries had $450 until October, then was set to $0 for November.
    const settings = {
      budgeting: {
        limits: {
          Groceries: [
            { from: null, limit: 0 },
            { from: "2026-09", limit: 450 },
            { from: "2026-11", limit: 0 },
          ],
        },
      },
    };
    expect(budgetPlanned({ Groceries: 0 }, settings, "2026-11")).toBe(false);
    expect(budgetPlanned({ Groceries: 0 }, settings, "2026-10")).toBe(true);
  });

  it("ignores a limit planned only for next month", () => {
    const { budgets, settings } = setLimit(
      { budgets: {}, settings: base.settings },
      "Groceries",
      "2026-12",
      "450",
      TODAY,
    );
    expect(budgetPlanned(budgets, settings, "2026-11")).toBe(false);
  });

  it("counts a never-edited limit (the same every month, as on the Budget page)", () => {
    expect(budgetPlanned({ Rent: 1200 }, {}, "2026-11")).toBe(true);
    expect(budgetPlanned({ Rent: 0 }, {}, "2026-11")).toBe(false);
  });
});

describe("who sees it", () => {
  it("new accounts, by their sign-up marker", () => {
    expect(isEligible(markNewAccount({}), ALL)).toBe(true);
  });

  it("genuinely empty existing accounts", () => {
    expect(isEligible(emptyData().settings, NONE)).toBe(true);
  });

  it("not an existing account with bills or goals but no transactions or accounts", () => {
    const withBills = store({ bills: [{ id: 1 }] });
    expect(isEligible(withBills.settings, done(withBills))).toBe(false);
    const withGoals = store({ goals: [{ id: 1 }] });
    expect(isEligible(withGoals.settings, done(withGoals))).toBe(false);
    const withBudget = store({ budgets: { Rent: 1200 } });
    expect(isEligible(withBudget.settings, done(withBudget))).toBe(false);
  });

  it("an empty account that started stays eligible once it has data", () => {
    const empty = emptyData();
    const started = trackChecklist(empty.settings, NONE, null, NOW).settings;
    expect(readGettingStarted(started).exists).toBe(true);
    expect(isEligible(started, { ...NONE, transaction: true })).toBe(true);
  });

  it("not sample data loaded into an existing account", () => {
    const sample = generateSampleData(TODAY);
    expect(isEligible(sample.settings, done(sample))).toBe(false);
    expect(checklistView(sample.settings, done(sample))).toBe(null);
  });
});

describe("what the Dashboard shows", () => {
  const fresh = markNewAccount({});

  it("the checklist while something is left", () => {
    expect(checklistView(fresh, NONE)).toBe("checklist");
    expect(checklistView(fresh, FOUR)).toBe("checklist");
  });

  it("nothing while hidden", () => {
    expect(checklistView(markHidden(fresh, NOW), FOUR)).toBe(null);
  });

  it("nothing for data that is already complete (e.g. a new account with sample data)", () => {
    expect(checklistView(fresh, ALL)).toBe(null);
  });

  it("the one-time 'all set up' card, then nothing after Done", () => {
    const { settings, celebrate } = trackChecklist(fresh, ALL, FOUR, NOW);
    expect(celebrate).toBe(true);
    expect(checklistView(settings, ALL)).toBe("complete");
    const acked = markAcknowledged(settings, LATER);
    expect(checklistView(acked, ALL)).toBe(null);
    expect(markAcknowledged(acked, "2027-01-01")).toBe(acked); // never re-stamped
  });

  it("a finished checklist never comes back, even after deleting data", () => {
    const finished = markAcknowledged(trackChecklist(fresh, ALL, FOUR, NOW).settings, NOW);
    expect(checklistView(finished, NONE)).toBe(null);
    expect(checklistView(finished, FOUR)).toBe(null);
  });

  it("a finished checklist doesn't reopen when hiddenAt is cleared", () => {
    const hidden = markHidden(fresh, NOW);
    const finished = trackChecklist(hidden, ALL, FOUR, NOW).settings;
    const shown = markShown(finished);
    expect(checklistView(shown, NONE)).toBe(null);
  });
});

describe("recording completion", () => {
  const fresh = markNewAccount({});

  it("gives an eligible account a record, and leaves others untouched", () => {
    const { settings } = trackChecklist(fresh, NONE, null, NOW);
    expect(settings.gettingStarted).toEqual({
      hiddenAt: null,
      completedAt: null,
      acknowledgedAt: null,
    });
    expect(trackChecklist(settings, NONE, NONE, NOW).settings).toBe(settings);
    const sample = generateSampleData(TODAY).settings;
    expect(trackChecklist(sample, ALL, null, NOW).settings).toBe(sample);
  });

  it("saves completedAt once and never overwrites it", () => {
    const first = trackChecklist(fresh, ALL, FOUR, NOW).settings;
    expect(first.gettingStarted.completedAt).toBe(NOW);
    const again = trackChecklist(first, ALL, FOUR, LATER);
    expect(again.settings).toBe(first);
    expect(again.celebrate).toBe(false);
    expect(trackChecklist(first, NONE, ALL, LATER).settings).toBe(first);
  });

  it("celebrates only a last step seen going from not done to done", () => {
    expect(trackChecklist(fresh, ALL, FOUR, NOW).celebrate).toBe(true);
    expect(trackChecklist(fresh, ALL, NONE, NOW).celebrate).toBe(true);
  });

  it("never celebrates data that arrived complete (sample data, a backup, a reload)", () => {
    // previous is null right after loading or replacing all data.
    const { settings, celebrate } = trackChecklist(fresh, ALL, null, NOW);
    expect(celebrate).toBe(false);
    expect(settings.gettingStarted.completedAt).toBe(NOW);
    expect(settings.gettingStarted.acknowledgedAt).toBe(NOW); // quietly
    expect(checklistView(settings, ALL)).toBe(null);
  });

  it("a hidden checklist still finishes for good, quietly", () => {
    const hidden = markHidden(fresh, NOW);
    const { settings, celebrate } = trackChecklist(hidden, ALL, FOUR, LATER);
    expect(celebrate).toBe(false);
    expect(settings.gettingStarted).toMatchObject({
      hiddenAt: NOW,
      completedAt: LATER,
      acknowledgedAt: LATER,
    });
    expect(canRestore(settings, ALL)).toBe(false);
    expect(canRestore(settings, NONE)).toBe(false);
  });

  it("never touches settings.onboarding", () => {
    const { settings } = trackChecklist(fresh, ALL, FOUR, NOW);
    expect(settings.onboarding).toBe(fresh.onboarding);
  });
});

describe("hide and restore", () => {
  const fresh = markNewAccount({});

  it("restore is offered only while hidden and unfinished", () => {
    expect(canRestore(fresh, NONE)).toBe(false); // showing already
    const hidden = markHidden(fresh, NOW);
    expect(canRestore(hidden, NONE)).toBe(true);
    expect(canRestore(markShown(hidden), NONE)).toBe(false);
    expect(canRestore(hidden, ALL)).toBe(false); // finishing on this render
  });

  it("never for an account that isn't eligible", () => {
    const sample = generateSampleData(TODAY);
    const hidden = markHidden(sample.settings, NOW);
    // A hidden record makes it eligible again (it had started), but all done = no restore.
    expect(canRestore(hidden, done(sample))).toBe(false);
  });

  it("keeps the other fields when hiding and showing", () => {
    const hidden = markHidden({ motion: "calm" }, NOW);
    expect(hidden).toEqual({
      motion: "calm",
      gettingStarted: { hiddenAt: NOW, completedAt: null, acknowledgedAt: null },
    });
    expect(markShown(hidden).gettingStarted.hiddenAt).toBe(null);
  });
});

describe("older backups", () => {
  it("a backup without gettingStarted reads as not hidden, not finished", () => {
    const restored = fromBackup({ transactions: [], settings: { motion: "off" } });
    expect(readGettingStarted(restored.settings)).toEqual({
      exists: false,
      hiddenAt: null,
      completedAt: null,
      acknowledgedAt: null,
    });
    expect(checklistView(restored.settings, done(restored))).toBe("checklist");
  });

  it("ignores a malformed record", () => {
    for (const bad of [[], "yes", 3, null])
      expect(readGettingStarted({ gettingStarted: bad })).toMatchObject({
        hiddenAt: null,
        completedAt: null,
      });
  });
});

describe("announcements", () => {
  it("lists steps that just became done", () => {
    expect(newlyDone(null, ALL)).toEqual([]);
    expect(newlyDone(FOUR, ALL).map((i) => i.id)).toEqual(["goal"]);
    expect(newlyDone(ALL, FOUR)).toEqual([]);
  });
});
