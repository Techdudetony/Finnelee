import { useLayoutEffect, useRef, useState } from 'react';
import Icon, { BrandMark } from './Icon';
import Status from './Status';
import { useAuth } from '../auth/AuthContext';
import { passwordStrength } from '../auth/authService';
import { shake } from '../utils/motion';

const BLANK = {
  name: '',
  email: '',
  password: '',
  withSampleData: false,
  recoveryKey: '',
  newPassword: '',
  confirmPassword: '',
};
const TITLES = {
  signin: ['Welcome back', 'Sign in to see your finances.'],
  signup: ['Create your account', 'Your budget, goals and stats stay private to your account.'],
  forgot: ['Reset your password', 'Use the recovery key you saved when you created your account.'],
};

// Sign in, create account, and forgot password: one card that changes between modes.
export default function AuthScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'forgot'
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cardRef = useRef(null);

  // Checkboxes report `checked`, other inputs report `value`.
  const update = (e) => {
    const { name, type, checked, value } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const switchTo = (next) => {
    setMode(next);
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'forgot' && form.newPassword !== form.confirmPassword) {
      setError("The new passwords don't match.");
      shake(cardRef.current);
      return;
    }
    setBusy(true); // disables the button so a double-click can't submit twice
    try {
      if (mode === 'signup') await signUp(form);
      else if (mode === 'forgot') await resetPassword(form);
      else await signIn(form);
      // No navigation needed: once `user` is set, App renders the dashboard instead of this screen.
    } catch (err) {
      setError(err.message);
      setBusy(false);
      shake(cardRef.current);
    }
  };

  const [title, subtitle] = TITLES[mode];
  const label = { signin: 'Sign in', signup: 'Create account', forgot: 'Reset password' }[mode];

  return (
    <div className="auth-page">
      <BrandPanel />

      <main className="auth-main">
        <form className="card auth-card" ref={cardRef} onSubmit={submit}>
          <div className="brand" style={{ padding: 0 }}>
            <BrandMark /> Finnelee
          </div>

          {mode === 'forgot' ? (
            <button type="button" className="link-btn back-link" onClick={() => switchTo('signin')}>
              ‹ Back to sign in
            </button>
          ) : (
            // Two real buttons; the pill behind them slides to the active one (CSS transform).
            <div className="segmented" data-mode={mode} role="group" aria-label="Account">
              <span className="segmented-pill" aria-hidden="true" />
              <button type="button" aria-pressed={mode === 'signin'} onClick={() => switchTo('signin')}>
                Sign in
              </button>
              <button type="button" aria-pressed={mode === 'signup'} onClick={() => switchTo('signup')}>
                Create account
              </button>
            </div>
          )}

          <AutoHeight>
            {/* key={mode}: React mounts fresh content per mode, so the fade-in plays only on a switch. */}
            <div key={mode} className="fade-in">
              <h1 className="page-title" style={{ margin: '16px 0 4px' }}>
                {title}
              </h1>
              <p className="sub">{subtitle}</p>

              <div className="stack" style={{ gap: 12 }}>
                {mode === 'signup' && (
                  <FloatField label="Name" name="name" value={form.name} onChange={update} autoComplete="given-name" required />
                )}
                <FloatField label="Email" type="email" name="email" value={form.email} onChange={update} autoComplete="email" required />

                {mode === 'signin' && (
                  <>
                    <PasswordField label="Password" name="password" value={form.password} onChange={update} autoComplete="current-password" />
                    <button type="button" className="link-btn small forgot-link" onClick={() => switchTo('forgot')}>
                      Forgot password?
                    </button>
                  </>
                )}

                {mode === 'signup' && (
                  <>
                    <PasswordField label="Password" name="password" value={form.password} onChange={update} autoComplete="new-password" minLength={8} />
                    <StrengthMeter password={form.password} />
                    <label className="row small muted" style={{ gap: 8 }}>
                      <input type="checkbox" name="withSampleData" checked={form.withSampleData} onChange={update} />
                      Start with sample data so I can explore first
                    </label>
                  </>
                )}

                {mode === 'forgot' && (
                  <>
                    <FloatField
                      label="Recovery key"
                      name="recoveryKey"
                      value={form.recoveryKey}
                      onChange={update}
                      autoComplete="off"
                      spellCheck={false}
                      className="mono"
                      required
                    />
                    <PasswordField label="New password" name="newPassword" value={form.newPassword} onChange={update} autoComplete="new-password" minLength={8} />
                    <StrengthMeter password={form.newPassword} />
                    <PasswordField label="Confirm new password" name="confirmPassword" value={form.confirmPassword} onChange={update} autoComplete="new-password" />
                    <details className="small muted">
                      <summary>No recovery key?</summary>
                      <p>
                        Accounts live only in this browser, so without the key there's no way to
                        reset the password and the old account's data can't be opened.
                      </p>
                      <p style={{ marginBottom: 0 }}>
                        If you exported a backup, create a new account and use{' '}
                        <strong>Settings → Import backup</strong>. Backups hold your financial data
                        only (not your email, password or recovery key), and importing replaces
                        everything in that account. Without a backup, start fresh.
                      </p>
                    </details>
                  </>
                )}

                {/* role="alert" makes screen readers announce the error as soon as it appears */}
                {error && (
                  <Status tone="critical" as="p" role="alert" style={{ margin: 0 }}>
                    {error}
                  </Status>
                )}
                <button className="btn btn-primary btn-block" disabled={busy}>
                  {busy && <span className="spinner" aria-hidden="true" />}
                  {busy ? 'Please wait…' : label}
                </button>
              </div>
            </div>
          </AutoHeight>
        </form>
      </main>
    </div>
  );
}

/**
 * Animates the card's height when the content changes (switching modes, an error appearing).
 * This is the one LAYOUT animation in the app (height, not transform/opacity): the card is
 * small and it only runs on a mode switch, so the cost is fine. See styles.css.
 */
function AutoHeight({ children }) {
  const inner = useRef(null);
  const [height, setHeight] = useState('auto');
  useLayoutEffect(() => {
    const el = inner.current;
    // ResizeObserver reports every size change of the content, including errors appearing.
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="auto-height" style={{ height }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

/** Input with a label that floats above it on focus or once it has a value (pure CSS). */
function FloatField({ label, name, className = '', children, ...input }) {
  const id = `auth-${name}`;
  return (
    <div className={`float-field ${children ? 'has-action' : ''}`}>
      {/* placeholder=" " lets CSS tell an empty field apart with :placeholder-shown */}
      <input id={id} name={name} placeholder=" " className={className} {...input} />
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/** Password input with a show/hide button. */
function PasswordField(props) {
  const [visible, setVisible] = useState(false);
  return (
    <FloatField type={visible ? 'text' : 'password'} required {...props}>
      <button
        type="button"
        className="field-action"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`}
        aria-pressed={visible}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </FloatField>
  );
}

/** Four bars that fill with color as the password gets stronger, plus a text label. */
function StrengthMeter({ password }) {
  if (!password) return null;
  const { score, label } = passwordStrength(password);
  return (
    <div className="strength-row">
      <div className="strength" data-score={score} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <span className="small muted" aria-live="polite">
        Strength: {label}
      </span>
    </div>
  );
}

/** Left half on wide screens: brand, pitch, and a small chart that draws itself once. */
function BrandPanel() {
  const bars = [38, 52, 46, 64, 58, 78];
  return (
    <aside className="auth-hero" aria-hidden="true">
      <div className="auth-hero-inner">
        <div className="brand auth-hero-brand">
          <BrandMark size={32} /> Finnelee
        </div>
        <p className="auth-hero-pitch">Budgets, goals and net worth in one calm place.</p>
        <svg className="hero-chart" viewBox="0 0 240 120">
          {bars.map((h, i) => (
            <rect
              key={i}
              className="hero-bar"
              x={12 + i * 38}
              y={110 - h}
              width="22"
              height={h}
              rx="4"
              style={{ animationDelay: `${120 + i * 70}ms` }}
            />
          ))}
          <path className="hero-line" d="M23 66 L61 54 L99 60 L137 40 L175 46 L213 26" pathLength="1" />
        </svg>
        <ul className="auth-hero-points">
          <li>
            <Icon name="check" /> Private: your data never leaves this browser
          </li>
          <li>
            <Icon name="check" /> Zero-based budgets with rollover
          </li>
          <li>
            <Icon name="check" /> Debt payoff, forecasts and net worth
          </li>
        </ul>
      </div>
    </aside>
  );
}
