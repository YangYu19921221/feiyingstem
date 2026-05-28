# 分类记忆法 单元复习 (Unit Recap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在分类记忆法每个单元的最后一组通关后,插入一个三幕的"单元复习"环节(闪现 → 卡片池散落 → 自评收官),让学生用拖拽 / 翻面 / 长按读音的方式重新过一遍单元词,并把"再练"的词直接接入听写。

**Architecture:** 新增 `frontend/src/components/classify/recap/` 目录,5 个组件 + 1 个纯函数(scatter)。`WordClassifyLearning.tsx` 改 1 处:Phase 类型加 `unitRecap`,isLastGroup 时 exam 完成路径插入 recap;DictationPhase 不动,靠新增的 `dictationSource` flag 决定听写完成后回 summary 而非 exam。前端纯 UI 改动,无后端 / DB 影响。

**Tech Stack:** React 18 + TypeScript + framer-motion ^12 + Tailwind + 现有 `useAudio` hook(playAudio(word, rate))。仓库当前无 vitest,纯函数测试用浏览器 devtools console 手测。

**Spec:** `docs/superpowers/specs/2026-05-28-classify-unit-recap-design.md`

---

## File Structure

| 文件 | 责任 | 行数 |
|---|---|---|
| `frontend/src/components/classify/recap/scatter.ts` | 散落算法纯函数:输入(N, isMobile, isLargeN),输出 cards 坐标列表 | ~40 |
| `frontend/src/components/classify/recap/RecapCard.tsx` | 单卡片 UI: 翻面 + 拖动 + 长按读音 + 视觉切换 | ~140 |
| `frontend/src/components/classify/recap/CardPool.tsx` | 矩形容器: 卡片状态管理 + 篮子 + 摇一摇 + 进度条 + 撤销 | ~200 |
| `frontend/src/components/classify/recap/FlashStage.tsx` | 闪现幕: 逐张卡片淡入显示 + TTS + 淡出, 进度 + 跳过按钮 | ~110 |
| `frontend/src/components/classify/recap/RecapSummary.tsx` | 收官幕: 满分金光 / 部分则列出再练词 + 听写按钮 | ~110 |
| `frontend/src/components/classify/recap/UnitRecapPhase.tsx` | 三幕状态机: flash → pool → summary | ~120 |
| `frontend/src/pages/WordClassifyLearning.tsx` | 接入 unitRecap phase + dictationSource flag | 修改 ~30 行 |

---

## Task 1: scatter.ts 纯函数

**Files:**
- Create: `frontend/src/components/classify/recap/scatter.ts`

- [ ] **Step 1: 创建散落算法**

```ts
/**
 * 卡片池散落算法。
 *
 * 把矩形池切成 cols × rows 网格,每张卡 anchor 在格子中心,
 * 加 ±15% jitter + ±12° rotation。结构上是网格,视觉上是散落。
 *
 * @param n 卡片总数
 * @param isMobileOrLargeN 移动端竖屏 (cols=3) 或 N > 32 (cols=5);
 *                         其余 cols=4
 * @param seed 可选随机种子,便于测试; 默认用 Math.random()
 */
export interface ScatteredCard {
  x: number       // 0-100 百分比
  y: number       // 0-100 百分比
  rotation: number // -12 ~ 12 度
  zIndex: number  // 1..n
}

export interface ScatterOptions {
  n: number
  layout: 'mobile' | 'desktop' | 'large'  // mobile=3 cols, desktop=4 cols, large=5 cols
  seed?: number
}

function mulberry32(seed: number) {
  let s = seed
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function scatter(opts: ScatterOptions): ScatteredCard[] {
  const { n, layout } = opts
  const rand = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random
  const cols = layout === 'mobile' ? 3 : layout === 'large' ? 5 : 4
  const rows = Math.max(1, Math.ceil(n / cols))
  const cards: ScatteredCard[] = []
  for (let i = 0; i < n; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const anchorX = ((col + 0.5) / cols) * 100
    const anchorY = ((row + 0.5) / rows) * 100
    const x = clamp(anchorX + (rand() - 0.5) * 30, 5, 95)
    const y = clamp(anchorY + (rand() - 0.5) * 30, 8, 92)
    const rotation = (rand() - 0.5) * 24
    cards.push({ x, y, rotation, zIndex: i + 1 })
  }
  return cards
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
```

- [ ] **Step 2: 浏览器 console 手测 (仓库无 vitest)**

打开 `cc.feiyingsteam.com` (或本地 dev),控制台运行:

```js
// 复制 scatter 函数体到 console (临时) 后执行:
console.log(scatter({ n: 30, layout: 'desktop', seed: 1 }))
// 预期: 30 个对象, 每个 x ∈ [5,95], y ∈ [8,92], rotation ∈ [-12,12]
console.log(scatter({ n: 1, layout: 'mobile', seed: 1 }).length === 1)
console.log(scatter({ n: 60, layout: 'large', seed: 1 }).length === 60)
```

预期: 三个语句各产生符合范围的输出。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/classify/recap/scatter.ts
git commit -m "feat(recap): add scatter algorithm for card layout"
```

---

## Task 2: RecapCard.tsx 单卡片

**Files:**
- Create: `frontend/src/components/classify/recap/RecapCard.tsx`

- [ ] **Step 1: 创建 RecapCard 组件**

```tsx
/**
 * 单张可翻面 / 拖动 / 长按读音的卡片。
 */
import { useRef, useState, useCallback } from 'react'
import { motion, type PanInfo } from 'framer-motion'
import type { WordData } from '../../../api/progress'

export type Verdict = 'unknown' | 'mastered' | 'practice'

export interface PoolCardState {
  word: WordData
  x: number
  y: number
  rotation: number
  zIndex: number
  flipped: boolean
  verdict: Verdict
}

interface Props {
  card: PoolCardState
  containerRef: React.RefObject<HTMLDivElement | null>
  onFlip: (wordId: number) => void
  onPositionChange: (wordId: number, x: number, y: number) => void
  onDragEnd: (wordId: number, info: PanInfo) => void
  playAudio: (word: string) => void
}

const LONG_PRESS_MS = 400
const AUDIO_THROTTLE_MS = 800

export default function RecapCard({
  card, containerRef, onFlip, onPositionChange, onDragEnd, playAudio,
}: Props) {
  const longPressTimer = useRef<number | null>(null)
  const lastAudioAt = useRef<number>(0)
  const dragMoved = useRef<boolean>(false)
  const [isLongPressing, setIsLongPressing] = useState(false)

  const handlePointerDown = useCallback(() => {
    dragMoved.current = false
    longPressTimer.current = window.setTimeout(() => {
      const now = Date.now()
      if (now - lastAudioAt.current < AUDIO_THROTTLE_MS) return
      lastAudioAt.current = now
      setIsLongPressing(true)
      playAudio(card.word.word)
      window.setTimeout(() => setIsLongPressing(false), 600)
    }, LONG_PRESS_MS)
  }, [card.word.word, playAudio])

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleClick = useCallback(() => {
    if (dragMoved.current) return
    onFlip(card.word.id)
  }, [card.word.id, onFlip])

  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    cancelLongPress()
    if (Math.abs(info.offset.x) > 4 || Math.abs(info.offset.y) > 4) {
      dragMoved.current = true
    }
    onDragEnd(card.word.id, info)
    // 同步坐标
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const newX = ((info.point.x - rect.left) / rect.width) * 100
    const newY = ((info.point.y - rect.top) / rect.height) * 100
    onPositionChange(card.word.id, newX, newY)
  }, [card.word.id, onDragEnd, onPositionChange, containerRef, cancelLongPress])

  return (
    <motion.div
      drag
      dragConstraints={containerRef}
      dragElastic={0.1}
      onPointerDown={handlePointerDown}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onClick={handleClick}
      onDragEnd={handleDragEnd}
      whileDrag={{ scale: 1.1, zIndex: 999 }}
      animate={{
        left: `${card.x}%`,
        top: `${card.y}%`,
        rotate: card.rotation,
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      style={{
        position: 'absolute',
        translateX: '-50%',
        translateY: '-50%',
        zIndex: card.zIndex,
        WebkitTouchCallout: 'none',
        userSelect: 'none',
        touchAction: 'none',
      }}
      className="w-[120px] h-[160px] md:w-[120px] md:h-[160px]"
    >
      <div
        className="relative w-full h-full"
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 0.5s',
          transform: card.flipped ? 'rotateY(180deg)' : 'rotateY(0)',
        }}
      >
        {/* 正面 */}
        <div
          className="absolute inset-0 bg-paper rounded-lg border border-amber-200 shadow-md p-3 flex flex-col items-center justify-center"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="text-center font-display text-xl font-bold text-ink leading-tight">
            {card.word.word}
          </div>
          {card.word.phonetic && (
            <div className="mt-2 text-xs text-ink-soft">{card.word.phonetic}</div>
          )}
          <div className={`absolute bottom-1 right-1 text-sm transition-colors ${isLongPressing ? 'text-accent-warm' : 'text-ink-mute'}`}>
            🔊
          </div>
        </div>
        {/* 背面 */}
        <div
          className="absolute inset-0 bg-amber-50 rounded-lg border border-amber-200 shadow-md p-3 flex flex-col items-center justify-center"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <div className="text-center text-base font-semibold text-ink">
            {card.word.meaning}
          </div>
          {card.word.example_sentence && (
            <div className="mt-1 text-[10px] text-ink-soft text-center line-clamp-2">
              {card.word.example_sentence}
            </div>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); playAudio(card.word.word) }}
            className="absolute bottom-1 right-1 text-sm text-ink-mute hover:text-accent-warm"
          >
            🔊
          </button>
        </div>
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -10`
Expected: 无 error 输出。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/classify/recap/RecapCard.tsx
git commit -m "feat(recap): add RecapCard with flip + drag + long-press audio"
```

---

## Task 3: CardPool.tsx 池子容器

**Files:**
- Create: `frontend/src/components/classify/recap/CardPool.tsx`

- [ ] **Step 1: 创建 CardPool 组件**

```tsx
/**
 * 卡片池: 矩形容器 + 卡片状态管理 + 篮子 + 摇一摇 + 撤销。
 *
 * 学生把卡片拖入 mastered/practice 篮子完成自评。
 * 全部卡片都进篮子或学生点"完成"时, 调 onComplete。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, type PanInfo } from 'framer-motion'
import type { WordData } from '../../../api/progress'
import RecapCard, { type PoolCardState, type Verdict } from './RecapCard'
import { scatter } from './scatter'

interface Props {
  words: WordData[]
  playAudio: (word: string) => void
  onComplete: (result: {
    masteredWordIds: number[]
    practiceWords: WordData[]
  }) => void
  initialCards?: PoolCardState[]  // 用于 localStorage 恢复
}

interface DropZone {
  rect: DOMRect
  verdict: 'mastered' | 'practice'
}

function pickLayout(n: number): 'mobile' | 'desktop' | 'large' {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  if (isMobile) return 'mobile'
  if (n > 32) return 'large'
  return 'desktop'
}

export default function CardPool({ words, playAudio, onComplete, initialCards }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const masteredBasketRef = useRef<HTMLDivElement>(null)
  const practiceBasketRef = useRef<HTMLDivElement>(null)
  const undoTimer = useRef<number | null>(null)

  const [cards, setCards] = useState<PoolCardState[]>(() => {
    if (initialCards && initialCards.length === words.length) return initialCards
    const layout = pickLayout(words.length)
    const positions = scatter({ n: words.length, layout })
    return words.map((w, i) => ({
      word: w,
      x: positions[i].x,
      y: positions[i].y,
      rotation: positions[i].rotation,
      zIndex: positions[i].zIndex,
      flipped: false,
      verdict: 'unknown' as Verdict,
    }))
  })

  const [lastSorted, setLastSorted] = useState<{ wordId: number; prev: Verdict } | null>(null)

  const sortedCount = useMemo(
    () => cards.filter(c => c.verdict !== 'unknown').length,
    [cards],
  )
  const masteredCount = useMemo(
    () => cards.filter(c => c.verdict === 'mastered').length,
    [cards],
  )
  const practiceCount = useMemo(
    () => cards.filter(c => c.verdict === 'practice').length,
    [cards],
  )

  // 全部分类完毕自动收官
  useEffect(() => {
    if (sortedCount === words.length && words.length > 0) {
      finish()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedCount, words.length])

  function finish() {
    const masteredWordIds: number[] = []
    const practiceWords: WordData[] = []
    for (const c of cards) {
      if (c.verdict === 'mastered') masteredWordIds.push(c.word.id)
      else if (c.verdict === 'practice') practiceWords.push(c.word)
    }
    onComplete({ masteredWordIds, practiceWords })
  }

  function flipCard(wordId: number) {
    setCards(prev => prev.map(c => c.word.id === wordId ? { ...c, flipped: !c.flipped } : c))
  }

  function setPosition(wordId: number, x: number, y: number) {
    setCards(prev => prev.map(c =>
      c.word.id === wordId ? { ...c, x: clamp(x, 5, 95), y: clamp(y, 8, 92) } : c
    ))
  }

  function pointInRect(px: number, py: number, rect: DOMRect | undefined): boolean {
    if (!rect) return false
    return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom
  }

  function handleDragEnd(wordId: number, info: PanInfo) {
    const drop: DropZone[] = []
    if (masteredBasketRef.current) drop.push({ rect: masteredBasketRef.current.getBoundingClientRect(), verdict: 'mastered' })
    if (practiceBasketRef.current) drop.push({ rect: practiceBasketRef.current.getBoundingClientRect(), verdict: 'practice' })
    for (const z of drop) {
      if (pointInRect(info.point.x, info.point.y, z.rect)) {
        const prev = cards.find(c => c.word.id === wordId)?.verdict ?? 'unknown'
        setCards(prevCards => prevCards.map(c =>
          c.word.id === wordId ? { ...c, verdict: z.verdict } : c
        ))
        setLastSorted({ wordId, prev })
        if (undoTimer.current) clearTimeout(undoTimer.current)
        undoTimer.current = window.setTimeout(() => setLastSorted(null), 5000)
        return
      }
    }
  }

  function undoLast() {
    if (!lastSorted) return
    const { wordId, prev } = lastSorted
    setCards(prevCards => prevCards.map(c =>
      c.word.id === wordId ? { ...c, verdict: prev } : c
    ))
    setLastSorted(null)
    if (undoTimer.current) clearTimeout(undoTimer.current)
  }

  function shake() {
    const layout = pickLayout(words.length)
    const positions = scatter({ n: words.length, layout })
    setCards(prev => prev.map((c, i) => ({
      ...c,
      x: positions[i].x,
      y: positions[i].y,
      rotation: positions[i].rotation,
    })))
  }

  function clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v))
  }

  const visibleCards = cards.filter(c => c.verdict === 'unknown')

  return (
    <div className="min-h-[80vh] px-4 py-6 flex flex-col">
      {/* 顶部进度 */}
      <div className="max-w-3xl mx-auto w-full mb-4 flex items-center justify-between">
        <p className="text-sm text-ink-soft">
          已分类 <span className="font-numeric font-semibold text-ink">{sortedCount}</span> / {words.length}
        </p>
        <button
          type="button"
          onClick={shake}
          className="text-sm px-3 py-1 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 transition"
        >
          🎲 摇一摇
        </button>
      </div>

      {/* 矩形池 */}
      <div
        ref={containerRef}
        className="relative max-w-3xl mx-auto w-full bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 rounded-2xl overflow-hidden"
        style={{ aspectRatio: typeof window !== 'undefined' && window.innerWidth < 768 ? '9/14' : '16/10' }}
      >
        <AnimatePresence>
          {visibleCards.map(c => (
            <RecapCard
              key={c.word.id}
              card={c}
              containerRef={containerRef}
              onFlip={flipCard}
              onPositionChange={setPosition}
              onDragEnd={handleDragEnd}
              playAudio={playAudio}
            />
          ))}
        </AnimatePresence>

        {/* 篮子: 我会了 */}
        <div
          ref={masteredBasketRef}
          className="absolute bottom-3 right-3 w-20 h-20 rounded-2xl bg-amber-500 text-white flex flex-col items-center justify-center shadow-lg"
        >
          <div className="text-2xl">🏆</div>
          <div className="text-xs mt-0.5">我会了</div>
          <div className="font-numeric text-sm font-semibold">{masteredCount}</div>
        </div>

        {/* 篮子: 再练 */}
        <div
          ref={practiceBasketRef}
          className="absolute bottom-3 right-28 w-20 h-20 rounded-2xl bg-rose-400 text-white flex flex-col items-center justify-center shadow-lg"
        >
          <div className="text-2xl">💪</div>
          <div className="text-xs mt-0.5">再练</div>
          <div className="font-numeric text-sm font-semibold">{practiceCount}</div>
        </div>
      </div>

      {/* 撤销 + 完成按钮 */}
      <div className="max-w-3xl mx-auto w-full mt-4 flex items-center justify-between">
        {lastSorted ? (
          <button
            type="button"
            onClick={undoLast}
            className="text-xs px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            ↶ 撤销最后一张 (5 秒)
          </button>
        ) : <div />}
        <button
          type="button"
          onClick={finish}
          disabled={sortedCount === 0}
          className="px-6 py-2 rounded-xl bg-accent-warm text-white font-semibold disabled:opacity-40"
        >
          完成 →
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -10`
Expected: 无 error 输出。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/classify/recap/CardPool.tsx
git commit -m "feat(recap): add CardPool with baskets, undo, shake, finish"
```

---

## Task 4: FlashStage.tsx 闪现幕

**Files:**
- Create: `frontend/src/components/classify/recap/FlashStage.tsx`

- [ ] **Step 1: 创建 FlashStage 组件**

```tsx
/**
 * 单元复习幕 1: 闪现。逐张卡片淡入显示带 TTS, 然后淡出。
 *
 * 单卡: 入场 0.4s + 静态 1.5s + 出场 0.4s + 间隔 0.2s ≈ 2.5s/卡
 * 30 卡 ≈ 75 秒。30 张后右上角出现 "跳到池子" 按钮 (避免长单元失耐心)。
 */
import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { WordData } from '../../../api/progress'

interface Props {
  words: WordData[]
  playAudio: (word: string) => void
  onDone: () => void
}

const ENTER_MS = 400
const HOLD_MS = 1500
const EXIT_MS = 400
const GAP_MS = 200
const PER_CARD_MS = ENTER_MS + HOLD_MS + EXIT_MS + GAP_MS

export default function FlashStage({ words, playAudio, onDone }: Props) {
  const [index, setIndex] = useState(0)
  const [showSkip, setShowSkip] = useState(false)
  const [showCurtain, setShowCurtain] = useState(false)
  const advanceTimer = useRef<number | null>(null)
  const audioTimer = useRef<number | null>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
      if (advanceTimer.current) clearTimeout(advanceTimer.current)
      if (audioTimer.current) clearTimeout(audioTimer.current)
    }
  }, [])

  useEffect(() => {
    if (showCurtain) return
    if (index >= words.length) {
      // 全部播完, 黑屏过渡然后调 onDone
      setShowCurtain(true)
      window.setTimeout(() => { if (!cancelled.current) onDone() }, 800)
      return
    }
    const word = words[index]
    // 入场后 0.2s 触发 TTS
    audioTimer.current = window.setTimeout(() => playAudio(word.word), ENTER_MS - 200)
    advanceTimer.current = window.setTimeout(() => {
      if (!cancelled.current) setIndex(i => i + 1)
    }, PER_CARD_MS)
    if (index === 30 && !showSkip) setShowSkip(true)
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current)
      if (audioTimer.current) clearTimeout(audioTimer.current)
    }
  }, [index, words, playAudio, onDone, showCurtain, showSkip])

  function skip() {
    setShowCurtain(true)
    window.setTimeout(() => { if (!cancelled.current) onDone() }, 500)
  }

  if (showCurtain) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 bg-ink z-50 flex items-center justify-center"
      >
        <p className="text-paper/80 text-lg">现在挑你想再看的</p>
      </motion.div>
    )
  }

  const current = words[index]

  return (
    <div className="fixed inset-0 bg-ink/95 z-40 flex flex-col">
      {/* 跳到池子按钮 */}
      {showSkip && (
        <button
          type="button"
          onClick={skip}
          className="absolute top-4 right-4 text-xs text-paper/60 hover:text-paper/90 px-3 py-1 rounded-full border border-paper/20"
        >
          跳到池子 →
        </button>
      )}

      <div className="flex-1 flex items-center justify-center">
        <AnimatePresence mode="wait">
          {current && (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              transition={{ duration: ENTER_MS / 1000, ease: [0.16, 1, 0.3, 1] }}
              className="bg-paper rounded-2xl shadow-2xl px-12 py-10 text-center min-w-[280px] max-w-md"
            >
              <div className="font-display text-4xl md:text-5xl font-bold text-ink mb-3">
                {current.word}
              </div>
              {current.phonetic && (
                <div className="text-base text-ink-soft mb-3">{current.phonetic}</div>
              )}
              <div className="text-lg text-ink-soft">{current.meaning}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 进度 */}
      <div className="pb-6 text-center">
        <p className="text-paper/60 text-sm font-numeric">
          {Math.min(index + 1, words.length)} / {words.length}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -10`
Expected: 无 error 输出。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/classify/recap/FlashStage.tsx
git commit -m "feat(recap): add FlashStage timed slideshow with TTS"
```

---

## Task 5: RecapSummary.tsx 收官幕

**Files:**
- Create: `frontend/src/components/classify/recap/RecapSummary.tsx`

- [ ] **Step 1: 创建 RecapSummary 组件**

```tsx
/**
 * 单元复习幕 3: 收官。
 *
 * 满分 (Y=0) → 金光特效 + "单元收官 · 完美" 大字。
 * 否则 → 列出 Y 个再练词 + 主按钮 "立刻听写这 Y 个 →"。
 */
import { motion } from 'framer-motion'
import type { WordData } from '../../../api/progress'

interface Props {
  unitName?: string
  masteredCount: number
  practiceWords: WordData[]
  onRetryDictation: (words: WordData[]) => void
  onSkipToSummary: () => void
}

export default function RecapSummary({
  unitName, masteredCount, practiceWords, onRetryDictation, onSkipToSummary,
}: Props) {
  const total = masteredCount + practiceWords.length
  const isPerfect = practiceWords.length === 0 && masteredCount > 0

  return (
    <div className="min-h-[80vh] px-4 py-10 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full bg-paper rounded-3xl shadow-xl p-8 text-center relative overflow-hidden"
      >
        {isPerfect && (
          <motion.div
            initial={{ scale: 0, opacity: 0.8 }}
            animate={{ scale: 4, opacity: 0 }}
            transition={{ duration: 1.6, ease: 'easeOut' }}
            className="absolute inset-0 m-auto w-24 h-24 rounded-full bg-amber-300 pointer-events-none"
          />
        )}

        {isPerfect ? (
          <>
            <div className="text-6xl mb-3">🏆</div>
            <h2 className="font-display text-3xl font-bold text-amber-700 mb-2">单元收官 · 完美</h2>
            <p className="text-ink-soft text-sm mb-6">
              {unitName ? `《${unitName}》` : ''}全部 {masteredCount} 个词都被你认领,了不起。
            </p>
            <button
              type="button"
              onClick={onSkipToSummary}
              className="w-full py-3 rounded-2xl bg-accent-warm text-white font-semibold shadow-lg"
            >
              领取奖励 →
            </button>
          </>
        ) : (
          <>
            <div className="text-5xl mb-3">📋</div>
            <h2 className="font-display text-2xl font-bold text-ink mb-1">单元复习完成</h2>
            <p className="text-ink-soft text-sm mb-5">
              我会了 <span className="font-numeric font-bold text-amber-600">{masteredCount}</span> 个 ·
              再练 <span className="font-numeric font-bold text-rose-500">{practiceWords.length}</span> 个
            </p>

            {practiceWords.length > 0 && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 mb-5 text-left">
                <p className="text-xs text-rose-700 font-medium mb-2">需要再练的词</p>
                <div className="flex flex-wrap gap-1.5">
                  {practiceWords.slice(0, 12).map(w => (
                    <span key={w.id} className="text-xs px-2 py-0.5 rounded bg-white border border-rose-200 text-ink">
                      {w.word}
                    </span>
                  ))}
                  {practiceWords.length > 12 && (
                    <span className="text-xs px-2 py-0.5 text-ink-mute">+{practiceWords.length - 12}</span>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => onRetryDictation(practiceWords)}
              className="w-full py-3 rounded-2xl bg-accent-warm text-white font-semibold shadow-lg mb-2"
            >
              立刻听写这 {practiceWords.length} 个 →
            </button>
            <button
              type="button"
              onClick={onSkipToSummary}
              className="w-full py-2 text-sm text-ink-soft hover:text-ink"
            >
              跳过去结算
            </button>
          </>
        )}

        <p className="text-xs text-ink-mute mt-4">共 {total} 个词</p>
      </motion.div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -10`
Expected: 无 error 输出。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/classify/recap/RecapSummary.tsx
git commit -m "feat(recap): add RecapSummary with perfect/partial branches"
```

---

## Task 6: UnitRecapPhase.tsx 三幕状态机

**Files:**
- Create: `frontend/src/components/classify/recap/UnitRecapPhase.tsx`

- [ ] **Step 1: 创建 UnitRecapPhase 组件**

```tsx
/**
 * 单元复习总编排: 三幕状态机。
 *
 * flash → pool → summary
 * pool 完成时把 (masteredWordIds, practiceWords) 通过 onComplete 上报。
 * summary 用户点 "立刻听写" → onRetryDictation(practiceWords)
 *                         → 由父级 (WordClassifyLearning) 切到 dictation phase
 *                            并设 dictationSource='recap'。
 */
import { useState, useCallback } from 'react'
import type { WordData } from '../../../api/progress'
import FlashStage from './FlashStage'
import CardPool from './CardPool'
import RecapSummary from './RecapSummary'

type Sub = 'flash' | 'pool' | 'summary'

interface Props {
  words: WordData[]
  unitName?: string
  initialSub?: Sub  // 用于 localStorage 恢复
  playAudio: (word: string) => void
  onRetryDictation: (words: WordData[]) => void
  onSkipToSummary: () => void
}

export default function UnitRecapPhase({
  words, unitName, initialSub = 'flash',
  playAudio, onRetryDictation, onSkipToSummary,
}: Props) {
  const [sub, setSub] = useState<Sub>(initialSub)
  const [masteredWordIds, setMasteredWordIds] = useState<number[]>([])
  const [practiceWords, setPracticeWords] = useState<WordData[]>([])

  const handleFlashDone = useCallback(() => setSub('pool'), [])

  const handlePoolComplete = useCallback((result: {
    masteredWordIds: number[]
    practiceWords: WordData[]
  }) => {
    setMasteredWordIds(result.masteredWordIds)
    setPracticeWords(result.practiceWords)
    setSub('summary')
  }, [])

  // 极小单元 (N=1 或 2) 跳过整个 recap
  if (words.length <= 2) {
    onSkipToSummary()
    return null
  }

  if (sub === 'flash') {
    return <FlashStage words={words} playAudio={playAudio} onDone={handleFlashDone} />
  }
  if (sub === 'pool') {
    return <CardPool words={words} playAudio={playAudio} onComplete={handlePoolComplete} />
  }
  return (
    <RecapSummary
      unitName={unitName}
      masteredCount={masteredWordIds.length}
      practiceWords={practiceWords}
      onRetryDictation={onRetryDictation}
      onSkipToSummary={onSkipToSummary}
    />
  )
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -10`
Expected: 无 error 输出。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/classify/recap/UnitRecapPhase.tsx
git commit -m "feat(recap): add UnitRecapPhase three-act state machine"
```

---

## Task 7: 接入 WordClassifyLearning + dictationSource flag

**Files:**
- Modify: `frontend/src/pages/WordClassifyLearning.tsx`

- [ ] **Step 1: 加 Phase 类型 + state**

定位 line 29 `type Phase = ...` 改为:

```ts
type Phase = 'classify' | 'speechVerify' | 'dictation' | 'exam' | 'unitRecap' | 'summary';
type DictationSource = 'normal' | 'recap';
```

定位 line 65 `const [phase, setPhase] = useState<Phase>('classify');` 之后添加:

```ts
const [dictationSource, setDictationSource] = useState<DictationSource>('normal');
const [recapRetryWords, setRecapRetryWords] = useState<WordData[] | null>(null);
```

定位 line 21 `import DictationPhase` 后添加:

```ts
import UnitRecapPhase from '../components/classify/recap/UnitRecapPhase';
```

- [ ] **Step 2: handleExamPass 接入 unitRecap**

定位 line 362-367:

```ts
// 过关检测通过 → 组内总结
const handleExamPass = (correct: number, total: number) => {
  setPhase('summary');
  dispatchPetEvent('complete');
  clearLocalProgress();
};
```

替换为:

```ts
// 过关检测通过 → 最后一组进单元复习, 否则进组内总结
const handleExamPass = (correct: number, total: number) => {
  dispatchPetEvent('complete');
  if (isLastGroup) {
    setPhase('unitRecap');
    // 不 clearLocalProgress, 让 unitRecap 也能恢复
  } else {
    setPhase('summary');
    clearLocalProgress();
  }
};
```

- [ ] **Step 3: DictationPhase 完成路径根据 dictationSource 分支**

定位 dictation 完成后 setPhase 调用 (line 349 附近 `setPhase('exam')` 或类似):

找到 `handleDictationComplete` 函数。原行为是 dictation 完成 → setPhase('exam')。改为:

```ts
const handleDictationComplete = (results: DictationResult[]) => {
  setDictationResults(results);
  if (dictationSource === 'recap') {
    // 来自 recap 的二次听写: 直接进 summary
    setPhase('summary');
    setDictationSource('normal');
    setRecapRetryWords(null);
    clearLocalProgress();
  } else {
    setPhase('exam');
  }
};
```

(原文件里的具体 handler 名称可能略不同, 找到调 setDictationResults + setPhase('exam') 的那个。)

- [ ] **Step 4: 渲染 unitRecap phase**

定位现有 `{phase === 'exam' && ...}` 渲染块下方,添加:

```tsx
{phase === 'unitRecap' && learningData && (
  <UnitRecapPhase
    words={learningData.words}
    unitName={learningData.unit_name}
    playAudio={playAudio}
    onRetryDictation={(words) => {
      setRecapRetryWords(words);
      setDictationSource('recap');
      setPhase('dictation');
    }}
    onSkipToSummary={() => {
      setPhase('summary');
      clearLocalProgress();
    }}
  />
)}
```

- [ ] **Step 5: DictationPhase 收到 recapRetryWords 时用子集**

定位 `{phase === 'dictation' && ...}` 渲染块, words prop 改为:

```tsx
words={recapRetryWords ?? currentGroupWords}
```

(currentGroupWords 在 line 125,默认行为不变。)

- [ ] **Step 6: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -10`
Expected: 无 error 输出。

- [ ] **Step 7: 浏览器手测** (本地 dev server)

```bash
cd frontend && npm run dev
```

打开 `http://localhost:5173`,登录学生账号,进一个有 5-10 词的单元单组,跑完 5 阶段。**期望**: 最后一组的 exam 通过后 → 进 unitRecap phase 闪现幕。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/WordClassifyLearning.tsx
git commit -m "feat(classify): wire UnitRecapPhase as last-group exam → recap → summary"
```

---

## Task 8: localStorage 持久化(extend saveLocalProgress)

**Files:**
- Modify: `frontend/src/pages/WordClassifyLearning.tsx`

- [ ] **Step 1: saveLocalProgress 加 unitRecap 状态**

定位 line 99-108 `saveLocalProgress`:

```ts
const saveLocalProgress = useCallback(() => {
  if (!progressKey || phase === 'summary' || !learningData) return;
  localStorage.setItem(progressKey, JSON.stringify({
    phase,
    groupIndex: currentGroupIndex,
    classifyResults: ...,
    dictationResults,
  }));
}, [...]);
```

加 `dictationSource` 入持久化体(单元复习子幕和卡片状态先不持久化, YAGNI: 第一版先让 phase 恢复就够,卡片层级状态后续若有反馈再加):

```ts
const saveLocalProgress = useCallback(() => {
  if (!progressKey || phase === 'summary' || !learningData) return;
  localStorage.setItem(progressKey, JSON.stringify({
    phase,
    groupIndex: currentGroupIndex,
    classifyResults: Array.from(classifyResults.entries()),
    dictationResults,
    dictationSource,
  }));
}, [progressKey, currentGroupIndex, phase, classifyResults, dictationResults, dictationSource, learningData]);
```

- [ ] **Step 2: 恢复时读 dictationSource 与新 phase**

定位 line 220 附近 `validPhases`:

```ts
const validPhases: Phase[] = ['classify', 'dictation', 'exam'];
```

改为:

```ts
const validPhases: Phase[] = ['classify', 'dictation', 'exam', 'unitRecap'];
```

定位 phase 恢复后,补加 dictationSource 恢复:

```ts
if (saved.dictationSource === 'recap' || saved.dictationSource === 'normal') {
  setDictationSource(saved.dictationSource);
}
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -10`
Expected: 无 error 输出。

- [ ] **Step 4: 浏览器手测刷新恢复**

进单元到 unitRecap (闪现/池子) → 刷新页面 → 期望: 直接回到 unitRecap phase (重头闪现; 池子状态本版不恢复)。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/WordClassifyLearning.tsx
git commit -m "feat(classify): persist unitRecap phase + dictationSource across refresh"
```

---

## Task 9: build + manual testing checklist + deploy

**Files:**
- 无新增

- [ ] **Step 1: build 全量验证**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: `built in <NN>s`,无 TS error。

- [ ] **Step 2: 跑手动测试 checklist (spec 第 8 节)**

启动 dev server,逐项过:

```bash
cd frontend && npm run dev
```

每条都要在 `http://localhost:5173` 实测,记 ✓ 或问题:

- [ ] N=1 词单元 → 跳过整个 unitRecap 直进 summary
- [ ] N=2 词单元 → 同上
- [ ] N=5 词单元 → 闪现 12.5s + 池子 + 收官 全程正常
- [ ] N=15 词单元 → 闪现 37.5s + 池子(4 列) + 收官
- [ ] N=30 词单元 → 闪现 75s + 池子 + 收官,第 30 张后出现"跳到池子"按钮
- [ ] N=50 词单元 → 5 列网格 + 缩卡
- [ ] 闪现中刷新 → 跳过闪现直进池子 (Task 8 行为, 但**注意第一版 sub 不持久化, 实际会重头闪现** — 验证至少 phase 是 unitRecap 即可)
- [ ] 池子分类 5 mastered + 5 practice + 完成 → 收官显示
- [ ] 收官点"立刻听写"→ DictationPhase → 完成后回 summary (不进 exam)
- [ ] 收官满分 → 金光特效正常
- [ ] 长按读音 + 节流 800ms 不重叠
- [ ] 拖动卡片不出矩形
- [ ] 移动端 Safari/Chrome: 长按、拖动、无原生菜单
- [ ] 摇一摇连点 5 次 → spring 动画不打架
- [ ] 篮子误拖 → 5 秒撤销可用

- [ ] **Step 3: build for prod**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: rsync dist 到生产**

```bash
sshpass -p 'X9Th2vDUK@uGuw6M' rsync -az --delete -e "ssh -o StrictHostKeyChecking=accept-new" \
  frontend/dist/ root@42.193.250.250:/www/wwwroot/english-helper/frontend/dist/
```

Expected: rsync 完成,无 error。

- [ ] **Step 5: 生产端到端冒烟**

打开 `https://es.feiyingsteam.com`,登录任一有 owned book 的学生(如 wy15308897486),挑一个最后一组的小单元,跑完 5 阶段,确认 unitRecap 出现。

- [ ] **Step 6: push 到 origin**

```bash
git push origin feat/pk-arena
```

(若分支名变化,用 `git rev-parse --abbrev-ref HEAD` 确认。)

- [ ] **Step 7: Final commit (手动测验证 OK 后)**

```bash
git commit --allow-empty -m "chore(recap): ship unit recap to production after manual QA"
```

---

## Self-Review

按 writing-plans skill 要求做最后核对。

**1. Spec coverage scan:**

| Spec section | 对应 Task |
|---|---|
| 1 目标 + 非目标 | 全部 Tasks 共同满足 |
| 2 触发与流程总览 | Task 7 (接入), Task 6 (三幕) |
| 3 组件结构 | Tasks 1-7 一一对应 |
| 4 数据模型 | Task 2 (RecapCard 类型), Task 3 (CardPool) |
| 5 散落算法 | Task 1 |
| 6 视觉规范 | Tasks 2-5 各自实现 |
| 7 边界 + 错误处理 N=1/2 跳过 | Task 6 step 1 |
| 7 60+ 快速跳过 | Task 4 (showSkip @ index===30) |
| 7 篮子误拖撤销 | Task 3 (lastSorted + undoTimer) |
| 7 dragConstraints 锁矩形内 | Task 2 (drag dragConstraints) |
| 7 长按节流 | Task 2 (AUDIO_THROTTLE_MS) |
| 7 iOS 原生菜单 | Task 2 (WebkitTouchCallout/userSelect) |
| 7 DictationPhase 复用陷阱 | Task 7 step 3 (dictationSource flag) |
| 7 localStorage 恢复 | Task 8 |
| 8 测试策略 | Task 1 step 2 (console 手测), Task 9 step 2 (checklist) |
| 9 实施顺序 | Tasks 1→9 已按风险递减 |
| 10 回滚 | spec 第 10 节 (Task 7 step 1 一行 if 即可) |

无 spec 项无 task 对应。

**2. Placeholder scan:** 已查全文,无 TBD/TODO/「实现后续 ...」「补充错误处理」等占位。

**3. Type consistency:**

| Type/symbol | 出处 | 一致性 |
|---|---|---|
| `Verdict = 'unknown' \| 'mastered' \| 'practice'` | Task 2 export | Task 3 import 使用 ✓ |
| `PoolCardState` | Task 2 export | Task 3 (`useState<PoolCardState[]>`) + Task 6 import ✓ |
| `Phase` 加 `'unitRecap'` | Task 7 step 1 | Task 8 step 2 validPhases 同步 ✓ |
| `DictationSource` | Task 7 step 1 | Task 7 step 3, Task 8 step 1/2 ✓ |
| `playAudio: (word: string) => void` | Task 2-7 prop 签名 | 全部一致 ✓ |
| `onRetryDictation(words: WordData[])` | Task 5/6/7 | 一致 ✓ |
| `scatter({ n, layout, seed? })` | Task 1 | Task 3 调用一致 (ScatterOptions) ✓ |

无类型 / 命名 drift。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-classify-unit-recap.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
