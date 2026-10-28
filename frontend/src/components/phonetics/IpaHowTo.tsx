/**
 * 「音标怎么打」—— 第一次打开键盘时自动放一遍,键盘右上角「怎么打?」随时再看
 *
 * 用真的键(IpaKey)和真的格子(AnswerSlots)演示打 bed:看词 → 点 b → 点橙色的 e → 点 d → 交。
 * 演示里的键和格子跟孩子马上要用的长得一模一样,看完照着点就行,不用把说明翻译成动作。
 *
 * 自动播放,每一步约 2 秒;下面的小圆点可以点回任意一步。
 * 减少动态效果的用户不自动播,改成「下一步」按钮。
 * 必须 portal 到 body: 整页版键盘在带 backdrop-blur 的侧栏里,fixed 遮罩会被困在侧栏里。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import IpaKey from './IpaKey';
import AnswerSlots from './AnswerSlots';

const ANSWER = ['b', 'e', 'd'];
/** 演示键盘: 三个要按的键 + 几个旁边的键,看着像一小块真键盘 */
const DEMO_CONSONANTS = ['p', 'b', 't', 'd'];
const DEMO_VOWELS = ['æ', 'e', 'ɪ'];

const STEPS: { press?: string; text: string }[] = [
  { text: '先看单词 bed(床),心里读一读。三个格子 = 三个音,一格放一个音' },
  { press: 'b', text: '第一个音是 /b/:点键下面写着 bag 的那个键。点了会读出 bag,听着像就对了' },
  { press: 'e', text: '中间是元音,元音都是橙色键:点 egg 的 e' },
  { press: 'd', text: '最后一个音 /d/:点 dog 的 d。格子会自己跳到下一格' },
  { text: '填满了,点下面的「看看对不对」(整页版叫「交卷」)。点错了按「退格」' },
];
const STEP_MS = [2600, 2800, 2600, 2600, 3600];

interface Props {
  onClose: () => void;
}

export default function IpaHowTo({ onClose }: Props) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(!reduce);
  const dialogRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 自动播放: 放完最后一步停一会儿从头再来,孩子没看清可以接着看
  useEffect(() => {
    if (!auto) return;
    const t = window.setTimeout(() => setStep(s => (s + 1) % STEPS.length), STEP_MS[step]);
    return () => window.clearTimeout(t);
  }, [auto, step]);

  // 演示格子不能点、不能 Tab 进去(AnswerSlots 里是真按钮)
  useEffect(() => { slotsRef.current?.setAttribute('inert', ''); }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // 卡片页在 window 上听回车(交卷/下一张)和退格(删格): 演示开着时一律截住,
      // 回车照样能按下演示里聚焦的按钮(那是按钮的默认动作,不走监听)
      if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Escape') e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const els = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([tabindex="-1"])'))
        .filter(el => !el.closest('[inert]') && !el.hasAttribute('disabled'));
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    // 捕获阶段: 卡片页自己监听了回车/退格(推进、删格),演示开着时不能漏下去
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const filled = STEPS.slice(1, step + 1).filter(s => s.press).length;
  const slots = ANSWER.map((p, i) => (i < filled ? p : null));
  const cursor = filled < ANSWER.length ? filled : -1;
  const pressing = STEPS[step].press;
  const last = step === STEPS.length - 1;

  const goto = (i: number) => { setAuto(false); setStep(i); };

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ipa-howto-title"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-white px-5 pb-5 pt-4 shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start gap-3">
          <h2 id="ipa-howto-title" className="flex-1 pt-1 text-lg font-bold text-slate-900">
            音标怎么打
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="-mr-1 flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 演示台: 单词 + 格子 + 一小块键盘 */}
        <div className="mt-3 rounded-2xl bg-orange-50/70 px-4 pb-4 pt-5 ring-1 ring-orange-100" aria-hidden>
          <div className="flex flex-col items-center gap-3">
            <p className="font-mono text-4xl font-bold leading-none text-slate-900">
              bed <span className="font-sans text-base font-medium text-slate-600">床</span>
            </p>
            <div ref={slotsRef}>
              <AnswerSlots slots={slots} editable={[0, 1, 2]} cursor={cursor} size="lg" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1">
            {DEMO_CONSONANTS.map(k => <IpaKey key={k} k={k} demo pressed={pressing === k} />)}
            {DEMO_VOWELS.map(k => <IpaKey key={k} k={k} demo pressed={pressing === k} />)}
          </div>
          {last && (
            <div className="mt-3 flex h-11 items-center justify-center rounded-xl bg-orange-500 text-sm font-semibold text-white">
              看看对不对
            </div>
          )}
        </div>

        <p className="mt-4 min-h-[3.5rem] text-base leading-7 text-slate-800" aria-live="polite">
          <span className="mr-1.5 font-bold text-accent-warm">第 {step + 1} 步</span>
          {STEPS[step].text}
        </p>
        {last && (
          <p className="mt-1 text-sm leading-6 text-slate-600">
            有的词格子最前面印着 <span className="font-mono font-bold text-slate-800">ˈ</span>,
            那是重音记号,已经帮你印好了,不用填。
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center" role="group" aria-label="跳到第几步">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goto(i)}
                aria-label={`第 ${i + 1} 步`}
                aria-current={i === step ? 'step' : undefined}
                className="flex h-8 w-6 items-center justify-center sm:w-8"
              >
                <span
                  className={[
                    'block h-2 rounded-full transition-all duration-300',
                    i === step ? 'w-5 bg-[#FF6B35]' : 'w-2 bg-slate-300',
                  ].join(' ')}
                />
              </button>
            ))}
          </div>
          {!last && (
            <button
              type="button"
              onClick={() => goto(step + 1)}
              className="h-11 shrink-0 whitespace-nowrap rounded-xl px-3.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              下一步
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-11 shrink-0 whitespace-nowrap rounded-xl bg-accent-warm px-4 text-sm font-bold text-white hover:bg-[#a9441c]"
          >
            我会了,开始写
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
