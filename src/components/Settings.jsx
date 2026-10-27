import { useRef, useState } from 'react';
import { generateSampleData, emptyData } from '../data/sampleData';
import { DEFAULT_CATEGORIES } from '../data/categories';
import { todayISO } from '../utils/format';
import { useAuth } from '../auth/AuthContext';

export default function Settings({ store }) {
  const fileInput = useRef(null); // useRef = a handle to a real DOM element (the hidden file input)
  const [message, setMessage] = useState('');
  const { user, updateProfile, signOut } = useAuth();
  const [name, setName] = useState(user.name);

  const saveProfile = async (e) => {
    e.preventDefault();
    await updateProfile({ name });
    setMessage('✓ Profile saved.');
  };

  // Replace every slice of state at once. Works for sample data, empty data, or an imported backup.
  const loadAll = (data) => {
    store.setTransactions(data.transactions ?? []);
    store.setBudgets(data.budgets ?? {});
    store.setDebts(data.debts ?? []);
    store.setGoals(data.goals ?? []);
    store.setBills(data.bills ?? []);
    store.setSettings(data.settings ?? emptyData().settings);
    // Backups made before custom categories existed don't have this field.
    store.setCategories(data.categories ?? DEFAULT_CATEGORIES.map((c) => ({ ...c })));
  };

  const exportBackup = () => {
    const { transactions, budgets, debts, goals, bills, settings, categories } = store;
    const json = JSON.stringify(
      { transactions, budgets, debts, goals, bills, settings, categories },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `finnelee-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()); // File.text() returns a Promise, hence async/await
      if (!Array.isArray(data.transactions)) throw new Error('Missing transactions');
      loadAll(data);
      setMessage(`✓ Imported ${data.transactions.length} transactions.`);
    } catch (err) {
      setMessage(`⚠ Could not import: ${err.message}`);
    }
    e.target.value = ''; // allow re-selecting the same file later
  };

  // window.confirm is a quick built-in yes/no dialog for destructive actions.
  const reset = (kind) => {
    const ok = window.confirm(
      kind === 'sample'
        ? 'Replace all data with sample data?'
        : 'Delete ALL data? This cannot be undone.',
    );
    if (!ok) return;
    loadAll(kind === 'sample' ? generateSampleData() : emptyData());
    setMessage(kind === 'sample' ? '✓ Sample data loaded.' : '✓ All data cleared.');
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>Your profile</h2>
        <p className="sub">Signed in as {user.email}. Your name is used in greetings.</p>
        <form className="row" onSubmit={saveProfile}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Display name"
            style={{ flex: 1, minWidth: 160 }}
          />
          <button className="btn btn-primary">Save</button>
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Backup &amp; restore</h2>
        <p className="sub">
          Your data lives only in this browser. Export a backup to move it or keep it safe.
        </p>
        <div className="row">
          <button className="btn btn-primary" onClick={exportBackup}>
            Export backup (.json)
          </button>
          <button className="btn" onClick={() => fileInput.current.click()}>
            Import backup
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            onChange={importBackup}
            hidden
          />
        </div>
      </section>

      <section className="card">
        <h2>Reset</h2>
        <p className="sub">Start fresh with your own numbers, or reload the demo data.</p>
        <div className="row">
          <button className="btn" onClick={() => reset('sample')}>
            Load sample data
          </button>
          <button className="btn btn-danger" onClick={() => reset('clear')}>
            Clear all data
          </button>
        </div>
      </section>

      {message && <p className="insight">{message}</p>}
    </div>
  );
}
