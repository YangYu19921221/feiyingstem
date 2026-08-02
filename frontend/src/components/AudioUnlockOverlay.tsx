import { useAudioBlocked } from '../hooks/useAudio';

/**
 * 自动播放解锁蒙层
 * 刷新页面后浏览器拦住了发音(无用户手势不许出声,所有网站同此策略),
 * 全屏提示学生点一下——点击瞬间 useAudio 会原地补读当前词并收起蒙层。
 * 点击本身由 useAudio 的 window 级 pointerdown/keydown 捕获监听处理,
 * 这里只负责"看得见",不用绑 onClick。
 */
export default function AudioUnlockOverlay() {
  const blocked = useAudioBlocked();
  if (!blocked) return null;
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/55 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audio-unlock-title"
      aria-describedby="audio-unlock-description"
    >
      <div className="mx-6 flex w-full max-w-xs flex-col items-center rounded-3xl bg-white px-8 py-9 text-center shadow-2xl">
        <div className="mb-4 flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-orange-100 text-3xl">
          🔊
        </div>
        <p id="audio-unlock-title" className="text-xl font-bold text-gray-800">点击继续学习</p>
        <p id="audio-unlock-description" className="mt-2 text-sm leading-6 text-gray-500">
          浏览器需要你点一下屏幕
          <br />
          才允许自动播放发音
        </p>
        <button
          type="button"
          autoFocus
          className="mt-5 min-h-12 w-full rounded-2xl bg-[#FF6B35] px-5 text-base font-bold text-white shadow-lg transition hover:bg-[#e95d2c]"
        >
          ▶️ 继续
        </button>
      </div>
    </div>
  );
}
