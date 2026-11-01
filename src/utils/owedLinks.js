// Where to fix a payment the estimates can't fully use: which page holds the record, found
// from the record's key ("debt:<id>", "account:<id>", "bill:<id>") and never from its
// name, since two records can share one. Pure; the rules for what's owed stay in
// obligations.js and health.js.

/** Page names, as the buttons say them. */
export const PAGE_NAMES = {
  bills: "Bills",
  debt: "Debt Planner",
  networth: "Net Worth",
};

/**
 * The page where an owed item's amount or due day is entered: a linked bill or plain
 * bill on Bills, a Debt Planner group on Debt Planner, a Net Worth liability on Net Worth.
 */
export function owedPage(item) {
  if (item.bill || item.key.startsWith("bill:")) return "bills";
  if (item.key.startsWith("debt:")) return "debt";
  return "networth";
}

/** One entry per record (and linked bill): the same record owed in two months is listed once. */
function byRecord(items) {
  const found = new Map();
  for (const i of items) {
    const id = `${i.key}|${i.bill ?? ""}`;
    const entry = found.get(id) ?? {
      id,
      name: i.bill ?? i.name,
      page: owedPage(i),
      amount: 0,
      months: 0,
    };
    entry.amount = Math.round((entry.amount + (i.amount ?? 0)) * 100) / 100;
    entry.months += 1;
    found.set(id, entry);
  }
  return [...found.values()];
}

/** Payments with an unknown amount: [{ id, name, page }], once per record. */
export const unknownPayments = (items) =>
  byRecord(items.filter((i) => i.amount === null)).map(
    ({ id, name, page }) => ({ id, name, page }),
  );

/**
 * Known debt payments with no due day. They count in the spendable estimate but have no
 * date, so the 14-day runway and its projection leave them out:
 * [{ id, name, page, amount, months }], amount summed over the months in the window.
 */
export const undatedPayments = (items) =>
  byRecord(
    items.filter(
      (i) => i.kind === "debt" && i.reason === "undated" && i.amount !== null,
    ),
  );
