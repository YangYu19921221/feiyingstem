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

// 发牌式:池子里最多一批,避免单词太多时一次铺满、卡片重叠拥挤
const BATCH_MOBILE = 6
const BATCH_DESKTOP = 8
const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768
const pickBatch = () => (isMobile() ? BATCH_MOBILE : BATCH_DESKTOP)
const freshRotation = () => (Math.random() - 0.5) * 20

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** 初始化:全部卡为数据源,只把前 batch 张未分类卡放进池子(active),其余在牌堆 */
function buildInitial(words: WordData[], initialCards?: PoolCardState[]) {
  const batch = pickBatch()
  const layout = isMobile() ? 'mobile' : 'desktop'
  const positions = scatter({ n: batch, layout })
  const cards: PoolCardState[] = (initialCards && initialCards.length === words.length)
    ? initialCards.map(c => ({ ...c }))
    : words.map(w => ({
        word: w, x: 50, y: 50, rotation: 0, zIndex: 1, flipped: false, verdict: 'unknown' as Verdict,
      }))
  const activeIds: number[] = []
  let slot = 0
  for (const c of cards) {
    if (c.verdict !== 'unknown') continue
    if (slot >= batch) break
    const p = positions[slot]
    c.x = p.x; c.y = p.y; c.rotation = p.rotation; c.zIndex = slot + 1
    activeIds.push(c.word.id)
    slot++
  }
  return { cards, activeIds }
}

export default function CardPool({ words, playAudio, onComplete, initialCards }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const masteredBasketRef = useRef<HTMLDivElement>(null)
  const practiceBasketRef = useRef<HTMLDivElement>(null)
  const undoTimer = useRef<number | null>(null)
  const didFinish = useRef(false)
  const cardsRef = useRef<PoolCardState[]>([])

  const init = useMemo(() => buildInitial(words, initialCards), [])  // 仅挂载时
  const [cards, setCards] = useState<PoolCardState[]>(init.cards)
  const [activeIds, setActiveIds] = useState<number[]>(init.activeIds)

  const [lastSorted, setLastSorted] = useState<{ wordId: number; prev: Verdict } | null>(null)
  const [flying, setFlying] = useState<FlyingCard[]>([])
  const [caught, setCaught] = useState<{ mastered: number; practice: number }>({ mastered: 0, practice: 0 })
  const flyId = useRef(0)

  const sortedCount = useMemo(() => cards.filter(c => c.verdict !== 'unknown').length, [cards])
  const masteredCount = useMemo(() => cards.filter(c => c.verdict === 'mastered').length, [cards])
  const practiceCount = useMemo(() => cards.filter(c => c.verdict === 'practice').length, [cards])
  const unknownCount = cards.length - sortedCount
  const deckCount = Math.max(0, unknownCount - activeIds.length)

  function finish() {
    if (didFinish.current) return
    didFinish.current = true
    const latest = cardsRef.current.length > 0 ? cardsRef.current : cards
    const masteredWordIds: number[] = []
    const practiceWords: WordData[] = []
    for (const c of latest) {
      if (c.verdict === 'mastered') masteredWordIds.push(c.word.id)
      else if (c.verdict === 'practice') practiceWords.push(c.word)
    }
    onComplete({ masteredWordIds, practiceWords })
  }

  useEffect(() => { cardsRef.current = cards }, [cards])

  useEffect(() => {
    if (sortedCount === words.length && words.length > 0 && !didFinish.current) finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedCount, words.length])

  useEffect(() => () => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
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
    // 命中判定放大:篮子 80px、卡片 120×160,按半卡 + 余量膨胀;两篮都命中按最近中心
    const MARGIN_X = 72
    const MARGIN_Y = 92
    const zones: { verdict: 'mastered' | 'practice'; rect: DOMRect; cx: number; cy: number }[] = []
    if (masteredBasketRef.current) {
      const r = masteredBasketRef.current.getBoundingClientRect()
      zones.push({ verdict: 'mastered', rect: r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 })
    }
    if (practiceBasketRef.current) {
      const r = practiceBasketRef.current.getBoundingClientRect()
      zones.push({ verdict: 'practice', rect: r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 })
    }
    const { x: px, y: py } = info.point
    const candidates = zones.filter(z =>
      px >= z.rect.left - MARGIN_X && px <= z.rect.right + MARGIN_X &&
      py >= z.rect.top - MARGIN_Y && py <= z.rect.bottom + MARGIN_Y)
    if (candidates.length === 0) return
    candidates.sort((a, b) =>
      ((px - a.cx) ** 2 + (py - a.cy) ** 2) - ((px - b.cx) ** 2 + (py - b.cy) ** 2))
    const z = candidates[0]

    const freed = cards.find(c => c.word.id === wordId)
    const prev = freed?.verdict ?? 'unknown'
    // 牌堆里下一张(未分类且不在池中),发到刚空出的位置
    const deckCard = cards.find(c =>
      c.verdict === 'unknown' && c.word.id !== wordId && !activeIds.includes(c.word.id))

    if (freed) {
      flyId.current += 1
      setFlying(p => [...p, {
        id: flyId.current, word: freed.word,
        from: { x: px, y: py }, to: { x: z.cx, y: z.cy },
        verdict: z.verdict, rotation: freed.rotation,
      }])
    }
    setCards(prevCards => prevCards.map(c => {
      if (c.word.id === wordId) return { ...c, verdict: z.verdict }
      if (deckCard && freed && c.word.id === deckCard.word.id) {
        return { ...c, x: freed.x, y: freed.y, rotation: freshRotation(), zIndex: freed.zIndex }
      }
      return c
    }))
    setActiveIds(prevIds => {
      const next = prevIds.filter(id => id !== wordId)
      if (deckCard) next.push(deckCard.word.id)
      return next
    })
    setLastSorted({ wordId, prev })
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setLastSorted(null), 5000)
  }

  function removeFlying(id: number) {
    setFlying(prev => {
      const landed = prev.find(f => f.id === id)
      if (landed) {
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
      c.word.id === wordId
        ? { ...c, verdict: prev, x: 50, y: 28, rotation: freshRotation() }
        : c
    ))
    if (prev === 'unknown') {
      setActiveIds(ids => ids.includes(wordId) ? ids : [...ids, wordId])
    }
    setLastSorted(null)
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
  }

  function shake() {
    const positions = scatter({ n: pickBatch(), layout: isMobile() ? 'mobile' : 'desktop' })
    let slot = 0
    setCards(prev => prev.map(c => {
      if (c.verdict === 'unknown' && activeIds.includes(c.word.id)) {
        const p = positions[slot % positions.length]; slot++
        return { ...c, x: p.x, y: p.y, rotation: p.rotation }
      }
      return c
    }))
  }

  const visibleCards = cards.filter(c => c.verdict === 'unknown' && activeIds.includes(c.word.id))
  const mobileView = isMobile()

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
        style={{ aspectRatio: mobileView ? '9/14' : '16/10' }}
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

        {/* 牌堆「还剩 N 张」,给一堆单词以进度感,而非一次全铺出来 */}
        {deckCount > 0 && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 pointer-events-none select-none">
            <div className="relative w-9 h-12">
              <div className="absolute inset-0 rounded-md bg-white"
                style={{ border: '1px solid oklch(0.82 0.085 65)', transform: 'rotate(-7deg)' }} />
              <div className="absolute inset-0 rounded-md bg-white"
                style={{ border: '1px solid oklch(0.82 0.085 65)', transform: 'rotate(4deg)' }} />
              <div className="absolute inset-0 rounded-md bg-white flex items-center justify-center font-numeric font-bold text-ink"
                style={{ border: '1px solid oklch(0.82 0.085 65)' }}>
                {deckCount}
              </div>
            </div>
            <span className="text-xs text-ink-soft">还剩 {deckCount} 张</span>
          </div>
        )}

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

      {/* 飞入篮子过场层 */}
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
