/**
 * 学生身份徽标：姓名首字头像 + 姓名 + @账号。
 * 给老师/家长拍照时一眼辨认是谁。身份取自 localStorage 登录用户。
 * tone='paper' 用于米白底页面，tone='color' 用于彩色 hero（白字）。
 */
interface Props {
  tone?: 'paper' | 'color';
  className?: string;
}

function readMe() {
  try { return JSON.parse(localStorage.getItem('user') || '{}'); }
  catch { return {}; }
}

export default function StudentIdentityBadge({ tone = 'paper', className = '' }: Props) {
  const me = readMe();
  const name: string = me.full_name || me.username || '同学';
  const account: string = me.username || '';
  const onColor = tone === 'color';

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span
        className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-base font-bold ${
          onColor ? 'bg-white/25 text-white' : 'bg-accent-warm/15 text-accent-warm'
        }`}
      >
        {name.slice(0, 1)}
      </span>
      <div className="leading-tight">
        <p className={`font-display text-base font-semibold ${onColor ? 'text-white' : 'text-ink'}`}>
          {name}
        </p>
        {account && (
          <p className={`text-xs ${onColor ? 'text-white/75' : 'text-ink-mute'}`}>
            账号 @{account}
          </p>
        )}
      </div>
    </div>
  );
}
