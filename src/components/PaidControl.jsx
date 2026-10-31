import { useEffect, useRef, useState } from "react";
import Status from "./Status";
import { markPaidLabel, paidTarget } from "../utils/obligations";
import { recentPaidStatus } from "../utils/payments";

/**
 * "Mark paid for Oct 2026" plus a status line with its own Undo for each recent paid
 * month. Used for debts, liabilities and bills. The parent saves the change:
 * onMark(month) and onUndo(month). After Undo, focus goes back to Mark paid.
 */
export default function PaidControl({ record, name, onMark, onUndo }) {
  const today = new Date();
  const markRef = useRef(null);
  const boxRef = useRef(null);
  const [refocus, setRefocus] = useState(false);
  const target = paidTarget(record, today);
  const label = markPaidLabel(record, today);
  const lines = recentPaidStatus(record, today);

  // Runs after the re-render, once the button is back (or gone).
  useEffect(() => {
    if (!refocus) return;
    setRefocus(false);
    const undos = boxRef.current?.querySelectorAll(".paid-undo");
    (markRef.current ?? undos?.[undos.length - 1])?.focus();
  }, [refocus]);

  return (
    <div className="paid" ref={boxRef}>
      {lines.map((l) => (
        <span key={l.month} className="paid-line">
          <Status tone="good">{l.text}</Status>
          <button
            type="button"
            className="link-btn paid-undo"
            aria-label={`Undo paid for ${l.monthText}, ${name}`}
            onClick={() => {
              onUndo(l.month);
              setRefocus(true);
            }}
          >
            Undo
          </button>
        </span>
      ))}
      {target && (
        <button
          ref={markRef}
          type="button"
          className="btn paid-mark"
          aria-label={`${label}, ${name}`}
          onClick={() => {
            onMark(target);
            setRefocus(true); // keeps focus here, or on Undo when both months are marked
          }}
        >
          {label}
        </button>
      )}
    </div>
  );
}
