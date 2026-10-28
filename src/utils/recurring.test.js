import { describe, expect, it } from 'vitest';
import { detectRecurring, normalizeMerchant, toBill } from './recurring';
import { generateSampleData } from '../data/sampleData';

// One expense per date. Amounts can be one number or a list matching the dates.
const charges = (description, amounts, dates, category = 'Entertainment') =>
  dates.map((date, i) => ({
    id: `${description}-${date}`,
    date,
    description,
    category,
    type: 'expense',
    amount: Array.isArray(amounts) ? amounts[i] : amounts,
  }));

const TODAY = new Date(2026, 9, 27); // Oct 27, 2026
const detect = (transactions, bills = [], options = {}) =>
  detectRecurring(transactions, bills, { today: TODAY, ...options });

const NETFLIX = charges('NETFLIX.COM 866-579', 15.49, [
  '2026-05-12', '2026-06-12', '2026-07-13', '2026-08-12', '2026-09-14', '2026-10-12',
]);

describe('detectRecurring', () => {
  it('finds a monthly subscription', () => {
    expect(detect(NETFLIX)).toEqual([
      {
        key: 'netflix', name: 'Netflix', amount: 15.49, dueDay: 12,
        category: 'Entertainment', count: 6, lastDate: '2026-10-12',
      },
    ]);
  });

  it('re-exports normalizeMerchant', () => expect(normalizeMerchant('Spotify #2')).toBe('spotify'));

  it('handles end-of-month bills in short months', () => {
    // Due on the 31st: February only has 28 days and April 30, so those charges come earlier.
    const storage = charges('Storage unit', 89, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'], 'Housing');
    expect(detect(storage, [], { today: new Date(2026, 5, 2) })[0]).toMatchObject({ dueDay: 31, count: 4 });
  });

  it('follows weekend shifts, even into the previous month', () => {
    // Due on the 1st. Aug 1 and Nov 1 2026 are weekends: charged Fri Jul 31 and Mon Nov 2.
    const phone = charges('Phone plan', 70, ['2026-07-01', '2026-07-31', '2026-09-01', '2026-10-01', '2026-11-02'], 'Utilities');
    expect(detect(phone, [], { today: new Date(2026, 10, 5) })[0]).toMatchObject({ dueDay: 1, count: 5 });
  });

  it('accepts small amount changes and uses the median', () => {
    const power = charges('City Power', [48.5, 52, 50], ['2026-08-08', '2026-09-08', '2026-10-08'], 'Utilities');
    expect(detect(power)[0]).toMatchObject({ amount: 50, count: 3 });
  });

  it('rejects amounts that vary more than 10%', () => {
    const water = charges('Water Co', [40, 60, 41], ['2026-08-08', '2026-09-08', '2026-10-08'], 'Utilities');
    expect(detect(water)).toEqual([]);
  });

  it('suggests the current price after a price increase', () => {
    const tv = charges('Streamflix', [12, 12, 12, 14, 14, 14], [
      '2026-05-03', '2026-06-03', '2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03',
    ]);
    expect(detect(tv)[0]).toMatchObject({ amount: 14, count: 3 });
  });

  it('ignores frequent shopping at the same store', () => {
    const dates = [];
    for (let m = 5; m <= 10; m++) for (const d of [3, 10, 17, 24]) dates.push(`2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    expect(detect(charges('Kroger #512', 100, dates, 'Groceries'))).toEqual([]);
  });

  it('needs at least three months in a row', () => {
    expect(detect(NETFLIX.slice(-2))).toEqual([]);
    const gap = charges('Gym', 40, ['2026-06-05', '2026-07-05', '2026-09-05', '2026-10-05']);
    expect(detect(gap)).toEqual([]); // August is missing, so only 2 in a row
  });

  it('skips subscriptions that stopped', () => {
    expect(detect(NETFLIX, [], { today: new Date(2026, 11, 31) })).toEqual([]);
  });

  it('only looks at expenses', () => {
    const pay = NETFLIX.map((t) => ({ ...t, type: 'income' }));
    expect(detect(pay)).toEqual([]);
  });

  it('skips merchants that already have a bill', () => {
    expect(detect(NETFLIX, [{ id: 'b', name: 'Netflix', amount: 15.49, dueDay: 12, category: 'Entertainment' }])).toEqual([]);
    expect(detect(NETFLIX, [{ id: 'b', name: 'Netflix Premium', amount: 22, dueDay: 12, category: 'Entertainment' }])).toEqual([]);
    expect(detect(NETFLIX, [{ id: 'b', name: 'Net', amount: 5, dueDay: 1, category: 'Other' }])).toHaveLength(1);
  });

  it('skips dismissed merchants', () => {
    expect(detect(NETFLIX, [], { dismissed: ['netflix'] })).toEqual([]);
    expect(detect(NETFLIX, [], { dismissed: ['spotify'] })).toHaveLength(1);
  });

  it('sorts suggestions by amount, biggest first', () => {
    const gym = charges('Gym', 40, ['2026-08-05', '2026-09-05', '2026-10-05'], 'Health');
    expect(detect([...NETFLIX, ...gym]).map((s) => s.name)).toEqual(['Gym', 'Netflix']);
  });

  it('finds nothing new in the sample data (its fixed costs are already bills)', () => {
    const today = new Date(2026, 9, 27);
    const { transactions, bills } = generateSampleData(today);
    expect(detectRecurring(transactions, bills, { today })).toEqual([]);
  });
});

describe('toBill', () => {
  it('keeps only the bill fields and adds an id', () => {
    const [suggestion] = detect(NETFLIX);
    expect(toBill(suggestion)).toEqual({
      id: expect.any(String), name: 'Netflix', amount: 15.49, dueDay: 12, category: 'Entertainment',
    });
  });
});
