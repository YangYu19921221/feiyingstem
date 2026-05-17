/**
 * 通关结果页（全屏沉浸式）— 立绘版 + 变化层
 *
 * 反审美疲劳的 4 条变量：
 *   1) 每档 3 张立绘按 dayOfYear 轮换，一周内同档不重复
 *   2) 标题入场 4 种风格随机选（upward / shutter / typewriter / stamp）
 *   3) 数据带顺序随机置换
 *   4) 学生称号按 localStorage 累计本档通关次数选档
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import ColoredWord from '../ColoredWord';

export interface WrongAnswer {
  id: number;
  word: string;
  syllables?: string | null;
  correctAnswer: string;
  userAnswer: string;
}

interface Props {
  score: number;
  correctCount: number;
  totalQuestions: number;
  elapsedSeconds: number;
  wrongAnswers: WrongAnswer[];
  onPass: () => void;
  onRetry: () => void;
  onRelearn: () => void;
}

type TierKey = 'perfect' | 'great' | 'retry';

interface Theme {
  key: TierKey;
  title: string;
  subtitle: string;
  images: string[];
  topVeil: string;
  bottomVeil: string;
  titleColor: string;
  titleStroke: string;
  accent: string;
  accentHover: string;
  chipBg: string;
  chipText: string;
}

const THEMES: Record<TierKey, Theme> = {
  perfect: {
    key: 'perfect',
    title: 'PERFECT VICTORY',
    subtitle: '满分通关 · 完美无瑕',
    images: ['/victory/perfect-1.webp', '/victory/perfect-2.webp', '/victory/perfect-3.webp'],
    topVeil: 'linear-gradient(to bottom, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.15) 35%, transparent 60%)',
    bottomVeil: 'linear-gradient(to top, rgba(40,15,0,0.55) 0%, rgba(40,15,0,0.2) 40%, transparent 70%)',
    titleColor: 'oklch(0.98 0.02 80)',
    titleStroke: 'oklch(0.35 0.13 50 / 0.5)',
    accent: 'oklch(0.66 0.18 55)',
    accentHover: 'oklch(0.72 0.17 55)',
    chipBg: 'oklch(0.18 0.05 50 / 0.55)',
    chipText: 'oklch(0.98 0.02 80)',
  },
  great: {
    key: 'great',
    title: 'GREAT WORK',
    subtitle: '表现出色 · 继续加油',
    images: ['/victory/great-1.webp', '/victory/great-2.webp', '/victory/great-3.webp'],
    topVeil: 'linear-gradient(to bottom, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.10) 35%, transparent 60%)',
    bottomVeil: 'linear-gradient(to top, rgba(20,30,55,0.5) 0%, rgba(20,30,55,0.18) 40%, transparent 70%)',
    titleColor: 'oklch(0.98 0.02 80)',
    titleStroke: 'oklch(0.30 0.10 240 / 0.5)',
    accent: 'oklch(0.66 0.18 55)',
    accentHover: 'oklch(0.72 0.17 55)',
    chipBg: 'oklch(0.20 0.04 240 / 0.55)',
    chipText: 'oklch(0.98 0.02 80)',
  },
  retry: {
    key: 'retry',
    title: 'KEEP GOING',
    subtitle: '再来一次 · 你能行',
    images: ['/victory/retry-1.webp', '/victory/retry-2.webp', '/victory/retry-3.webp'],
    topVeil: 'linear-gradient(to bottom, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.10) 35%, transparent 60%)',
    bottomVeil: 'linear-gradient(to top, rgba(25,30,45,0.55) 0%, rgba(25,30,45,0.22) 40%, transparent 70%)',
    titleColor: 'oklch(0.98 0.02 80)',
    titleStroke: 'oklch(0.30 0.08 250 / 0.55)',
    accent: 'oklch(0.66 0.18 55)',
    accentHover: 'oklch(0.72 0.17 55)',
    chipBg: 'oklch(0.20 0.03 245 / 0.55)',
    chipText: 'oklch(0.98 0.02 80)',
  },
};

function pickTheme(score: number): Theme {
  if (score === 100) return THEMES.perfect;
  if (score >= 80) return THEMES.great;
  return THEMES.retry;
}

function pickImage(theme: Theme): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
  const tierHash = theme.key === 'perfect' ? 0 : theme.key === 'great' ? 1 : 2;
  const idx = (dayOfYear + tierHash * 2) % theme.images.length;
  return theme.images[idx];
}

type Intro = 'upward' | 'shutter' | 'typewriter' | 'stamp';
const INTROS: Intro[] = ['upward', 'shutter', 'typewriter', 'stamp'];
function pickIntro(seed: number): Intro {
  return INTROS[seed % INTROS.length];
}

const TIER_TITLES: Record<TierKey, string[]> = {
  perfect: ['初露锋芒', '渐入佳境', '驾轻就熟', '所向披靡', '无人能挡'],
  great:   ['不错', '稳步前进', '越战越勇', '日臻成熟', '深得要领'],
  retry:   ['继续努力', '别灰心', '再来一遍', '坚持就赢', '收拾再战'],
};

function bumpAndPickTitle(tier: TierKey): string {
  const key = `victory_count_${tier}`;
  let n = 1;
  try {
    n = parseInt(localStorage.getItem(key) || '0', 10) + 1;
    localStorage.setItem(key, String(n));
  } catch {
    n = 1;
  }
  const list = TIER_TITLES[tier];
  let idx = 0;
  if (n >= 21) idx = 4;
  else if (n >= 11) idx = 3;
  else if (n >= 6) idx = 2;
  else if (n >= 3) idx = 1;
  return list[Math.min(idx, list.length - 1)];
}

function IntroTitle({ text, intro, color, stroke }: {
  text: string; intro: Intro; color: string; stroke: string;
}) {
  const className = "font-display text-3xl md:text-5xl font-black tracking-[0.18em] flex justify-center flex-wrap";
  const baseStyle: React.CSSProperties = {
    color,
    textShadow: `0 2px 0 ${stroke}, 0 4px 24px rgba(0,0,0,0.35)`,
  };

  if (intro === 'stamp') {
    return (
      <motion.h1
        initial={{ y: -120, opacity: 0, scale: 1.4 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className={className}
        style={baseStyle}
      >
        {text}
      </motion.h1>
    );
  }

  if (intro === 'shutter') {
    return (
      <motion.h1
        initial={{ clipPath: 'inset(0 50% 0 50%)', opacity: 0 }}
        animate={{ clipPath: 'inset(0 0% 0 0%)', opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className={className}
        style={baseStyle}
      >
        {text}
      </motion.h1>
    );
  }

  if (intro === 'typewriter') {
    return (
      <h1 className={className} style={baseStyle}>
        {text.split('').map((ch, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.05, delay: 0.3 + i * 0.06 }}
            className={ch === ' ' ? 'inline-block w-3' : 'inline-block'}
          >
            {ch === ' ' ? ' ' : ch}
          </motion.span>
        ))}
      </h1>
    );
  }

  return (
    <h1 className={className} style={baseStyle}>
      {text.split('').map((ch, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.45 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
          className={ch === ' ' ? 'inline-block w-3' : 'inline-block'}
        >
          {ch === ' ' ? ' ' : ch}
        </motion.span>
      ))}
    </h1>
  );
}

export default function VictoryScreen({
  score, correctCount, totalQuestions, elapsedSeconds, wrongAnswers,
  onPass, onRetry, onRelearn,
}: Props) {
  const theme = pickTheme(score);
  const passed = score >= 80;
  const [showWrongList, setShowWrongList] = useState(false);
  const [animatedScore, setAnimatedScore] = useState(0);

  const heroImage = useMemo(() => pickImage(theme), [theme.key]);
  const intro = useMemo(() => pickIntro(Math.floor(Math.random() * 100)), []);
  const learnerTitle = useMemo(() => bumpAndPickTitle(theme.key), [theme.key]);

  const dataOrder = useMemo<('correct' | 'score' | 'time')[]>(() => {
    const orders: ('correct' | 'score' | 'time')[][] = [
      ['correct', 'score', 'time'],
      ['time', 'score', 'correct'],
      ['correct', 'score', 'time'],
      ['score', 'correct', 'time'],
    ];
    return orders[Math.floor(Math.random() * orders.length)];
  }, []);

  useEffect(() => {
    const duration = 1200;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setAnimatedScore(Math.round(score * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const safety = setTimeout(() => setAnimatedScore(score), duration + 400);
    return () => { cancelAnimationFrame(raf); clearTimeout(safety); };
  }, [score]);

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timeText = minutes > 0 ? `${minutes}'${String(seconds).padStart(2, '0')}"` : `${seconds}s`;
  const accuracy = Math.round((correctCount / Math.max(totalQuestions, 1)) * 100);

  const renderChip = (kind: 'correct' | 'score' | 'time') => {
    if (kind === 'correct') {
      return (
        <div className="text-center">
          <div
            className="font-numeric font-black text-3xl md:text-5xl leading-none"
            style={{ color: theme.titleColor, textShadow: `0 2px 0 ${theme.titleStroke}, 0 4px 18px rgba(0,0,0,0.4)` }}
          >
            {correctCount}<span className="text-base md:text-2xl opacity-70">/{totalQuestions}</span>
          </div>
          <div className="text-[10px] md:text-xs text-white/80 tracking-[0.2em] mt-1">⚔ 答对</div>
        </div>
      );
    }
    if (kind === 'time') {
      return (
        <div className="text-center">
          <div
            className="font-numeric font-black text-3xl md:text-5xl leading-none"
            style={{ color: theme.titleColor, textShadow: `0 2px 0 ${theme.titleStroke}, 0 4px 18px rgba(0,0,0,0.4)` }}
          >
            {timeText}
          </div>
          <div className="text-[10px] md:text-xs text-white/80 tracking-[0.2em] mt-1">⏱ 用时</div>
        </div>
      );
    }
    return (
      <div className="text-center">
        <div
          className="font-numeric font-black text-5xl md:text-7xl leading-none"
          style={{ color: theme.titleColor, textShadow: `0 3px 0 ${theme.titleStroke}, 0 6px 28px rgba(0,0,0,0.45)` }}
        >
          {animatedScore}
          <span className="text-lg md:text-3xl opacity-70 ml-1">分</span>
        </div>
        <div className="text-[10px] md:text-xs text-white/80 tracking-[0.2em] mt-1">★ 本组得分</div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black">
      <motion.div
        key={heroImage}
        initial={{ scale: 1.06, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${heroImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="absolute inset-x-0 top-0 h-1/2 pointer-events-none" style={{ background: theme.topVeil }} />
      <div className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none" style={{ background: theme.bottomVeil }} />

      <button
        onClick={passed ? onPass : onRelearn}
        aria-label="关闭"
        className="fixed top-3 right-3 z-50 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur text-white text-xl font-bold flex items-center justify-center border border-white/30"
      >
        ✕
      </button>

      <div className="relative z-10 min-h-full flex flex-col px-5 py-8 md:py-12 max-w-2xl mx-auto w-full">
        <div className="text-center mt-2 mb-auto">
          <motion.p
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
            className="text-white/80 text-xs md:text-sm tracking-[0.3em] mb-3"
          >
            ◆ CLEAR ◆
          </motion.p>
          <IntroTitle text={theme.title} intro={intro} color={theme.titleColor} stroke={theme.titleStroke} />
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.0, duration: 0.6 }}
            className="text-white/85 text-sm md:text-base mt-3"
          >
            {theme.subtitle}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1.3, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="inline-block mt-4 px-4 py-1.5 rounded-full text-xs md:text-sm font-medium tracking-[0.15em]"
            style={{
              background: theme.chipBg,
              color: theme.chipText,
              border: '1px solid rgba(255,255,255,0.2)',
              backdropFilter: 'blur(6px)',
            }}
          >
            ⊹ {learnerTitle}
          </motion.div>
        </div>

        <div className="mt-8">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-[1fr_auto_1fr_auto_1fr] gap-2 md:gap-4 items-end mb-5"
          >
            {renderChip(dataOrder[0])}
            <div className="w-px h-10 md:h-14 bg-white/25 self-center" />
            {renderChip(dataOrder[1])}
            <div className="w-px h-10 md:h-14 bg-white/25 self-center" />
            {renderChip(dataOrder[2])}
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4, duration: 0.5 }}
            className="text-center text-white/80 text-xs md:text-sm mb-5"
          >
            正确率 <span className="font-numeric font-semibold text-white">{accuracy}%</span>
          </motion.div>

          {wrongAnswers.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5, duration: 0.5 }}
              className="mb-4"
            >
              <button
                onClick={() => setShowWrongList(v => !v)}
                className="w-full px-4 py-2.5 rounded-xl text-white text-sm font-medium flex items-center justify-between transition"
                style={{ background: theme.chipBg, backdropFilter: 'blur(6px)' }}
              >
                <span>错题回顾（{wrongAnswers.length} 题）</span>
                <span className="opacity-70">{showWrongList ? '▲' : '▼'}</span>
              </button>
              <AnimatePresence>
                {showWrongList && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-2 overflow-hidden"
                  >
                    <div className="rounded-xl bg-white/95 px-3 py-2 max-h-44 overflow-y-auto space-y-1.5">
                      {wrongAnswers.map(w => (
                        <div key={w.id} className="flex items-center gap-2 py-1 border-b border-gray-100 last:border-0 text-sm">
                          <span className="text-red-500 shrink-0">✗</span>
                          <ColoredWord word={w.word} syllables={w.syllables} className="font-medium text-sm" />
                          <span className="text-gray-400">→</span>
                          <span className="text-green-600">{w.correctAnswer}</span>
                          {w.userAnswer && (
                            <span className="text-red-400 text-xs ml-auto truncate">你答: {w.userAnswer}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.55, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-3"
          >
            {passed ? (
              <button
                onClick={onPass}
                className="w-full py-4 rounded-2xl text-base md:text-lg font-bold text-white transition"
                style={{
                  background: theme.accent,
                  boxShadow: `0 8px 32px ${theme.accent}80, inset 0 1px 0 rgba(255,255,255,0.25)`,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = theme.accentHover; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = theme.accent; }}
              >
                继续下一组 →
              </button>
            ) : (
              <>
                <button
                  onClick={onRetry}
                  className="w-full py-4 rounded-2xl text-base md:text-lg font-bold text-white transition"
                  style={{
                    background: theme.accent,
                    boxShadow: `0 8px 32px ${theme.accent}80, inset 0 1px 0 rgba(255,255,255,0.25)`,
                  }}
                >
                  重新检测
                </button>
                <button
                  onClick={onRelearn}
                  className="w-full py-3 rounded-2xl text-base font-medium text-white border border-white/30 hover:bg-white/10 transition"
                  style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(6px)' }}
                >
                  重学本组
                </button>
              </>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
