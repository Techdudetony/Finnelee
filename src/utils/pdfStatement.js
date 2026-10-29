// Turns the text lines of a PDF bank or card statement (from pdfText.js) into import
// drafts (see csvImport.js), so preview, categories, corrections and duplicate checks
// are shared with CSV import. Pure: no PDF.js here.

import { parseAmount, parseDateCell } from './csvImport';
import { toISODate } from './format';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const MONTH_NC = MONTH.replace('(', '(?:'); // same, without a capture group
const DAY_MS = 86_400_000;
const monthNumber = (name) => MONTHS.indexOf(name.toLowerCase()) + 1;

// Dates a transaction line can start with; the year is often left out.
const DATE_FORMATS = [
  // 2026-10-15
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})\b/, read: (m) => [m[1], +m[2], +m[3]] },
  // 10/15, 10/15/26, 10/15/2026, 10-15
  {
    re: /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?(?![\d/])/,
    read: (m) => [m[3], +m[1], +m[2]],
  },
  // Oct 15, Oct. 15, 2026
  {
    re: new RegExp(`^${MONTH}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, 'i'),
    read: (m) => [m[3], monthNumber(m[1]), +m[2]],
  },
  // 15 Oct, 15 Oct 2026
  {
    re: new RegExp(`^(\\d{1,2})\\s+${MONTH}(?:,?\\s+(\\d{4}))?\\b`, 'i'),
    read: (m) => [m[3], monthNumber(m[2]), +m[1]],
  },
];

const FULL_DATE = `(?:\\d{1,2}/\\d{1,2}/\\d{2,4}|${MONTH_NC}\\s+\\d{1,2},?\\s+\\d{4})`;
const PERIOD_RE = new RegExp(`(${FULL_DATE})\\s*(?:-|–|—|to|through|thru)\\s*(${FULL_DATE})`, 'i');

// A money amount with two decimals, optionally signed, in parentheses, or marked CR/DR.
const MONEY_TOKEN = /^(\(?[-+]?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?-?)(CR|DR)?$/i;

// Statement furniture that is never a transaction. Shown to the user as skipped lines.
const SUMMARY_RE = new RegExp(
  [
    '\\b(beginning|opening|starting|ending|closing|previous|new|daily|average|available|current|statement|account)\\s+balance\\b',
    '^balance\\b',
    '\\bbalance (forward|brought forward|carried forward)\\b',
    '^(sub)?total\\b',
    '\\btotal (deposits|withdrawals|debits|credits|fees|interest|payments|purchases|charges|checks|for this period)\\b',
    'minimum (payment|amount) due',
    'payment due date',
    'credit limit',
    'available credit',
    'account (number|summary)',
    'statement (period|date|closing date)',
    'annual percentage rate',
    'interest charged',
    'fees charged',
    'year[- ]to[- ]date',
  ].join('|'),
  'i',
);
const NOISE_RE = /^page \d+( of \d+)?$|^\d+ of \d+$|^\(?continued\)?/i;
const CARD_RE = /credit card|card ?member|minimum payment|credit limit|available credit/i;

// Column header words, checked in this order ("Transaction Date" is a date column).
const COLUMNS = [
  ['balance', /balance/i],
  ['debit', /withdrawal|debit|money out|subtraction|checks paid/i],
  ['credit', /deposit|credit|money in|addition/i],
  ['amount', /amount/i],
  ['date', /date/i],
  ['description', /description|details|transaction|payee|merchant|activity|memo/i],
];
const MONEY_COLUMNS = new Set(['amount', 'debit', 'credit', 'balance']);

/** A date at the start of `text`: { year, month, day, words } or null. */
function leadingDate(text) {
  for (const { re, read } of DATE_FORMATS) {
    const m = re.exec(text);
    if (!m) continue;
    const [year, month, day] = read(m);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return {
      year: year ? (year.length === 2 ? 2000 + Number(year) : Number(year)) : null,
      month,
      day,
      words: m[0].trim().split(/\s+/).length,
    };
  }
  return null;
}

const isoDate = (y, m, d) =>
  parseDateCell(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

/** "Statement period 09/16/2026 - 10/15/2026" -> { start, end } as Dates, or null. */
function findPeriod(text) {
  const m = PERIOD_RE.exec(text);
  if (!m) return null;
  const [start, end] = [m[1], m[2]].map((s) => {
    const d = leadingDate(s);
    return d?.year ? new Date(d.year, d.month - 1, d.day) : null;
  });
  return start && end && start <= end ? { start, end } : null;
}

/** Fills in a missing year from the statement period and says when it had to guess. */
function resolveDate(d, period, fallbackYear) {
  const raw = `${d.month}/${d.day}`;
  if (d.year) return { iso: isoDate(d.year, d.month, d.day) ?? raw };
  if (period) {
    const slack = 7 * DAY_MS;
    // December charges on a statement that ends in January belong to the earlier year.
    for (const year of new Set([period.end.getFullYear(), period.start.getFullYear()])) {
      const date = new Date(year, d.month - 1, d.day);
      if (date >= period.start - slack && date <= +period.end + slack)
        return { iso: isoDate(year, d.month, d.day) ?? raw };
    }
    const iso = isoDate(period.end.getFullYear(), d.month, d.day) ?? raw;
    return { iso, review: 'Date is outside the statement period' };
  }
  const iso = isoDate(fallbackYear, d.month, d.day) ?? raw;
  return { iso, review: `The year isn't on the statement; ${fallbackYear} was assumed` };
}

/** A column header line -> [{ kind, x, right }], or null when the line isn't a header. */
function readHeader(line) {
  if (leadingDate(line.text) || line.cells.some((c) => MONEY_TOKEN.test(c.text))) return null;
  const columns = line.cells
    .map((c) => ({ kind: COLUMNS.find(([, re]) => re.test(c.text))?.[0], x: c.x, right: c.right }))
    .filter((c) => c.kind);
  const kinds = new Set(columns.map((c) => c.kind));
  const hasMoney = [...kinds].some((k) => MONEY_COLUMNS.has(k) && k !== 'balance');
  const mostlyHeaders = columns.length >= line.cells.length * 0.6;
  return hasMoney && kinds.size >= 2 && mostlyHeaders ? columns : null;
}

/** Which money column a number sits under (numbers and headers are usually right-aligned). */
function columnFor(cell, header) {
  let best = null;
  for (const col of header) {
    if (!MONEY_COLUMNS.has(col.kind)) continue;
    const distance = Math.min(
      Math.abs(col.right - cell.right),
      Math.abs((col.x + col.right) / 2 - (cell.x + cell.right) / 2),
    );
    if (distance < 60 && (!best || distance < best.distance)) best = { kind: col.kind, distance };
  }
  return best?.kind ?? null;
}

/**
 * Splits one line into its leading date, description words and trailing amounts.
 * Words keep a reference to their cell when the cell is a single word, so an amount
 * can be matched to the column it sits under.
 */
function splitLine(line, header) {
  const tokens = [];
  line.cells.forEach((cell, i) => {
    // "84.52 CR" or a lone "CR" cell after an amount become one token: "84.52CR"
    const text = cell.text.replace(/(\d\.\d{2}\)?-?)\s+(CR|DR)\b/gi, '$1$2');
    if (/^(CR|DR)$/i.test(text) && tokens.length) {
      tokens.at(-1).text += text;
      return;
    }
    const words = text.split(' ');
    for (const word of words)
      tokens.push({ text: word, cell: words.length === 1 ? cell : null, cellIndex: i });
  });

  const amounts = [];
  while (tokens.length) {
    const m = MONEY_TOKEN.exec(tokens.at(-1).text);
    if (!m) break;
    const token = tokens.pop();
    amounts.unshift({
      value: parseAmount(m[1]),
      marker: m[2]?.toUpperCase() ?? null,
      column: header && token.cell ? columnFor(token.cell, header) : null,
    });
  }

  let date = leadingDate(tokens.map((t) => t.text).join(' '));
  if (date) {
    tokens.splice(0, date.words);
    const second = leadingDate(tokens.map((t) => t.text).join(' ')); // card statements: trans + post date
    if (second) tokens.splice(0, second.words);
  }
  const first = tokens[0];
  return {
    date,
    description: tokens.map((t) => t.text).join(' '),
    // x of the description's cell, used to recognize wrapped description lines below it
    descriptionX: first ? line.cells[first.cellIndex].x : null,
    amounts,
  };
}

/** Picks the transaction amount and type for a line, adding a review note when unsure. */
function decideMoney(amounts, { isCard, signed }, reviews) {
  const located = amounts.some((a) => a.column);
  let candidates = amounts.filter((a) => a.column !== 'balance');
  if (!located && candidates.length > 1) {
    reviews.push(
      candidates.length === 2
        ? 'Two amounts on this line; the second was taken as the running balance'
        : 'Several amounts on this line; the first was used',
    );
    candidates = candidates.slice(0, 1);
  }
  if (!candidates.length) return { error: 'Only a balance on this line' };
  if (candidates.length > 1) return { error: 'More than one amount on this line' };

  const { value, marker, column } = candidates[0];
  if (value === 0) return { error: 'Amount is zero' };
  const amount = Math.abs(value);
  const moneyIn =
    column === 'credit' ||
    marker === 'CR' ||
    (column !== 'debit' && marker !== 'DR' && (isCard ? value < 0 : value > 0 && signed));
  const known =
    column === 'debit' || column === 'credit' || marker || isCard || value < 0 || signed;

  // Paying off a card shows up as a credit: usually a transfer, not income.
  if (isCard && moneyIn)
    reviews.push('Payment or credit on a card; usually a transfer, so check before importing');
  if (!known) reviews.push("Couldn't tell if this is money in or out");
  return { amount, type: moneyIn ? 'income' : 'expense' };
}

/**
 * pages from pdfText.readPdfPages -> {
 *   drafts,                          // rows for previewDrafts()
 *   skipped: [{ page, text, reason }], // balances, totals and lines that looked broken
 *   kind: 'bank' | 'card', period: { start, end } | null, pages, fatal: string | null
 * }
 */
export function parseStatement(pages, { today = new Date() } = {}) {
  const lines = pages.flatMap((p) =>
    p.lines.map((l) => ({ ...l, page: p.number, text: l.cells.map((c) => c.text).join(' ') })),
  );
  const allText = lines.map((l) => l.text).join('\n');
  const result = (fields) => ({
    drafts: [],
    skipped: [],
    kind: 'bank',
    period: null,
    pages: pages.length,
    fatal: null,
    ...fields,
  });

  if (allText.replace(/\s/g, '').length < 20)
    return result({
      fatal:
        "This PDF has no selectable text, so it's probably a scanned image. Scanned statements aren't supported yet; try downloading a CSV from your bank instead.",
    });

  const period = findPeriod(allText);
  const years = [...allText.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  const fallbackYear =
    period?.end.getFullYear() ?? (years.length ? Math.max(...years) : today.getFullYear());
  const isCard = CARD_RE.test(allText);

  let header = null; // column positions, kept across page breaks
  let last = null; // previous transaction, for wrapped description lines
  const entries = [];
  const skipped = [];
  const skip = (line, reason) => {
    skipped.push({ page: line.page, text: line.text, reason });
    last = null;
  };

  for (const line of lines) {
    if (NOISE_RE.test(line.text)) continue;
    const columns = readHeader(line);
    if (columns) {
      header = columns;
      last = null;
      continue;
    }
    if (SUMMARY_RE.test(line.text)) {
      skip(line, 'Balance, total or summary line');
      continue;
    }
    const parts = splitLine(line, header);
    if (!parts.date) {
      if (parts.amounts.length) skip(line, 'Has an amount but no date');
      else if (
        last &&
        last.page === line.page &&
        last.wraps < 2 &&
        last.descriptionX !== null &&
        Math.abs(line.cells[0].x - last.descriptionX) < 15
      ) {
        last.description += ` ${line.text}`;
        last.wraps++;
      }
      continue; // other text (addresses, notices) is ignored
    }
    if (!parts.amounts.length) {
      skip(line, 'Has a date but no amount');
      continue;
    }
    last = { ...parts, page: line.page, wraps: 0 };
    entries.push(last);
  }

  if (!entries.length)
    return result({
      skipped,
      fatal:
        "Couldn't find any transactions in this PDF. Statements need one transaction per line, starting with a date.",
    });

  const signed = entries.some((e) =>
    e.amounts.some((a) => a.column !== 'balance' && (a.value < 0 || a.marker)),
  );
  const drafts = entries.map((e, i) => {
    const reviews = [];
    const date = resolveDate(e.date, period, fallbackYear);
    if (date.review) reviews.push(date.review);
    const money = decideMoney(e.amounts, { isCard, signed }, reviews);
    return {
      line: i + 1,
      page: e.page,
      date: date.iso,
      description: e.description,
      money,
      category: '',
      ...(reviews.length && { review: reviews.join('. ') }),
    };
  });

  return result({
    drafts,
    skipped,
    kind: isCard ? 'card' : 'bank',
    period: period && { start: toISODate(period.start), end: toISODate(period.end) },
  });
}
