import { useState } from "react";

/**
 * A number box for an optional field (due day, monthly payment). What you type stays in
 * local state (`draft`) and is saved only when it's valid, so "0", "32" or "2.5" never
 * reach storage. A blank box saves "" (the parent removes the field: unknown, never 0).
 * Invalid text stays on screen with its message until it's corrected.
 *
 *   problemOf(text) -> message or null    onSave(text) -> parent stores it
 */
export default function OptionalNumber({
  value,
  onSave,
  problemOf,
  id,
  ...inputProps
}) {
  const [draft, setDraft] = useState(null); // null = show the saved value
  const shown = draft ?? value ?? "";
  const problem = problemOf(shown);
  const messageId = `${id}-problem`;

  const change = (e) => {
    const text = e.target.value;
    setDraft(text);
    if (!problemOf(text)) onSave(text);
  };

  return (
    <>
      <input
        id={id}
        type="number"
        value={shown}
        onChange={change}
        // Valid text is saved already, so the saved value can show again.
        onBlur={() => !problem && setDraft(null)}
        aria-invalid={Boolean(problem)}
        aria-describedby={problem ? messageId : undefined}
        {...inputProps}
      />
      {problem && (
        <span id={messageId} className="small status-critical">
          {problem} Not saved.
        </span>
      )}
    </>
  );
}
