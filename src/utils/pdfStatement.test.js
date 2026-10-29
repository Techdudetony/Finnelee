import { describe, expect, it } from 'vitest';
import { parseStatement } from './pdfStatement';
import { previewDrafts } from './csvImport';
import { DEFAULT_CATEGORIES } from '../data/categories';

// Lines as pdfText.js produces them. Cells are [x, text]; width is ~5pt per character.
const row = (...cells) => ({
  y: 0,
  cells: cells.map(([x, text]) => ({ text, x, right: x + text.length * 5 })),
});
const right = (edge, text) => [edge - text.length * 5, text]; // a right-aligned cell
const page = (number, ...lines) => ({ number, lines });
const parse = (...pages) => parseStatement(pages, { today: new Date(2026, 9, 28) });
const summary = (drafts) =>
  drafts.map((d) => [d.date, d.description, d.money.type, d.money.amount]);

const BANK_HEADER = row(
  [40, 'Date'],
  [90, 'Description'],
  right(380, 'Withdrawals'),
  right(470, 'Deposits'),
  right(560, 'Balance'),
);

describe('parseStatement: bank statement with withdrawal/deposit columns', () => {
  const statement = parse(
    page(
      1,
      row([40, 'First Community Bank']),
      row([40, 'Statement period 09/16/2026 - 10/15/2026']),
      row([40, 'Beginning balance'], right(560, '1,000.00')),
      BANK_HEADER,
      row([40, '09/20'], [90, 'WALMART #123'], right(380, '84.52'), right(560, '915.48')),
      row([40, '09/25'], [90, 'PAYROLL ACME CORP'], right(470, '1,850.00'), right(560, '2,765.48')),
      row([40, '09/28'], [90, 'ONLINE TRANSFER TO'], right(380, '200.00'), right(560, '2,565.48')),
      row([90, 'SAVINGS XXXX1234']),
      row([40, 'Questions? Call 1-800-555-0100']),
      row([250, 'Page 1 of 2']),
    ),
    page(
      2,
      BANK_HEADER, // repeated on every page
      row([40, '10/12'], [90, 'NETFLIX.COM'], right(380, '15.49'), right(560, '2,549.99')),
      row([40, 'Total withdrawals'], right(380, '299.01')),
      row([40, 'Ending balance'], right(560, '2,549.99')),
      row([250, 'Page 2 of 2']),
    ),
  );

  it('reads every transaction across the page break, with years from the period', () => {
    expect(statement.fatal).toBeNull();
    expect(summary(statement.drafts)).toEqual([
      ['2026-09-20', 'WALMART #123', 'expense', 84.52],
      ['2026-09-25', 'PAYROLL ACME CORP', 'income', 1850],
      ['2026-09-28', 'ONLINE TRANSFER TO SAVINGS XXXX1234', 'expense', 200],
      ['2026-10-12', 'NETFLIX.COM', 'expense', 15.49],
    ]);
    expect(statement.drafts.map((d) => d.page)).toEqual([1, 1, 1, 2]);
    expect(statement.drafts.every((d) => !d.review)).toBe(true);
  });

  it('skips balances, totals and account details, and lists them', () => {
    expect(statement.skipped.map((s) => s.text)).toEqual([
      'Statement period 09/16/2026 - 10/15/2026',
      'Beginning balance 1,000.00',
      'Total withdrawals 299.01',
      'Ending balance 2,549.99',
    ]);
  });

  it('reports the period and kind', () => {
    expect(statement).toMatchObject({
      kind: 'bank',
      pages: 2,
      period: { start: '2026-09-16', end: '2026-10-15' },
    });
  });
});

describe('parseStatement: credit card statement', () => {
  const statement = parse(
    page(
      1,
      row([40, 'Rewards Visa Credit Card']),
      row([40, 'Opening/Closing Date 09/16/26 - 10/15/26']),
      row([40, 'Minimum Payment Due'], right(560, '35.00')),
      row([40, 'Trans Date'], [100, 'Post Date'], [160, 'Description'], right(560, 'Amount')),
      row([40, '10/02'], [100, '10/03'], [160, 'STARBUCKS #55'], right(560, '6.45')),
      row([40, '10/05'], [100, '10/06'], [160, 'PAYMENT THANK YOU'], right(560, '-500.00')),
      row([40, '10/09'], [100, '10/10'], [160, 'AMAZON MKTPLACE'], right(560, '42.10')),
    ),
  );

  it('treats charges as expenses and drops the post date', () => {
    expect(statement.kind).toBe('card');
    expect(summary(statement.drafts)).toEqual([
      ['2026-10-02', 'STARBUCKS #55', 'expense', 6.45],
      ['2026-10-05', 'PAYMENT THANK YOU', 'income', 500],
      ['2026-10-09', 'AMAZON MKTPLACE', 'expense', 42.1],
    ]);
  });

  it('flags card payments for review instead of importing them as income', () => {
    expect(statement.drafts[1].review).toMatch(/Payment or credit/);
    expect(statement.drafts[0].review).toBeUndefined();
  });
});

describe('parseStatement: other layouts', () => {
  it('reads month-name dates and signed amounts, flagging the running balance guess', () => {
    const { drafts } = parse(
      page(
        1,
        row([40, 'Oct 1, 2026'], [120, 'Coffee Shop'], [400, '-4.50'], [480, '995.50']),
        row([40, 'Oct 3, 2026'], [120, 'Refund'], [400, '12.00'], [480, '1,007.50']),
      ),
    );
    expect(summary(drafts)).toEqual([
      ['2026-10-01', 'Coffee Shop', 'expense', 4.5],
      ['2026-10-03', 'Refund', 'income', 12],
    ]);
    expect(drafts[0].review).toMatch(/running balance/);
  });

  it('reads CR/DR markers and ISO dates in a single text cell', () => {
    const { drafts } = parse(
      page(
        1,
        row([40, 'Account activity for Jane Doe']),
        row([40, '2026-10-01 Interest paid 1.25 CR']),
        row([40, '2026-10-02 Service fee 5.00 DR']),
      ),
    );
    expect(summary(drafts)).toEqual([
      ['2026-10-01', 'Interest paid', 'income', 1.25],
      ['2026-10-02', 'Service fee', 'expense', 5],
    ]);
  });

  it('puts December charges in the previous year when the period crosses New Year', () => {
    const { drafts } = parse(
      page(
        1,
        row([40, 'Statement Period: Dec 16, 2026 to Jan 15, 2027']),
        BANK_HEADER,
        row([40, '12/20'], [90, 'GIFT SHOP'], right(380, '30.00'), right(560, '970.00')),
        row([40, '01/05'], [90, 'GYM'], right(380, '40.00'), right(560, '930.00')),
      ),
    );
    expect(drafts.map((d) => d.date)).toEqual(['2026-12-20', '2027-01-05']);
  });

  it('flags dates whose year had to be guessed', () => {
    const { drafts } = parse(
      page(
        1,
        BANK_HEADER,
        row([40, '10/12'], [90, 'GYM'], right(380, '40.00'), right(560, '960.00')),
      ),
    );
    expect(drafts[0]).toMatchObject({
      date: '2026-10-12',
      review: expect.stringMatching(/2026 was assumed/),
    });
  });

  it('flags unsigned amounts it cannot classify', () => {
    const { drafts } = parse(
      page(
        1,
        row([40, 'Statement period 10/01/2026 - 10/31/2026']),
        row([40, 'Date'], [90, 'Description'], right(560, 'Amount')),
        row([40, '10/12'], [90, 'TRANSFER'], right(560, '100.00')),
      ),
    );
    expect(drafts[0].review).toMatch(/money in or out/);
  });
});

describe('parseStatement: malformed and unusual input', () => {
  const statement = parse(
    page(
      1,
      row([40, 'Statement period 10/01/2026 - 10/31/2026']),
      BANK_HEADER,
      row([40, '10/40'], [90, 'BAD DAY'], right(380, '5.00'), right(560, '995.00')),
      row([40, '02/30'], [90, 'BAD DATE'], right(380, '5.00'), right(560, '990.00')),
      row([40, '10/05'], [90, 'NO AMOUNT HERE']),
      row([90, 'ORPHAN AMOUNT'], right(380, '12.00')),
      row([40, '10/06'], [90, 'GOOD ROW'], right(380, '7.00'), right(560, '983.00')),
      row([40, 'Thank you for banking with us']),
    ),
  );

  it('skips lines that look broken, with a reason', () => {
    expect(statement.skipped.map((s) => [s.text, s.reason])).toEqual([
      ['Statement period 10/01/2026 - 10/31/2026', 'Balance, total or summary line'],
      ['10/40 BAD DAY 5.00 995.00', 'Has an amount but no date'],
      ['10/05 NO AMOUNT HERE', 'Has a date but no amount'],
      ['ORPHAN AMOUNT 12.00', 'Has an amount but no date'],
    ]);
  });

  it('keeps impossible dates as drafts so the preview shows them as errors', () => {
    const items = previewDrafts(statement.drafts, {
      categories: DEFAULT_CATEGORIES,
      transactions: [],
    });
    expect(items.map((i) => [i.status, i.reason])).toEqual([
      ['error', 'Invalid date "2/30"'],
      ['ok', undefined],
    ]);
  });

  it("doesn't glue unrelated text under the last row onto its description", () => {
    expect(statement.drafts.at(-1).description).toBe('GOOD ROW');
  });

  it('explains scanned PDFs and PDFs without transactions', () => {
    expect(parse(page(1)).fatal).toMatch(/scanned/);
    expect(
      parse(page(1, row([40, 'Your privacy notice and other information about your account'])))
        .fatal,
    ).toMatch(/Couldn't find any transactions/);
  });
});

describe('PDF drafts in the shared preview', () => {
  it('flags repeated rows and saved transactions as duplicates', () => {
    const { drafts } = parse(
      page(
        1,
        row([40, 'Statement period 10/01/2026 - 10/31/2026']),
        BANK_HEADER,
        row([40, '10/12'], [90, 'NETFLIX.COM'], right(380, '15.49'), right(560, '984.51')),
        row([40, '10/12'], [90, 'NETFLIX.COM'], right(380, '15.49'), right(560, '969.02')),
        row([40, '10/14'], [90, 'WALMART'], right(380, '20.00'), right(560, '949.02')),
      ),
    );
    const saved = [
      {
        id: 'x',
        date: '2026-10-14',
        description: 'Walmart',
        category: 'Groceries',
        type: 'expense',
        amount: 20,
      },
    ];
    const items = previewDrafts(drafts, { categories: DEFAULT_CATEGORIES, transactions: saved });
    expect(items.map((i) => [i.page, i.status, i.reason])).toEqual([
      [1, 'ok', undefined],
      [1, 'duplicate', 'Same as row 1'],
      [1, 'duplicate', 'Matches a saved transaction'],
    ]);
  });
});
