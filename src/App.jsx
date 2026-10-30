import { useEffect, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import { userKey } from './auth/userStorage';
import { useLocalStorage } from './hooks/useLocalStorage';
import { emptyData } from './data/sampleData';
import { syncBudgets } from './utils/budgeting';
import { recordSnapshot } from './utils/netWorth';
import AuthScreen from './components/AuthScreen';
import WelcomeSummary from './components/WelcomeSummary';
import Dashboard from './components/Dashboard';
import NetWorth from './components/NetWorth';
import Transactions from './components/Transactions';
import Budget from './components/Budget';
import DebtPlanner from './components/DebtPlanner';
import Forecast from './components/Forecast';
import Goals from './components/Goals';
import Bills from './components/Bills';
import Categories from './components/Categories';
import Settings from './components/Settings';
import Icon, { BrandMark } from './components/Icon';
 
// Navigation config. Adding a page = add a row here + a component.
const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', Component: Dashboard },
  { id: 'networth', label: 'Net Worth', icon: 'networth', Component: NetWorth },
  { id: 'transactions', label: 'Transactions', icon: 'transactions', Component: Transactions },
  { id: 'budget', label: 'Budget', icon: 'budget', Component: Budget },
  { id: 'debt', label: 'Debt Planner', icon: 'debt', Component: DebtPlanner },
  { id: 'forecast', label: 'Forecast', icon: 'forecast', Component: Forecast },
  { id: 'goals', label: 'Goals', icon: 'goals', Component: Goals },
  { id: 'bills', label: 'Bills', icon: 'bills', Component: Bills },
  { id: 'categories', label: 'Categories', icon: 'categories', Component: Categories },
  { id: 'settings', label: 'Settings', icon: 'settings', Component: Settings },
];
 
/** Top level: decides between a loading screen, the sign-in screen, and the app itself. */
export default function App() {
  const { user, loading } = useAuth();
 
  if (loading) return <div className="auth-page muted">Loading…</div>;
  if (!user) return <AuthScreen />;
 
  // key={user.id} is important: when a different user signs in, React throws away
  // the old FinanceApp (and all its state) and mounts a fresh one that reads the
  // new user's storage keys. Without it, one user's data could leak into another's.
  return <FinanceApp key={user.id} user={user} />;
}
 
function FinanceApp({ user }) {
  const { signOut, freshLogin, clearFreshLogin } = useAuth();
  const [page, setPage] = useState('dashboard');
  // The summary pops up automatically right after signing in (not on every page refresh).
  const [showSummary, setShowSummary] = useState(freshLogin);
  const closeSummary = () => {
    setShowSummary(false);
    clearFreshLogin();
  };
  const blank = emptyData(); // fallback values if a key is missing
 
  // Each slice of data is stored under this user's own keys: finnelee.<userId>.<slice>
  const [transactions, setTransactions] = useLocalStorage(
    userKey(user.id, 'transactions'),
    blank.transactions,
  );
  const [budgets, setBudgets] = useLocalStorage(userKey(user.id, 'budgets'), blank.budgets);
  const [debts, setDebts] = useLocalStorage(userKey(user.id, 'debts'), blank.debts);
  const [goals, setGoals] = useLocalStorage(userKey(user.id, 'goals'), blank.goals);
  const [bills, setBills] = useLocalStorage(userKey(user.id, 'bills'), blank.bills);
  // Net worth accounts. Older accounts and backups have none, which reads as [].
  const [accounts, setAccounts] = useLocalStorage(userKey(user.id, 'accounts'), blank.accounts);
  const [settings, setSettings] = useLocalStorage(userKey(user.id, 'settings'), blank.settings);
  // Accounts created before custom categories existed fall back to the starter set.
  const [categories, setCategories] = useLocalStorage(
    userKey(user.id, 'categories'),
    blank.categories,
  );
 
  // A limit planned for next month becomes the active one once that month arrives.
  // syncBudgets returns the same object when nothing changed, so this doesn't loop.
  useEffect(() => {
    setBudgets((prev) => syncBudgets(prev, settings));
  }, [settings, setBudgets]);

  // Record this month's net worth totals whenever accounts or debts change.
  // recordSnapshot returns the same object when nothing changed, so this doesn't loop.
  useEffect(() => {
    setSettings((prev) => recordSnapshot(prev, accounts, debts));
  }, [accounts, debts, setSettings]);
 
  // Bundle everything into one object so every page gets the same single prop.
  const store = {
    user,
    transactions,
    setTransactions,
    budgets,
    setBudgets,
    debts,
    setDebts,
    goals,
    setGoals,
    bills,
    setBills,
    accounts,
    setAccounts,
    settings,
    setSettings,
    categories,
    setCategories,
  };
 
  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const { Component } = current; // Capitalized so JSX treats it as a component
 
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark /> Finnelee
        </div>
        <nav className="nav" aria-label="Main">
          {PAGES.map((p) => (
            <button
              key={p.id} // React needs a stable key for each item in a list
              className={`nav-item ${p.id === page ? 'active' : ''}`}
              aria-current={p.id === page ? 'page' : undefined}
              onClick={() => setPage(p.id)}
            >
              <Icon name={p.icon} />
              <span>{p.label}</span>
            </button>
          ))}
        </nav>
        <div className="profile">
          {/* First letter of the name as a simple avatar */}
          <span className="avatar" aria-hidden>
            {user.name[0]?.toUpperCase()}
          </span>
          <div className="profile-text">
            <div className="small">{user.name}</div>
            <div className="small muted profile-email">{user.email}</div>
          </div>
          <button className="btn-icon small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
 
      <main className="content">
        {/* The dashboard renders its own greeting, so skip the generic title there */}
        {page !== 'dashboard' && <h1 className="page-title">{current.label}</h1>}
        <Component store={store} goTo={setPage} openSummary={() => setShowSummary(true)} />
      </main>
 
      {/* Conditional rendering: the popup only exists in the page while it's open */}
      {showSummary && <WelcomeSummary store={store} goTo={setPage} onClose={closeSummary} />}
    </div>
  );
}
 