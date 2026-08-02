import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  CircleAlert,
  Clock3,
  Headphones,
  Languages,
  LoaderCircle,
  PencilLine,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { imeSafeInputProps } from '../../utils/noSuggestInput';
import { useAudio } from '../../hooks/useAudio';

/** 过关题型(与后端 adapters.EXAM_TYPES 对齐) */
export type PkExamType = 'en_to_cn' | 'cn_to_en' | 'listening' | 'spelling';

interface PkExamCardProps {
  word: { id: number; word: string; translation: string };
  examType: PkExamType;
  /** 选择题(en_to_cn/cn_to_en)的选项;听写/拼写为空 */
  options?: string[];
  /** 选择题回传 {selected};听写/拼写回传 {text}。ms=作答耗时 */
  onSelect: (selected: string, ms: number) => void;
  onText: (text: string, ms: number) => void;
  disabled?: boolean;
  /** 实时连接断开时锁定作答，但保留当前输入，恢复后可继续。 */
  offline?: boolean;
  /** 服务端超时(ms),仅用于本地倒计时显示,判分以服务端为准 */
  timeoutMs?: number;
}

interface TypeConfig {
  label: string;
  instruction: string;
  icon: LucideIcon;
}

const TYPE_CONFIG: Record<PkExamType, TypeConfig> = {
  en_to_cn: { label: '英译中', instruction: '选择正确的中文意思', icon: Languages },
  cn_to_en: { label: '中译英', instruction: '选择对应的英文单词', icon: Languages },
  listening: { label: '听音拼写', instruction: '听清发音，拼出完整单词', icon: Headphones },
  spelling: { label: '看义拼写', instruction: '根据中文意思拼出英文单词', icon: PencilLine },
};

export default function PkExamCard({
  word,
  examType,
  options = [],
  onSelect,
  onText,
  disabled = false,
  offline = false,
  timeoutMs = 30_000,
}: PkExamCardProps) {
  const [text, setText] = useState('');
  const [remaining, setRemaining] = useState(timeoutMs);
  const [playCount, setPlayCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [hasSubmittedText, setHasSubmittedText] = useState(false);
  const startRef = useRef<number>(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();
  const { playAudio } = useAudio();

  const isChoice = examType === 'en_to_cn' || examType === 'cn_to_en';
  const isInput = examType === 'listening' || examType === 'spelling';
  const config = TYPE_CONFIG[examType];
  const TypeIcon = config.icon;

  // 切题重置(word.id 或题型变化都重置);听写题自动播一次发音。
  useEffect(() => {
    let cancelled = false;
    let actionTimer: number | undefined;

    setText('');
    setPlayCount(0);
    setIsPlaying(false);
    setSelectedOption(null);
    setHasSubmittedText(false);
    startRef.current = Date.now();
    setRemaining(timeoutMs);

    const tick = () => {
      const next = Math.max(0, timeoutMs - (Date.now() - startRef.current));
      setRemaining(next);
      if (next === 0) window.clearInterval(timer);
    };
    const timer = window.setInterval(tick, 1000);

    if (examType === 'listening') {
      actionTimer = window.setTimeout(async () => {
        if (cancelled) return;
        setIsPlaying(true);
        try {
          await playAudio(word.word, 1, word.id);
          if (!cancelled) setPlayCount(1);
        } finally {
          if (!cancelled) {
            setIsPlaying(false);
            inputRef.current?.focus();
          }
        }
      }, 300);
    } else if (isInput) {
      actionTimer = window.setTimeout(() => inputRef.current?.focus(), 100);
    }

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (actionTimer !== undefined) window.clearTimeout(actionTimer);
    };
  }, [examType, isInput, playAudio, timeoutMs, word.id, word.word]);

  const replay = async () => {
    if (playCount >= 3 || isPlaying || disabled || offline) return;
    setIsPlaying(true);
    try {
      await playAudio(word.word, 1, word.id);
      setPlayCount((count) => Math.min(3, count + 1));
    } finally {
      setIsPlaying(false);
    }
  };

  const submitText = () => {
    if (disabled || offline || hasSubmittedText || remaining <= 0 || !text.trim()) return;
    setHasSubmittedText(true);
    onText(text.trim(), Date.now() - startRef.current);
  };

  const pick = (option: string) => {
    if (disabled || offline || remaining <= 0 || selectedOption !== null) return;
    setSelectedOption(option);
    onSelect(option, Date.now() - startRef.current);
  };

  const spellingHint = word.word
    ? `${word.word[0]}${' ·'.repeat(Math.max(0, word.word.length - 1))}`
    : '';
  const secondsLeft = Math.max(0, Math.ceil(remaining / 1000));
  const timeExpired = remaining <= 0;
  const timeIsUrgent = secondsLeft <= 5;
  const timeIsLow = secondsLeft <= 10;
  const timeProgress = timeoutMs > 0 ? Math.min(100, Math.max(0, (remaining / timeoutMs) * 100)) : 0;
  const inputLocked = disabled || offline || timeExpired || hasSubmittedText;
  const choiceLocked = disabled || offline || timeExpired || selectedOption !== null;
  const answerSubmitted = selectedOption !== null || hasSubmittedText;

  return (
    <section className="card-soft overflow-hidden rounded-2xl" aria-busy={disabled} aria-labelledby="pk-exam-heading">
      <h2 id="pk-exam-heading" className="sr-only">{config.label}：{config.instruction}</h2>
      <header className="px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 text-xs font-semibold text-accent-warm sm:text-sm">
            <TypeIcon className="h-4 w-4" aria-hidden="true" />
            {config.label}
          </span>
          <span
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:text-sm ${
              timeIsUrgent
                ? 'bg-red-50 text-red-700'
                : timeIsLow
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-slate-100 text-ink-soft'
            }`}
            role="timer"
            aria-label={timeExpired ? '本题时间到' : `剩余 ${secondsLeft} 秒`}
          >
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-numeric">{secondsLeft}</span> 秒
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <motion.div
            className={`h-full w-full rounded-full ${timeIsUrgent ? 'bg-red-500' : timeIsLow ? 'bg-amber-500' : 'bg-accent-warm'}`}
            style={{ transformOrigin: 'left center' }}
            initial={false}
            animate={{ scaleX: timeProgress / 100 }}
            transition={{ duration: reduceMotion ? 0 : 0.25, ease: 'linear' }}
          />
        </div>
      </header>

      <div className="px-4 pb-5 pt-5 sm:px-6 sm:pb-6">
      <div className="mb-5 text-center">
        <p className="text-sm text-ink-mute">{config.instruction}</p>

        {isChoice && (
          <h2
            className={`font-display mt-3 break-words font-semibold leading-tight text-ink ${
              examType === 'en_to_cn' ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'
            }`}
          >
            {examType === 'en_to_cn' ? word.word : word.translation}
          </h2>
        )}

        {examType === 'listening' && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => void replay()}
              disabled={playCount >= 3 || isPlaying || disabled || offline || timeExpired}
              className="mx-auto inline-flex min-h-14 min-w-44 items-center justify-center gap-3 rounded-xl bg-accent-warm px-5 font-semibold text-white transition-colors hover:opacity-90 disabled:bg-slate-100 disabled:text-ink-mute"
              aria-describedby="pk-listening-count"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
                {isPlaying
                  ? <LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <Volume2 className="h-5 w-5" aria-hidden="true" />}
              </span>
              {isPlaying ? '正在加载发音' : playCount >= 3 ? '播放次数已用完' : '播放发音'}
            </button>
            <p id="pk-listening-count" className="mt-2 text-xs text-ink-mute">
              还可以播放 <span className="font-numeric font-semibold text-ink-soft">{Math.max(0, 3 - playCount)}</span> 次
            </p>
          </div>
        )}

        {examType === 'spelling' && (
          <div className="mt-3">
            <h2 className="font-display break-words text-2xl font-semibold text-ink sm:text-3xl">
              {word.translation}
            </h2>
            <p className="mt-2 text-sm text-ink-mute">
              首字母提示：
              <span className="ml-1 font-display font-semibold tracking-[0.12em] text-accent-warm">{spellingHint}</span>
            </p>
          </div>
        )}
      </div>

      {(offline || timeExpired) && !answerSubmitted && (
        <div className={`mb-4 flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm ${offline ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-ink-soft'}`} role="status">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{offline ? '实时连接暂时中断，恢复后可以继续作答。' : '本题时间到，正在等待下一题。'}</span>
        </div>
      )}

      {isChoice && (
        <fieldset disabled={choiceLocked}>
          <legend className="sr-only">{config.instruction}</legend>
          {options.length > 0 ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {options.map((option, index) => {
                const selected = selectedOption === option;
                return (
                  <motion.button
                    key={`${option}-${index}`}
                    type="button"
                    whileTap={reduceMotion || choiceLocked ? undefined : { scale: 0.985 }}
                    onClick={() => pick(option)}
                    disabled={choiceLocked}
                    aria-pressed={selected}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm font-semibold transition-colors sm:text-base ${
                      selected
                        ? 'border-accent-warm bg-orange-50 text-accent-warm'
                        : 'border-slate-200 bg-white text-ink hover:border-orange-300 hover:bg-orange-50/50'
                    } disabled:cursor-default ${choiceLocked && !selected ? 'disabled:opacity-60' : ''}`}
                  >
                    <span className={`font-numeric flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      selected ? 'bg-accent-warm text-white' : 'bg-slate-100 text-ink-soft'
                    }`}>
                      {String.fromCharCode(65 + index)}
                    </span>
                    <span className="min-w-0 flex-1 break-words">{option}</span>
                  </motion.button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              题目选项正在准备，请稍候。
            </div>
          )}
        </fieldset>
      )}

      {isInput && (
        <div>
          <label htmlFor={`pk-exam-answer-${word.id}`} className="sr-only">输入英文答案</label>
          <input
            {...imeSafeInputProps()}
            id={`pk-exam-answer-${word.id}`}
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && !event.nativeEvent.isComposing && submitText()}
            disabled={inputLocked}
            aria-describedby="pk-exam-input-help"
            className="allow-select h-14 w-full rounded-xl border border-slate-200 bg-white px-4 text-center font-display text-xl font-semibold tracking-[0.06em] text-ink outline-none transition focus:border-accent-warm focus:ring-4 focus:ring-orange-100 disabled:bg-slate-50 disabled:text-ink-mute sm:text-2xl"
            placeholder="输入英文单词"
          />
          <p id="pk-exam-input-help" className="mt-2 text-center text-xs text-ink-mute">输入完成后按回车或点击下方按钮提交</p>
          <button
            type="button"
            onClick={submitText}
            disabled={inputLocked || !text.trim()}
            className="btn-glow mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 font-semibold text-white disabled:border-transparent"
          >
            {hasSubmittedText || disabled ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                提交中…
              </>
            ) : timeExpired ? (
              '本题时间到'
            ) : offline ? (
              '等待连接恢复'
            ) : (
              <>
                提交答案
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      )}

      {answerSubmitted && (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm font-medium text-emerald-700" role="status" aria-live="polite">
          <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          答案已提交，正在准备下一题…
        </div>
      )}
      </div>
    </section>
  );
}
