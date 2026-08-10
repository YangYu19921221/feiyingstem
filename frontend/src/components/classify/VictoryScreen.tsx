/**
 * 通关结果页（全屏沉浸式）— 宠物主角版 + 变化层
 *
 * 舞台 = AI 生成的空舞台背景（不含任何角色）+ 学生自己宠物的立绘合成在舞台上。
 * 展示的是**最终进化形态**（getPetFinalStage）：哪怕孩子的宠物现在还是幼体，
 * 满分这一刻也让他看见最帅的样子——这是庆祝画面，不是养成状态页。
 *
 * 背景每档 3 套场景 × 竖版(-m，手机) / 横版(-w，PC)，按视口方向实时切换：
 *   横图铺在手机上会被裁掉大半构图，反之亦然，所以必须两套。
 *
 * 反审美疲劳的 4 条变量：
 *   1) 每档 3 套场景按 dayOfYear 轮换，一周内同档不重复
 *   2) 标题入场 4 种风格随机选（upward / shutter / typewriter / stamp）
 *   3) 数据带顺序随机置换
 *   4) 学生称号按 localStorage 累计本档通关次数选档
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ColoredWord from '../ColoredWord';
import { resolveImage } from '../../utils/webp';
import { getMyPet } from '../../api/pet';
import { getPetDefinition, getPetFinalStage } from '../../config/petSpecies';

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
  /** 场景 basename（不含 -m/-w 后缀与扩展名），运行时按视口方向补全 */
  scenes: string[];
  /** 舞台聚光/光环的主色，跟背景配色对齐 */
  spotlight: string;
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
    scenes: ['perfect-1', 'perfect-2', 'perfect-3'],
    spotlight: 'oklch(0.85 0.16 85)',
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
    scenes: ['great-1', 'great-2', 'great-3'],
    spotlight: 'oklch(0.82 0.14 220)',
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
    scenes: ['retry-1', 'retry-2', 'retry-3'],
    spotlight: 'oklch(0.78 0.10 250)',
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

/** 今天该用本档的哪套场景（按 dayOfYear 轮换，各档错开，一周内同档不重复） */
function pickScene(theme: Theme): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
  const tierHash = theme.key === 'perfect' ? 0 : theme.key === 'great' ? 1 : 2;
  return theme.scenes[(dayOfYear + tierHash * 2) % theme.scenes.length];
}

/** 竖屏（手机）用 -m，横屏（PC/平板横放）用 -w */
function isLandscape(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= window.innerHeight;
}

function sceneUrl(scene: string, landscape: boolean): string {
  return resolveImage(`/victory/${scene}-${landscape ? 'w' : 'm'}.webp`);
}

/** 监听视口方向：手机横竖屏翻转 / PC 拖窗口都要换图，否则构图被裁 */
function useLandscape(): boolean {
  const [landscape, setLandscape] = useState(isLandscape);
  useEffect(() => {
    const onResize = () => setLandscape(isLandscape());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return landscape;
}

type Intro = 'upward' | 'shutter' | 'typewriter' | 'stamp';
const INTROS: Intro[] = ['upward', 'shutter', 'typewriter', 'stamp'];
function randomIntro(): Intro {
  return INTROS[Math.floor(Math.random() * INTROS.length)];
}

// 4 种数据带排列；4 项独立，不重复
type ChipKind = 'correct' | 'score' | 'time';
const DATA_ORDERS: ChipKind[][] = [
  ['correct', 'score', 'time'],
  ['time', 'score', 'correct'],
  ['score', 'correct', 'time'],
  ['correct', 'time', 'score'],
];
function randomDataOrder(): ChipKind[] {
  return DATA_ORDERS[Math.floor(Math.random() * DATA_ORDERS.length)];
}

const TIER_TITLES: Record<TierKey, string[]> = {
  perfect: ['初露锋芒', '渐入佳境', '驾轻就熟', '所向披靡', '无人能挡'],
  great:   ['不错', '稳步前进', '越战越勇', '日臻成熟', '深得要领'],
  retry:   ['继续努力', '别灰心', '再来一遍', '坚持就赢', '收拾再战'],
};

// 累计次数 → 称号档位的阈值（升档点）
const TITLE_THRESHOLDS = [3, 6, 11, 21];

function readVictoryCount(tier: TierKey): number {
  try {
    return parseInt(localStorage.getItem(`victory_count_${tier}`) || '0', 10);
  } catch {
    return 0;
  }
}

function writeVictoryCount(tier: TierKey, n: number): void {
  try {
    localStorage.setItem(`victory_count_${tier}`, String(n));
  } catch {
    // ignore
  }
}

function pickTitle(count: number, tier: TierKey): string {
  const list = TIER_TITLES[tier];
  const idx = TITLE_THRESHOLDS.filter(t => count >= t).length;
  return list[Math.min(idx, list.length - 1)];
}

function IntroTitle({ text, intro, color, stroke }: {
  text: string; intro: Intro; color: string; stroke: string;
}) {
  const className = "font-display text-3xl md:text-5xl lg:text-6xl font-black tracking-[0.18em] flex justify-center flex-wrap";
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

/** 舞台上的宠物：立绘 + 聚光 + 光环 + 地面投影，登场带一个落地的重量感 */
function PetHero({ image, name, spotlight, isGem }: {
  image: string; name: string; spotlight: string; isGem: boolean;
}) {
  return (
    <div
      className="relative flex items-end justify-center pointer-events-none select-none
                 w-[min(72vw,44vh)] aspect-square max-w-[380px]"
    >
      {/* 舞台聚光柱：从宠物脚下往上散 */}
      <motion.div
        initial={{ opacity: 0, scaleY: 0.6 }}
        animate={{ opacity: 0.5, scaleY: 1 }}
        transition={{ delay: 0.45, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="absolute bottom-0 w-[95%] h-[145%] origin-bottom blur-2xl"
        style={{
          background: `radial-gradient(55% 60% at 50% 100%, ${spotlight} 0%, transparent 70%)`,
          mixBlendMode: 'screen',
        }}
      />
      {/* 背后光环：缓慢呼吸，让立绘从背景里"浮"出来 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: [0.55, 0.85, 0.55], scale: 1 }}
        transition={{
          opacity: { delay: 0.6, duration: 3.2, repeat: Infinity, ease: 'easeInOut' },
          scale: { delay: 0.5, duration: 0.8, ease: [0.16, 1, 0.3, 1] },
        }}
        className="absolute bottom-[10%] w-[78%] aspect-square rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, ${spotlight} 0%, transparent 68%)`,
          mixBlendMode: 'screen',
        }}
      />
      {/* 地面投影：给立绘一个落点，不然像飘在空中 */}
      <motion.div
        initial={{ opacity: 0, scaleX: 0.4 }}
        animate={{ opacity: 0.45, scaleX: 1 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="absolute bottom-[3%] w-[52%] h-[5%] rounded-[50%] blur-md bg-black/70"
      />
      <motion.img
        src={image}
        alt={name}
        decoding="async"
        initial={{ opacity: 0, y: -34, scale: 1.12 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.35, duration: 0.72, ease: [0.16, 1, 0.3, 1] }}
        className={`relative z-[1] w-full h-full object-contain ${
          isGem ? 'saturate-125 contrast-110' : ''
        }`}
        style={{
          filter: `drop-shadow(0 10px 26px rgba(0,0,0,0.55)) drop-shadow(0 0 22px ${spotlight})`,
        }}
      />
      {/* 宠物名牌：绝对定位贴在立绘底部，不占布局流（占流会把立绘顶离舞台） */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.05, duration: 0.5 }}
        className="absolute -bottom-1 z-[2] px-3 py-1 rounded-full whitespace-nowrap
                   text-[11px] md:text-xs text-white/95 tracking-[0.12em]
                   bg-black/45 border border-white/20 backdrop-blur-sm"
      >
        {name}
      </motion.div>
    </div>
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

  // theme 在组件生命周期内不变（score 是 props 一次性传入），直接派生
  const [scene] = useState(() => pickScene(theme));
  const landscape = useLandscape();
  const heroImage = sceneUrl(scene, landscape);

  // 学生自己的宠物：拿不到（没养宠物 / 请求失败）就只显示舞台，不阻塞结算页
  const { data: pet } = useQuery({
    queryKey: ['myPet'],
    queryFn: getMyPet,
    staleTime: 60_000,
    retry: 0,
  });
  const petFinal = pet ? getPetFinalStage(pet.species, pet.evolution_stage) : null;
  const petImage = petFinal?.image || null;
  const petLabel = pet
    ? `${pet.name} · ${petFinal?.name || getPetDefinition(pet.species).label}`
    : '';

  // 入场风格 / 数据顺序：组件挂载时一次性随机；用 useState 初始化避免 StrictMode 双调
  const [intro] = useState<Intro>(randomIntro);
  const [dataOrder] = useState<ChipKind[]>(randomDataOrder);

  // 称号：用本次通关 = 历史 +1 显示；副作用（写 storage）放 useEffect 里，
  // 避免 StrictMode 下 useState 初始化器双调用导致计数翻倍
  const [victoryCount] = useState<number>(() => readVictoryCount(theme.key) + 1);
  const learnerTitle = pickTitle(victoryCount, theme.key);
  useEffect(() => {
    writeVictoryCount(theme.key, victoryCount);
  }, [theme.key, victoryCount]);

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
          // 底部对齐：背景图里画出来的舞台圆盘都在下缘，贴底才能让宠物真的站在台上。
          // 用 center 会把圆盘推到画面外或半截，宠物看着像飘在空中。
          backgroundPosition: 'center bottom',
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

      <div className="relative z-10 min-h-full flex flex-col px-5 py-8 md:py-12 max-w-4xl mx-auto w-full">
        <div className="text-center mt-2">
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

        {/* 舞台上的主角：学生自己的宠物（最终进化形态）。
            flex-1 吃掉标题与数据带之间的余量，屏幕越高宠物越大；
            宠物名做成绝对定位的浮层（不占流），否则会把立绘从舞台上顶起来；
            没养宠物时这块塌成弹性空白，版面照旧成立。 */}
        <div className="flex-1 min-h-0 flex items-end justify-center">
          {petImage && (
            <PetHero
              image={petImage}
              name={petLabel}
              spotlight={theme.spotlight}
              isGem={Boolean(petFinal?.isGem)}
            />
          )}
        </div>

        <div>
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-[1fr_auto_1fr_auto_1fr] gap-2 md:gap-4 items-end mt-3 mb-4"
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
            className="text-center text-white/80 text-xs md:text-sm mb-4"
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
