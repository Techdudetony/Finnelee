import { useMemo, useState } from 'react';
import Icon from './Icon';
import ImportPreview from './ImportPreview';
import Status from './Status';
import {
  FIELDS,
  applyEdits,
  buildPreview,
  fileKind,
  guessMapping,
  mappingProblem,
  needsApproval,
  parseCSV,
  previewDrafts,
  selectForImport,
  summarize,
  validateFile,
} from '../utils/csvImport';
import { parseStatement } from '../utils/pdfStatement';
import { downloadCSV } from '../utils/csvExport';
import { formatDate } from '../utils/format';

const FIELD_LABELS = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  debit: 'Debit (money out)',
  credit: 'Credit (money in)',
  type: 'Type (debit/credit)',
  category: 'Category',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const formatSize = (bytes) =>
  bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

// PDF.js errors -> messages people can act on.
function readError(err) {
  if (err?.name === 'PasswordException')
    return 'This PDF is password-protected. Save an unlocked copy and try again.';
  if (err?.name === 'InvalidPDFException') return "This file isn't a valid PDF.";
  return err?.message || "Couldn't read this file.";
}

/** Transactions page card: import a CSV export or a PDF statement, check it, then save. */
export default function TransactionImport({ store }) {
  const { transactions, setTransactions, categories } = store;
  const [step, setStep] = useState('pick'); // 'pick' -> 'reading' -> 'review' -> 'done'
  const [file, setFile] = useState(null); // { name, size }
  const [error, setError] = useState('');
  // { kind: 'csv', parsed } or { kind: 'pdf', statement } (statement from parseStatement)
  const [source, setSource] = useState(null);
  const [mapping, setMapping] = useState(null); // CSV only
  const [edits, setEdits] = useState({}); // line -> corrected { date, description, amount, type }
  const [included, setIncluded] = useState(() => new Set()); // ticked duplicate/review lines
  const [result, setResult] = useState(null);

  const reset = () => {
    setStep('pick');
    setFile(null);
    setError('');
    setSource(null);
    setMapping(null);
    setEdits({});
    setIncluded(new Set());
    setResult(null);
  };

  const chooseFile = async (e) => {
    const picked = e.target.files[0];
    e.target.value = ''; // lets the same file be picked again
    if (!picked) return;
    setFile({ name: picked.name, size: picked.size });
    setError('');
    const problem = validateFile(picked);
    if (problem) {
      setError(problem);
      return;
    }
    setStep('reading');
    try {
      if (fileKind(picked.name) === 'csv') {
        const csv = parseCSV(await picked.text());
        if (csv.fatal) throw new Error(csv.fatal);
        setSource({ kind: 'csv', parsed: csv });
        setMapping(guessMapping(csv.headers, csv.rows));
      } else {
        // Dynamic import: PDF.js only downloads when someone actually picks a PDF.
        const { readPdfFile } = await import('../utils/pdfText');
        const statement = parseStatement(await readPdfFile(picked));
        if (statement.fatal) throw new Error(statement.fatal);
        setSource({ kind: 'pdf', statement });
      }
      setEdits({});
      setIncluded(new Set());
      setStep('review');
    } catch (err) {
      setError(readError(err));
      setStep('pick');
    }
  };

  const updateMapping = (e) => {
    const { name, value } = e.target;
    setMapping((m) => ({ ...m, [name]: name === 'sign' ? value : Number(value) }));
  };

  const toggle = (line) =>
    setIncluded((prev) => {
      const next = new Set(prev); // copy: React needs a new object to re-render
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const saveEdit = (line, values) => setEdits((prev) => ({ ...prev, [line]: values }));

  const problem = source?.kind === 'csv' ? mappingProblem(mapping) : null;
  const items = useMemo(() => {
    if (!source || problem) return [];
    const context = { categories, transactions };
    return source.kind === 'csv'
      ? buildPreview(source.parsed, mapping, context, edits)
      : previewDrafts(applyEdits(source.statement.drafts, edits), context);
  }, [source, mapping, problem, edits, categories, transactions]);
  const counts = summarize(items);
  const importCount = items.filter(
    (i) => i.status === 'ok' || (needsApproval(i) && included.has(i.line)),
  ).length;

  const runImport = () => {
    const txs = selectForImport(items, included);
    setTransactions((prev) => [...txs, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    setResult({
      imported: txs.length,
      left: counts.total - counts.error - txs.length,
      errors: counts.error,
    });
    setStep('done');
  };

  const downloadExtracted = () =>
    downloadCSV(
      items.filter((i) => i.tx).map((i) => i.tx),
      file.name.replace(/\.pdf$/i, '.csv'),
    );

  return (
    <section className="card">
      <h2>Import transactions</h2>

      {step === 'pick' && (
        <>
          <p className="sub">
            Add transactions from a CSV export or a PDF statement. Files are read in your browser
            and never uploaded. PDFs need selectable text; scanned statements aren't supported yet.
          </p>
          <label className="field">
            CSV (up to 5 MB) or PDF (up to 10 MB)
            <input type="file" accept=".csv,.pdf,text/csv,application/pdf" onChange={chooseFile} />
          </label>
          {error && (
            <Status tone="critical" as="p" role="alert" style={{ marginBottom: 0 }}>
              {file && `${file.name} (${formatSize(file.size)}): `}
              {error}
            </Status>
          )}
        </>
      )}

      {step === 'reading' && (
        <p className="muted" role="status">
          <Icon name="upload" /> Reading {file.name}…
        </p>
      )}

      {step === 'review' && (
        <div className="stack">
          {source.kind === 'csv' ? (
            <>
              <p className="sub" style={{ margin: 0 }}>
                {file.name} · {formatSize(file.size)} ·{' '}
                {plural(source.parsed.rows.length + source.parsed.errors.length, 'row')}. Check
                which column holds each field.
              </p>
              <div className="form">
                {FIELDS.map((field) => (
                  <label className="field" key={field}>
                    {FIELD_LABELS[field]}
                    <select name={field} value={mapping[field]} onChange={updateMapping}>
                      <option value={-1}>Not in file</option>
                      {/* Headers never reorder for a given file, so the index is a safe key */}
                      {source.parsed.headers.map((h, i) => (
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
            </>
          ) : (
            <PdfSummary file={file} statement={source.statement} />
          )}

          {problem ? (
            <Status tone="warning" as="p" role="status" style={{ margin: 0 }}>
              {problem}
            </Status>
          ) : (
            <>
              <p className="small" role="status" style={{ margin: 0 }}>
                {plural(counts.total, 'row')} · <Status tone="good">{counts.ok} ready</Status> ·{' '}
                <Status tone="warning" icon="edit">
                  {counts.review} to check
                </Status>{' '}
                · <Status tone="warning">{plural(counts.duplicate, 'duplicate')}</Status> ·{' '}
                <Status tone="critical">{plural(counts.error, 'error')}</Status>
              </p>
              {counts.review + counts.duplicate > 0 && (
                <p className="small muted" style={{ margin: 0 }}>
                  Rows to check and duplicates are left out unless you tick them. Use the edit
                  button to fix a date, description, amount or type; a fixed row is ready to import.
                </p>
              )}
              <ImportPreview
                items={items}
                kind={source.kind}
                included={included}
                onToggle={toggle}
                onSaveEdit={saveEdit}
              />
            </>
          )}

          <div className="row">
            <span className="spacer" />
            <button className="btn" onClick={reset}>
              Cancel
            </button>
            {source.kind === 'pdf' && (
              <button
                className="btn"
                onClick={downloadExtracted}
                disabled={!items.some((i) => i.tx)}
              >
                Download as CSV
              </button>
            )}
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
          {(result.left > 0 || result.errors > 0) && (
            <p className="small muted" style={{ margin: 0 }}>
              Left out {plural(result.left, 'unticked row')} and {plural(result.errors, 'row')} with
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

/** What was found in a PDF, plus the lines that were skipped (so nothing disappears silently). */
function PdfSummary({ file, statement }) {
  const { drafts, skipped, pages, period, kind } = statement;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <p className="sub" style={{ margin: 0 }}>
        {file.name} · {kind === 'card' ? 'Card statement' : 'Bank statement'} ·{' '}
        {plural(drafts.length, 'transaction')} found on {plural(pages, 'page')}
        {period && ` · ${formatDate(period.start)} to ${formatDate(period.end)}`}.
      </p>
      {skipped.length > 0 && (
        <details className="small">
          <summary>
            {plural(skipped.length, 'line')} skipped (balances, totals, unreadable rows)
          </summary>
          <ul className="list">
            {skipped.map((s, i) => (
              // Skipped lines can repeat, so position is part of the key
              <li key={`${s.page}-${i}`} style={{ flexWrap: 'wrap' }}>
                <span className="muted">p.{s.page}</span>
                <span>{s.text}</span>
                <span className="spacer" />
                <span className="muted">{s.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
