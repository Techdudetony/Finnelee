import Icon from './Icon';

const TONE_ICON = { good: 'check', warning: 'warning', critical: 'critical' };

/** Colored status text with a matching icon: <Status tone="good">On track</Status>. */
export default function Status({ tone, icon = TONE_ICON[tone], as: Tag = 'span', children, ...rest }) {
  return (
    <Tag className={`status status-${tone}`} {...rest}>
      <Icon name={icon} size={14} />
      {children}
    </Tag>
  );
}

/** A message box (.insight) led by an icon. Pass `tone`, `icon`, or both. */
export function Notice({ tone, icon = TONE_ICON[tone], as: Tag = 'div', children, ...rest }) {
  return (
    <Tag className="insight" {...rest}>
      <Icon name={icon} className={tone ? `status-${tone}` : ''} />
      <span>{children}</span>
    </Tag>
  );
}
