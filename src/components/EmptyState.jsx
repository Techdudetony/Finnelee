import Icon from './Icon';

/**
 * What a section shows when it has nothing in it yet: an icon, a short title, one line on
 * what will appear here (and how to add it), plus an optional action button.
 *   <EmptyState icon="goals" title="No goals yet">Add one above.</EmptyState>
 * `as` changes the outer tag (e.g. "li" inside a list); `compact` trims the padding.
 */
export default function EmptyState({ icon, title, children, action, compact = false, as: Tag = 'div', className = '' }) {
  return (
    <Tag className={`empty-state ${compact ? 'compact' : ''} ${className}`}>
      {icon && (
        <span className="empty-state-icon" aria-hidden="true">
          <Icon name={icon} size={22} />
        </span>
      )}
      <span className="empty-state-title">{title}</span>
      {children && <p className="empty-state-text">{children}</p>}
      {action}
    </Tag>
  );
}
