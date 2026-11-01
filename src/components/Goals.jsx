import { useRef, useState } from 'react';
import Icon from './Icon';
import EmptyState from './EmptyState';
import { useNewItems } from '../hooks/useNewItems';
import ProgressBar from './ProgressBar';
import Status from './Status';
import { useCelebration } from './Celebrate';
import { formatCurrency, formatDate, uid } from '../utils/format';
import { monthsUntil, requiredMonthly } from '../utils/finance';
import { addToGoal, goalMessage, goalReached } from '../utils/celebrate';

const emptyGoal = { name: '', target: '', saved: '', deadline: '' };

export default function Goals({ store }) {
  const { goals, setGoals } = store;
  const isNew = useNewItems(goals); // a goal added after the page opened fades in
  const [form, setForm] = useState(emptyGoal);
  const party = useCelebration(); // "goal reached" moment, only after adding money here
  // The goals including changes made here that React hasn't re-rendered yet, so a second
  // quick contribution is checked against the first one, exactly as it will be saved.
  const latest = useRef(goals);
  latest.current = goals;

  const addGoal = (e) => {
    e.preventDefault();
    const g = { id: uid(), name: form.name.trim(), target: +form.target, saved: +form.saved || 0, deadline: form.deadline };
    if (!g.name || g.target <= 0 || !g.deadline) return;
    setGoals((prev) => [...prev, g]);
    latest.current = [...latest.current, g];
    setForm(emptyGoal);
  };

  // Add (or subtract, with a negative number) money to a goal.
  const contribute = (id, amount, card) => {
    setGoals((prev) => addToGoal(prev, id, amount).goals);
    // Celebrate when this contribution takes the goal from below its target to reaching it.
    const { goals: next, before, after } = addToGoal(latest.current, id, amount);
    latest.current = next;
    if (before && goalReached(before, after))
      party.celebrate(goalMessage(after.name, formatCurrency(after.saved)), card, id);
  };

  const remove = (id) => {
    setGoals((p) => p.filter((x) => x.id !== id));
    latest.current = latest.current.filter((x) => x.id !== id);
  };

  const totalMonthly = goals.reduce((s, g) => s + requiredMonthly(g), 0);

  return (
    <div className="stack">
      {party.node}
      <section className="card">
        <h2>New goal</h2>
        <p className="sub">Saving for everything at once? You need {formatCurrency(totalMonthly)}/month across all goals.</p>
        <form className="form" onSubmit={addGoal}>
          <label className="field">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. New laptop" /></label>
          <label className="field">Target<input type="number" min="1" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /></label>
          <label className="field">Already saved<input type="number" min="0" value={form.saved} onChange={(e) => setForm({ ...form, saved: e.target.value })} /></label>
          <label className="field">Deadline<input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label>
          <button className="btn btn-primary">Add goal</button>
        </form>
      </section>

      <div className="grid grid-2">
        {goals.length === 0 && (
          <EmptyState icon="goals" title="No goals yet" className="card">
            Add one above, like an emergency fund or a trip.
          </EmptyState>
        )}
        {goals.map((g) => <GoalCard key={g.id} isNew={isNew(g.id)} celebrating={party.glow === g.id} goal={g} onContribute={contribute} onDelete={() => remove(g.id)} />)}
      </div>
    </div>
  );
}

function GoalCard({ goal, isNew, celebrating, onContribute, onDelete }) {
  // Each card has its own input state; lifting it to the parent would be unnecessary.
  const [amount, setAmount] = useState('');
  const card = useRef(null); // where the confetti starts
  const months = monthsUntil(goal.deadline);
  const needed = requiredMonthly(goal);
  const done = goal.saved >= goal.target;

  const submit = (e) => {
    e.preventDefault();
    if (Number(amount)) onContribute(goal.id, Number(amount), card.current);
    setAmount('');
  };

  return (
    <section ref={card} className={`card ${isNew ? 'row-new' : ''}${celebrating ? ' celebrate-glow' : ''}`}>
      <div className="row">
        <h2>{goal.name}</h2>
        <span className="spacer" />
        <button className="btn-icon" onClick={onDelete} aria-label={`Delete ${goal.name}`}><Icon name="close" /></button>
      </div>
      <p className="sub">By {formatDate(goal.deadline)} · {months} months left</p>
      <div className="row small" style={{ marginBottom: 6 }}>
        <strong className="num">{formatCurrency(goal.saved)}</strong>
        <span className="muted">of {formatCurrency(goal.target)}</span>
      </div>
      <ProgressBar value={goal.saved} max={goal.target} mode="target" label={`${goal.name} goal`} />
      <p className="small" style={{ margin: '12px 0' }}>
        {done ? <Status tone="good" icon="celebrate">Goal reached!</Status> : <>Save <strong>{formatCurrency(needed)}</strong> per month to stay on track.</>}
      </p>
      <form className="row" onSubmit={submit}>
        <input type="number" step="any" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ flex: 1 }} aria-label={`Contribute to ${goal.name}`} />
        <button className="btn">Add money</button>
      </form>
    </section>
  );
}
