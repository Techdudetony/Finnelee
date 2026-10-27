import { useState } from 'react';
import { useColorScheme } from '../hooks/useColorScheme';
import { getPalette, SERIES_NAMES } from '../utils/colors';
import { deleteCategory, renameCategory, usageCount } from '../utils/categoryOps';
import { uid } from '../utils/format';

const emptyForm = { name: '', type: 'expense', group: 'want', colorIndex: '' };

export default function Categories({ store }) {
  const { categories, setCategories } = store;
  const palette = getPalette(useColorScheme());
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');

  // Names must be unique (case-insensitive), because transactions refer to categories by name.
  const nameTaken = (name, exceptId) =>
    categories.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());

  const addCategory = (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    if (nameTaken(name)) return setMessage(`⚠ "${name}" already exists.`);
    const colorIndex = form.colorIndex === '' ? null : Number(form.colorIndex);
    setCategories((prev) => [
      ...prev,
      { id: uid(), name, type: form.type, group: form.group, colorIndex },
    ]);
    setForm(emptyForm);
    setMessage(`✓ Added "${name}".`);
  };

  // Change simple fields (group, color) on one category.
  const updateField = (id, field, value) =>
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));

  // Renaming also rewrites every transaction, bill and budget that used the old name.
  const rename = (cat, newName) => {
    const name = newName.trim();
    if (!name || name === cat.name) return true;
    if (nameTaken(name, cat.id)) {
      setMessage(`⚠ "${name}" already exists.`);
      return false; // tells the row to put the old name back
    }
    applyDataChange(renameCategory(store, cat.name, name));
    updateField(cat.id, 'name', name);
    setMessage(`✓ Renamed "${cat.name}" to "${name}".`);
    return true;
  };

  const remove = (cat) => {
    const sameType = categories.filter((c) => c.type === cat.type && c.id !== cat.id);
    if (sameType.length === 0) return setMessage(`⚠ You need at least one ${cat.type} category.`);
    // Prefer a catch-all "Other" category as the new home for this category's records.
    const fallback = sameType.find((c) => c.name.toLowerCase().startsWith('other')) ?? sameType[0];
    const used = usageCount(store, cat.name);
    const question = used
      ? `Delete "${cat.name}"? Its ${used} transaction(s) and bill(s) will move to "${fallback.name}".`
      : `Delete "${cat.name}"?`;
    if (!window.confirm(question)) return;
    applyDataChange(deleteCategory(store, cat.name, fallback.name));
    setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    setMessage(`✓ Deleted "${cat.name}".`);
  };

  // Save the updated records returned by the pure functions in categoryOps.js.
  const applyDataChange = ({ transactions, bills, budgets }) => {
    store.setTransactions(transactions);
    store.setBills(bills);
    store.setBudgets(budgets);
  };

  const rowProps = { store, palette, onRename: rename, onUpdate: updateField, onDelete: remove };

  return (
    <div className="stack">
      <section className="card">
        <h2>New category</h2>
        <p className="sub">
          "Need" vs "want" decides where spending lands in the 50/30/20 calculator and the emergency
          fund estimate.
        </p>
        <form className="form" onSubmit={addCategory}>
          <label className="field">
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Pets"
              required
            />
          </label>
          <label className="field">
            Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          {/* Only expenses are split into needs and wants */}
          {form.type === 'expense' && (
            <label className="field">
              Group
              <select
                value={form.group}
                onChange={(e) => setForm({ ...form, group: e.target.value })}
              >
                <option value="need">Need</option>
                <option value="want">Want</option>
              </select>
            </label>
          )}
          <label className="field">
            Chart color
            <ColorSelect
              value={form.colorIndex}
              onChange={(v) => setForm({ ...form, colorIndex: v })}
              palette={palette}
            />
          </label>
          <button className="btn btn-primary">Add category</button>
        </form>
      </section>

      {message && (
        <p className="insight" role="status" style={{ margin: 0 }}>
          {message}
        </p>
      )}

      <CategoryTable title="Expense categories" type="expense" {...rowProps} />
      <CategoryTable title="Income categories" type="income" {...rowProps} />
    </div>
  );
}

function CategoryTable({ title, type, store, ...rowProps }) {
  const rows = store.categories.filter((c) => c.type === type);
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="sub">
        Click a name to rename it. Every transaction, bill and budget using it updates too.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              {type === 'expense' && <th>Group</th>}
              <th>Chart color</th>
              <th className="num">Used by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <CategoryRow key={c.id} cat={c} used={usageCount(store, c.name)} {...rowProps} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CategoryRow({ cat, used, palette, onRename, onUpdate, onDelete }) {
  // Local "draft" state: typing doesn't touch real data until the input loses focus or Enter is pressed.
  const [draft, setDraft] = useState(cat.name);

  const commit = () => {
    if (!onRename(cat, draft)) setDraft(cat.name); // rejected: restore the old name
  };

  return (
    <tr>
      <td>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} // blur triggers commit
          aria-label={`Rename ${cat.name}`}
          style={{ width: '100%', minWidth: 120 }}
        />
      </td>
      {cat.type === 'expense' && (
        <td>
          <select
            value={cat.group}
            onChange={(e) => onUpdate(cat.id, 'group', e.target.value)}
            aria-label={`${cat.name} group`}
          >
            <option value="need">Need</option>
            <option value="want">Want</option>
          </select>
        </td>
      )}
      <td>
        <ColorSelect
          value={cat.colorIndex ?? ''}
          onChange={(v) => onUpdate(cat.id, 'colorIndex', v === '' ? null : Number(v))}
          palette={palette}
          label={`${cat.name} color`}
        />
      </td>
      <td className="num muted">{used}</td>
      <td className="num">
        <button
          className="btn-icon"
          onClick={() => onDelete(cat)}
          aria-label={`Delete ${cat.name}`}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

/**
 * A <select> of the 8 chart colors plus gray, with a swatch showing the current pick.
 * Native <option>s can't show colored dots reliably, so the swatch sits beside the select.
 */
function ColorSelect({ value, onChange, palette, label = 'Chart color' }) {
  const swatch = value === '' || value == null ? palette.other : palette.series[value];
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <span className="dot" style={{ background: swatch, margin: 0 }} aria-hidden />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Gray</option>
        {SERIES_NAMES.map((name, i) => (
          <option key={name} value={i}>
            {name}
          </option>
        ))}
      </select>
    </span>
  );
}
