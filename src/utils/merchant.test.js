import { describe, expect, it } from 'vitest';
import { merchantCategoryMap, normalizeMerchant } from './merchant';

describe('normalizeMerchant', () => {
  it.each([
    ['NETFLIX.COM 866-579-7172', 'netflix'],
    ['Starbucks #1234', 'starbucks'],
    ['SQ *BLUE BOTTLE COFFEE', 'blue bottle coffee'],
    ['  Trader   Joe\'s  ', 'trader joe s'],
    ['AT&T Wireless', 'at&t wireless'],
    ['12345', ''],
    [undefined, ''],
  ])('%j -> %j', (raw, key) => expect(normalizeMerchant(raw)).toBe(key));
});

describe('merchantCategoryMap', () => {
  it('keeps the most recent category per merchant and type', () => {
    const map = merchantCategoryMap([
      { description: 'Starbucks #1', category: 'Dining', type: 'expense' }, // newest first
      { description: 'STARBUCKS #2', category: 'Shopping', type: 'expense' },
      { description: 'Starbucks', category: 'Other Income', type: 'income' },
    ]);
    expect(map.get('expense|starbucks')).toBe('Dining');
    expect(map.get('income|starbucks')).toBe('Other Income');
  });
});
