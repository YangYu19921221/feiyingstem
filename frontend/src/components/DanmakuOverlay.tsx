/**
 * 弹幕层 —— 叠在视频右侧的半透明聊天列表(直播间右边那种飘字条)。
 *
 * 视觉:靠右一竖列,每条独立半透明气泡(黑底 backdrop-blur),新消息从底部进、
 * 自动滚到底;整列顶部渐隐(mask 渐变),越往上越透明 → "飘在画面上"的通透感,
 * 不糊住视频主体。老师弹幕描金加粗,学生名天蓝。
 *
 * 无障碍/性能:pointer-events-none 不挡视频控件;只保留最近 MAX_SHOWN 条,长课不堆爆;
 * prefers-reduced-motion 时关掉滚动过渡动画(列表照常更新),低端机也稳。
 */
import { useEffect, useRef } from 'react';

export interface DanmakuItem {
  id: number;
  name: string;
  role: 'student' | 'teacher';
  content: string;
  student_id?: number;
}

const MAX_SHOWN = 30;   // 只渲染最近这么多条

export default function DanmakuOverlay({
  items,
  scroll = true,
}: {
  items: DanmakuItem[];
  scroll?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  const prefersReduced = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const smooth = scroll && !prefersReduced;

  const shown = items.slice(-MAX_SHOWN);

  // 新弹幕滚到底
  useEffect(() => {
    endRef.current?.scrollIntoView({
      block: 'end',
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, [shown.length, smooth]);

  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-[46%] max-w-[300px] pointer-events-none
                 flex flex-col justify-end overflow-hidden px-2 py-2"
      style={{
        // 顶部渐隐:越靠上越透明,飘出画面的通透感
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 100%)',
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 100%)',
      }}
    >
      <div className="flex flex-col gap-1.5 overflow-y-auto no-scrollbar">
        {shown.map((it) => (
          <div
            key={it.id}
            className="self-end max-w-full px-2.5 py-1 rounded-xl text-sm leading-snug
                       break-words bg-black/35 backdrop-blur-sm text-white/95 shadow-sm"
          >
            <span
              className="font-bold mr-1"
              style={{ color: it.role === 'teacher' ? '#FFD23F' : '#00D9FF' }}
            >
              {it.name}
            </span>
            {it.content}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
