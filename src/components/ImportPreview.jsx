import { useState } from 'react';
import Icon from './Icon';
import Status from './Status';
import { needsApproval, parseDateCell } from '../utils/csvImport';
import { formatCurrency, formatDate } from '../utils/format';

const PREVIEW_ROWS = 20;
// The edit inputs live in other table cells, so they join the Save form via form="..." (Enter saves).
const EDIT_FORM = 'import-edit-row';

const STATUS = {
  ok: { tone: 'good', text: 'Ready' },
  review: { tone: 'warning', icon: 'edit', text: 'Check' },
  duplicate: { tone: 'warning', text: 'Duplicate' },
  error: { tone: 'critical', text: 'Error' },
};

// Starting values for the edit form: the parsed transaction, or the raw draft for error rows.
const editValues = ({ tx, draft }) => ({
  date: tx?.date ?? parseDateCell(draft.date) ?? '',
  description: tx?.description ?? draft.description,
  amount: String(tx?.amount ?? draft.money.amount ?? ''),
  type: tx?.type ?? draft.money.type ?? 'expense',
});

/** The preview table shared by CSV and PDF imports, with per-row corrections. */
export default function ImportPreview({ items, kind, included, onToggle, onSaveEdit }) {
  const [show, setShow] = useState('all');
  const [editing, setEditing] = useState(null); // { line, date, description, amount, type }
  const shown = show === 'all' ? items : items.filter((i) => i.status === show);

  const updateEditing = (e) => setEditing((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  const saveEdit = (e) => {
    e.preventDefault();
    const { line, ...values } = editing;
    onSaveEdit(line, values);
    setEditing(null);
  };

  return (
    <>
      <div className="row">
        <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show rows">
          <option value="all">All rows</option>
          <option value="ok">Ready</option>
          <option value="review">To check</option>
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
              <th className="num">{kind === 'pdf' ? 'Page' : 'Line'}</th>
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
            {shown.slice(0, PREVIEW_ROWS).map((item) => {
              const status = STATUS[item.status];
              const isEditing = editing?.line === item.line;
              return (
                // Line numbers are unique and stable, so they make good keys
                <tr key={item.line}>
                  <td className="num muted">{kind === 'pdf' ? item.page : item.line}</td>
                  <td>
                    <Status tone={status.tone} icon={status.icon}>
                      {status.text}
                    </Status>
                    {item.reason && <div className="small muted">{item.reason}</div>}
                  </td>

                  {isEditing ? (
                    <EditCells values={editing} onChange={updateEditing} formId={EDIT_FORM} />
                  ) : item.tx ? (
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
                      {item.draft ? item.draft.description || 'Not imported' : 'Not imported'}
                    </td>
                  )}

                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <form
                        id={EDIT_FORM}
                        onSubmit={saveEdit}
                        className="row"
                        style={{ gap: 4, flexWrap: 'nowrap' }}
                      >
                        <button className="btn btn-primary">Save</button>
                        <button type="button" className="btn" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        {needsApproval(item) && (
                          <input
                            type="checkbox"
                            checked={included.has(item.line)}
                            onChange={() => onToggle(item.line)}
                            aria-label={`Import ${kind === 'pdf' ? 'row' : 'line'} ${item.line} anyway`}
                          />
                        )}
                        {item.draft && (
                          <button
                            className="btn-icon"
                            onClick={() => setEditing({ line: item.line, ...editValues(item) })}
                            aria-label={`Edit ${item.tx?.description ?? `line ${item.line}`}`}
                          >
                            <Icon name="edit" />
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No rows to show.</p>}
      </div>
    </>
  );
}

/** Inputs that replace the date, description, type, category and amount cells while editing. */
function EditCells({ values, onChange, formId }) {
  return (
    <>
      <td>
        <input
          type="date"
          name="date"
          value={values.date}
          onChange={onChange}
          form={formId}
          required
          aria-label="Date"
        />
      </td>
      <td>
        <input
          name="description"
          value={values.description}
          onChange={onChange}
          form={formId}
          required
          aria-label="Description"
        />
      </td>
      <td>
        <select name="type" value={values.type} onChange={onChange} form={formId} aria-label="Type">
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </td>
      <td className="small muted">Auto</td>
      <td>
        <input
          type="number"
          name="amount"
          min="0.01"
          step="0.01"
          value={values.amount}
          onChange={onChange}
          form={formId}
          required
          aria-label="Amount"
          style={{ width: 100 }}
        />
      </td>
    </>
  );
}
