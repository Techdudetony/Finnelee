import { useRef } from 'react';

/**
 * Remembers the ids that were there on the first render. Returns isNew(id): true only for
 * items added later, so just those get an entrance animation. The rows already on screen
 * when a page opens (and every rerender after) stay still.
 */
export function useNewItems(items, getId = (item) => item.id) {
  const initial = useRef(null);
  if (initial.current === null) initial.current = new Set(items.map(getId));
  return (id) => !initial.current.has(id);
}
