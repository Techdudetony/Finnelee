import { useRef, useState } from 'react';
import { Notice } from './Status';
import { generateSampleData, emptyData, fromBackup } from '../data/sampleData';
import { todayISO } from '../utils/format';
import { useAuth } from '../auth/AuthContext';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { resolveMotion } from '../utils/motion';

// The Motion setting. Saved as settings.motion, so it travels with backups.
const MOTION_OPTIONS = [
  { id: 'full', label: 'Full', text: 'Pages glide, tiles grow into the page they open, numbers count up.' },
  { id: 'calm', label: 'Calm', text: 'Short fades only. Nothing slides, scales or counts.' },
  { id: 'off', label: 'Off', text: 'No animation. Everything appears at once.' },
];

export default function Settings({ store }) {
  const fileInput = useRef(null); // useRef = a handle to a real DOM element (the hidden file input)
  const [message, setMessage] = useState('');
  const { user, updateProfile, signOut, createRecoveryKey } = useAuth();
  const [keyPassword, setKeyPassword] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [name, setName] = useState(user.name);
  const deviceReduces = useMediaQuery('(prefers-reduced-motion: reduce)');
  const savedMotion = store.settings.motion;
  // Before anything is chosen, the selected option is what the device default resolves to.
  const shownMotion = MOTION_OPTIONS.some((o) => o.id === savedMotion)
    ? savedMotion
    : resolveMotion(undefined, deviceReduces);
  const setMotion = (motion) => store.setSettings((s) => ({ ...s, motion }));

  const saveProfile = async (e) => {
    e.preventDefault();
    await updateProfile({ name });
    setMessage({ tone: 'good', text: 'Profile saved.' });
  };

  // Create or replace the recovery key. The new key opens in the save-key dialog (App.jsx).
  const makeRecoveryKey = async (e) => {
    e.preventDefault();
    setKeyError('');
    setKeyBusy(true);
    try {
      await createRecoveryKey(keyPassword);
      setKeyPassword('');
    } catch (err) {
      setKeyError(err.message);
    }
    setKeyBusy(false);
  };

  // Replace every slice of state at once. Works for sample data, empty data, or an imported backup.
  // fromBackup fills in anything an older backup is missing (accounts, categories, ...).
  const loadAll = (raw) => {
    const data = fromBackup(raw);
    store.setTransactions(data.transactions);
    store.setBudgets(data.budgets);
    store.setDebts(data.debts);
    store.setGoals(data.goals);
    store.setBills(data.bills);
    store.setAccounts(data.accounts);
    store.setSettings(data.settings); // also replaces the net worth snapshots
    store.setCategories(data.categories);
  };

  const exportBackup = () => {
    const { transactions, budgets, debts, goals, bills, accounts, settings, categories } = store;
    const json = JSON.stringify(
      { transactions, budgets, debts, goals, bills, accounts, settings, categories },
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
      setMessage({ tone: 'good', text: `Imported ${data.transactions.length} transactions.` });
    } catch (err) {
      setMessage({ tone: 'critical', text: `Could not import: ${err.message}` });
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
    setMessage({ tone: 'good', text: kind === 'sample' ? 'Sample data loaded.' : 'All data cleared.' });
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
        <h2>Motion</h2>
        <p className="sub">How much Finnelee animates. Every action works the same at any level.</p>
        <fieldset className="choice-group">
          <legend className="sr-only">Motion</legend>
          {MOTION_OPTIONS.map((o) => (
            <label key={o.id} className="choice">
              <input
                type="radio"
                name="motion"
                value={o.id}
                checked={shownMotion === o.id}
                onChange={() => setMotion(o.id)}
              />
              <span>
                <span className="choice-title">{o.label}</span>
                <span className="choice-text">{o.text}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {(deviceReduces || savedMotion === undefined) && (
          <p className="small muted" style={{ margin: '12px 0 0' }}>
            {savedMotion === undefined && 'Following your device until you choose. '}
            {deviceReduces &&
              'Your device asks for reduced motion, so Full plays as Calm here.'}
          </p>
        )}
      </section>

      <section className="card" id="recovery-key">
        <h2>Recovery key</h2>
        <p className="sub">
          {user.hasRecoveryKey
            ? `You have a recovery key (created ${new Date(user.recoveryCreatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}). Replacing it stops the old one from working.`
            : "You don't have a recovery key yet. Without one, a forgotten password can't be reset, because there's no server to email you."}
        </p>
        <form className="row" onSubmit={makeRecoveryKey}>
          <input
            type="password"
            value={keyPassword}
            onChange={(e) => setKeyPassword(e.target.value)}
            placeholder="Current password"
            aria-label="Current password"
            autoComplete="current-password"
            required
            style={{ flex: 1, minWidth: 160 }}
          />
          <button className="btn btn-primary" disabled={keyBusy}>
            {user.hasRecoveryKey ? 'Replace key' : 'Create key'}
          </button>
        </form>
        {keyError && (
          <Notice as="p" tone="critical" role="alert" style={{ marginBottom: 0 }}>
            {keyError}
          </Notice>
        )}
      </section>

      <section className="card">
        <h2>Backup &amp; restore</h2>
        <p className="sub">
          Your data lives only in this browser. Export a backup to move it or keep it safe.
          A backup holds your financial data only (no email, password or recovery key), so it
          can be imported into any account, including a new one. Importing replaces everything
          in the current account.
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

      {message && (
        <Notice as="p" tone={message.tone} role="status">
          {message.text}
        </Notice>
      )}
    </div>
  );
}
