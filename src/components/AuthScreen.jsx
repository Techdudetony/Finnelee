import { useState } from 'react';
import { BrandMark } from './Icon';
import Status from './Status';
import { useAuth } from '../auth/AuthContext';

// One form that switches between "Sign in" and "Create account" modes.
export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [form, setForm] = useState({ name: '', email: '', password: '', withSampleData: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === 'signup';
  // Checkboxes report `checked`, other inputs report `value`.
  const update = (e) => {
    const { name, type, checked, value } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true); // disables the button so a double-click can't submit twice
    try {
      await (isSignUp ? signUp(form) : signIn(form));
      // No navigation needed: once `user` is set, App renders the dashboard instead of this screen.
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><BrandMark /> Finnelee</div>
        <h1 className="page-title" style={{ margin: '12px 0 4px' }}>{isSignUp ? 'Create your account' : 'Welcome back'}</h1>
        <p className="sub">{isSignUp ? 'Your budget, goals and stats stay private to your account.' : 'Sign in to see your finances.'}</p>

        <div className="stack" style={{ gap: 12 }}>
          {isSignUp && (
            <label className="field">Name
              <input name="name" value={form.name} onChange={update} autoComplete="given-name" required />
            </label>
          )}
          <label className="field">Email
            <input type="email" name="email" value={form.email} onChange={update} autoComplete="email" required />
          </label>
          <label className="field">Password
            {/* autoComplete hints let password managers fill or generate the right value */}
            <input type="password" name="password" value={form.password} onChange={update} autoComplete={isSignUp ? 'new-password' : 'current-password'} minLength={isSignUp ? 8 : undefined} required />
          </label>
          {isSignUp && (
            <label className="row small muted" style={{ gap: 8 }}>
              <input type="checkbox" name="withSampleData" checked={form.withSampleData} onChange={update} />
              Start with sample data so I can explore first
            </label>
          )}
          {/* role="alert" makes screen readers announce the error as soon as it appears */}
          {error && <Status tone="critical" as="p" role="alert" style={{ margin: 0 }}>{error}</Status>}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
          </button>
        </div>

        <p className="small muted" style={{ marginTop: 16, textAlign: 'center' }}>
          {isSignUp ? 'Already have an account?' : 'New to Finnelee?'}{' '}
          <button type="button" className="link-btn" onClick={() => { setMode(isSignUp ? 'signin' : 'signup'); setError(''); }}>
            {isSignUp ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </div>
  );
}
