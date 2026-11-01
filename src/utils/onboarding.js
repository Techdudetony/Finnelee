// The guided tour's record in settings: who is offered it, and how runs ended.
// Kept apart from utils/tour.js (the steps and layout), so sign-up and the app shell
// load only this, and the tour itself can load on demand. Pure and unit-tested.

/*
 * Saved as settings.onboarding, so it travels with backups like the Motion setting:
 *   {
 *     newAccount: true,              // written only at sign-up
 *     offeredAt: ISO | null,         // when the automatic offer was shown
 *     outcome: null | "done" | "skipped" | "showme",  // how that first run ended
 *     outcomeAt: ISO | null,
 *     lastReplay: { outcome, at },   // the latest replay, kept apart from the above
 *   }
 * Only sign-up writes newAccount, so accounts made before the tour existed (and
 * backups from them) never get it automatically. Replay works for everyone, and an
 * account with no record at all simply gets { lastReplay } after one.
 */

/** settings for a brand-new account: marks it so the tour is offered once. */
export function markNewAccount(settings) {
  return {
    ...settings,
    onboarding: {
      newAccount: true,
      offeredAt: null,
      outcome: null,
      outcomeAt: null,
    },
  };
}

/** True only for a new account that has never been offered the tour. */
export function shouldOfferTour(settings) {
  const o = settings?.onboarding;
  return o?.newAccount === true && !o.offeredAt;
}

/** Records that the tour was offered automatically, so it never is again. */
export function markTourOffered(settings, now) {
  return {
    ...settings,
    onboarding: { ...settings.onboarding, offeredAt: now },
  };
}

/**
 * Records how a run ended. The automatic first run fills outcome / outcomeAt once
 * and is never overwritten; a replay only updates lastReplay.
 */
export function markTourEnded(settings, outcome, now, { replay = false } = {}) {
  const o = settings.onboarding ?? {};
  if (replay)
    return {
      ...settings,
      onboarding: { ...o, lastReplay: { outcome, at: now } },
    };
  if (o.outcome) return settings; // the first run's result is already recorded
  return {
    ...settings,
    onboarding: { ...o, outcome, outcomeAt: now },
  };
}
