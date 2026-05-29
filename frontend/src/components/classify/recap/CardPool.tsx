import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, type PanInfo } from 'framer-motion'
import type { WordData } from '../../../api/progress'
import RecapCard, { type PoolCardState, type Verdict } from './RecapCard'
import FlyingCardLayer, { type FlyingCard } from './FlyingCardLayer'
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

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function pointInRect(px: number, py: number, rect: DOMRect | undefined): boolean {
  if (!rect) return false
  return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom
}

export default function CardPool({ words, playAudio, onComplete, initialCards }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const masteredBasketRef = useRef<HTMLDivElement>(null)
  const practiceBasketRef = useRef<HTMLDivElement>(null)
  const undoTimer = useRef<number | null>(null)
  const didFinish = useRef(false)
  // cards 镜像 ref: finish() 用它而不是闭包 cards, 避免学生拖最后一张到篮子的同时
  // 立即点 "完成 →" 时, finish 用了上一渲染的 stale cards (最后一张 verdict 仍 unknown).
  const cardsRef = useRef<PoolCardState[]>([])

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
  const [flying, setFlying] = useState<FlyingCard[]>([])
  // 篮子「接住」脉冲：飞行卡落地时 +1，驱动对应篮子弹一下，时序与落地对齐
  const [caught, setCaught] = useState<{ mastered: number; practice: number }>({ mastered: 0, practice: 0 })
  const flyId = useRef(0)

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

  function finish() {
    if (didFinish.current) return
    didFinish.current = true
    // 用 cardsRef.current 而不是闭包 cards: 学生拖最后一张到篮子的同时立即点 "完成 →",
    // 闭包 cards 是上一渲染的快照, 最后一张 verdict 仍是 'unknown' → 漏报.
    const latest = cardsRef.current.length > 0 ? cardsRef.current : cards
    const masteredWordIds: number[] = []
    const practiceWords: WordData[] = []
    for (const c of latest) {
      if (c.verdict === 'mastered') masteredWordIds.push(c.word.id)
      else if (c.verdict === 'practice') practiceWords.push(c.word)
    }
    onComplete({ masteredWordIds, practiceWords })
  }

  // 同步 cardsRef → finish() 能拿到最新 cards 而非闭包快照
  useEffect(() => {
    cardsRef.current = cards
  }, [cards])

  // 全部分类完毕自动收官
  useEffect(() => {
    if (sortedCount === words.length && words.length > 0 && !didFinish.current) {
      finish()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedCount, words.length])

  // 卸载清理 undoTimer
  useEffect(() => {
    return () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    }
  }, [])

  function flipCard(wordId: number) {
    setCards(prev => prev.map(c => c.word.id === wordId ? { ...c, flipped: !c.flipped } : c))
  }

  function setPosition(wordId: number, x: number, y: number) {
    setCards(prev => prev.map(c =>
      c.word.id === wordId ? { ...c, x: clamp(x, 5, 95), y: clamp(y, 8, 92) } : c
    ))
  }

  function handleDragEnd(wordId: number, info: PanInfo) {
    const drop: DropZone[] = []
    if (masteredBasketRef.current) drop.push({ rect: masteredBasketRef.current.getBoundingClientRect(), verdict: 'mastered' })
    if (practiceBasketRef.current) drop.push({ rect: practiceBasketRef.current.getBoundingClientRect(), verdict: 'practice' })
    for (const z of drop) {
      if (pointInRect(info.point.x, info.point.y, z.rect)) {
        const prev = cards.find(c => c.word.id === wordId)?.verdict ?? 'unknown'
        const card = cards.find(c => c.word.id === wordId)
        // 生成「飞入篮子」过场卡：从松手点飞向篮子中心，缩小淡出
        if (card) {
          flyId.current += 1
          setFlying(prevFly => [...prevFly, {
            id: flyId.current,
            word: card.word,
            from: { x: info.point.x, y: info.point.y },
            to: { x: z.rect.left + z.rect.width / 2, y: z.rect.top + z.rect.height / 2 },
            verdict: z.verdict,
            rotation: card.rotation,
          }])
        }
        // 立刻把原卡设为已分类（从池中消失），由飞行卡接管视觉过场
        setCards(prevCards => prevCards.map(c =>
          c.word.id === wordId ? { ...c, verdict: z.verdict } : c
        ))
        setLastSorted({ wordId, prev })
        if (undoTimer.current) window.clearTimeout(undoTimer.current)
        undoTimer.current = window.setTimeout(() => setLastSorted(null), 5000)
        return
      }
    }
  }

  function removeFlying(id: number) {
    setFlying(prev => {
      const landed = prev.find(f => f.id === id)
      if (landed) {
        // 落地瞬间触发对应篮子「接住」脉冲，时序与飞入对齐
        setCaught(c => landed.verdict === 'mastered'
          ? { ...c, mastered: c.mastered + 1 }
          : { ...c, practice: c.practice + 1 })
      }
      return prev.filter(f => f.id !== id)
    })
  }

  function undoLast() {
    if (!lastSorted) return
    const { wordId, prev } = lastSorted
    setCards(prevCards => prevCards.map(c =>
      c.word.id === wordId ? { ...c, verdict: prev } : c
    ))
    setLastSorted(null)
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
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

  const visibleCards = cards.filter(c => c.verdict === 'unknown')
  const isMobileView = typeof window !== 'undefined' && window.innerWidth < 768

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
        style={{ aspectRatio: isMobileView ? '9/14' : '16/10' }}
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
        <motion.div
          ref={masteredBasketRef}
          animate={{ scale: caught.mastered > 0 ? [1, 1.18, 1] : 1 }}
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
          key={`m-${caught.mastered}`}
          className="absolute bottom-3 right-3 w-20 h-20 rounded-2xl bg-amber-500 text-white flex flex-col items-center justify-center shadow-lg"
        >
          <div className="text-2xl">🏆</div>
          <div className="text-xs mt-0.5">我会了</div>
          <div className="font-numeric text-sm font-semibold">{masteredCount}</div>
        </motion.div>

        {/* 篮子: 再练 */}
        <motion.div
          ref={practiceBasketRef}
          animate={{ scale: caught.practice > 0 ? [1, 1.18, 1] : 1 }}
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
          key={`p-${caught.practice}`}
          className="absolute bottom-3 right-28 w-20 h-20 rounded-2xl bg-rose-400 text-white flex flex-col items-center justify-center shadow-lg"
        >
          <div className="text-2xl">💪</div>
          <div className="text-xs mt-0.5">再练</div>
          <div className="font-numeric text-sm font-semibold">{practiceCount}</div>
        </motion.div>
      </div>

      {/* 飞入篮子过场层（脱离卡池布局，按视口定位，落点精准） */}
      {flying.map(f => (
        <FlyingCardLayer key={f.id} fly={f} onDone={removeFlying} />
      ))}

      {/* 撤销 + 完成按钮 */}
      <div className="max-w-3xl mx-auto w-full mt-4 flex items-center justify-between">
        {lastSorted ? (
          <button
            type="button"
            onClick={undoLast}
            className="text-xs px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            ↶ 撤销最后一张
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
