/**
 * 看大图(学习助手的记忆图;2026-10-27 用户「对话中返回的图片点击放大显示有问题」)。
 *
 * **必须 portal 到 body**: 聊天气泡有入场动画,带 transform 的祖先会变成 fixed 的包含块,
 * 放在气泡里的「全屏」遮罩只会盖住那个气泡(实测: 手机上缩在消息里、电脑上歪到一边、Esc 关不掉)。
 *
 * - 关: 右上角叉、点空白处、Esc;打开时焦点放在关闭键,关了回到原来的按钮;Tab 只在两个按钮间转
 * - 背后的页面不跟着滚(锁 body)
 * - 底部大按钮「听 xxx」;图可以长按保存(只有单词的画面,没有孩子的信息;学生端默认拦长按,这里放开)
 */
import { memo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Volume2, X } from 'lucide-react';

function ImageLightbox({ url, word, onClose, onSpeak, speaking }: {
  url: string; word: string; onClose: () => void; onSpeak: () => void; speaking: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const speakRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        // 只有两个按钮: 在它们之间转,别跑到背后的页面
        e.preventDefault();
        (document.activeElement === closeRef.current ? speakRef.current : closeRef.current)?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="tutor-lightbox fixed inset-0 z-[90] flex flex-col bg-slate-950/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${word} 的记忆图`}
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="min-w-0 truncate text-sm font-medium text-white/85">{word} 的记忆图</p>
        <button
          ref={closeRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          aria-label="关闭"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <img
          src={url}
          alt={`${word} 的记忆图`}
          data-allow-save
          onClick={(e) => e.stopPropagation()}
          className="tutor-lightbox-img allow-select max-h-full w-auto max-w-[min(100%,36rem)] rounded-2xl bg-white object-contain shadow-2xl"
        />
      </div>

      <div className="flex flex-col items-center gap-2 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <button
          ref={speakRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); onSpeak(); }}
          className="inline-flex min-h-12 max-w-full items-center gap-2 rounded-full bg-white px-6 text-base font-semibold text-sky-700 shadow-lg hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-label={`听 ${word} 的发音`}
        >
          <Volume2 className={`h-5 w-5 shrink-0 ${speaking ? 'tutor-speaking' : ''}`} aria-hidden="true" />
          <span className="truncate">听 {word}</span>
        </button>
        <p className="text-xs text-white/60">点空白处关闭 · 长按图片可以保存</p>
      </div>
    </div>,
    document.body,
  );
}

export default memo(ImageLightbox);
