import { describe, expect, it } from 'vitest';
import {
  MAX_ROWS,
  applyEdits,
  buildPreview,
  fileKind,
  guessMapping,
  mappingProblem,
  parseAmount,
  parseCSV,
  parseDateCell,
  previewDrafts,
  selectForImport,
  summarize,
  toDrafts,
  validateFile,
} from './csvImport';
import { transactionsToCSV } from './csvExport';
import { DEFAULT_CATEGORIES } from '../data/categories';

const CONTEXT = { categories: DEFAULT_CATEGORIES, transactions: [] };

// Parse + guess + preview in one go, the way the import card uses them.
const preview = (csv, { categories = DEFAULT_CATEGORIES, transactions = [], mapping = {} } = {}) => {
  const parsed = parseCSV(csv);
  const m = { ...guessMapping(parsed.headers, parsed.rows), ...mapping };
  return buildPreview(parsed, m, { categories, transactions });
};

const FORMAT_A = `Date,Description,Amount,Category
10/15/2026,Walmart,-84.52,Groceries
10/16/2026,Payroll,1850.00,Salary
10/17/2026,Netflix,-15.49,Entertainment`;

const FORMAT_B = `Posted Date,Description,Debit,Credit
10/15/2026,Walmart,84.52,
10/16/2026,Payroll,,1850.00
10/17/2026,Netflix,15.49,`;

const FORMAT_C = `Transaction Date,Payee,Amount,Type
2026-10-15,Walmart,84.52,Debit
2026-10-16,Payroll,1850.00,Credit
2026-10-17,Netflix,15.49,Debit`;

const asTypes = (items) => items.map((i) => [i.tx.description, i.tx.type, i.tx.amount]);
const EXPECTED = [
  ['Walmart', 'expense', 84.52],
  ['Payroll', 'income', 1850],
  ['Netflix', 'expense', 15.49],
];

describe('validateFile', () => {
  it('accepts a normal .csv', () => expect(validateFile({ name: 'bank.CSV', size: 100 })).toBeNull());
  it('rejects other extensions, empty and oversized files', () => {
    expect(validateFile({ name: 'bank.xlsx', size: 100 })).toMatch(/\.csv/);
    expect(validateFile({ name: 'bank.csv', size: 0 })).toMatch(/empty/);
    expect(validateFile({ name: 'bank.csv', size: 6 * 1024 * 1024 })).toMatch(/limit/);
  });
});

describe('parseCSV', () => {
  it('handles quoted commas and escaped quotes', () => {
    const { rows } = parseCSV('a,b\n"Smith, John","He said ""hi"""');
    expect(rows[0].cells).toEqual(['Smith, John', 'He said "hi"']);
  });

  it('keeps embedded newlines and reports the line each row starts on', () => {
    const { rows } = parseCSV('a,b\n"two\nlines",x\nnext,y');
    expect(rows[0]).toEqual({ line: 2, cells: ['two\nlines', 'x'] });
    expect(rows[1].line).toBe(4);
  });

  it('handles CRLF, a UTF-8 BOM and blank lines', () => {
    const parsed = parseCSV('﻿Date,Amount\r\n1/2/2026,5\r\n\r\n1/3/2026,6\r\n');
    expect(parsed.headers).toEqual(['Date', 'Amount']);
    expect(parsed.rows.map((r) => [r.line, r.cells])).toEqual([
      [2, ['1/2/2026', '5']],
      [4, ['1/3/2026', '6']],
    ]);
  });

  it('flags malformed quotes and wrong column counts with their line numbers', () => {
    const parsed = parseCSV('a,b\n"x"y,1\nonly-one\nok,2');
    expect(parsed.errors).toEqual([
      { line: 2, reason: 'Unexpected text after a closing quote' },
      { line: 3, reason: 'Expected 2 columns, found 1' },
    ]);
    expect(parsed.rows.map((r) => r.cells)).toEqual([['ok', '2']]);
  });

  it('reports an unclosed quote', () => {
    expect(parseCSV('a,b\n1,"oops\n2,3').errors[0]).toEqual({ line: 2, reason: expect.stringMatching(/Unclosed/) });
  });

  it('tolerates a trailing empty column the header lacks', () => {
    expect(parseCSV('a,b\n1,2,').rows[0].cells).toEqual(['1', '2']);
  });

  it('fails the whole file when there are no rows, no data, too many rows or a broken header', () => {
    expect(parseCSV('').fatal).toBeTruthy();
    expect(parseCSV('a,b').fatal).toMatch(/no transactions/);
    expect(parseCSV('"a,b\n1,2').fatal).toBeTruthy();
    const big = 'a\n' + '1\n'.repeat(MAX_ROWS + 1);
    expect(parseCSV(big).fatal).toMatch(/limit/);
  });
});

describe('parseDateCell', () => {
  it('reads ISO, MM/DD/YYYY and M/D/YY', () => {
    expect(parseDateCell('2026-10-05')).toBe('2026-10-05');
    expect(parseDateCell('10/05/2026')).toBe('2026-10-05');
    expect(parseDateCell('1/5/26')).toBe('2026-01-05');
    expect(parseDateCell('2026-10-05 13:45:00')).toBe('2026-10-05');
  });
  it('rejects impossible dates instead of rolling them over', () => {
    expect(parseDateCell('2026-02-30')).toBeNull();
    expect(parseDateCell('2/29/2026')).toBeNull(); // 2026 is not a leap year
    expect(parseDateCell('2/29/2028')).toBe('2028-02-29');
    expect(parseDateCell('13/01/2026')).toBeNull(); // day-first dates aren't guessed
    expect(parseDateCell('Oct 5 2026')).toBeNull();
    expect(parseDateCell('')).toBeNull();
  });
});

describe('parseAmount', () => {
  it.each([
    ['84.52', 84.52],
    ['$1,234.56', 1234.56],
    [' -84.52 ', -84.52],
    ['(84.52)', -84.52],
    ['$(1,000)', -1000],
    ['84.52-', -84.52],
    ['+5', 5],
    ['.5', 0.5],
    ['0', 0],
  ])('%s -> %s', (raw, value) => expect(parseAmount(raw)).toBe(value));

  it.each(['', 'abc', '1,5', '12,34.00', '1.2.3', '--5'])('rejects %j', (raw) =>
    expect(parseAmount(raw)).toBeNull(),
  );
});

describe('guessMapping', () => {
  it('detects format A (signed amounts)', () => {
    const p = parseCSV(FORMAT_A);
    expect(guessMapping(p.headers, p.rows)).toMatchObject({
      date: 0, description: 1, amount: 2, category: 3, debit: -1, credit: -1, type: -1, sign: 'negative-expense',
    });
  });
  it('detects format B (debit/credit)', () => {
    const p = parseCSV(FORMAT_B);
    expect(guessMapping(p.headers, p.rows)).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, amount: -1 });
  });
  it('detects format C (type column) and positive amounts', () => {
    const p = parseCSV(FORMAT_C);
    expect(guessMapping(p.headers, p.rows)).toMatchObject({
      date: 0, description: 1, amount: 2, type: 3, sign: 'positive-expense',
    });
  });
  it('mappingProblem asks for the missing columns', () => {
    expect(mappingProblem({ date: -1, description: 1, amount: 2, debit: -1, credit: -1 })).toMatch(/date/);
    expect(mappingProblem({ date: 0, description: 1, amount: -1, debit: -1, credit: -1 })).toMatch(/amount/);
    expect(mappingProblem({ date: 0, description: 1, amount: -1, debit: 2, credit: -1 })).toBeNull();
  });
});

describe('buildPreview: amounts and types', () => {
  it.each([
    ['A', FORMAT_A],
    ['B', FORMAT_B],
    ['C', FORMAT_C],
  ])('format %s gives the same transactions', (_, csv) => expect(asTypes(preview(csv))).toEqual(EXPECTED));

  it('lets the user flip the sign rule', () => {
    const items = preview(FORMAT_A, { mapping: { sign: 'positive-expense' } });
    expect(items.map((i) => i.tx.type)).toEqual(['income', 'expense', 'income']);
  });

  it('a type column beats the sign rule', () => {
    const items = preview('Date,Description,Amount,Type\n1/1/2026,Refund,-20,Credit');
    expect(items[0].tx).toMatchObject({ type: 'income', amount: 20 });
  });

  it('falls back to the sign rule for unknown type words', () => {
    const items = preview('Date,Description,Amount,Type\n1/1/2026,Shop,-20,Pending');
    expect(items[0].tx.type).toBe('expense');
  });

  it('rejects rows with missing or invalid values, with line numbers', () => {
    const items = preview(`Date,Description,Amount
,No date,-5
2026-02-30,Bad date,-5
1/1/2026,,-5
1/1/2026,Zero,0
1/1/2026,Words,abc
1/1/2026,Fine,-5`);
    expect(items.map((i) => [i.line, i.status, i.reason])).toEqual([
      [2, 'error', 'Missing date'],
      [3, 'error', 'Invalid date "2026-02-30"'],
      [4, 'error', 'Missing description'],
      [5, 'error', 'Amount is zero'],
      [6, 'error', `Can't read the amount "abc"`],
      [7, 'ok', undefined],
    ]);
  });

  it('rejects a row with both a debit and a credit', () => {
    expect(preview('Date,Description,Debit,Credit\n1/1/2026,Odd,5,6')[0].reason).toMatch(/Both/);
  });

  it('merges parser errors into the list in file order', () => {
    const items = preview('Date,Description,Amount\n1/1/2026,A,-1\n"x"y,B,-2\n1/2/2026,C,-3');
    expect(items.map((i) => [i.line, i.status])).toEqual([
      [2, 'ok'],
      [3, 'error'],
      [4, 'ok'],
    ]);
  });

  it('turns embedded newlines in descriptions into spaces', () => {
    expect(preview('Date,Description,Amount\n1/1/2026,"Corner\nShop",-5')[0].tx.description).toBe('Corner Shop');
  });
});

describe('buildPreview: categories', () => {
  it('matches CSV categories ignoring case and spaces', () => {
    const items = preview('Date,Description,Amount,Category\n1/1/2026,Kroger,-50,"  groceries "');
    expect(items[0].tx.category).toBe('Groceries');
  });

  it('reuses the category this merchant was filed under before', () => {
    const transactions = [
      { id: '1', date: '2026-09-01', description: 'STARBUCKS #12', category: 'Dining', type: 'expense', amount: 5 },
    ];
    const items = preview('Date,Description,Amount,Category\n1/1/2026,Starbucks #99,-6,Shopping', { transactions });
    expect(items[0].tx.category).toBe('Dining');
  });

  it("never gives an income row an expense category (or the reverse)", () => {
    const items = preview('Date,Description,Amount,Category\n1/1/2026,Gift,20,Groceries\n1/2/2026,Shop,-20,Salary');
    expect(items.map((i) => i.tx.category)).toEqual(['Other Income', 'Other']);
  });

  it('uses Other / Other Income for unknown categories and never creates new ones', () => {
    const items = preview('Date,Description,Amount,Category\n1/1/2026,Gym,-40,Fitness');
    expect(items[0].tx.category).toBe('Other');
  });

  it('works with custom categories when the fallbacks were renamed or deleted', () => {
    const categories = [
      { id: 'a', name: 'Food', type: 'expense', group: 'need', colorIndex: 0 },
      { id: 'b', name: 'Paycheck', type: 'income', group: 'need', colorIndex: null },
    ];
    const items = preview('Date,Description,Amount\n1/1/2026,Shop,-5\n1/2/2026,Work,100', { categories });
    expect(items.map((i) => i.tx.category)).toEqual(['Food', 'Paycheck']);
  });

  it('errors when the user has no category of that type', () => {
    const categories = [{ id: 'a', name: 'Food', type: 'expense', group: 'need', colorIndex: 0 }];
    const items = preview('Date,Description,Amount\n1/2/2026,Work,100', {
      categories,
      mapping: { sign: 'negative-expense' }, // a lone positive row would otherwise be guessed as a charge
    });
    expect(items[0]).toMatchObject({ status: 'error', reason: expect.stringMatching(/No income category/) });
  });
});

describe('buildPreview: duplicates', () => {
  const saved = [
    { id: '1', date: '2026-10-15', description: 'WALMART #123', category: 'Groceries', type: 'expense', amount: 84.52 },
  ];

  it('flags rows that match a saved transaction (merchant normalized, amount in cents)', () => {
    const items = preview(FORMAT_A, { transactions: saved });
    expect(items[0]).toMatchObject({ status: 'duplicate', reason: 'Matches a saved transaction' });
    expect(items.slice(1).map((i) => i.status)).toEqual(['ok', 'ok']);
  });

  it('flags repeats inside the same file, pointing at the first one', () => {
    const items = preview('Date,Description,Amount\n1/1/2026,Coffee,-4.5\n1/1/2026,COFFEE,-4.50');
    expect(items.map((i) => [i.status, i.reason])).toEqual([
      ['ok', undefined],
      ['duplicate', 'Same as line 2'],
    ]);
  });

  it('does not treat a different type or amount as a duplicate', () => {
    const items = preview('Date,Description,Amount\n10/15/2026,Walmart,84.52\n10/15/2026,Walmart,-84.53', {
      transactions: saved,
    });
    expect(items.map((i) => i.status)).toEqual(['ok', 'ok']);
  });
});

describe('summarize and selectForImport', () => {
  const items = preview('Date,Description,Amount\n1/1/2026,A,-1\n1/1/2026,A,-1\n,B,-2\n1/3/2026,C,-3');

  it('counts each status', () => expect(summarize(items)).toEqual({ total: 4, ok: 2, review: 0, duplicate: 1, error: 1 }));

  it('skips duplicates and errors by default', () => {
    const txs = selectForImport(items);
    expect(txs.map((t) => t.description)).toEqual(['A', 'C']);
    expect(txs[0]).toEqual({
      id: expect.any(String), date: '2026-01-01', description: 'A', category: 'Other', type: 'expense', amount: 1,
    });
    expect(new Set(txs.map((t) => t.id)).size).toBe(2);
  });

  it('includes duplicates the user approved', () => {
    expect(selectForImport(items, new Set([3])).map((t) => t.description)).toEqual(['A', 'A', 'C']);
  });
});

describe('file kinds', () => {
  it('accepts PDFs up to 10 MB', () => {
    expect(fileKind('Statement.PDF')).toBe('pdf');
    expect(fileKind('bank.csv')).toBe('csv');
    expect(fileKind('bank.xlsx')).toBeNull();
    expect(validateFile({ name: 'statement.pdf', size: 8 * 1024 * 1024 })).toBeNull();
    expect(validateFile({ name: 'statement.pdf', size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
  });
});

describe('corrections and review rows', () => {
  const csv =
    'Date,Description,Amount\n1/1/2026,Coffee,-4.5\n2026-02-30,Typo date,-5\n1/3/2026,Mystery,-9';

  it('applies corrections before validation, so a fixed row becomes ready', () => {
    const edits = {
      3: { date: '2026-02-28', description: 'Bakery', amount: '5', type: 'expense' },
    };
    const items = preview(csv, { mapping: {} });
    expect(items[1].status).toBe('error');
    const parsed = parseCSV(csv);
    const fixed = buildPreview(parsed, guessMapping(parsed.headers, parsed.rows), CONTEXT, edits);
    expect(fixed[1]).toMatchObject({
      status: 'ok',
      tx: { date: '2026-02-28', description: 'Bakery', amount: 5 },
    });
  });

  it('lets a correction change the type, which also changes the category', () => {
    const drafts = toDrafts(parseCSV(csv), guessMapping(['Date', 'Description', 'Amount'], []));
    const [first] = previewDrafts(
      applyEdits(drafts, {
        2: { date: '2026-01-01', description: 'Coffee', amount: '4.50', type: 'income' },
      }),
      CONTEXT,
    );
    expect(first.tx).toMatchObject({ type: 'income', category: 'Other Income' });
  });

  it('turns an unreadable corrected amount into an error', () => {
    const drafts = toDrafts(parseCSV(csv), guessMapping(['Date', 'Description', 'Amount'], []));
    const [first] = previewDrafts(
      applyEdits(drafts, {
        2: { date: '2026-01-01', description: 'Coffee', amount: 'abc', type: 'expense' },
      }),
      CONTEXT,
    );
    expect(first).toMatchObject({ status: 'error', reason: `Can't read the amount "abc"` });
  });

  it('keeps review rows out unless ticked, and a correction confirms them', () => {
    const drafts = [
      {
        line: 1,
        page: 1,
        date: '2026-10-01',
        description: 'Gym',
        money: { amount: 40, type: 'expense' },
        category: '',
      },
      {
        line: 2,
        page: 1,
        date: '2026-10-02',
        description: 'Transfer',
        money: { amount: 100, type: 'expense' },
        category: '',
        review: "Couldn't tell if this is money in or out",
      },
    ];
    const items = previewDrafts(drafts, CONTEXT);
    expect(items.map((i) => [i.page, i.status])).toEqual([
      [1, 'ok'],
      [1, 'review'],
    ]);
    expect(summarize(items)).toMatchObject({ ok: 1, review: 1 });
    expect(selectForImport(items).map((t) => t.description)).toEqual(['Gym']);
    expect(selectForImport(items, new Set([2])).map((t) => t.description)).toEqual([
      'Gym',
      'Transfer',
    ]);

    const edit = {
      2: { date: '2026-10-02', description: 'Transfer', amount: '100', type: 'income' },
    };
    expect(previewDrafts(applyEdits(drafts, edit), CONTEXT)[1].status).toBe('ok');
  });
});

describe('transactionsToCSV', () => {
  it('round-trips through the importer', () => {
    const rows = [
      {
        id: '1',
        date: '2026-10-01',
        description: 'Smith, "Jr" Deli',
        category: 'Dining',
        type: 'expense',
        amount: 12.5,
      },
      {
        id: '2',
        date: '2026-10-02',
        description: 'Paycheck',
        category: 'Salary',
        type: 'income',
        amount: 2100,
      },
    ];
    const items = preview(transactionsToCSV(rows));
    expect(items.map((i) => i.tx)).toEqual(rows.map(({ id: _id, ...tx }) => tx));
  });
});
