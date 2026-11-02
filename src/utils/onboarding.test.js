import { describe, expect, it } from "vitest";
import {
  markNewAccount,
  markTourEnded,
  markTourOffered,
  shouldOfferTour,
} from "./onboarding";
import { emptyData, generateSampleData } from "../data/sampleData";

describe("who is offered the tour", () => {
  it("offers it once to a new account, with or without sample data", () => {
    for (const data of [emptyData(), generateSampleData()]) {
      const fresh = markNewAccount(data.settings);
      expect(shouldOfferTour(fresh)).toBe(true);
      const offered = markTourOffered(fresh, "2026-11-01T10:00:00.000Z");
      expect(shouldOfferTour(offered)).toBe(false);
    }
  });

  it("never offers it to existing accounts, empty or not, or old backups", () => {
    expect(shouldOfferTour(emptyData().settings)).toBe(false);
    expect(shouldOfferTour(generateSampleData().settings)).toBe(false);
    expect(shouldOfferTour({ motion: "calm" })).toBe(false);
    expect(shouldOfferTour(undefined)).toBe(false);
    expect(shouldOfferTour({ onboarding: { newAccount: "true" } })).toBe(false);
  });

  it("keeps 'offered' apart from how it ended", () => {
    const offered = markTourOffered(markNewAccount({}), "t1");
    const skipped = markTourEnded(offered, "skipped", "t2");
    expect(skipped.onboarding).toEqual({
      newAccount: true,
      offeredAt: "t1",
      outcome: "skipped",
      outcomeAt: "t2",
    });
    expect(shouldOfferTour(skipped)).toBe(false);
  });

  it("replays never overwrite the first run's result", () => {
    const first = markTourEnded(
      markTourOffered(markNewAccount({}), "t1"),
      "skipped",
      "t2",
    );
    const replayed = markTourEnded(first, "done", "t3", { replay: true });
    expect(replayed.onboarding).toEqual({
      newAccount: true,
      offeredAt: "t1",
      outcome: "skipped",
      outcomeAt: "t2",
      lastReplay: { outcome: "done", at: "t3" },
    });
    const again = markTourEnded(replayed, "showme", "t4", { replay: true });
    expect(again.onboarding.lastReplay).toEqual({
      outcome: "showme",
      at: "t4",
    });
    expect(again.onboarding.outcome).toBe("skipped");
    // A second end of the first run (it can't happen twice) changes nothing.
    expect(markTourEnded(first, "done", "t5")).toBe(first);
    expect(shouldOfferTour(again)).toBe(false);
  });

  it("accounts with no record only get lastReplay, and are never offered it", () => {
    const ended = markTourEnded({ motion: "off" }, "done", "t", {
      replay: true,
    });
    expect(ended).toEqual({
      motion: "off",
      onboarding: { lastReplay: { outcome: "done", at: "t" } },
    });
    expect(shouldOfferTour(ended)).toBe(false);
  });

  it("doesn't touch anything else in settings", () => {
    const s = { startingSavings: 3800, annualReturn: 5, motion: "full" };
    expect(markNewAccount(s)).toMatchObject(s);
  });
});
