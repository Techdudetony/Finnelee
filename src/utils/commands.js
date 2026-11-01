// The command palette's commands and how typed text finds them. Pure, so every rule is
// unit tested. A command only describes what to do; App.jsx carries it out. No command
// adds, changes or deletes a financial record: they open pages, put focus in a form
// field, or change the Motion setting.

/** Pages, in the sidebar's order, with extra words people might type for each. */
const PAGE_ALIASES = {
  dashboard: ["home", "overview", "summary"],
  networth: ["accounts", "assets", "liabilities", "balance"],
  transactions: ["spending", "expenses", "history"],
  budget: ["plan", "zero based", "allocation", "envelope"],
  debt: ["loan", "loans", "credit card", "payoff", "snowball", "avalanche"],
  forecast: ["projection", "future"],
  goals: ["savings", "save", "emergency fund"],
  bills: ["recurring", "subscriptions", "due"],
  categories: ["tags", "groups"],
  settings: ["preferences", "backup", "export", "password", "recovery key"],
};

/**
 * Tasks: open a page and put focus in a field. `focus` lists data-focus-target values to
 * try in order (the first one on the page wins).
 */
const TASKS = [
  {
    id: "task:add-transaction",
    label: "Add a transaction",
    page: "transactions",
    focus: ["add-transaction"],
    aliases: ["new transaction", "expense", "income", "purchase"],
  },
  {
    id: "task:import-statement",
    label: "Import a statement",
    page: "transactions",
    focus: ["import-statement"],
    aliases: ["csv", "pdf", "upload", "bank statement"],
  },
  {
    id: "task:add-bill",
    label: "Add a bill",
    page: "bills",
    focus: ["add-bill"],
    aliases: ["new bill", "recurring bill", "subscription"],
  },
  {
    id: "task:add-goal",
    label: "Add a goal",
    page: "goals",
    focus: ["add-goal"],
    aliases: ["new goal", "savings goal"],
  },
  {
    id: "task:add-debt",
    label: "Add a debt",
    page: "debt",
    focus: ["add-debt"],
    aliases: ["new debt", "loan", "credit card"],
  },
  {
    id: "task:checking-balance",
    label: "Update your checking balance",
    page: "networth",
    focus: ["cash-balance", "add-account"],
    aliases: ["cash", "bank balance", "checking"],
  },
  {
    id: "task:pay-schedule",
    label: "Set your pay schedule",
    page: "bills",
    focus: ["pay-schedule"],
    aliases: ["payday", "paycheck", "salary", "income schedule"],
  },
];

const MOTION = [
  { level: "full", label: "Motion: Full", aliases: ["animations on"] },
  { level: "calm", label: "Motion: Calm", aliases: ["reduce motion", "less"] },
  { level: "off", label: "Motion: Off", aliases: ["animations off", "none"] },
];

/**
 * Every command, in the order shown when nothing is typed: pages, tasks, then settings.
 * pages: [{ id, label }] (App.jsx's PAGES). Each command: { id, label, group, aliases,
 * action } where action is { type: "page", page, focus? } or { type: "motion", level }.
 */
export function buildCommands(pages) {
  return [
    ...pages.map((p) => ({
      id: `page:${p.id}`,
      label: p.label,
      group: "Go to",
      aliases: PAGE_ALIASES[p.id] ?? [],
      action: { type: "page", page: p.id },
    })),
    ...TASKS.map(({ id, label, page, focus, aliases }) => ({
      id,
      label,
      group: "Start a task",
      aliases,
      action: { type: "page", page, focus },
    })),
    ...MOTION.map(({ level, label, aliases }) => ({
      id: `motion:${level}`,
      label,
      group: "Settings",
      aliases,
      action: { type: "motion", level },
    })),
  ];
}

/** Lower case, single spaces, no surrounding spaces. */
export const normalize = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** True when every letter of `query` appears in `text` in order ("dbt" in "debt"). */
export function isSubsequence(query, text) {
  let i = 0;
  for (const ch of text) if (ch === query[i]) i += 1;
  return i === query.length;
}

const startsAWord = (text, query) =>
  text.startsWith(query) || text.includes(` ${query}`);

/**
 * How well a command matches, lower is better, or null for no match:
 * 0 exact label or alias, 1 label starts with it, 2 a word in the label starts with
 * it, 3 an alias starts with it (or a word in one does), 4 the letters appear in order
 * in the label. Spaces in the query are ignored for the letters-in-order rule.
 */
export function matchRank(command, rawQuery) {
  const query = normalize(rawQuery);
  if (!query) return 0;
  const label = normalize(command.label);
  const aliases = command.aliases.map(normalize);
  if (label === query || aliases.includes(query)) return 0;
  if (label.startsWith(query)) return 1;
  if (startsAWord(label, query)) return 2;
  if (aliases.some((a) => startsAWord(a, query))) return 3;
  if (isSubsequence(query.replace(/ /g, ""), label.replace(/ /g, ""))) return 4;
  return null;
}

/**
 * The commands that match, best first. Within a rank they keep their listed order, so
 * the same text always gives the same list. Nothing typed: every command, in order.
 */
export function rankCommands(commands, query) {
  return commands
    .map((command, index) => ({
      command,
      index,
      rank: matchRank(command, query),
    }))
    .filter((r) => r.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((r) => r.command);
}

/** "4 results", "1 result", "No matches": read out as you type. */
export const resultCount = (n) =>
  n === 0 ? "No matches" : `${n} result${n === 1 ? "" : "s"}`;

/** True when a key event is the palette shortcut: Ctrl K, or ⌘K on a Mac. */
export const isPaletteShortcut = (e) =>
  Boolean(e.ctrlKey || e.metaKey) &&
  !e.altKey &&
  !e.shiftKey &&
  typeof e.key === "string" &&
  e.key.toLowerCase() === "k";

/** The next highlighted index for an arrow, Home or End key (wraps around), or null. */
export function moveActive(key, index, count) {
  if (count === 0) return null;
  if (key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
