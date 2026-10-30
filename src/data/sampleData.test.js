import { describe, expect, it } from 'vitest';
import { emptyData, fromBackup, generateSampleData } from './sampleData';
import { DATA_SLICES } from '../auth/userStorage';
import { historySeries, liquidSavings, netWorthTotals, readAccounts, recordSnapshot } from '../utils/netWorth';

const TODAY = new Date(2026, 9, 30);

describe('emptyData and sample data', () => {
  it('every stored slice has a starting value, including accounts', () => {
    const blank = emptyData();
    for (const slice of DATA_SLICES) expect(blank[slice]).toBeDefined();
    expect(blank.accounts).toEqual([]);
    expect(blank.settings.netWorthHistory).toBeUndefined();
  });

  it('sample accounts are valid, dated today, and separate from the car loan debt', () => {
    const sample = generateSampleData(TODAY);
    expect(readAccounts(sample.accounts)).toHaveLength(sample.accounts.length);
    expect(sample.accounts.every((a) => a.updated === '2026-10-30' && a.source === 'manual')).toBe(true);
    // The car is entered at market value; its loan stays in the Debt Planner.
    expect(sample.accounts.find((a) => a.kind === 'vehicle').balance).toBe(16500);
    expect(sample.debts.some((d) => d.name === 'Car loan')).toBe(true);
    expect(sample.accounts.some((a) => a.type === 'liability')).toBe(false);
    // Liquid savings matches the typed-in starting savings shown in the Forecast.
    expect(liquidSavings(sample.accounts).amount).toBe(2400 + 3800);
  });

  it('sample data has no made-up history: only this month gets a snapshot', () => {
    const sample = generateSampleData(TODAY);
    expect(sample.settings.netWorthHistory).toBeUndefined();
    const settings = recordSnapshot(sample.settings, sample.accounts, sample.debts, TODAY);
    expect(historySeries(settings).map((s) => s.month)).toEqual(['2026-10']);
  });
});

describe('fromBackup (restore, load sample, clear)', () => {
  const OLD_BACKUP = {
    transactions: [{ id: 't', date: '2026-01-02', description: 'x', category: 'Other', type: 'expense', amount: 5 }],
    budgets: { Other: 50 },
    debts: [{ id: 'd', name: 'Visa', balance: 500, apr: 20, minPayment: 25 }],
    goals: [],
    bills: [],
    settings: { startingSavings: 1000, annualReturn: 5 },
  };

  it('restores an older backup with no accounts and no snapshots', () => {
    const data = fromBackup(OLD_BACKUP);
    expect(data.accounts).toEqual([]);
    expect(data.settings).toEqual({ startingSavings: 1000, annualReturn: 5 });
    expect(data.categories.length).toBeGreaterThan(0); // starter categories for pre-category backups
    expect(netWorthTotals(data.accounts, data.debts).liabilities).toBe(500);
    // With no accounts, nothing is recorded, so no "minus your debts" history appears.
    expect(recordSnapshot(data.settings, data.accounts, data.debts, TODAY)).toBe(data.settings);
  });

  it('replaces every slice, so no accounts or snapshots survive a clear', () => {
    const before = {
      ...generateSampleData(TODAY),
      settings: { startingSavings: 1, annualReturn: 5, netWorthHistory: { '2026-09': { assets: 9, liabilities: 1 } } },
    };
    expect(before.accounts.length).toBeGreaterThan(0);
    const cleared = fromBackup(emptyData());
    expect(cleared.accounts).toEqual([]);
    expect(cleared.settings.netWorthHistory).toBeUndefined();
  });

  it('keeps a newer backup as it is', () => {
    const sample = generateSampleData(TODAY);
    const settings = recordSnapshot(sample.settings, sample.accounts, sample.debts, TODAY);
    const data = fromBackup(JSON.parse(JSON.stringify({ ...sample, settings })));
    expect(data.accounts).toEqual(sample.accounts);
    expect(data.settings.netWorthHistory).toEqual(settings.netWorthHistory);
  });

  it('falls back on missing or wrongly shaped slices', () => {
    const data = fromBackup({ accounts: 'oops', settings: [], budgets: null });
    expect(data.accounts).toEqual([]);
    expect(data.settings).toEqual(emptyData().settings);
    expect(data.budgets).toEqual({});
    expect(fromBackup(undefined).transactions).toEqual([]);
  });
});

describe('backups carry no login details', () => {
  it('can be imported into any account, including a brand-new one', () => {
    // Exactly what Settings → Export backup writes (see exportBackup in Settings.jsx).
    const { transactions, budgets, debts, goals, bills, accounts, settings, categories } = generateSampleData(TODAY);
    const json = JSON.stringify({ transactions, budgets, debts, goals, bills, accounts, settings, categories });
    expect(json).not.toMatch(/passwordHash|recoveryHash|"email"|userId/);
    const imported = fromBackup(JSON.parse(json));
    expect(imported.transactions).toHaveLength(transactions.length);
    expect(imported.accounts).toEqual(accounts);
  });
});
