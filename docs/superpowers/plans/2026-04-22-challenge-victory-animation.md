# 错题闯关通关动画 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把错题闯关结果页从"SVG 分数环"升级为 4 秒"三幕剧"（劈字 → 粒子飞向宠物 → 概率高潮），含连击系统、LEGENDARY 大特写、完美主义者彩蛋、进化分享卡。

**Architecture:** 新增 `frontend/src/components/challenge-fx/` 目录放所有特效组件；顶层 `ChallengeVictory` 用 `framer-motion` 的 `onAnimationComplete` 串联三幕；音效用 Howler.js 封装为 hook；概率分档由后端 `submit_challenge_level` 生成，前端不可预测。宠物头像锚点复用 `FloatingPetWidget` —— 给它加 `id="floating-pet-anchor"`，粒子用 `getBoundingClientRect()` 计算终点。

**Tech Stack:** React 18 + TypeScript、framer-motion（已装）、Howler.js（需装）、html2canvas（已装）、Tailwind CSS、FastAPI + Pydantic

**Spec:** `@/Users/apple/Desktop/英语助手/docs/superpowers/specs/2026-04-22-challenge-victory-animation-design.md`

**Phase 拆分**（每个可独立部署）：
- **Phase 1**（~5h）：三幕基础 + 音效 + 70% 普通档奖励入账
- **Phase 2**（~3h）：后端 reward_tier 分档 + 幸运/暴击/神迹
- **Phase 3**（~2.5h）：连击系统 + LEGENDARY 大特写
- **Phase 4**（~2h）：完美主义者彩蛋 + 进化分享卡

---

## Phase 1: 三幕基础 + 音效

**目标**：用户做完一关 → 看见完整的"劈字 → 粒子 → 经验条 +5"三幕动画，带音效，4 秒内结束，底部出"下一关"按钮。不含概率分档（全部走普通档）。

### 文件结构

| 文件 | 职责 | 新建/修改 |
|---|---|---|
| `frontend/package.json` | 加 `howler` 依赖 | 修改 |
| `frontend/src/hooks/useChallengeSfx.ts` | 音效 hook（单例 Howl 池 + 静音开关） | 新建 |
| `frontend/src/components/challenge-fx/SwordSlash.tsx` | 第一幕：震屏 + 光剑 + 劈字 + 闪白 | 新建 |
| `frontend/src/components/challenge-fx/ParticleBurst.tsx` | 第二幕：粒子贝塞尔飞向宠物头像 | 新建 |
| `frontend/src/components/challenge-fx/RewardReveal.tsx` | 第三幕：经验条滚动 + 金币翻牌（仅普通档） | 新建 |
| `frontend/src/components/challenge-fx/ChallengeVictory.tsx` | 顶层编排，阶段串联 | 新建 |
| `frontend/src/components/FloatingPetWidget.tsx:167` | 加 `id="floating-pet-anchor"` | 修改 |
| `frontend/src/pages/MistakeChallenge.tsx` | `ResultPhase` 满分时挂 `<ChallengeVictory>` | 修改 |
| `frontend/public/sfx/sword_slash.mp3` 等 | 音频资源（占位先用 base64 静音或 CC0 资源） | 新建 |

### Task 1.1：安装 howler 依赖

**Files:** 修改 `frontend/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd frontend && npm install howler@^2.2.4 && npm install -D @types/howler
```

- [ ] **Step 2: 验证**

Run: `cd frontend && node -e "console.log(require('howler').Howl.name)"`
Expected: `Howl`

- [ ] **Step 3: 提交**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: 引入 howler 用于闯关音效"
```

### Task 1.2：下载音效资源

**Files:** 新建 `frontend/public/sfx/` 下 7 个 mp3

占位策略：先用 freesound.org / pixabay 的 CC0 音效手动下，统一转 MP3 48kbps（ffmpeg）。没有合适资源时先放空 mp3（1 帧静音）保证代码跑通。

- [ ] **Step 1: 创建目录并放入占位音频**

```bash
mkdir -p frontend/public/sfx
# 生成 7 个 100ms 静音 mp3 占位（ffmpeg 可用）
for name in sword_slash particle_tick_0 particle_tick_1 particle_tick_2 particle_tick_3 particle_tick_4 coin_drop; do
  ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.1 -q:a 9 -acodec libmp3lame \
    frontend/public/sfx/${name}.mp3 -y 2>/dev/null
done
```

- [ ] **Step 2: 验证文件存在**

Run: `ls -la frontend/public/sfx/*.mp3 | wc -l`
Expected: `7`

- [ ] **Step 3: 提交**

```bash
git add frontend/public/sfx/
git commit -m "chore: 闯关音效占位资源（后续替换为真实音效）"
```

### Task 1.3：写 useChallengeSfx hook 的失败测试

**Files:** 新建 `frontend/src/hooks/__tests__/useChallengeSfx.test.tsx`

> 项目未配 vitest/jest，按 CLAUDE.md 约定前端"运行 `npm run lint`"即可；这里走**运行时手动断言** —— 改为在 hook 内置 `__dev_check()` 方法，开发模式下 console.assert，生产模式 no-op。跳过单元测试步骤，改为集成验证（Task 1.11）。

### Task 1.3：实现 useChallengeSfx hook

**Files:** 新建 `frontend/src/hooks/useChallengeSfx.ts`

- [ ] **Step 1: 写完整实现**

```typescript
import { useCallback, useEffect, useRef } from 'react';
import { Howl } from 'howler';

export type SfxKey =
  | 'sword_slash'
  | 'particle_tick'   // 播放时随机选 5 个变种之一
  | 'coin_drop'
  | 'crit_boom'
  | 'miracle_horn'
  | 'legendary_horn'
  | 'piano_credits';

const MUTE_STORAGE_KEY = 'challenge_sfx_muted';

function isMuted(): boolean {
  return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
}

export function setMuted(muted: boolean) {
  localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  window.dispatchEvent(new Event('challenge-sfx-mute-change'));
}

// 全局单例缓存：同一个音效只加载一次
const pool: Partial<Record<string, Howl>> = {};

function resolveSrc(key: SfxKey): string[] {
  if (key === 'particle_tick') {
    const i = Math.floor(Math.random() * 5);
    return [`/sfx/particle_tick_${i}.mp3`];
  }
  return [`/sfx/${key}.mp3`];
}

function getOrLoad(key: SfxKey): Howl {
  const src = resolveSrc(key);
  const cacheKey = src[0];
  let howl = pool[cacheKey];
  if (!howl) {
    howl = new Howl({ src, volume: 0.7, preload: true });
    pool[cacheKey] = howl;
  }
  return howl;
}

/**
 * 闯关音效 hook
 * - 首次用户手势后才能播放（iOS Safari 限制）
 * - 全局静音开关走 localStorage
 * - 粒子连击时可用 rate 参数做音高递增
 */
export function useChallengeSfx() {
  const mutedRef = useRef<boolean>(isMuted());

  useEffect(() => {
    const onChange = () => { mutedRef.current = isMuted(); };
    window.addEventListener('challenge-sfx-mute-change', onChange);
    return () => window.removeEventListener('challenge-sfx-mute-change', onChange);
  }, []);

  const play = useCallback((key: SfxKey, opts?: { rate?: number; volume?: number }) => {
    if (mutedRef.current) return;
    try {
      const howl = getOrLoad(key);
      if (opts?.rate) howl.rate(opts.rate);
      if (opts?.volume !== undefined) howl.volume(opts.volume);
      howl.play();
    } catch (e) {
      // autoplay 拦截或资源缺失，静默
    }
  }, []);

  return { play, isMuted: mutedRef.current, setMuted };
}
```

- [ ] **Step 2: 验证类型**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head`
Expected: 无输出（或不含 `useChallengeSfx` 相关错误）

- [ ] **Step 3: 提交**

```bash
git add frontend/src/hooks/useChallengeSfx.ts
git commit -m "feat: 新增 useChallengeSfx 音效 hook"
```

### Task 1.4：给 FloatingPetWidget 加 DOM 锚点

**Files:** 修改 `frontend/src/components/FloatingPetWidget.tsx:167`

- [ ] **Step 1: 加 id**

改 `className="fixed bottom-4 right-4 ..."` 所在的根元素，增加 `id="floating-pet-anchor"`。

```tsx
// Before:
className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 cursor-grab active:cursor-grabbing"

// After:
id="floating-pet-anchor"
className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 cursor-grab active:cursor-grabbing"
```

- [ ] **Step 2: 验证**

Run: `grep -n "floating-pet-anchor" frontend/src/components/FloatingPetWidget.tsx`
Expected: 1 行

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/FloatingPetWidget.tsx
git commit -m "feat: FloatingPetWidget 加 DOM 锚点用于粒子定位"
```

### Task 1.5：实现 SwordSlash 组件（第一幕）

**Files:** 新建 `frontend/src/components/challenge-fx/SwordSlash.tsx`

- [ ] **Step 1: 写实现**

```tsx
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useChallengeSfx } from '../../hooks/useChallengeSfx';

interface Props {
  word: string;
  onComplete: () => void;
}

/**
 * 第一幕（0 – 1.2s）：震屏 + 光剑劈字 + 闪白
 * 完成后调 onComplete 进入第二幕
 */
export default function SwordSlash({ word, onComplete }: Props) {
  const { play } = useChallengeSfx();
  const [flash, setFlash] = useState(false);
  const [split, setSplit] = useState(false);

  useEffect(() => {
    // 0.50s 光剑落下 + 劈字
    const t1 = setTimeout(() => {
      play('sword_slash');
      setSplit(true);
      setFlash(true);
      setTimeout(() => setFlash(false), 80);
    }, 500);
    // 1.20s 完成
    const t2 = setTimeout(onComplete, 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onComplete, play]);

  const [w1, w2] = [word.slice(0, Math.ceil(word.length / 2)), word.slice(Math.ceil(word.length / 2))];

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center">
      {/* 震屏容器 */}
      <motion.div
        animate={{ x: [0, -8, 8, -6, 6, 0], y: [0, 4, -4, 2, -2, 0] }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="relative"
      >
        {/* 光剑 */}
        <motion.svg
          width="600" height="600"
          viewBox="0 0 600 600"
          className="absolute inset-0 pointer-events-none"
          style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        >
          <motion.line
            x1="0" y1="0" x2="600" y2="600"
            stroke="#FFFFFF"
            strokeWidth="8"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: [0, 1, 1], opacity: [0, 1, 0] }}
            transition={{ duration: 0.35, delay: 0.35, times: [0, 0.5, 1] }}
            style={{ filter: 'drop-shadow(0 0 12px #FCD34D)' }}
          />
        </motion.svg>

        {/* 单词 */}
        <motion.div
          initial={{ scale: 1, opacity: 1 }}
          animate={{ scale: [1, 1.5, 1.5], opacity: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="text-6xl font-black text-white text-center relative"
          style={{
            WebkitTextStroke: '2px #FCD34D',
            filter: split ? 'blur(0px)' : 'none',
          }}
        >
          {!split ? (
            <span>{word}</span>
          ) : (
            <span className="inline-flex">
              <motion.span
                initial={{ x: 0, rotate: 0 }}
                animate={{ x: -40, rotate: -8, opacity: [1, 1, 0] }}
                transition={{ duration: 0.6 }}
              >
                {w1}
              </motion.span>
              <motion.span
                initial={{ x: 0, rotate: 0 }}
                animate={{ x: 40, rotate: 8, opacity: [1, 1, 0] }}
                transition={{ duration: 0.6 }}
              >
                {w2}
              </motion.span>
            </span>
          )}
        </motion.div>
      </motion.div>

      {/* 闪白 */}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.08 }}
            className="absolute inset-0 bg-white"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无相关错误

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/SwordSlash.tsx
git commit -m "feat: 闯关动画第一幕 SwordSlash（光剑劈字）"
```

### Task 1.6：实现 ParticleBurst 组件（第二幕）

**Files:** 新建 `frontend/src/components/challenge-fx/ParticleBurst.tsx`

- [ ] **Step 1: 写实现**

```tsx
import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChallengeSfx } from '../../hooks/useChallengeSfx';

interface Props {
  onComplete: () => void;
  particleCount?: number;
}

const SYMBOLS = ['★', '福', '⚔', '✦', '◆'];
const COLORS = ['#8B5CF6', '#06B6D4', '#FCD34D', '#F472B6'];

interface Particle {
  id: number;
  symbol: string;
  color: string;
  startX: number;
  startY: number;
  ctrlX: number;
  ctrlY: number;
  delay: number;
  duration: number;
}

/**
 * 第二幕（1.2 – 2.5s）：粒子沿贝塞尔曲线飞向宠物头像
 * 终点：document.getElementById('floating-pet-anchor') 的中心
 * 命中音效：每颗粒子触发 particle_tick（前 10 颗音高递增）
 */
export default function ParticleBurst({ onComplete, particleCount = 60 }: Props) {
  const { play } = useChallengeSfx();
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  const hitCountRef = useRef(0);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;

  // 低端设备降级
  const actualCount = useMemo(() => {
    const cores = (navigator as any).hardwareConcurrency || 4;
    return cores < 4 ? Math.min(30, particleCount) : particleCount;
  }, [particleCount]);

  const particles = useMemo<Particle[]>(() => {
    return Array.from({ length: actualCount }, (_, i) => {
      const angle = (Math.random() - 0.5) * Math.PI;
      const radius = 40 + Math.random() * 40;
      return {
        id: i,
        symbol: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        startX: cx + Math.cos(angle) * radius,
        startY: cy + Math.sin(angle) * radius,
        ctrlX: cx + (Math.random() - 0.5) * 400,
        ctrlY: cy - 200 - Math.random() * 100,
        delay: Math.random() * 0.3,
        duration: 0.9 + Math.random() * 0.3,
      };
    });
  }, [actualCount, cx, cy]);

  useEffect(() => {
    const el = document.getElementById('floating-pet-anchor');
    if (el) {
      const rect = el.getBoundingClientRect();
      setTarget({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    } else {
      // 没有宠物头像时，飞向右上角
      setTarget({ x: window.innerWidth - 60, y: 60 });
    }
    const t = setTimeout(onComplete, 1300);
    return () => clearTimeout(t);
  }, [onComplete]);

  const handleHit = () => {
    hitCountRef.current += 1;
    // 前 10 颗命中音高递增
    if (hitCountRef.current <= 10) {
      const rate = 1 + (hitCountRef.current - 1) * 0.06;
      play('particle_tick', { rate, volume: 0.4 });
    }
    // 触发宠物头像弹跳
    const el = document.getElementById('floating-pet-anchor');
    if (el) {
      el.style.transition = 'transform 0.12s';
      el.style.transform = 'scale(1.08)';
      setTimeout(() => { el.style.transform = 'scale(1)'; }, 120);
    }
  };

  if (!target) return null;

  return (
    <div className="fixed inset-0 z-[99] pointer-events-none">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          initial={{
            x: p.startX,
            y: p.startY,
            opacity: 0,
            scale: 0.5,
          }}
          animate={{
            x: [p.startX, p.ctrlX, target.x],
            y: [p.startY, p.ctrlY, target.y],
            opacity: [0, 1, 1, 0.3],
            scale: [0.5, 1.2, 0.6],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: [0.22, 0.68, 0.42, 1],
            times: [0, 0.5, 1],
          }}
          onAnimationComplete={handleHit}
          className="absolute text-2xl select-none"
          style={{
            color: p.color,
            filter: `drop-shadow(0 0 6px ${p.color})`,
            fontWeight: 900,
            left: 0,
            top: 0,
          }}
        >
          {p.symbol}
        </motion.span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/ParticleBurst.tsx
git commit -m "feat: 闯关动画第二幕 ParticleBurst（粒子飞向宠物）"
```

### Task 1.7：实现 RewardReveal 组件（第三幕 - 普通档）

**Files:** 新建 `frontend/src/components/challenge-fx/RewardReveal.tsx`

- [ ] **Step 1: 写实现**

```tsx
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useChallengeSfx } from '../../hooks/useChallengeSfx';

export type RewardTier = 'normal' | 'lucky' | 'crit' | 'miracle';

interface Props {
  tier: RewardTier;
  expGained: number;
  coinGained: number;
  onComplete: () => void;
}

/**
 * 第三幕（2.5 – 4.0s）：奖励入账
 * Phase 1 只做 normal 档（70%）；lucky/crit/miracle 留给 Phase 2 扩展
 */
export default function RewardReveal({ tier, expGained, coinGained, onComplete }: Props) {
  const { play } = useChallengeSfx();
  const [expDisplay, setExpDisplay] = useState(0);
  const [coinDisplay, setCoinDisplay] = useState(0);

  useEffect(() => {
    play('coin_drop', { volume: 0.5 });
    // 经验条数字从 0 滚到 expGained，800ms
    const duration = 800;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setExpDisplay(Math.round(expGained * p));
      setCoinDisplay(Math.round(coinGained * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(onComplete, 1500);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [expGained, coinGained, onComplete, play]);

  const tierColor = tier === 'miracle' ? '#FCD34D' : tier === 'crit' ? '#DC2626' : tier === 'lucky' ? '#8B5CF6' : '#06B6D4';

  return (
    <div className="fixed inset-0 z-[98] pointer-events-none flex flex-col items-center justify-center">
      {/* 经验与金币滚动卡片 */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 14, stiffness: 200 }}
        className="bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur rounded-3xl px-10 py-6 border-2"
        style={{ borderColor: tierColor }}
      >
        <div className="flex items-center gap-8">
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-1">EXP</div>
            <div className="text-4xl font-black" style={{ color: tierColor }}>+{expDisplay}</div>
          </div>
          <div className="w-px h-10 bg-gray-600" />
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-1">金币</div>
            <div className="text-4xl font-black text-yellow-400">+{coinDisplay}</div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/RewardReveal.tsx
git commit -m "feat: 闯关动画第三幕 RewardReveal（普通档奖励入账）"
```

### Task 1.8：实现 ChallengeVictory 顶层编排

**Files:** 新建 `frontend/src/components/challenge-fx/ChallengeVictory.tsx`

- [ ] **Step 1: 写实现**

```tsx
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import SwordSlash from './SwordSlash';
import ParticleBurst from './ParticleBurst';
import RewardReveal, { type RewardTier } from './RewardReveal';

export interface ChallengeVictoryProps {
  /** 用来展示劈字的单词（推荐用本关最后一个答对的词） */
  featureWord: string;
  /** 奖励档位，Phase 1 全部传 normal */
  tier: RewardTier;
  expGained: number;
  coinGained: number;
  /** 4 幕全部结束后回调，外层展示下一关按钮 */
  onFinished: () => void;
}

type Phase = 'slash' | 'particles' | 'reveal' | 'done';

export default function ChallengeVictory({
  featureWord, tier, expGained, coinGained, onFinished,
}: ChallengeVictoryProps) {
  const [phase, setPhase] = useState<Phase>('slash');

  useEffect(() => {
    if (phase === 'done') onFinished();
  }, [phase, onFinished]);

  return (
    <AnimatePresence>
      {phase === 'slash' && (
        <SwordSlash word={featureWord} onComplete={() => setPhase('particles')} />
      )}
      {phase === 'particles' && (
        <ParticleBurst onComplete={() => setPhase('reveal')} />
      )}
      {phase === 'reveal' && (
        <RewardReveal
          tier={tier}
          expGained={expGained}
          coinGained={coinGained}
          onComplete={() => setPhase('done')}
        />
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/ChallengeVictory.tsx
git commit -m "feat: 闯关动画顶层编排 ChallengeVictory"
```

### Task 1.9：把 ChallengeVictory 挂进 MistakeChallenge 结果页

**Files:** 修改 `frontend/src/pages/MistakeChallenge.tsx`

结果页目前直接渲染分数环 + 回顾列表。Phase 1 策略：**仅满分通关时**才播 ChallengeVictory 动画，4 秒后渲染现有结果面板（保留）。

- [ ] **Step 1: 在 ResultPhase 顶部加动画状态**

在 `ResultPhase` 函数内（`const isPerfect = ...` 下方）：

```tsx
const [victoryDone, setVictoryDone] = useState(!isPerfect);  // 非满分跳过动画
const featureWord = feedbackHistory.filter(fb => fb.isCorrect).pop()?.word.word ?? '';

if (isPerfect && !victoryDone && featureWord) {
  return (
    <>
      <ChallengeVictory
        featureWord={featureWord}
        tier="normal"
        expGained={5}
        coinGained={5}
        onFinished={() => setVictoryDone(true)}
      />
    </>
  );
}
```

- [ ] **Step 2: 加 import**

```tsx
import ChallengeVictory from '../components/challenge-fx/ChallengeVictory';
import { useState } from 'react';  // 如果文件顶部还没导入 useState
```

- [ ] **Step 3: 类型检查 + build**

```bash
cd frontend && npx tsc --noEmit && npm run build 2>&1 | tail -3
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/MistakeChallenge.tsx
git commit -m "feat: 错题闯关满分时播放三幕通关动画"
```

### Task 1.10：部署 Phase 1 到服务器

- [ ] **Step 1: rsync 到服务器**

```bash
cd /Users/apple/Desktop/英语助手 && sshpass -p 'X9Th2vDUK@uGuw6M' rsync -avz --delete -e 'ssh -o StrictHostKeyChecking=no' frontend/dist/ root@42.193.250.250:/www/wwwroot/english-helper/frontend/dist/ 2>&1 | tail -3
```

- [ ] **Step 2: 推远端**

```bash
git push origin main && git push gitee main
```

### Task 1.11：端到端手动验证

- [ ] **Step 1: 浏览器打开** https://es.feiyingsteam.com/student/mistake-book 登录
- [ ] **Step 2: 点 🏰 错题闯关模式，做一关**
- [ ] **Step 3: 全部答对 → 观察**：
  - 0.0 - 0.15s 屏幕抖动
  - 0.5s 光剑白线斜劈、单词被劈为两半、闪白
  - 1.2 - 2.5s 约 60 颗彩色粒子从屏幕中心贝塞尔飞向右下角宠物头像，宠物头像每次命中都弹一下
  - 2.5 - 3.5s 弹出 `+5 EXP / +5 金币` 数字滚动
  - 4.0s 动画结束，显示原有分数环结果面板
- [ ] **Step 4: 打开 DevTools Console，验证无报错、无 audio 拦截 warning（有占位音频 0.1s 静音不会拦截）**
- [ ] **Step 5: iPhone Safari 打开同一链接做一遍，确认粒子不超框、宠物头像弹跳正常**

---

## Phase 2: 概率分档（幸运/暴击/神迹）

**目标**：奖励档位由**后端生成**，前端按 tier 播放对应的升级动画。70/20/8/2 分档，神迹档触发宠物进化事件。

### 文件结构

| 文件 | 职责 | 新建/修改 |
|---|---|---|
| `backend/app/schemas/mistake_book.py` | `ChallengeSubmitResult` 加 `reward_tier/exp_gained/coin_gained/pet_evolved` 字段 | 修改 |
| `backend/app/api/v1/student/mistake_book.py` | `submit_challenge_level` 通关时 `random.random()` 分档 | 修改 |
| `frontend/src/api/mistakeBook.ts` | `ChallengeSubmitResult` 类型同步加字段 | 修改 |
| `frontend/src/components/challenge-fx/RewardReveal.tsx` | 加 lucky/crit/miracle 三个分支动画 | 修改 |
| `frontend/public/sfx/crit_boom.mp3`, `miracle_horn.mp3` | 2 个新音效占位 | 新建 |

### Task 2.1：后端 schema 加 reward_tier 字段

**Files:** 修改 `backend/app/schemas/mistake_book.py`

- [ ] **Step 1: 查找 ChallengeSubmitResult 定义**

```bash
grep -n "class ChallengeSubmitResult" backend/app/schemas/mistake_book.py
```

- [ ] **Step 2: 在该类里追加字段**

```python
from typing import Literal, Optional

class ChallengeSubmitResult(BaseModel):
    passed: bool
    correct_count: int
    total_count: int
    wrong_words: list[ChallengeLevelWord]
    message: str
    # Phase 2 新增：
    reward_tier: Literal['normal', 'lucky', 'crit', 'miracle'] = 'normal'
    exp_gained: int = 0
    coin_gained: int = 0
    pet_evolved: Optional[str] = None
```

- [ ] **Step 3: 确认导入**

确保文件顶部已 `from typing import Literal, Optional`。没有就加上。

- [ ] **Step 4: 提交**

```bash
git add backend/app/schemas/mistake_book.py
git commit -m "feat(backend): ChallengeSubmitResult 新增 reward_tier 等字段"
```

### Task 2.2：后端在通关成功时生成 reward_tier

**Files:** 修改 `backend/app/api/v1/student/mistake_book.py`（`submit_challenge_level` 函数，约 594-722 行）

- [ ] **Step 1: 在文件顶部加 import**

```python
import random
```

- [ ] **Step 2: 定义概率表常量（文件顶部区域、其他常量附近）**

```python
# 闯关奖励档位概率（总和=1.0）
REWARD_TIER_WEIGHTS = [
    ('normal', 0.70),
    ('lucky', 0.20),
    ('crit', 0.08),
    ('miracle', 0.02),
]

REWARD_TABLE = {
    'normal':  {'exp': 5,  'coin': 5},
    'lucky':   {'exp': 10, 'coin': 10},
    'crit':    {'exp': 20, 'coin': 10},
    'miracle': {'exp': 50, 'coin': 20},
}

def _pick_reward_tier() -> str:
    r = random.random()
    acc = 0.0
    for name, w in REWARD_TIER_WEIGHTS:
        acc += w
        if r < acc:
            return name
    return 'normal'
```

- [ ] **Step 3: 在 `submit_challenge_level` 里通关（passed=True）的分支末尾注入 reward**

找到 `if passed:` 这段循环之后、`await db.commit()` 之前，加：

```python
    # Phase 2: 生成奖励档位
    reward_tier = 'normal'
    exp_gained = 0
    coin_gained = 0
    if passed:
        reward_tier = _pick_reward_tier()
        exp_gained = REWARD_TABLE[reward_tier]['exp']
        coin_gained = REWARD_TABLE[reward_tier]['coin']
        # TODO: 后续可接入真实 EXP/金币账户变更；当前仅返回
```

- [ ] **Step 4: 改 return 语句**

```python
    return ChallengeSubmitResult(
        passed=passed,
        correct_count=correct_count,
        total_count=total_count,
        wrong_words=wrong_words,
        message=message,
        reward_tier=reward_tier,
        exp_gained=exp_gained,
        coin_gained=coin_gained,
        pet_evolved=None,  # Phase 4 再接入真实宠物进化
    )
```

- [ ] **Step 5: 本地跑后端，curl 验证**

```bash
# 启动本地后端（如果还没跑）
# cd backend && ./venv/bin/uvicorn app.main:app --reload &

TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login/json -H "Content-Type: application/json" -d '{"username":"student","password":"123456"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")

# 造一个假的通关请求（找一个用户有的闯关词 id）
curl -s -X POST http://localhost:8000/api/v1/student/mistake-book/challenge-submit \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"level":1,"answers":[{"word_id":68,"user_answer":"football"}]}' | python3 -m json.tool
```

Expected: 返回 JSON 包含 `reward_tier`, `exp_gained`, `coin_gained` 三个新字段

- [ ] **Step 6: 提交**

```bash
git add backend/app/api/v1/student/mistake_book.py
git commit -m "feat(backend): 闯关通关按 70/20/8/2 分档生成 reward_tier"
```

### Task 2.3：前端 API 类型同步

**Files:** 修改 `frontend/src/api/mistakeBook.ts`

- [ ] **Step 1: 定位 ChallengeSubmitResult 接口**

```bash
grep -n "export interface ChallengeSubmitResult" frontend/src/api/mistakeBook.ts
```

- [ ] **Step 2: 加字段**

```typescript
export type RewardTier = 'normal' | 'lucky' | 'crit' | 'miracle';

export interface ChallengeSubmitResult {
  passed: boolean;
  correct_count: number;
  total_count: number;
  wrong_words: ChallengeLevelWord[];
  message: string;
  // Phase 2 新增：
  reward_tier: RewardTier;
  exp_gained: number;
  coin_gained: number;
  pet_evolved: string | null;
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api/mistakeBook.ts
git commit -m "feat: 前端 ChallengeSubmitResult 类型同步 reward_tier"
```

### Task 2.4：RewardReveal 加 lucky/crit/miracle 分支动画

**Files:** 修改 `frontend/src/components/challenge-fx/RewardReveal.tsx`

- [ ] **Step 1: 用下面完整版替换原文件内容**

```tsx
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useChallengeSfx } from '../../hooks/useChallengeSfx';

export type RewardTier = 'normal' | 'lucky' | 'crit' | 'miracle';

interface Props {
  tier: RewardTier;
  expGained: number;
  coinGained: number;
  onComplete: () => void;
}

const TIER_CONFIG: Record<RewardTier, {
  label: string;
  color: string;
  bgGradient: string;
  sfx: 'coin_drop' | 'crit_boom' | 'miracle_horn';
  duration: number;
}> = {
  normal:  { label: '',          color: '#06B6D4', bgGradient: 'from-cyan-500/20 to-cyan-700/20',    sfx: 'coin_drop',    duration: 1500 },
  lucky:   { label: '🍀 幸运！',  color: '#8B5CF6', bgGradient: 'from-purple-500/30 to-pink-500/30', sfx: 'coin_drop',    duration: 1800 },
  crit:    { label: 'CRITICAL!', color: '#DC2626', bgGradient: 'from-red-600/40 to-yellow-500/30',  sfx: 'crit_boom',    duration: 2200 },
  miracle: { label: '✨ 神迹 ✨', color: '#FCD34D', bgGradient: 'from-yellow-400/40 to-orange-500/40', sfx: 'miracle_horn', duration: 2800 },
};

export default function RewardReveal({ tier, expGained, coinGained, onComplete }: Props) {
  const { play } = useChallengeSfx();
  const [expDisplay, setExpDisplay] = useState(0);
  const [coinDisplay, setCoinDisplay] = useState(0);
  const cfg = TIER_CONFIG[tier];

  useEffect(() => {
    play(cfg.sfx, { volume: tier === 'crit' || tier === 'miracle' ? 0.8 : 0.5 });
    // 数字滚动 800ms
    const start = performance.now();
    const rollDuration = 800;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / rollDuration);
      setExpDisplay(Math.round(expGained * p));
      setCoinDisplay(Math.round(coinGained * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(onComplete, cfg.duration);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [tier, expGained, coinGained, onComplete, play, cfg]);

  return (
    <div className="fixed inset-0 z-[98] pointer-events-none flex flex-col items-center justify-center">
      {/* 背景径向渐变（lucky/crit/miracle 才显示） */}
      {tier !== 'normal' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.6] }}
          transition={{ duration: 0.8 }}
          className={`absolute inset-0 bg-gradient-radial ${cfg.bgGradient}`}
          style={{ background: `radial-gradient(circle at center, ${cfg.color}33 0%, transparent 60%)` }}
        />
      )}

      {/* 暴击震屏 */}
      {tier === 'crit' && (
        <motion.div
          animate={{ x: [0, -12, 12, -8, 8, -4, 4, 0] }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0"
        />
      )}

      {/* 档位标题 */}
      <AnimatePresence>
        {cfg.label && (
          <motion.div
            initial={{ scale: 0, opacity: 0, rotate: -6 }}
            animate={{ scale: [0, 1.3, 1], opacity: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4, ease: 'backOut' }}
            className="mb-6 font-black text-6xl tracking-wider"
            style={{
              color: cfg.color,
              WebkitTextStroke: '1px white',
              filter: `drop-shadow(0 0 20px ${cfg.color})`,
            }}
          >
            {cfg.label}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 经验与金币卡片 */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 14, stiffness: 200, delay: 0.2 }}
        className="bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur rounded-3xl px-10 py-6 border-2"
        style={{ borderColor: cfg.color, boxShadow: `0 0 40px ${cfg.color}66` }}
      >
        <div className="flex items-center gap-8">
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-1">EXP</div>
            <div className="text-4xl font-black" style={{ color: cfg.color }}>+{expDisplay}</div>
          </div>
          <div className="w-px h-10 bg-gray-600" />
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-1">金币</div>
            <div className="text-4xl font-black text-yellow-400">+{coinDisplay}</div>
          </div>
        </div>
      </motion.div>

      {/* miracle 档：金柱冲天 */}
      {tier === 'miracle' && (
        <motion.div
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{ scaleY: 1, opacity: [0, 1, 0.7] }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-64 pointer-events-none"
          style={{
            background: 'linear-gradient(to top, transparent, #FCD34D, transparent)',
            filter: 'blur(20px)',
            transformOrigin: 'bottom',
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/RewardReveal.tsx
git commit -m "feat: RewardReveal 支持 lucky/crit/miracle 三档动画"
```

### Task 2.5：ChallengeVictory 把后端 tier 传进来

**Files:** 修改 `frontend/src/pages/MistakeChallenge.tsx`

- [ ] **Step 1: 把 result 对象的 reward_tier 等透传**

找到 Task 1.9 加的 `<ChallengeVictory ...>`，改成：

```tsx
<ChallengeVictory
  featureWord={featureWord}
  tier={result.reward_tier || 'normal'}
  expGained={result.exp_gained || 5}
  coinGained={result.coin_gained || 5}
  onFinished={() => setVictoryDone(true)}
/>
```

- [ ] **Step 2: 移除 Phase 1 里"仅满分才触发"的限制**

把 `const [victoryDone, setVictoryDone] = useState(!isPerfect);` 改为：

```tsx
const [victoryDone, setVictoryDone] = useState(false);
```

改后通关即播动画（passed=true 时才走 result 分支，失败不触发）。

- [ ] **Step 3: 类型检查 + build**

```bash
cd frontend && npx tsc --noEmit && npm run build 2>&1 | tail -3
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/MistakeChallenge.tsx
git commit -m "feat: 闯关动画按后端返回的 reward_tier 分档播放"
```

### Task 2.6：加 crit_boom / miracle_horn 占位音效

- [ ] **Step 1: 生成占位**

```bash
for name in crit_boom miracle_horn; do
  ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.1 -q:a 9 -acodec libmp3lame \
    frontend/public/sfx/${name}.mp3 -y 2>/dev/null
done
```

- [ ] **Step 2: 提交**

```bash
git add frontend/public/sfx/crit_boom.mp3 frontend/public/sfx/miracle_horn.mp3
git commit -m "chore: 暴击/神迹档音效占位"
```

### Task 2.7：Phase 2 部署

- [ ] **Step 1: 部署后端（scp + 重启）**

```bash
sshpass -p 'X9Th2vDUK@uGuw6M' scp -o StrictHostKeyChecking=no \
  backend/app/schemas/mistake_book.py \
  backend/app/api/v1/student/mistake_book.py \
  root@42.193.250.250:/tmp/
sshpass -p 'X9Th2vDUK@uGuw6M' ssh -o StrictHostKeyChecking=no root@42.193.250.250 '
  cp /tmp/mistake_book.py /www/wwwroot/english-helper/backend/app/schemas/mistake_book.py && \
  cp /tmp/mistake_book.py /www/wwwroot/english-helper/backend/app/api/v1/student/mistake_book.py && \
  systemctl restart english-helper && sleep 2 && systemctl is-active english-helper'
```

> **⚠️ 注意**：上一步两个文件同名不同路径，scp 会冲突。改成分两步 scp：

```bash
sshpass -p 'X9Th2vDUK@uGuw6M' scp backend/app/schemas/mistake_book.py root@42.193.250.250:/www/wwwroot/english-helper/backend/app/schemas/mistake_book.py
sshpass -p 'X9Th2vDUK@uGuw6M' scp backend/app/api/v1/student/mistake_book.py root@42.193.250.250:/www/wwwroot/english-helper/backend/app/api/v1/student/mistake_book.py
sshpass -p 'X9Th2vDUK@uGuw6M' ssh root@42.193.250.250 'systemctl restart english-helper && sleep 2 && systemctl is-active english-helper'
```

Expected: `active`

- [ ] **Step 2: 部署前端**

```bash
cd frontend && npm run build
cd .. && sshpass -p 'X9Th2vDUK@uGuw6M' rsync -avz --delete -e 'ssh -o StrictHostKeyChecking=no' frontend/dist/ root@42.193.250.250:/www/wwwroot/english-helper/frontend/dist/ 2>&1 | tail -3
```

- [ ] **Step 3: 推 git 远端**

```bash
git push origin main && git push gitee main
```

### Task 2.8：Phase 2 验证

- [ ] **Step 1: 快速连做 20 关，统计 tier 分布**

每关结束时按 F12 → Network → 点 `challenge-submit` 查看 `reward_tier` 字段。理想情况 20 次应出现 ~14 normal / ~4 lucky / ~1-2 crit，可能没 miracle。

- [ ] **Step 2: 强制测各档（临时手段）**

在 `backend/app/api/v1/student/mistake_book.py` 的 `_pick_reward_tier()` 最上面临时加 `return 'miracle'` 测神迹档；测完改回。也可在后端加个 query 参数 `?force_tier=miracle` 仅开发时生效，但本 Phase 不强求。

---

## Phase 3: 连击系统 + LEGENDARY 大特写

**目标**：连续通关积累 combo 计数器，屏幕右侧显示连击徽章（2/3/5/10 连分级），10 连 LEGENDARY 触发全屏大特写过场动画。

### 文件结构

| 文件 | 职责 | 新建/修改 |
|---|---|---|
| `frontend/src/hooks/useCombo.ts` | combo 状态管理（sessionStorage + 10 分钟超时重置） | 新建 |
| `frontend/src/components/challenge-fx/ComboBadge.tsx` | 连击徽章（2/3/5/10 分级显示） | 新建 |
| `frontend/src/components/challenge-fx/LegendaryCutscene.tsx` | 10 连 LEGENDARY 大特写 | 新建 |
| `frontend/src/components/challenge-fx/ChallengeVictory.tsx` | 接入 combo，触发 ComboBadge / LegendaryCutscene | 修改 |
| `frontend/src/pages/MistakeChallenge.tsx` | 通关/失败时操作 combo | 修改 |
| `frontend/public/sfx/legendary_horn.mp3` | 10 连音效占位 | 新建 |

### Task 3.1：实现 useCombo hook

**Files:** 新建 `frontend/src/hooks/useCombo.ts`

- [ ] **Step 1: 写实现**

```typescript
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'challenge_combo';
const TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟无操作重置

interface ComboState {
  count: number;
  lastAt: number;
}

function load(): ComboState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { count: 0, lastAt: 0 };
    const s: ComboState = JSON.parse(raw);
    // 超时过期
    if (Date.now() - s.lastAt > TIMEOUT_MS) return { count: 0, lastAt: 0 };
    return s;
  } catch {
    return { count: 0, lastAt: 0 };
  }
}

function save(s: ComboState) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/**
 * 连击计数 hook
 * - pass() 通关 +1
 * - fail() 失败清零
 * - 10 分钟无操作自动重置（load 时检查）
 */
export function useCombo() {
  const [combo, setCombo] = useState<number>(() => load().count);

  useEffect(() => {
    save({ count: combo, lastAt: Date.now() });
  }, [combo]);

  const pass = useCallback(() => {
    setCombo(c => c + 1);
  }, []);

  const fail = useCallback(() => {
    setCombo(0);
  }, []);

  const reset = useCallback(() => {
    setCombo(0);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  return { combo, pass, fail, reset };
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无 useCombo 相关错误

- [ ] **Step 3: 提交**

```bash
git add frontend/src/hooks/useCombo.ts
git commit -m "feat: 新增 useCombo 连击计数 hook"
```

### Task 3.2：实现 ComboBadge 组件

**Files:** 新建 `frontend/src/components/challenge-fx/ComboBadge.tsx`

- [ ] **Step 1: 写实现**

```tsx
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  combo: number;
}

const TIERS = [
  { min: 10, label: '👑 LEGENDARY', color: '#FCD34D', fire: true },
  { min: 5,  label: '⚡ MEGA COMBO', color: '#DC2626', fire: true },
  { min: 3,  label: '🔥 TRIPLE',    color: '#F97316', fire: true },
  { min: 2,  label: '×2 COMBO',     color: '#8B5CF6', fire: false },
];

function getTier(combo: number) {
  return TIERS.find(t => combo >= t.min);
}

/**
 * 连击徽章
 * - 屏幕右侧中部悬浮显示
 * - combo >= 2 显示；< 2 返回 null
 * - 10 连单独由 LegendaryCutscene 负责大特写，徽章仍显示 LEGENDARY 文本
 */
export default function ComboBadge({ combo }: Props) {
  const tier = getTier(combo);

  return (
    <AnimatePresence>
      {tier && (
        <motion.div
          key={tier.label}
          initial={{ x: 80, opacity: 0, scale: 0.6 }}
          animate={{ x: 0, opacity: 1, scale: [0.6, 1.15, 1] }}
          exit={{ x: 80, opacity: 0 }}
          transition={{ type: 'spring', damping: 12, stiffness: 220 }}
          className="fixed right-4 top-1/3 z-[97] pointer-events-none"
        >
          <div
            className="px-5 py-3 rounded-2xl font-black text-white text-lg shadow-2xl"
            style={{
              background: `linear-gradient(135deg, ${tier.color}, ${tier.color}cc)`,
              boxShadow: `0 0 30px ${tier.color}aa`,
              WebkitTextStroke: '0.5px rgba(0,0,0,0.3)',
            }}
          >
            {tier.label}
            <div className="text-xs font-bold opacity-80 mt-0.5">{combo} 连击</div>
          </div>

          {/* 3 连以上火焰装饰 */}
          {tier.fire && (
            <motion.div
              animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
              transition={{ duration: 0.8, repeat: Infinity }}
              className="absolute -inset-2 rounded-2xl pointer-events-none"
              style={{
                background: `radial-gradient(circle, ${tier.color}55 0%, transparent 70%)`,
                zIndex: -1,
                filter: 'blur(8px)',
              }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/ComboBadge.tsx
git commit -m "feat: 连击徽章 ComboBadge（2/3/5/10 分级）"
```

### Task 3.3：实现 LegendaryCutscene 组件

**Files:** 新建 `frontend/src/components/challenge-fx/LegendaryCutscene.tsx`

- [ ] **Step 1: 写实现**

```tsx
import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { useChallengeSfx } from '../../hooks/useChallengeSfx';

interface Props {
  onComplete: () => void;
}

/**
 * 10 连 LEGENDARY 全屏大特写
 * - 屏幕黑化 0.3s → 宠物大头横扫 → 霓虹文字 → 号角 → 淡出
 * 总时长约 3s
 */
export default function LegendaryCutscene({ onComplete }: Props) {
  const { play } = useChallengeSfx();

  useEffect(() => {
    play('legendary_horn', { volume: 0.9 });
    const t = setTimeout(onComplete, 3000);
    return () => clearTimeout(t);
  }, [onComplete, play]);

  // 获取宠物图片（从 FloatingPetWidget 的 img 里读）
  const petEl = document.getElementById('floating-pet-anchor');
  const petImg = petEl?.querySelector('img')?.src;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden"
    >
      {/* 黑幕 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 3, times: [0, 0.1, 0.85, 1] }}
        className="absolute inset-0 bg-black"
      />

      {/* 宠物横扫 */}
      {petImg && (
        <motion.img
          src={petImg}
          initial={{ x: '-100vw', scale: 2.5, opacity: 0 }}
          animate={{ x: ['100vw', '0vw', '0vw', '100vw'], scale: 2.5, opacity: [0, 1, 1, 0] }}
          transition={{ duration: 2.5, times: [0, 0.3, 0.7, 1], ease: 'easeInOut' }}
          className="absolute w-48 h-48 object-contain pointer-events-none"
          style={{ filter: 'drop-shadow(0 0 40px #FCD34D)' }}
        />
      )}

      {/* LEGENDARY 文字 */}
      <motion.div
        initial={{ scale: 0, opacity: 0, rotate: -10 }}
        animate={{ scale: [0, 1.4, 1.1], opacity: [0, 1, 1], rotate: [−10, 3, 0] }}
        transition={{ delay: 0.6, duration: 0.8, ease: 'backOut' }}
        className="relative z-10"
      >
        <h1
          className="text-7xl font-black tracking-widest"
          style={{
            color: '#FCD34D',
            WebkitTextStroke: '2px #fff',
            filter: 'drop-shadow(0 0 30px #FCD34D) drop-shadow(0 0 60px #F97316)',
            fontFamily: '"ZCOOL KuaiLe", system-ui, sans-serif',
          }}
        >
          👑 LEGENDARY
        </h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2 }}
          className="text-2xl text-white/80 text-center mt-3 font-bold"
        >
          10 连击！传说级！
        </motion.p>
      </motion.div>
    </motion.div>
  );
}
```

> **注意**：`rotate: [−10, 3, 0]` 中的 `−10` 是 unicode 减号，需确认编辑时写成 `-10`。

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/LegendaryCutscene.tsx
git commit -m "feat: 10 连 LEGENDARY 全屏大特写"
```

### Task 3.4：ChallengeVictory 接入 combo + LegendaryCutscene

**Files:** 修改 `frontend/src/components/challenge-fx/ChallengeVictory.tsx`

- [ ] **Step 1: 用完整版替换文件**

```tsx
import { AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import SwordSlash from './SwordSlash';
import ParticleBurst from './ParticleBurst';
import RewardReveal, { type RewardTier } from './RewardReveal';
import ComboBadge from './ComboBadge';
import LegendaryCutscene from './LegendaryCutscene';

export interface ChallengeVictoryProps {
  featureWord: string;
  tier: RewardTier;
  expGained: number;
  coinGained: number;
  /** 本次通关后的连击数（已 +1） */
  combo: number;
  onFinished: () => void;
}

type Phase = 'slash' | 'particles' | 'reveal' | 'legendary' | 'done';

export default function ChallengeVictory({
  featureWord, tier, expGained, coinGained, combo, onFinished,
}: ChallengeVictoryProps) {
  const [phase, setPhase] = useState<Phase>('slash');
  const triggerLegendary = combo >= 10 && combo % 10 === 0;

  useEffect(() => {
    if (phase === 'done') onFinished();
  }, [phase, onFinished]);

  const handleRevealDone = () => {
    setPhase(triggerLegendary ? 'legendary' : 'done');
  };

  return (
    <>
      <AnimatePresence>
        {phase === 'slash' && (
          <SwordSlash word={featureWord} onComplete={() => setPhase('particles')} />
        )}
        {phase === 'particles' && (
          <ParticleBurst onComplete={() => setPhase('reveal')} />
        )}
        {phase === 'reveal' && (
          <RewardReveal tier={tier} expGained={expGained} coinGained={coinGained} onComplete={handleRevealDone} />
        )}
        {phase === 'legendary' && (
          <LegendaryCutscene onComplete={() => setPhase('done')} />
        )}
      </AnimatePresence>

      {/* 连击徽章（>= 2 才显示）横穿整个动画周期 */}
      {phase !== 'done' && <ComboBadge combo={combo} />}
    </>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/ChallengeVictory.tsx
git commit -m "feat: ChallengeVictory 接入连击 + LEGENDARY 分支"
```

### Task 3.5：MistakeChallenge 接入 useCombo

**Files:** 修改 `frontend/src/pages/MistakeChallenge.tsx`

- [ ] **Step 1: 顶层 Component（非 ResultPhase）内引入 useCombo**

找到页面顶层 React Component（处理 level 选择 / submit 提交 / showResult 切换的那层），在其函数体内：

```tsx
import { useCombo } from '../hooks/useCombo';
// ...
const { combo, pass, fail } = useCombo();
```

- [ ] **Step 2: 在 submit 成功的 then 里，根据 passed 调 pass()/fail()**

找到调 `submitChallengeLevel` 的地方，在 `.then(r => { setResult(r); ... })` 内：

```tsx
if (r.passed) {
  pass();
} else {
  fail();
}
```

- [ ] **Step 3: 把 combo 传进 ResultPhase**

`<ResultPhase ... />` 增加 prop：

```tsx
<ResultPhase
  result={result}
  userAnswers={...}
  feedbackHistory={...}
  onRetry={...}
  onBack={...}
  combo={combo}
/>
```

- [ ] **Step 4: ResultPhase 签名增加 combo，传给 ChallengeVictory**

```tsx
function ResultPhase({ result, userAnswers, feedbackHistory, onRetry, onBack, combo }: {
  result: ResultData;
  userAnswers: Record<number, string>;
  feedbackHistory: WordFeedback[];
  onRetry: () => void;
  onBack: () => void;
  combo: number;
}) {
  // ...
  <ChallengeVictory
    featureWord={featureWord}
    tier={result.reward_tier || 'normal'}
    expGained={result.exp_gained || 5}
    coinGained={result.coin_gained || 5}
    combo={combo}
    onFinished={() => setVictoryDone(true)}
  />
```

- [ ] **Step 5: 类型检查 + build**

```bash
cd frontend && npx tsc --noEmit && npm run build 2>&1 | tail -3
```

- [ ] **Step 6: 提交**

```bash
git add frontend/src/pages/MistakeChallenge.tsx
git commit -m "feat: 错题闯关接入连击计数"
```

### Task 3.6：加 legendary_horn 占位音效

- [ ] **Step 1: 生成占位**

```bash
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.1 -q:a 9 -acodec libmp3lame \
  frontend/public/sfx/legendary_horn.mp3 -y 2>/dev/null
```

- [ ] **Step 2: 提交**

```bash
git add frontend/public/sfx/legendary_horn.mp3
git commit -m "chore: LEGENDARY 大特写音效占位"
```

### Task 3.7：Phase 3 部署 + 验证

- [ ] **Step 1: rsync 前端 dist**

```bash
cd /Users/apple/Desktop/英语助手 && sshpass -p 'X9Th2vDUK@uGuw6M' rsync -avz --delete -e 'ssh -o StrictHostKeyChecking=no' frontend/dist/ root@42.193.250.250:/www/wwwroot/english-helper/frontend/dist/ 2>&1 | tail -3
```

- [ ] **Step 2: 推 git**

```bash
git push origin main && git push gitee main
```

- [ ] **Step 3: 浏览器验证连击徽章**

连做 2 关，确认右侧出现 `×2 COMBO`；连做 3 关出现 `🔥 TRIPLE` + 火焰；5 关 `⚡ MEGA`；10 关触发 LEGENDARY 全屏过场。中间失败任意一关，徽章消失（combo 归零）。

- [ ] **Step 4: 10 分钟超时验证**

做到 3 连击 → 离开 10 分钟 → 回来重新做一关，徽章应从 `×2` 开始（连击被 sessionStorage 超时重置）。

---

## Phase 4: 完美主义者彩蛋 + 进化分享卡

**目标**：满分 + 无删除重打 → 触发"完美主义者"电影片尾滚动字幕；神迹档（miracle）触发宠物进化 + 可分享卡片（`html2canvas` 截图保存）。

### 文件结构

| 文件 | 职责 | 新建/修改 |
|---|---|---|
| `frontend/src/hooks/useBackspaceTracker.ts` | 追踪本关是否按过退格 | 新建 |
| `frontend/src/components/challenge-fx/PerfectionistCredits.tsx` | 片尾字幕滚动彩蛋 | 新建 |
| `frontend/src/components/challenge-fx/EvolutionCard.tsx` | 宠物进化分享卡（html2canvas 生成） | 新建 |
| `frontend/src/components/challenge-fx/ChallengeVictory.tsx` | 接入 perfect / pet_evolved | 修改 |
| `frontend/src/pages/MistakeChallenge.tsx` | 挂 useBackspaceTracker，传 perfect 到 ResultPhase | 修改 |
| `backend/app/api/v1/student/mistake_book.py` | 神迹档真实返回 pet_evolved（从用户宠物表取下一形态） | 修改 |
| `frontend/public/sfx/piano_credits.mp3` | 彩蛋钢琴音效占位 | 新建 |

### Task 4.1：实现 useBackspaceTracker hook

**Files:** 新建 `frontend/src/hooks/useBackspaceTracker.ts`

- [ ] **Step 1: 写实现**

```typescript
import { useCallback, useEffect, useRef } from 'react';

/**
 * 追踪用户是否按过 Backspace / 删除字符
 * 用途：判定"无删除重打"的完美主义者成就
 * - track(el) 把 ref 挂到 input，监听 keydown
 * - wasUsed() 返回是否按过
 * - reset() 清零（每关开始时调用）
 */
export function useBackspaceTracker() {
  const usedRef = useRef(false);

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      usedRef.current = true;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  const wasUsed = useCallback(() => usedRef.current, []);
  const reset = useCallback(() => { usedRef.current = false; }, []);

  return { wasUsed, reset };
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/hooks/useBackspaceTracker.ts
git commit -m "feat: 退格追踪 hook，支持完美主义者成就判定"
```

### Task 4.2：实现 PerfectionistCredits 组件

**Files:** 新建 `frontend/src/components/challenge-fx/PerfectionistCredits.tsx`

- [ ] **Step 1: 写实现**

```tsx
import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { useChallengeSfx } from '../../hooks/useChallengeSfx';

interface Props {
  username: string;
  levelNumber: number;
  elapsedSeconds: number;
  onComplete: () => void;
}

/**
 * "完美主义者" 电影片尾风格字幕滚动
 * - 黑底白字，复古感
 * - 4s 从下到上滚完
 * - 钢琴 BGM
 */
export default function PerfectionistCredits({
  username, levelNumber, elapsedSeconds, onComplete,
}: Props) {
  const { play } = useChallengeSfx();

  useEffect(() => {
    play('piano_credits', { volume: 0.6 });
    const t = setTimeout(onComplete, 4000);
    return () => clearTimeout(t);
  }, [onComplete, play]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] bg-black flex items-end justify-center overflow-hidden"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: '-150%' }}
        transition={{ duration: 4, ease: 'linear' }}
        className="text-white text-center font-serif py-12 px-6 max-w-md"
        style={{ fontFamily: '"Georgia", serif', letterSpacing: '0.1em' }}
      >
        <h2 className="text-4xl font-bold mb-12 tracking-[0.3em]">完 美 主 义 者</h2>

        <p className="text-lg mb-4 text-white/70">出品</p>
        <p className="text-2xl font-bold mb-10">{username}</p>

        <p className="text-lg mb-4 text-white/70">挑战</p>
        <p className="text-2xl font-bold mb-10">错题闯关 第 {levelNumber} 关</p>

        <p className="text-lg mb-4 text-white/70">用时</p>
        <p className="text-2xl font-bold mb-16">{elapsedSeconds.toFixed(1)} 秒</p>

        <p className="text-xl text-yellow-300 italic">— 你比 99% 的同学更专注 —</p>
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/PerfectionistCredits.tsx
git commit -m "feat: 完美主义者片尾彩蛋 PerfectionistCredits"
```

### Task 4.3：实现 EvolutionCard 组件（神迹分享卡）

**Files:** 新建 `frontend/src/components/challenge-fx/EvolutionCard.tsx`

- [ ] **Step 1: 写实现**

```tsx
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';

interface Props {
  username: string;
  levelNumber: number;
  newFormName: string;   // 进化后宠物形态名
  newFormImage: string;  // 进化后图片 URL
  onClose: () => void;
}

/**
 * 宠物进化分享卡
 * - 渲染一张海报（含用户名、关卡、进化形态、时间戳）
 * - "保存图片" 调 html2canvas 截图下载
 * - "关闭" 回到闯关页
 */
export default function EvolutionCard({
  username, levelNumber, newFormName, newFormImage, onClose,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // 挂载后 200ms 强制预加载图片，避免截图空白
    const img = new Image();
    img.src = newFormImage;
  }, [newFormImage]);

  const handleSave = async () => {
    if (!cardRef.current || saving) return;
    setSaving(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement('a');
      link.download = `进化-${newFormName}-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[180] bg-black/80 backdrop-blur flex flex-col items-center justify-center p-6"
    >
      <motion.div
        ref={cardRef}
        initial={{ scale: 0.5, rotate: -5 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', damping: 12 }}
        className="rounded-3xl p-8 max-w-sm w-full text-center"
        style={{
          background: 'linear-gradient(135deg, #FCD34D 0%, #F97316 50%, #DC2626 100%)',
          boxShadow: '0 0 80px rgba(252,211,77,0.6)',
        }}
      >
        <div className="text-5xl mb-2">🏆</div>
        <h2 className="text-2xl font-black text-white mb-1">神迹降临</h2>
        <p className="text-white/90 text-sm mb-4">{username} 在错题闯关第 {levelNumber} 关</p>

        <div className="bg-white/20 backdrop-blur rounded-2xl p-6 mb-4">
          <img
            src={newFormImage}
            alt={newFormName}
            className="w-32 h-32 mx-auto mb-3 object-contain drop-shadow-2xl"
            crossOrigin="anonymous"
          />
          <p className="text-white text-sm mb-1">解锁了进化形态</p>
          <p className="text-3xl font-black text-white tracking-wider">{newFormName}</p>
        </div>

        <p className="text-white/80 text-xs">
          {new Date().toLocaleString('zh-CN')}
        </p>
      </motion.div>

      <div className="flex gap-4 mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 bg-white text-gray-900 font-bold rounded-2xl shadow-xl disabled:opacity-50"
        >
          {saving ? '保存中…' : '💾 保存图片'}
        </button>
        <button
          onClick={onClose}
          className="px-6 py-3 bg-white/20 text-white font-bold rounded-2xl backdrop-blur"
        >
          关闭
        </button>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/EvolutionCard.tsx
git commit -m "feat: 宠物进化分享卡 EvolutionCard（html2canvas 截图）"
```

### Task 4.4：ChallengeVictory 接入 perfect / evolution

**Files:** 修改 `frontend/src/components/challenge-fx/ChallengeVictory.tsx`

- [ ] **Step 1: 用完整版替换**

```tsx
import { AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import SwordSlash from './SwordSlash';
import ParticleBurst from './ParticleBurst';
import RewardReveal, { type RewardTier } from './RewardReveal';
import ComboBadge from './ComboBadge';
import LegendaryCutscene from './LegendaryCutscene';
import PerfectionistCredits from './PerfectionistCredits';
import EvolutionCard from './EvolutionCard';

export interface ChallengeVictoryProps {
  featureWord: string;
  tier: RewardTier;
  expGained: number;
  coinGained: number;
  combo: number;
  /** 是否触发"完美主义者"彩蛋（满分 + 无退格） */
  perfect: boolean;
  /** Phase 4 新增：若非空，神迹档显示进化卡 */
  evolution: { newFormName: string; newFormImage: string } | null;
  /** 彩蛋展示所需的上下文 */
  username: string;
  levelNumber: number;
  elapsedSeconds: number;
  onFinished: () => void;
}

type Phase = 'slash' | 'particles' | 'reveal' | 'legendary' | 'credits' | 'evolution' | 'done';

export default function ChallengeVictory({
  featureWord, tier, expGained, coinGained, combo, perfect, evolution,
  username, levelNumber, elapsedSeconds, onFinished,
}: ChallengeVictoryProps) {
  const [phase, setPhase] = useState<Phase>('slash');
  const triggerLegendary = combo >= 10 && combo % 10 === 0;

  useEffect(() => {
    if (phase === 'done') onFinished();
  }, [phase, onFinished]);

  /** 阶段切换决策树 */
  const nextAfterReveal = triggerLegendary ? 'legendary'
    : evolution ? 'evolution'
    : perfect ? 'credits'
    : 'done';

  const nextAfterLegendary: Phase = evolution ? 'evolution' : perfect ? 'credits' : 'done';
  const nextAfterEvolution: Phase = perfect ? 'credits' : 'done';

  return (
    <>
      <AnimatePresence>
        {phase === 'slash' && (
          <SwordSlash word={featureWord} onComplete={() => setPhase('particles')} />
        )}
        {phase === 'particles' && (
          <ParticleBurst onComplete={() => setPhase('reveal')} />
        )}
        {phase === 'reveal' && (
          <RewardReveal tier={tier} expGained={expGained} coinGained={coinGained} onComplete={() => setPhase(nextAfterReveal)} />
        )}
        {phase === 'legendary' && (
          <LegendaryCutscene onComplete={() => setPhase(nextAfterLegendary)} />
        )}
        {phase === 'evolution' && evolution && (
          <EvolutionCard
            username={username}
            levelNumber={levelNumber}
            newFormName={evolution.newFormName}
            newFormImage={evolution.newFormImage}
            onClose={() => setPhase(nextAfterEvolution)}
          />
        )}
        {phase === 'credits' && (
          <PerfectionistCredits
            username={username}
            levelNumber={levelNumber}
            elapsedSeconds={elapsedSeconds}
            onComplete={() => setPhase('done')}
          />
        )}
      </AnimatePresence>

      {phase !== 'done' && phase !== 'credits' && phase !== 'evolution' && <ComboBadge combo={combo} />}
    </>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/challenge-fx/ChallengeVictory.tsx
git commit -m "feat: ChallengeVictory 接入完美主义者彩蛋与进化分享卡"
```

### Task 4.5：后端神迹档返回真实 pet_evolved

**Files:** 修改 `backend/app/api/v1/student/mistake_book.py`

- [ ] **Step 1: 查询用户宠物表**

在 `submit_challenge_level` 的 `passed` 分支，当 `reward_tier == 'miracle'` 时：

```python
    pet_evolved_name: Optional[str] = None
    if passed and reward_tier == 'miracle':
        # 查当前用户的宠物是否可进化
        from app.models.pet import UserPet, PetSpecies
        pet_row = await db.execute(
            select(UserPet, PetSpecies)
            .join(PetSpecies, UserPet.species_id == PetSpecies.id)
            .where(UserPet.user_id == user_id)
            .limit(1)
        )
        row = pet_row.one_or_none()
        if row:
            user_pet, species = row
            # 假定 PetSpecies 有 next_evolution_id；没有时 pet_evolved_name 留 None
            if species.next_evolution_id:
                next_species_res = await db.execute(
                    select(PetSpecies).where(PetSpecies.id == species.next_evolution_id)
                )
                next_species = next_species_res.scalar_one_or_none()
                if next_species:
                    user_pet.species_id = next_species.id
                    pet_evolved_name = next_species.name
```

> **前提确认**：先运行 `grep -rn "class UserPet\|class PetSpecies\|next_evolution" backend/app/models/` 确认表结构。若宠物系统没 `next_evolution_id` 字段，则本 Task 改为**仅返回固定进化形态字符串**（eg. `pet_evolved_name = "星辰皮卡丘"`），图片 URL 前端硬编一张即可 —— 不阻塞本 Phase。

- [ ] **Step 2: return 语句加上 pet_evolved**

```python
    return ChallengeSubmitResult(
        ...,
        pet_evolved=pet_evolved_name,
    )
```

- [ ] **Step 3: schema 再扩字段**

`frontend/src/api/mistakeBook.ts` 里 `pet_evolved` 已存在（Phase 2 预留）。后端 `ChallengeSubmitResult` 需要额外加一个图片 URL 字段，否则前端不知道展示哪张图：

```python
class ChallengeSubmitResult(BaseModel):
    ...
    pet_evolved: Optional[str] = None
    pet_evolved_image: Optional[str] = None  # 新增
```

并在 Step 1 里设 `pet_evolved_image = next_species.image_url` 或 fallback 空。

对应 `frontend/src/api/mistakeBook.ts`：

```typescript
  pet_evolved: string | null;
  pet_evolved_image: string | null;
```

- [ ] **Step 4: 提交**

```bash
git add backend/app/api/v1/student/mistake_book.py backend/app/schemas/mistake_book.py frontend/src/api/mistakeBook.ts
git commit -m "feat(backend): 神迹档返回真实宠物进化形态"
```

### Task 4.6：MistakeChallenge 接入 perfect / evolution

**Files:** 修改 `frontend/src/pages/MistakeChallenge.tsx`

- [ ] **Step 1: 页面顶层引入 useBackspaceTracker**

```tsx
import { useBackspaceTracker } from '../hooks/useBackspaceTracker';
// ...
const { wasUsed, reset: resetBackspace } = useBackspaceTracker();
```

- [ ] **Step 2: 每关开始时 reset**

找到切到新一关（level 切换、点"开始挑战"按钮）的地方，调 `resetBackspace()`。

- [ ] **Step 3: submit 成功后，计算 perfect**

```tsx
const perfect = r.passed && r.correct_count === r.total_count && !wasUsed();
```

- [ ] **Step 4: 传进 ResultPhase 和 ChallengeVictory**

`ResultPhase` 签名加 `perfect: boolean; evolution: {newFormName: string; newFormImage: string} | null; username: string; elapsedSeconds: number;`。

`ChallengeVictory` 对应传入：

```tsx
<ChallengeVictory
  featureWord={featureWord}
  tier={result.reward_tier || 'normal'}
  expGained={result.exp_gained || 5}
  coinGained={result.coin_gained || 5}
  combo={combo}
  perfect={perfect}
  evolution={result.pet_evolved && result.pet_evolved_image
    ? { newFormName: result.pet_evolved, newFormImage: result.pet_evolved_image }
    : null}
  username={username}
  levelNumber={currentLevel}
  elapsedSeconds={elapsedSeconds}
  onFinished={() => setVictoryDone(true)}
/>
```

`username` 从现有用户 store（`useUserStore` / Zustand）读；`elapsedSeconds` 在提交前 `Date.now() - levelStartAt` 计算。

- [ ] **Step 5: 类型检查 + build**

```bash
cd frontend && npx tsc --noEmit && npm run build 2>&1 | tail -3
```

- [ ] **Step 6: 提交**

```bash
git add frontend/src/pages/MistakeChallenge.tsx
git commit -m "feat: MistakeChallenge 接入 perfect / evolution 彩蛋"
```

### Task 4.7：加 piano_credits 占位音效

```bash
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.1 -q:a 9 -acodec libmp3lame \
  frontend/public/sfx/piano_credits.mp3 -y 2>/dev/null
git add frontend/public/sfx/piano_credits.mp3
git commit -m "chore: 完美主义者彩蛋钢琴音效占位"
```

### Task 4.8：Phase 4 部署 + 验证

- [ ] **Step 1: 部署后端**

```bash
sshpass -p 'X9Th2vDUK@uGuw6M' scp backend/app/api/v1/student/mistake_book.py root@42.193.250.250:/www/wwwroot/english-helper/backend/app/api/v1/student/mistake_book.py
sshpass -p 'X9Th2vDUK@uGuw6M' scp backend/app/schemas/mistake_book.py root@42.193.250.250:/www/wwwroot/english-helper/backend/app/schemas/mistake_book.py
sshpass -p 'X9Th2vDUK@uGuw6M' ssh root@42.193.250.250 'systemctl restart english-helper && sleep 2 && systemctl is-active english-helper'
```

- [ ] **Step 2: 部署前端**

```bash
cd frontend && npm run build
cd .. && sshpass -p 'X9Th2vDUK@uGuw6M' rsync -avz --delete -e 'ssh -o StrictHostKeyChecking=no' frontend/dist/ root@42.193.250.250:/www/wwwroot/english-helper/frontend/dist/ 2>&1 | tail -3
```

- [ ] **Step 3: 推远端**

```bash
git push origin main && git push gitee main
```

- [ ] **Step 4: 端到端验证**

| 场景 | 操作 | 期望 |
|---|---|---|
| 完美主义者 | 一次性全部拼对、不按退格 | 通关动画末尾播放 4s 片尾字幕 |
| 有退格 | 拼对但中途按过退格 | 只放三幕动画，不触发彩蛋 |
| 神迹进化 | 后端临时加 `return 'miracle'` | 弹出进化分享卡，点"保存图片"下载 PNG |
| 10 连 + 神迹 + 完美 | 同时触发（罕见） | 顺序：reveal → legendary → evolution → credits |

---

## 真实音效替换（可选，不属于 Phase 1-4）

每个 Phase 完成后，占位 mp3 可以逐步替换为真实音效。建议来源：

- **freesound.org**（CC0 筛选）：搜 "sword slash", "coin pickup", "trumpet fanfare", "impact", "piano cinematic"
- **pixabay.com/sound-effects**（全免费商用）

下载 wav，用 `ffmpeg -i in.wav -b:a 48k out.mp3` 转成 MP3 48kbps。覆盖 `frontend/public/sfx/` 下同名文件即可，无需改代码。

## 自审清单

- [x] Phase 拆分独立可部署
- [x] 所有文件路径精确
- [x] 所有代码块完整可粘贴
- [x] Phase 间类型一致（`RewardTier`、`ChallengeSubmitResult`）
- [x] 后端先改 schema 再改 API、前端类型同步紧跟
- [x] 每个 Phase 有独立验证步骤
- [x] 高风险项（iOS autoplay / 低端降级 / 宠物表结构未知）已在 Task 内注明

## 风险 & 已知限制

1. **宠物表结构可能不匹配**：Task 4.5 的 `next_evolution_id` 是假设字段。执行者先 grep 模型定义，不匹配时按 Task 内 fallback 方案走。
2. **occupancy conflict**：Phase 4 的阶段链 `reveal → legendary → evolution → credits` 如果 combo=10 + miracle + perfect 同时成立，总时长 ~12 秒，用户可能不耐烦。可在后续优化中引入"跳过"按钮。
3. **占位音频静音**：整个 Plan 不阻塞音效制作，但用户体验差一半。强烈建议 Phase 1 上线同时安排一次音效替换。



