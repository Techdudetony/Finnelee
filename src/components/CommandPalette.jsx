import { useEffect, useId, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { moveActive, rankCommands, resultCount } from "../utils/commands";

/** "⌘K" on a Mac, "Ctrl K" elsewhere: shown on the buttons that open the palette. */
export const shortcutLabel = () =>
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? "⌘K"
    : "Ctrl K";

/**
 * The command palette: a modal dialog with a search box (combobox) and a list of
 * results (listbox). Up and Down move (wrapping), Home and End jump to the ends, Enter
 * runs the highlighted result, Esc closes. The highlighted result is announced through
 * aria-activedescendant, and a polite status reads the number of results.
 * onRun(command) carries the command out; onClose() closes without running anything.
 */
export default function CommandPalette({ commands, onRun, onClose }) {
  const ref = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ids = useId();
  const results = useMemo(
    () => rankCommands(commands, query),
    [commands, query],
  );
  const optionId = (c) => `${ids}-${c.id.replace(/[^a-z0-9-]/gi, "-")}`;
  const current = results[Math.min(active, results.length - 1)];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal(); // StrictMode-safe, like the other dialogs
  }, []);

  // Keep the highlighted result in view while moving through a long list.
  useEffect(() => {
    if (!current) return;
    document
      .getElementById(optionId(current))
      ?.scrollIntoView?.({ block: "nearest" });
  });

  const type = (e) => {
    setQuery(e.target.value);
    setActive(0); // a new search starts at the best match
  };

  const onKeyDown = (e) => {
    const next = moveActive(e.key, active, results.length);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      onRun(current);
    }
  };

  return (
    <dialog
      ref={ref}
      className="summary-dialog palette"
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault(); // Esc: close through React, which restores focus
        onClose();
      }}
      // A click on the dimmed page around the dialog closes it.
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="palette-search">
        <Icon name="search" size={18} />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={`${ids}-list`}
          aria-activedescendant={current ? optionId(current) : undefined}
          aria-autocomplete="list"
          aria-label="Search pages, tasks and settings"
          placeholder="Search pages, tasks and settings"
          value={query}
          onChange={type}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {results.length > 0 ? (
        <ul
          id={`${ids}-list`}
          role="listbox"
          aria-label="Results"
          className="palette-list"
        >
          {results.map((c) => (
            <li
              key={c.id}
              id={optionId(c)}
              role="option"
              aria-selected={c === current}
              className={`palette-option${c === current ? " is-active" : ""}`}
              onMouseMove={() => c !== current && setActive(results.indexOf(c))}
              onClick={() => onRun(c)}
            >
              <span>{c.label}</span>
              <span className="palette-group">{c.group}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="palette-empty small">
          No matches.{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus(); // this button disappears; keep focus in the box
            }}
          >
            Show all pages and tasks
          </button>
        </p>
      )}

      <div role="status" className="sr-only">
        {resultCount(results.length)}
      </div>
      <p className="palette-hint small muted" aria-hidden="true">
        ↑↓ move · Enter open · Esc close
      </p>
    </dialog>
  );
}
