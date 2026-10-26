/**
 * 小鹰老师的头像和「还没出字」时的等待样子(2026-10-27)。
 *
 * - 在想: 三个跳动的点 +「小鹰老师在想」
 * - 在查课本 / 在准备画图(工具): 文字扫光,写清楚它在干什么
 * - 深度思考: 天蓝色、脑子图标一闪一闪、走秒
 * - 等久了换一句安抚的话(别让孩子以为卡死了);再久提示可以停下 —— 还没出字就停,不算次数
 *
 * 读屏: 走秒的数字 aria-hidden,只念稳定的那句,不然每秒念一遍。
 * 动画样式在 index.css「学习助手聊天」那段,减少动态效果时全部停下。
 */
import { memo } from 'react';
import { Brain } from 'lucide-react';

export type WaitKind = 'think' | 'tool' | 'deep' | 'stopping';

function hintFor(kind: WaitKind, waited: number): string {
  if (kind === 'stopping') return '';
  if (kind === 'deep') return waited >= 25 ? '难题想得久一点,快好了' : '';
  if (waited >= 20) return '比平时慢一点。等不及可以点右下角停下,还没出字就停不算次数';
  if (waited >= 8) return '还在想,马上就好';
  return '';
}

export const TutorAvatar = memo(function TutorAvatar({ busy = false, deep = false, size = 'md' }: {
  busy?: boolean; deep?: boolean; size?: 'md' | 'lg';
}) {
  const box = size === 'lg' ? 'h-14 w-14' : 'h-9 w-9';
  return (
    <span className={`relative mt-0.5 shrink-0 ${box} ${busy ? 'tutor-bob' : ''}`} aria-hidden="true">
      <img
        src="/tutor-avatar.jpg"
        alt=""
        className={`${box} rounded-full object-cover shadow-sm ${size === 'lg' ? 'ring-4' : 'ring-2'} ${deep ? 'ring-sky-100' : 'ring-orange-100'}`}
      />
      {busy && (
        <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full ring-2 ring-white ${deep ? 'bg-sky-400' : 'bg-orange-400'}`} />
      )}
    </span>
  );
});

function Dots({ tone }: { tone: string }) {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => <span key={i} className={`tutor-dot h-1.5 w-1.5 rounded-full ${tone}`} />)}
    </span>
  );
}

/** compact: 已经出了一些字、中途去查东西时,挂在字下面的小一行(不给安抚话) */
function TutorWaiting({ kind, label, secs = 0, waited = 0, compact = false }: {
  kind: WaitKind; label: string; secs?: number; waited?: number; compact?: boolean;
}) {
  const deep = kind === 'deep';
  const hint = compact ? '' : hintFor(kind, waited);
  const tone = kind === 'stopping' ? 'text-ink-mute' : deep ? 'text-sky-700' : 'text-orange-700';
  const shine = kind === 'tool' || deep ? `tutor-shine${deep ? ' tutor-shine-deep' : ''}` : '';
  return (
    <div className={`flex flex-col gap-1 ${compact ? 'mt-2' : 'py-0.5'}`} role="status" aria-live="polite">
      <div className="flex min-h-6 items-center gap-2">
        {deep ? (
          <Brain className="h-4 w-4 shrink-0 animate-pulse text-sky-500" aria-hidden="true" />
        ) : (
          <Dots tone={kind === 'stopping' ? 'bg-slate-300' : 'bg-orange-400'} />
        )}
        <span className={`text-sm font-medium ${tone}`}>
          <span className={shine}>{label}</span>
          {deep && secs > 0 && <span className="ml-1 tabular-nums text-sky-600/80" aria-hidden="true">{secs} 秒</span>}
        </span>
      </div>
      {hint && <span className="text-xs leading-relaxed text-ink-mute">{hint}</span>}
    </div>
  );
}

export default memo(TutorWaiting);
