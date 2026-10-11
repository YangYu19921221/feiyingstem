/** 句子背诵各阶段共用的小组件 */
import type { ReactNode } from 'react';

export function StageHeader({ step, title, hint, pos, total, round }: {
  step: number; title: string; hint: string; pos: number; total: number; round?: number;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">
          <span className="mr-2 text-accent-warm">第 {step} 步</span>{title}
        </h2>
        <span className="text-xs tabular-nums text-ink-mute">
          {round && round > 1 ? `再练一轮 · ` : ''}{Math.min(pos + 1, total)} / {total}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">{hint}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
        <div className="h-full bg-accent-warm transition-all" style={{ width: `${(pos / Math.max(total, 1)) * 100}%` }} />
      </div>
    </div>
  );
}

export function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="min-h-12 w-full rounded-xl bg-accent-warm px-4 py-3 font-medium text-white hover:opacity-90 disabled:opacity-40">
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="min-h-12 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-ink hover:bg-black/[0.02] disabled:opacity-40">
      {children}
    </button>
  );
}

/** 逐词标注: 写对的正常显示,写错/漏写的标红 */
export function WordMarks({ words }: { words: { text: string; ok: boolean }[] }) {
  return (
    <p className="font-display text-xl leading-relaxed">
      {words.map((w, i) => (
        <span key={i} className={w.ok ? 'text-ink' : 'rounded bg-red-50 px-1 text-red-600 underline decoration-red-400 decoration-2 underline-offset-4'}>
          {w.text}{i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  );
}

/** 阶段之间的过渡卡: 告诉孩子刚做完什么、下一步做什么 */
export function StepIntro({ step, title, desc, onStart }: { step: number; title: string; desc: string; onStart: () => void }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-accent-warm">第 {step} 步</p>
      <h2 className="mt-1 font-display text-2xl font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-soft">{desc}</p>
      <div className="mx-auto mt-8 max-w-xs"><PrimaryButton onClick={onStart}>开始</PrimaryButton></div>
    </div>
  );
}
