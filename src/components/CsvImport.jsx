import { useMemo, useState } from 'react';
import {
  FIELDS,
  buildPreview,
  guessMapping,
  mappingProblem,
  parseCSV,
  selectForImport,
  summarize,
  validateFile,
} from '../utils/csvImport';
import { formatCurrency, formatDate } from '../utils/format';
import Status from './Status';

const PREVIEW_ROWS = 20;

const FIELD_LABELS = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  debit: 'Debit (money out)',
  credit: 'Credit (money in)',
  type: 'Type (debit/credit)',
  category: 'Category',
};

const STATUS = {
  ok: { tone: 'good', text: 'Ready' },
  duplicate: { tone: 'warning', text: 'Duplicate' },
  error: { tone: 'critical', text: 'Error' },
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const formatSize = (bytes) =>
  bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

/** Card on the Transactions page: pick a CSV, check the columns and preview, then import. */
export default function CsvImport({ store }) {
  const { transactions, setTransactions, categories } = store;
  // One `step` value instead of several booleans means the card can never be in
  // two steps at once: a tiny state machine ('pick' -> 'map' -> 'done').
  const [step, setStep] = useState('pick');
  const [file, setFile] = useState(null); // { name, size } of the chosen file
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState(null); // parseCSV() result
  const [mapping, setMapping] = useState(null); // which column holds each field
  // Line numbers of duplicates the user ticked. Lazy initial state (() => new Set())
  // builds the Set once instead of on every render.
  const [included, setIncluded] = useState(() => new Set());
  const [show, setShow] = useState('all'); // preview filter
  const [result, setResult] = useState(null); // counts shown after importing

  const reset = () => {
    setStep('pick');
    setFile(null);
    setError('');
    setParsed(null);
    setMapping(null);
    setIncluded(new Set());
    setShow('all');
    setResult(null);
  };

  const chooseFile = async (e) => {
    const picked = e.target.files[0];
    e.target.value = ''; // lets the same file be picked again after fixing it
    if (!picked) return;
    setFile({ name: picked.name, size: picked.size });
    setError('');
    const problem = validateFile(picked);
    if (problem) {
      setError(problem);
      return;
    }
    let text;
    try {
      text = await picked.text(); // reads the file inside the browser; nothing is uploaded
    } catch {
      setError("Couldn't read this file.");
      return;
    }
    const csv = parseCSV(text);
    if (csv.fatal) {
      setError(csv.fatal);
      return;
    }
    setParsed(csv);
    setMapping(guessMapping(csv.headers, csv.rows));
    setIncluded(new Set());
    setStep('map');
  };

  // Select values are strings; column indexes are stored as numbers, the sign rule as text.
  const updateMapping = (e) => {
    const { name, value } = e.target;
    setMapping((m) => ({ ...m, [name]: name === 'sign' ? value : Number(value) }));
  };

  // Sets are mutable, so copy before changing: React only re-renders when it gets a NEW object.
  const toggleDuplicate = (line) =>
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const problem = mapping && mappingProblem(mapping);
  // Rebuild the preview only when the file, mapping or saved data change, not when
  // the user ticks a checkbox or changes the filter (useMemo caches the last result).
  const items = useMemo(
    () => (parsed && !problem ? buildPreview(parsed, mapping, { categories, transactions }) : []),
    [parsed, mapping, problem, categories, transactions],
  );
  const counts = summarize(items);
  const importCount = items.filter(
    (i) => i.status === 'ok' || (i.status === 'duplicate' && included.has(i.line)),
  ).length;
  const shown = show === 'all' ? items : items.filter((i) => i.status === show);

  const runImport = () => {
    const txs = selectForImport(items, included);
    // Same merge as adding one transaction by hand: new array, newest first.
    setTransactions((prev) => [...txs, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    setResult({
      imported: txs.length,
      skipped: counts.duplicate - (txs.length - counts.ok), // duplicates that weren't ticked
      errors: counts.error,
    });
    setStep('done');
  };

  return (
    <section className="card">
      <h2>Import from CSV</h2>

      {step === 'pick' && (
        <>
          <p className="sub">
            Add transactions from a bank or card export. The file is read in your browser and never
            uploaded.
          </p>
          <label className="field">
            CSV file (up to 5 MB)
            <input type="file" accept=".csv,text/csv" onChange={chooseFile} />
          </label>
          {/* role="alert" makes screen readers announce the error as soon as it appears */}
          {error && (
            <Status tone="critical" as="p" role="alert" style={{ marginBottom: 0 }}>
              {file && `${file.name} (${formatSize(file.size)}): `}
              {error}
            </Status>
          )}
        </>
      )}

      {step === 'map' && (
        <div className="stack">
          <p className="sub" style={{ margin: 0 }}>
            {file.name} · {formatSize(file.size)} · {plural(parsed.rows.length + parsed.errors.length, 'row')}.
            Check which column holds each field.
          </p>

          <div className="form">
            {FIELDS.map((field) => (
              <label className="field" key={field}>
                {FIELD_LABELS[field]}
                <select name={field} value={mapping[field]} onChange={updateMapping}>
                  <option value={-1}>Not in file</option>
                  {/* Headers never reorder for a given file, so the index is a safe key here */}
                  {parsed.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {mapping.amount >= 0 && (
              <label className="field">
                In the amount column
                <select name="sign" value={mapping.sign} onChange={updateMapping}>
                  <option value="negative-expense">Negative = money out</option>
                  <option value="positive-expense">Positive = money out</option>
                </select>
              </label>
            )}
          </div>

          {problem ? (
            <Status tone="warning" as="p" role="status" style={{ margin: 0 }}>
              {problem}
            </Status>
          ) : (
            <>
              {/* role="status" announces the new counts politely whenever the mapping changes */}
              <p className="small" role="status" style={{ margin: 0 }}>
                {plural(counts.total, 'row')} ·{' '}
                <Status tone="good">{counts.ok} ready</Status> ·{' '}
                <Status tone="warning">{plural(counts.duplicate, 'duplicate')}</Status> ·{' '}
                <Status tone="critical">{plural(counts.error, 'error')}</Status>
              </p>
              {counts.duplicate > 0 && (
                <p className="small muted" style={{ margin: 0 }}>
                  Duplicates have the same date, merchant, amount and type as a saved transaction or an
                  earlier row. They're skipped unless you tick them, since two identical purchases can be
                  real.
                </p>
              )}

              <div className="row">
                <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show rows">
                  <option value="all">All rows</option>
                  <option value="ok">Ready</option>
                  <option value="duplicate">Duplicates</option>
                  <option value="error">Errors</option>
                </select>
                <span className="small muted">
                  Showing {Math.min(PREVIEW_ROWS, shown.length)} of {shown.length}
                </span>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="num">Line</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Type</th>
                      <th>Category</th>
                      <th className="num">Amount</th>
                      <th>Import?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, PREVIEW_ROWS).map((item) => (
                      // A CSV line number is unique and stable, so it makes a good key
                      <tr key={item.line}>
                        <td className="num muted">{item.line}</td>
                        <td>
                          <Status tone={STATUS[item.status].tone}>{STATUS[item.status].text}</Status>
                          {item.reason && <div className="small muted">{item.reason}</div>}
                        </td>
                        {item.tx ? (
                          <>
                            <td className="muted">{formatDate(item.tx.date)}</td>
                            <td>{item.tx.description}</td>
                            <td>{item.tx.type === 'income' ? 'Income' : 'Expense'}</td>
                            <td>
                              <span className="pill">{item.tx.category}</span>
                            </td>
                            <td className={`num ${item.tx.type === 'income' ? 'amount-income' : ''}`}>
                              {item.tx.type === 'income' ? '+' : '−'}
                              {formatCurrency(item.tx.amount)}
                            </td>
                          </>
                        ) : (
                          <td colSpan={5} className="muted">
                            Not imported
                          </td>
                        )}
                        <td>
                          {item.status === 'duplicate' && (
                            <input
                              type="checkbox"
                              checked={included.has(item.line)}
                              onChange={() => toggleDuplicate(item.line)}
                              aria-label={`Import line ${item.line} anyway`}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length === 0 && <p className="empty">No rows to show.</p>}
              </div>
            </>
          )}

          <div className="row">
            <span className="spacer" />
            <button className="btn" onClick={reset}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={runImport}
              disabled={Boolean(problem) || importCount === 0}
            >
              Import {plural(importCount, 'transaction')}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="stack">
          <p role="status" style={{ margin: 0 }}>
            <Status tone="good">Done.</Status> Imported{' '}
            <strong>{plural(result.imported, 'transaction')}</strong> from {file.name}.
          </p>
          {(result.skipped > 0 || result.errors > 0) && (
            <p className="small muted" style={{ margin: 0 }}>
              Skipped {plural(result.skipped, 'duplicate')} and {plural(result.errors, 'row')} with
              errors.
            </p>
          )}
          <div>
            <button className="btn" onClick={reset}>
              Import another file
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
