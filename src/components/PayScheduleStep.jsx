import { useEffect, useRef } from "react";
import Icon from "./Icon";
import { PayScheduleForm } from "./PaySchedule";

/**
 * Optional step right after creating an account: the same pay schedule form as the Bills
 * page. Skipping is fine (Esc too); it can be added on Bills any time. Shown once, only
 * after sign-up, and never when a schedule already exists.
 */
export default function PayScheduleStep({ store, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal(); // StrictMode-safe, like the other dialogs
  }, []);

  return (
    <dialog
      ref={ref}
      className="summary-dialog"
      aria-labelledby="pay-step-title"
      onClose={onClose}
    >
      <h2 id="pay-step-title">
        <Icon name="calendar" />
        When do you get paid?
      </h2>
      <p className="sub">
        Optional. With your pay schedule, Financial health counts bills up to
        your next payday and shows paydays on the next 14 days. Finnelee never
        guesses a payday. You can add or change this on the Bills page later.
      </p>
      <PayScheduleForm
        settings={store.settings}
        setSettings={store.setSettings}
        onSaved={() => ref.current?.close()}
      >
        <button
          type="button"
          className="btn"
          onClick={() => ref.current?.close()}
        >
          Skip for now
        </button>
      </PayScheduleForm>
    </dialog>
  );
}
