import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  keepNewAccountMark,
  migrateLegacyData,
  seedUserData,
  userKey,
} from "./userStorage";
import { markNewAccount, shouldOfferTour } from "../utils/onboarding";
import { emptyData } from "../data/sampleData";

// Tests run in Node, which has no localStorage: a tiny in-memory stand-in.
const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
};

/** Sign-up's seeding: empty data, marked as a new account. */
function seedNew(userId) {
  const data = emptyData();
  data.settings = markNewAccount(data.settings);
  seedUserData(userId, data);
}
const read = (slice) => JSON.parse(localStorage.getItem(userKey("u1", slice)));

describe("first account adopting data from before accounts existed", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the old data and settings, and the new-account mark", () => {
    localStorage.setItem(
      "fb.settings",
      JSON.stringify({ startingSavings: 900, motion: "calm" }),
    );
    localStorage.setItem(
      "fb.transactions",
      JSON.stringify([{ id: "t1", amount: 5 }]),
    );
    seedNew("u1");
    expect(migrateLegacyData("u1")).toBe(true);
    keepNewAccountMark("u1");
    expect(read("transactions")).toEqual([{ id: "t1", amount: 5 }]);
    expect(read("settings")).toMatchObject({
      startingSavings: 900,
      motion: "calm",
    });
    expect(shouldOfferTour(read("settings"))).toBe(true);
    expect(localStorage.getItem("fb.settings")).toBe(null); // still moved, not copied
  });

  it("old data without settings keeps the seeded, marked settings", () => {
    localStorage.setItem("fb.transactions", JSON.stringify([]));
    seedNew("u1");
    migrateLegacyData("u1");
    keepNewAccountMark("u1");
    expect(shouldOfferTour(read("settings"))).toBe(true);
    expect(read("settings").startingSavings).toBe(0);
  });

  it("never replaces an onboarding record, or settings it can't read", () => {
    const offered = { onboarding: { newAccount: true, offeredAt: "t" } };
    localStorage.setItem(userKey("u1", "settings"), JSON.stringify(offered));
    keepNewAccountMark("u1");
    expect(read("settings")).toEqual(offered);
    localStorage.setItem(userKey("u1", "settings"), "{not json");
    keepNewAccountMark("u1");
    expect(localStorage.getItem(userKey("u1", "settings"))).toBe("{not json");
  });
});
