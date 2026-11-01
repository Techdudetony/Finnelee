import Icon from './Icon';

/**
 * What a section shows when it has nothing in it yet: a small illustration, a short title,
 * one line on what will appear here (and how to add it), plus an optional action button.
 *   <EmptyState icon="goals" title="No goals yet">Add one above.</EmptyState>
 * `kind` says why it's empty, and the illustration matches:
 *   'empty'        nothing has been added yet
 *   'insufficient' some data, but not enough for this view yet; `progress` ({ have, need })
 *                  fills that many segments of a ring (say the same numbers in the text)
 *   'error'        something went wrong; announced to screen readers right away
 * `as` changes the outer tag (e.g. "li" inside a list); `compact` trims the padding.
 */
export default function EmptyState({
  icon,
  title,
  children,
  action,
  kind = 'empty',
  progress,
  compact = false,
  as: Tag = 'div',
  className = '',
}) {
  return (
    <Tag
      className={`empty-state empty-${kind} ${compact ? 'compact' : ''} ${className}`}
      role={kind === 'error' ? 'alert' : undefined}
    >
      {icon && <EmptyArt icon={icon} kind={kind} progress={progress} />}
      <span className="empty-state-title">{title}</span>
      {children && <p className="empty-state-text">{children}</p>}
      {action && <div className="empty-state-actions">{action}</div>}
    </Tag>
  );
}

/**
 * The illustration: the area's icon on a soft tile, with a few shapes around it, drawn in
 * the theme's colors (CSS), so it works in light and dark. Purely decorative.
 */
function EmptyArt({ icon, kind, progress }) {
  return (
    <span className="empty-art" aria-hidden="true">
      <svg viewBox="0 0 96 72" width="96" height="72" focusable="false">
        <circle className="empty-art-halo" cx="48" cy="36" r="34" />
        {kind === 'insufficient' && progress ? (
          <ProgressRing have={progress.have} need={progress.need} />
        ) : (
          <circle className="empty-art-ring" cx="48" cy="36" r="27" pathLength="100" />
        )}
        <circle className="empty-art-dot" cx="12" cy="18" r="3" />
        <circle className="empty-art-dot" cx="86" cy="52" r="2.5" />
        <path className="empty-art-spark" d="M83 12v8M79 16h8" />
      </svg>
      <span className="empty-art-tile">
        <Icon name={kind === 'error' ? 'critical' : icon} size={22} />
      </span>
    </span>
  );
}

/** `need` arcs around the tile; the first `have` are filled in. */
function ProgressRing({ have, need }) {
  const gap = 4; // pathLength units between arcs
  const step = 100 / need;
  return Array.from({ length: need }, (_, i) => (
    <circle
      key={i}
      className={i < have ? 'empty-art-arc filled' : 'empty-art-arc'}
      cx="48"
      cy="36"
      r="27"
      pathLength="100"
      strokeDasharray={`${step - gap} ${100 - step + gap}`}
      strokeDashoffset={-i * step + 25} // first arc starts at the top
    />
  ));
}
