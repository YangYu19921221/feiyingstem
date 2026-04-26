/**
 * 通关结果页（全屏沉浸式），三档统一布局：
 * - perfect (100): 金黄日落 + 奖杯 + 旋转阳光
 * - great (80-99): 天空蓝 + 星星
 * - retry (<80): 柔和橙红 + 加油拳头
 *
 * 替代 GroupExamPhase 老的白底卡片结果页 + ChallengeVictory 三幕动画。
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

interface Theme {
  emoji: string;
  title: string;
  subtitle: string;
  bgGradient: string;
  ringColor: string;
  textGradient: string;
  buttonGradient: string;
  particleColor: string;
  glow: string;
}

const THEMES = {
  perfect: {
    emoji: '🏆',
    title: 'PERFECT VICTORY',
    subtitle: '满分通关 · 完美无瑕',
    bgGradient: 'radial-gradient(ellipse at top, #FFE5B4 0%, #FFD23F 30%, #FF6B35 80%, #C44A1A 100%)',
    ringColor: '#FFD23F',
    textGradient: 'linear-gradient(180deg, #FFFFFF 0%, #FFEB99 40%, #FFD23F 70%, #FF6B35 100%)',
    buttonGradient: 'linear-gradient(135deg, #FF6B35 0%, #FFD23F 100%)',
    particleColor: '#FFD23F',
    glow: 'drop-shadow(0 0 30px #FFD23F) drop-shadow(0 0 60px #FF6B35)',
  } as Theme,
  great: {
    emoji: '🌟',
    title: 'GREAT WORK',
    subtitle: '表现出色 · 继续加油',
    bgGradient: 'radial-gradient(ellipse at top, #E0F7FF 0%, #00D9FF 50%, #0096C7 100%)',
    ringColor: '#00D9FF',
    textGradient: 'linear-gradient(180deg, #FFFFFF 0%, #E0F7FF 50%, #00D9FF 100%)',
    buttonGradient: 'linear-gradient(135deg, #00D9FF 0%, #0096C7 100%)',
    particleColor: '#00D9FF',
    glow: 'drop-shadow(0 0 24px #00D9FF) drop-shadow(0 0 48px #0096C7)',
  } as Theme,
  retry: {
    emoji: '💪',
    title: 'KEEP GOING',
    subtitle: '再来一次 · 你能行',
    bgGradient: 'radial-gradient(ellipse at top, #FFE0D6 0%, #FF8A65 50%, #D84315 100%)',
    ringColor: '#FF8A65',
    textGradient: 'linear-gradient(180deg, #FFFFFF 0%, #FFE0D6 50%, #FF8A65 100%)',
    buttonGradient: 'linear-gradient(135deg, #FF8A65 0%, #D84315 100%)',
    particleColor: '#FF8A65',
    glow: 'drop-shadow(0 0 20px #FF8A65)',
  } as Theme,
};

function pickTheme(score: number): Theme {
  if (score === 100) return THEMES.perfect;
  if (score >= 80) return THEMES.great;
  return THEMES.retry;
}

/** 18 道阳光辐射条（仅 perfect 用） */
function SunRays({ color }: { color: string }) {
  const rays = useMemo(() => Array.from({ length: 18 }, (_, i) => i * 20), []);
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      animate={{ rotate: 360 }}
      transition={{ duration: 60, ease: 'linear', repeat: Infinity }}
    >
      <svg width="200%" height="200%" viewBox="-100 -100 200 200" className="absolute opacity-30">
        {rays.map(deg => (
          <rect
            key={deg}
            x="-1.5"
            y="-100"
            width="3"
            height="200"
            fill={color}
            transform={`rotate(${deg})`}
          />
        ))}
      </svg>
    </motion.div>
  );
}

/** 中心爆炸礼花（挂载瞬间一次） */
function ConfettiBurst({ colors, count = 80 }: { colors: string[]; count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
        const distance = 200 + Math.random() * 380;
        return {
          id: i,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          size: 6 + Math.random() * 10,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotate: Math.random() * 720 - 360,
          delay: Math.random() * 0.15,
          duration: 1.4 + Math.random() * 0.8,
          shape: ['square', 'circle', 'star'][Math.floor(Math.random() * 3)] as 'square' | 'circle' | 'star',
        };
      }),
    [colors, count],
  );
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none flex items-center justify-center">
      {pieces.map(p => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, scale: 0, opacity: 1, rotate: 0 }}
          animate={{
            x: p.x,
            y: p.y + 200,
            scale: [0, 1.2, 1, 0.8],
            opacity: [1, 1, 1, 0],
            rotate: p.rotate,
          }}
          transition={{ duration: p.duration, delay: p.delay, ease: [0.16, 0.84, 0.44, 1] }}
          className="absolute select-none font-black flex items-center justify-center"
          style={{
            width: p.size,
            height: p.size,
            color: p.color,
            background: p.shape !== 'star' ? p.color : 'transparent',
            borderRadius: p.shape === 'circle' ? '50%' : p.shape === 'square' ? '2px' : 0,
            fontSize: p.size * 1.6,
            lineHeight: 1,
            boxShadow: p.shape !== 'star' ? `0 0 ${p.size}px ${p.color}` : 'none',
            filter: p.shape === 'star' ? `drop-shadow(0 0 ${p.size}px ${p.color})` : undefined,
          }}
        >
          {p.shape === 'star' ? '★' : ''}
        </motion.div>
      ))}
    </div>
  );
}

/** 闪电环（仅满分） */
function LightningRing({ color }: { color: string }) {
  const bolts = useMemo(() => Array.from({ length: 8 }, (_, i) => i * 45), []);
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {bolts.map((deg, i) => (
        <motion.div
          key={deg}
          className="absolute"
          style={{
            width: 4,
            height: '60vh',
            background: `linear-gradient(180deg, transparent 0%, ${color} 50%, transparent 100%)`,
            transformOrigin: 'center',
            transform: `rotate(${deg}deg)`,
            filter: `drop-shadow(0 0 12px ${color})`,
          }}
          animate={{ opacity: [0, 1, 0], scaleY: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, delay: i * 0.12, repeat: Infinity, repeatDelay: 2 }}
        />
      ))}
    </div>
  );
}

/** 全屏闪白（挂载瞬间一次） */
function FlashOverlay() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.85, 0] }}
      transition={{ duration: 0.5, times: [0, 0.15, 1] }}
      className="absolute inset-0 bg-white pointer-events-none z-20"
    />
  );
}

/** 漂浮粒子背景 */
function FloatingParticles({ color, count = 30 }: { color: string; count?: number }) {
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        startY: 100 + Math.random() * 20,
        size: 6 + Math.random() * 14,
        delay: Math.random() * 6,
        duration: 6 + Math.random() * 6,
        symbol: ['✦', '★', '◆', '·', '✧'][Math.floor(Math.random() * 5)],
      })),
    [count],
  );
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => (
        <motion.span
          key={p.id}
          className="absolute select-none font-bold"
          style={{
            left: `${p.x}%`,
            top: `${p.startY}%`,
            fontSize: p.size,
            color,
            filter: `drop-shadow(0 0 ${p.size}px ${color})`,
          }}
          animate={{
            y: ['0vh', '-120vh'],
            opacity: [0, 1, 1, 0],
            rotate: [0, 360],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'linear',
            times: [0, 0.1, 0.9, 1],
          }}
        >
          {p.symbol}
        </motion.span>
      ))}
    </div>
  );
}

export default function VictoryScreen({
  score, correctCount, totalQuestions, elapsedSeconds, wrongAnswers,
  onPass, onRetry, onRelearn,
}: Props) {
  const theme = pickTheme(score);
  const passed = score >= 80;
  const isPerfect = score === 100;
  const [showWrongList, setShowWrongList] = useState(false);
  const [animatedScore, setAnimatedScore] = useState(0);

  // 分数从 0 滚到 score（1.5s）
  useEffect(() => {
    const duration = 1500;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      setAnimatedScore(Math.round(score * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timeText = minutes > 0 ? `${minutes}'${String(seconds).padStart(2, '0')}"` : `${seconds}s`;

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col overflow-hidden"
      style={{ background: theme.bgGradient }}
    >
      {/* 旋转阳光（仅满分） */}
      {isPerfect && <SunRays color="#FFFFFF" />}
      {isPerfect && <LightningRing color="#FFD23F" />}

      {/* 入场闪白 */}
      <FlashOverlay />

      {/* 中心礼花爆炸 */}
      <ConfettiBurst
        colors={
          isPerfect
            ? ['#FFD23F', '#FF6B35', '#FFFFFF', '#FFEB99']
            : passed
              ? ['#00D9FF', '#FFFFFF', '#5FD35F', '#FFD23F']
              : ['#FF8A65', '#FFD23F', '#FFFFFF']
        }
        count={isPerfect ? 100 : 70}
      />

      {/* 漂浮粒子 */}
      <FloatingParticles color={theme.particleColor} count={isPerfect ? 40 : 25} />

      {/* 内容容器 */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-8 max-w-xl mx-auto w-full">

        {/* 主 emoji */}
        <motion.div
          initial={{ scale: 0, y: -200, rotate: -30 }}
          animate={{ scale: 1, y: 0, rotate: 0 }}
          transition={{ type: 'spring', damping: 12, stiffness: 140, delay: 0.1 }}
          className="mb-2"
        >
          <motion.div
            animate={{ y: [0, -16, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            style={{ filter: theme.glow, fontSize: 'clamp(120px, 30vh, 240px)', lineHeight: 1 }}
          >
            {theme.emoji}
          </motion.div>
        </motion.div>

        {/* 标题 */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="text-3xl md:text-4xl font-black text-white tracking-widest mb-1"
          style={{
            textShadow: `0 4px 20px rgba(0,0,0,0.3), 0 2px 4px ${theme.ringColor}66`,
          }}
        >
          {theme.title}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-white/90 text-base md:text-lg mb-2"
        >
          {theme.subtitle}
        </motion.p>

        {/* 巨型分数 */}
        <motion.div
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.9, type: 'spring', stiffness: 180, damping: 14 }}
          className="relative my-2"
        >
          <div
            className="font-black tracking-tighter leading-none"
            style={{
              fontSize: 'clamp(140px, 28vh, 280px)',
              background: theme.textGradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              WebkitTextStroke: `2px rgba(255,255,255,0.5)`,
              filter: `drop-shadow(0 6px 20px rgba(0,0,0,0.25))`,
            }}
          >
            {animatedScore}
          </div>
          <div
            className="absolute -right-4 -top-2 text-3xl font-black text-white/80"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
          >
            分
          </div>
        </motion.div>

        {/* 数据三联 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2 }}
          className="grid grid-cols-3 gap-3 w-full max-w-md mb-6"
        >
          <div className="rounded-2xl px-3 py-3 text-center bg-white/15 backdrop-blur-md border border-white/30">
            <div className="text-2xl md:text-3xl font-black text-white">
              {correctCount}<span className="text-base text-white/70">/{totalQuestions}</span>
            </div>
            <div className="text-xs text-white/80 mt-0.5">✅ 答对</div>
          </div>
          <div className="rounded-2xl px-3 py-3 text-center bg-white/15 backdrop-blur-md border border-white/30">
            <div className="text-2xl md:text-3xl font-black text-white">{timeText}</div>
            <div className="text-xs text-white/80 mt-0.5">⏱️ 用时</div>
          </div>
          <div className="rounded-2xl px-3 py-3 text-center bg-white/15 backdrop-blur-md border border-white/30">
            <div className="text-2xl md:text-3xl font-black text-white">{Math.round((correctCount / totalQuestions) * 100)}<span className="text-base">%</span></div>
            <div className="text-xs text-white/80 mt-0.5">🎯 正确率</div>
          </div>
        </motion.div>

        {/* 错题区（折叠，仅有错时显示） */}
        {wrongAnswers.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4 }}
            className="w-full max-w-md mb-5"
          >
            <button
              onClick={() => setShowWrongList(v => !v)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/15 backdrop-blur-md border border-white/30 text-white text-sm font-medium flex items-center justify-between hover:bg-white/20 transition"
            >
              <span>📝 错题回顾（{wrongAnswers.length} 题）</span>
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
                        <span className="text-red-400 shrink-0">✗</span>
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

        {/* 按钮区 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.6 }}
          className="w-full max-w-md flex flex-col gap-3"
        >
          {passed ? (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              animate={{ boxShadow: [
                `0 8px 32px ${theme.ringColor}80`,
                `0 8px 48px ${theme.ringColor}cc`,
                `0 8px 32px ${theme.ringColor}80`,
              ] }}
              transition={{ boxShadow: { duration: 2, repeat: Infinity } }}
              onClick={onPass}
              className="w-full py-4 rounded-2xl text-lg md:text-xl font-bold text-white"
              style={{ background: theme.buttonGradient }}
            >
              继续下一组 →
            </motion.button>
          ) : (
            <>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onRetry}
                className="w-full py-4 rounded-2xl text-lg font-bold text-white shadow-2xl"
                style={{ background: theme.buttonGradient }}
              >
                🔄 重新检测
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={onRelearn}
                className="w-full py-3 rounded-2xl text-base font-medium text-white bg-white/20 backdrop-blur-md border border-white/30"
              >
                重学本组
              </motion.button>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
