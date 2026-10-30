import { useCountUp } from '../hooks/useCountUp';

/**
 * A number that counts up the first time it appears: <CountUp value={4200} format={formatCurrency} />.
 * Screen readers get the final value only (the moving digits are hidden from them).
 */
export default function CountUp({ value, format = String }) {
  const shown = useCountUp(Number(value) || 0);
  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}
