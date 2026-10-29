// Transaction import: turns a bank or card export into Finnelee transactions.
// Everything here is pure (text in, plain objects out), so the React card only
// handles the file picker and clicks, and every rule can be unit-tested.
//
// CSV: validateFile -> parseCSV -> guessMapping -> buildPreview -> selectForImport
// PDF: validateFile -> pdfText -> pdfStatement (drafts) -> previewDrafts -> selectForImport

import { merchantCategoryMap, normalizeMerchant } from './merchant';
import { toISODate, uid } from './format';

const MB = 1048576;
const MAX_BYTES = { csv: 5 * MB, pdf: 10 * MB };
export const MAX_ROWS = 10_000;

/** 'csv', 'pdf' or null, from the file name. */
export const fileKind = (name) =>
  /\.csv$/i.test(name) ? 'csv' : /\.pdf$/i.test(name) ? 'pdf' : null;

/** Checks a File's name and size before reading it. Returns an error message or null. */
export function validateFile({ name = '', size = 0 }) {
  const kind = fileKind(name);
  if (!kind) return 'Choose a .csv or .pdf file.';
  if (size === 0) return 'This file is empty.';
  if (size > MAX_BYTES[kind])
    return `This file is ${(size / MB).toFixed(1)} MB; the limit for ${kind.toUpperCase()} files is ${MAX_BYTES[kind] / MB} MB.`;
  return null;
}

// ---------- Parsing ----------

/**
 * Splits CSV text into rows of cells, following the CSV quoting rules:
 * a field wrapped in "..." may contain commas, newlines and "" (an escaped quote).
 * A character-by-character loop is needed because a simple split(',') breaks on all of these.
 *
 * Returns { headers, rows: [{ line, cells }], errors: [{ line, reason }], fatal }.
 * `line` is the file line where the row starts (the header is line 1), so error
 * messages point at the right place even when a quoted field spans several lines.
 * `fatal` is a message when the whole file can't be used; otherwise null.
 */
export function parseCSV(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // drop the UTF-8 BOM Excel adds
  const records = [];
  const errors = [];
  let cells = [];
  let field = '';
  let inQuotes = false; // currently between an opening and closing quote
  let quoted = false; // the current field started with a quote
  let problem = null; // first malformed-quote problem in the current row
  let line = 1;
  let rowLine = 1;

  const endField = () => {
    cells.push(quoted ? field : field.trim()); // spaces inside quotes are intentional; keep them
    field = '';
    quoted = false;
  };
  const endRow = () => {
    endField();
    const blank = cells.length === 1 && cells[0] === '';
    if (problem) errors.push({ line: rowLine, reason: problem });
    else if (!blank) records.push({ line: rowLine, cells });
    cells = [];
    problem = null;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'; // "" inside quotes is one literal quote
          i++;
        } else inQuotes = false;
      } else if (ch === '\r' && src[i + 1] === '\n') {
        continue; // store CRLF inside a quoted field as a plain \n
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++; // CRLF (Windows) counts as one line break
      endRow();
      line++;
      rowLine = line;
    } else if (ch === '"' && !quoted && field.trim() === '') {
      inQuotes = quoted = true;
      field = '';
    } else if (quoted) {
      // After a closing quote only spaces may come before the next comma: "abc" ,
      if (ch.trim() && !problem) problem = 'Unexpected text after a closing quote';
    } else {
      field += ch; // includes a stray " inside an unquoted value (27" monitor): kept as text
    }
  }
  if (inQuotes) problem = 'Unclosed quote (the file may be cut off)';
  if (field || quoted || cells.length) endRow();

  const fail = (fatal) => ({ headers: [], rows: [], errors: [], fatal });
  if (!records.length) return fail(errors[0]?.reason ?? 'The file has no rows.');
  const [header, ...body] = records;
  // A row error before the first good record means the header itself was malformed.
  const headerError = errors.find((e) => e.line < header.line);
  if (headerError)
    return fail(`The header row (line ${headerError.line}) can't be read: ${headerError.reason}.`);
  // No good rows but some broken ones: keep going so the preview can list why each failed.
  if (!body.length && !errors.length) return fail('The file has a header row but no transactions.');
  if (body.length > MAX_ROWS)
    return fail(
      `This file has ${body.length.toLocaleString()} rows; the limit is ${MAX_ROWS.toLocaleString()}.`,
    );

  const width = header.cells.length;
  const rows = [];
  for (const r of body) {
    // Some banks end data rows with a trailing comma the header doesn't have; empty extras are harmless.
    const extrasEmpty = r.cells.slice(width).every((c) => c === '');
    if (r.cells.length === width || (r.cells.length > width && extrasEmpty))
      rows.push({ line: r.line, cells: r.cells.slice(0, width) });
    else
      errors.push({ line: r.line, reason: `Expected ${width} columns, found ${r.cells.length}` });
  }
  return { headers: header.cells, rows, errors, fatal: null };
}

/**
 * '2026-10-15', '10/15/2026' or '10/15/26' -> '2026-10-15'; anything else -> null.
 * Slash dates are read as US month/day. Two-digit years are 20xx.
 */
export function parseDateCell(raw) {
  const s = String(raw ?? '')
    .trim()
    .split(/[ T]/)[0]; // ignore a trailing time: '2026-10-15 00:00:00'
  let y, m, d;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = match.slice(1).map(Number);
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    [m, d, y] = match.slice(1).map(Number);
    if (y < 100) y += 2000;
  } else return null;
  // new Date(2026, 1, 30) silently rolls over to Mar 2, so rebuild the date and
  // reject it if any part changed. That catches Feb 30, month 13, day 0, etc.
  const date = new Date(y, m - 1, d);
  const same = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  return same ? toISODate(date) : null;
}

/**
 * '$1,234.56' -> 1234.56, '-84.52' / '(84.52)' / '84.52-' -> -84.52.
 * Returns null for text that isn't a plain amount (including '1,5', which could be
 * a European decimal) rather than guessing.
 */
export function parseAmount(raw) {
  let s = String(raw ?? '').replace(/[\s$]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true; // accounting style: (84.52) means -84.52
    s = s.slice(1, -1);
  }
  if (/^[-+]/.test(s)) {
    negative = negative !== (s[0] === '-'); // !== flips the sign, so -(5) stays negative overall
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.includes(',') && !/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null; // commas only as thousands
  s = s.replace(/,/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const value = Math.round(Number(s) * 100) / 100; // money has 2 decimals
  return negative ? -value : value;
}

// ---------- Column mapping ----------

// Header names banks commonly use for each field, in priority order. Headers are
// compared lowercased with spaces and punctuation removed ('Posted Date' -> 'posteddate').
const HEADER_HINTS = {
  date: [
    'date',
    'transactiondate',
    'transdate',
    'posteddate',
    'postdate',
    'postingdate',
    'dateposted',
  ],
  description: ['description', 'payee', 'merchant', 'name', 'details', 'memo'],
  amount: ['amount', 'transactionamount', 'amt'],
  debit: ['debit', 'debitamount', 'withdrawal', 'withdrawals', 'moneyout'],
  credit: ['credit', 'creditamount', 'deposit', 'deposits', 'moneyin'],
  type: ['type', 'transactiontype', 'debitcredit', 'drcr'],
  category: ['category'],
};
export const FIELDS = Object.keys(HEADER_HINTS);

/**
 * Suggests which column holds each field (-1 = not in the file) and how to read
 * signs in a single amount column:
 *   sign 'negative-expense': -84.52 is money out (most bank accounts)
 *   sign 'positive-expense': 84.52 is money out (many credit card exports)
 */
export function guessMapping(headers, rows = []) {
  const keys = headers.map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const used = new Set(); // each column can only fill one field
  const mapping = { sign: 'negative-expense' };
  for (const field of FIELDS) {
    const hit = HEADER_HINTS[field]
      .map((hint) => keys.indexOf(hint))
      .find((i) => i !== -1 && !used.has(i));
    mapping[field] = hit ?? -1;
    if (hit !== undefined) used.add(hit);
  }
  // An amount column that is never negative is most likely a list of charges.
  if (mapping.amount !== -1 && rows.length) {
    const anyNegative = rows.some((r) => (parseAmount(r.cells[mapping.amount]) ?? 0) < 0);
    if (!anyNegative) mapping.sign = 'positive-expense';
  }
  return mapping;
}

/** What still has to be chosen before a preview makes sense, or null when the mapping is usable. */
export function mappingProblem(m) {
  if (m.date < 0) return 'Choose the date column.';
  if (m.description < 0) return 'Choose the description column.';
  if (m.amount < 0 && m.debit < 0 && m.credit < 0)
    return 'Choose an amount column, or debit and credit columns.';
  return null;
}

// ---------- Rows -> transactions ----------

const TYPE_WORDS = {
  expense: ['debit', 'dr', 'withdrawal', 'expense', 'purchase', 'sale'],
  income: ['credit', 'cr', 'deposit', 'income', 'refund', 'return'],
};
const readType = (raw) => {
  const word = String(raw ?? '')
    .trim()
    .toLowerCase();
  return TYPE_WORDS.expense.includes(word)
    ? 'expense'
    : TYPE_WORDS.income.includes(word)
      ? 'income'
      : null;
};

/**
 * Works out { amount, type } for one row, or { error }. The amount is always positive.
 * Most explicit wins: debit/credit columns, then a Debit/Credit type column, then the sign rule.
 */
function readMoney(cell, m) {
  const debitRaw = cell(m.debit);
  const creditRaw = cell(m.credit);
  if (debitRaw || creditRaw) {
    const debit = debitRaw ? parseAmount(debitRaw) : 0;
    const credit = creditRaw ? parseAmount(creditRaw) : 0;
    if (debit === null) return { error: `Can't read the debit "${debitRaw}"` };
    if (credit === null) return { error: `Can't read the credit "${creditRaw}"` };
    if (debit && credit) return { error: 'Both debit and credit have a value' };
    if (!debit && !credit) return { error: 'Amount is zero' };
    return debit
      ? { amount: Math.abs(debit), type: 'expense' }
      : { amount: Math.abs(credit), type: 'income' };
  }
  const raw = cell(m.amount);
  if (!raw) return { error: 'Missing amount' };
  const value = parseAmount(raw);
  if (value === null) return { error: `Can't read the amount "${raw}"` };
  if (value === 0) return { error: 'Amount is zero' };
  const negative = value < 0;
  const bySign = (m.sign === 'negative-expense') === negative ? 'expense' : 'income';
  return { amount: Math.abs(value), type: readType(cell(m.type)) ?? bySign };
}

/**
 * Returns a function that picks a category NAME (transactions store names) of the right type:
 * 1. what this merchant was filed under before, 2. the CSV's category if the user has it
 * (ignoring case and spaces), 3. 'Other' / 'Other Income', 4. the first category of that type.
 * Never invents a category; '' means the user has none of that type.
 */
function categoryPicker(categories, transactions) {
  const history = merchantCategoryMap(transactions);
  const FALLBACK = { expense: 'Other', income: 'Other Income' };
  const loose = (s) =>
    String(s ?? '')
      .trim()
      .toLowerCase();
  const find = (name, type) =>
    name
      ? categories.find((c) => c.type === type && loose(c.name) === loose(name))?.name
      : undefined;
  return (merchant, type, csvCategory) =>
    find(history.get(`${type}|${merchant}`), type) ??
    find(csvCategory, type) ??
    find(FALLBACK[type], type) ??
    categories.find((c) => c.type === type)?.name ??
    '';
}

/**
 * Two transactions look like the same one when date, merchant, amount and type match.
 * Amounts compare as whole cents so float noise (0.1 + 0.2) can't hide a match.
 * Descriptions with no letters ('12345') fall back to the raw text so they don't all collide.
 */
export const duplicateKey = (t) =>
  [
    t.date,
    normalizeMerchant(t.description) || String(t.description).trim().toLowerCase(),
    Math.round(Number(t.amount) * 100),
    t.type,
  ].join('|');

// ---------- Drafts: the shared shape for CSV and PDF rows ----------
// draft = { line, page?, date, description, money: { amount, type } | { error }, category, review? }
// `date` and `description` are raw text until previewDrafts validates them.
// `review` is set when the importer guessed something the user should confirm.

/** CSV rows + column mapping -> drafts. */
export const toDrafts = (parsed, mapping) =>
  parsed.rows.map(({ line, cells }) => {
    const cell = (i) => (i >= 0 ? (cells[i] ?? '').trim() : '');
    return {
      line,
      date: cell(mapping.date),
      description: cell(mapping.description),
      money: readMoney(cell, mapping),
      category: cell(mapping.category),
    };
  });

/**
 * Applies the user's corrections: { [line]: { date, description, amount, type } }.
 * A corrected row counts as confirmed, so its `review` flag is dropped.
 */
export function applyEdits(drafts, edits = {}) {
  return drafts.map((draft) => {
    const edit = edits[draft.line];
    if (!edit) return draft;
    const { review: _confirmed, ...rest } = draft;
    const value = parseAmount(edit.amount);
    const money =
      value === null
        ? { error: `Can't read the amount "${edit.amount}"` }
        : value === 0
          ? { error: 'Amount is zero' }
          : { amount: Math.abs(value), type: edit.type };
    return { ...rest, date: edit.date, description: edit.description, money };
  });
}

/** The first reason a draft can't become a transaction, or null. */
function draftError(d) {
  if (!d.date) return 'Missing date';
  if (!parseDateCell(d.date)) return `Invalid date "${d.date}"`;
  if (!d.description.trim()) return 'Missing description';
  return d.money.error ?? null;
}

/**
 * Validates drafts and returns one preview item per row, in order:
 *   { line, page?, status: 'ok' | 'review' | 'duplicate' | 'error', tx?, reason?, draft? }
 * Duplicates are checked against saved transactions AND earlier rows of the same file.
 * Nothing is saved here: the caller decides what to import.
 */
export function previewDrafts(drafts, { categories, transactions }, parseErrors = []) {
  const pickCategory = categoryPicker(categories, transactions);
  const existing = new Set(transactions.map(duplicateKey));
  const firstSeen = new Map(); // duplicate key -> line of the first row with it
  const items = parseErrors.map((e) => ({ line: e.line, status: 'error', reason: e.reason }));

  for (const draft of drafts) {
    const { line, page } = draft;
    const base = page ? { line, page, draft } : { line, draft };
    const error = draftError(draft);
    if (error) {
      items.push({ ...base, status: 'error', reason: error });
      continue;
    }
    const description = draft.description.replace(/\s+/g, ' ').trim(); // embedded newlines -> spaces
    const { amount, type } = draft.money;
    const category = pickCategory(normalizeMerchant(description), type, draft.category);
    if (!category) {
      items.push({
        ...base,
        status: 'error',
        reason: `No ${type} category exists. Add one on the Categories page.`,
      });
      continue;
    }
    const tx = { date: parseDateCell(draft.date), description, category, type, amount };
    const key = duplicateKey(tx);
    const label = page ? 'row' : 'line';
    if (existing.has(key))
      items.push({ ...base, status: 'duplicate', tx, reason: 'Matches a saved transaction' });
    else if (firstSeen.has(key))
      items.push({
        ...base,
        status: 'duplicate',
        tx,
        reason: `Same as ${label} ${firstSeen.get(key)}`,
      });
    else if (draft.review) items.push({ ...base, status: 'review', tx, reason: draft.review });
    else items.push({ ...base, status: 'ok', tx });
    if (!firstSeen.has(key)) firstSeen.set(key, line);
  }
  return items.sort((a, b) => a.line - b.line);
}

/** CSV shortcut: mapping + corrections + validation in one call. */
export const buildPreview = (parsed, mapping, context, edits = {}) =>
  previewDrafts(applyEdits(toDrafts(parsed, mapping), edits), context, parsed.errors);

/** Counts for the preview header. */
export function summarize(items) {
  const counts = { total: items.length, ok: 0, review: 0, duplicate: 0, error: 0 };
  for (const i of items) counts[i.status]++;
  return counts;
}

/** Rows that are only imported when the user ticks them. */
export const needsApproval = (item) => item.status === 'duplicate' || item.status === 'review';

/**
 * The transactions to save: every 'ok' row plus the duplicate/review rows the user ticked
 * (by line number). Ids are created here, at import time.
 */
export const selectForImport = (items, includedLines = new Set()) =>
  items
    .filter((i) => i.status === 'ok' || (needsApproval(i) && includedLines.has(i.line)))
    .map((i) => ({ id: uid(), ...i.tx }));
