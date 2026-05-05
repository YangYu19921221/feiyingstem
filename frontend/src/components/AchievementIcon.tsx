/**
 * 成就图标 — 兼容路径型（徽章图）和 emoji 型 icon
 * - /badges/*.jpeg 或 http(s) URL → 渲染 <img>
 * - 否则按 emoji / 文字渲染
 */
interface Props {
  icon?: string | null;
  size?: number;
  className?: string;
}

export function AchievementIcon({ icon, size = 48, className = '' }: Props) {
  const isImagePath = !!icon && (icon.startsWith('/') || icon.startsWith('http'));

  if (isImagePath) {
    return (
      <img
        src={icon!}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className={`rounded-full object-cover select-none ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center select-none ${className}`}
      style={{ fontSize: size * 0.75, lineHeight: 1, width: size, height: size }}
    >
      {icon || '🏆'}
    </span>
  );
}
