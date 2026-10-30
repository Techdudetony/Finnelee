import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { Notice } from './Status';

const INTRO = {
  signup: 'Your account is ready. If you ever forget your password, this key is the only way back in.',
  reset: 'Your password is changed. The key you just used no longer works; here is your new one.',
  created: 'Your new recovery key is ready. Any older key has stopped working.',
};

/**
 * Shows a new recovery key exactly once. It can't be dismissed (Esc included) until the
 * person ticks that they saved it, because after this dialog the key is gone for good.
 */
export default function RecoveryKeyDialog({ recoveryKey, reason, onDone }) {
  const dialogRef = useRef(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Same pattern as WelcomeSummary: open as a modal once mounted (guard for StrictMode).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard blocked: the key is still selectable on screen
    }
  };

  // A plain text file, built in the browser like the CSV export.
  const download = () => {
    const text = `Finnelee recovery key\n\n${recoveryKey}\n\nUse it on the sign-in page under "Forgot password?".\nKeep it private. It stops working after it's used or replaced.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'finnelee-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <dialog
      ref={dialogRef}
      className="summary-dialog recovery-dialog"
      aria-labelledby="recovery-title"
      // Esc fires "cancel": block it until the key is saved, so it can't vanish by accident.
      onCancel={(e) => {
        if (!saved) e.preventDefault();
      }}
      onClose={onDone}
    >
      <h2 id="recovery-title">Save your recovery key</h2>
      <p className="sub">{INTRO[reason] ?? INTRO.created}</p>

      <output className="recovery-key" aria-label="Recovery key">
        {recoveryKey}
      </output>

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={copy}>
          <Icon name={copied ? 'check' : 'summary'} />
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn" onClick={download}>
          Download .txt
        </button>
      </div>

      {/* Notice (not Status): Status text doesn't wrap, and this is a full sentence. */}
      <Notice tone="warning" style={{ margin: '12px 0' }}>
        It's shown only this once and Finnelee can't show it again. Store it somewhere safe, like a
        password manager.
      </Notice>

      <label className="row small" style={{ gap: 8 }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I've saved my recovery key somewhere safe
      </label>

      <div className="row" style={{ marginTop: 16 }}>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!saved}
          onClick={() => dialogRef.current.close()}
        >
          Continue
        </button>
      </div>
    </dialog>
  );
}
