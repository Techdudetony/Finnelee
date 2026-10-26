import { useState } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { generateSampleData } from './data/sampleData';
import Dashboard from './components/Dashboard';
import Transactions from './components/Transactions';
import Budget from './components/Budget';
import DebtPlanner from './components/DebtPlanner';
import Forecast from './components/Forecast';
import Goals from './components/Goals';
import Bills from './components/Bills';
import Settings from './components/Settings';

// Navigation config. Adding a page = add a row here + a component.
const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', Component: Dashboard },
  { id: 'transactions', label: 'Transactions', icon: '🧾', Component: Transactions },
  { id: 'budget', label: 'Budget', icon: '🎯', Component: Budget },
  { id: 'debt', label: 'Debt Planner', icon: '💳', Component: DebtPlanner },
  { id: 'forecast', label: 'Forecast', icon: '📈', Component: Forecast },
  { id: 'goals', label: 'Goals', icon: '🏁', Component: Goals },
  { id: 'bills', label: 'Bills', icon: '📅', Component: Bills },
  { id: 'settings', label: 'Settings', icon: '⚙️', Component: Settings },
];

export default function App() {
  const [page, setPage] = useState('dashboard');

  // Demo data is built once (lazy init) and only used if localStorage is empty.
  const [sample] = useState(() => generateSampleData());

  // Each slice of data gets its own localStorage key. The "fb." prefix avoids
  // clashing with other apps on the same origin (e.g. localhost:5173).
  const [transactions, setTransactions] = useLocalStorage('fb.transactions', sample.transactions);
  const [budgets, setBudgets] = useLocalStorage('fb.budgets', sample.budgets);
  const [debts, setDebts] = useLocalStorage('fb.debts', sample.debts);
  const [goals, setGoals] = useLocalStorage('fb.goals', sample.goals);
  const [bills, setBills] = useLocalStorage('fb.bills', sample.bills);
  const [settings, setSettings] = useLocalStorage('fb.settings', sample.settings);

  // Bundle everything into one object so every page gets the same single prop.
  // (In a bigger app you'd reach for React Context to avoid passing this around.)
  const store = {
    transactions, setTransactions,
    budgets, setBudgets,
    debts, setDebts,
    goals, setGoals,
    bills, setBills,
    settings, setSettings,
  };

  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const { Component } = current; // Capitalized so JSX treats it as a component

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span aria-hidden>💰</span> Finnelee
        </div>
        <nav className="nav" aria-label="Main">
          {PAGES.map((p) => (
            <button
              key={p.id} // React needs a stable key for each item in a list
              className={`nav-item ${p.id === page ? 'active' : ''}`}
              aria-current={p.id === page ? 'page' : undefined}
              onClick={() => setPage(p.id)}
            >
              <span aria-hidden>{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        <h1 className="page-title">{current.label}</h1>
        <Component store={store} goTo={setPage} />
      </main>
    </div>
  );
}
