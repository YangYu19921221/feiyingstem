import { useRef, useState, useCallback, useEffect } from 'react'
import { motion, type PanInfo } from 'framer-motion'
import type { WordData } from '../../../api/progress'

export type Verdict = 'unknown' | 'mastered' | 'practice'

export interface PoolCardState {
  word: WordData
  x: number          // 0-100 百分比
  y: number
  rotation: number   // -12..12 度
  zIndex: number
  flipped: boolean
  verdict: Verdict
}

interface Props {
  card: PoolCardState
  containerRef: React.RefObject<HTMLDivElement | null>
  onFlip: (wordId: number) => void
  onPositionChange: (wordId: number, x: number, y: number) => void
  onDrag: (wordId: number, info: PanInfo) => void
  onDragEnd: (wordId: number, info: PanInfo) => void
  playAudio: (word: string) => void
}

const LONG_PRESS_MS = 400
const AUDIO_THROTTLE_MS = 800

export default function RecapCard({
  card, containerRef, onFlip, onPositionChange, onDrag, onDragEnd, playAudio,
}: Props) {
  const longPressTimer = useRef<number | null>(null)
  const lastAudioAt = useRef<number>(0)
  const dragMoved = useRef<boolean>(false)
  const [isLongPressing, setIsLongPressing] = useState(false)

  // 卸载时清理任何挂着的 timer
  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) {
        window.clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
  }, [])

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handlePointerDown = useCallback(() => {
    dragMoved.current = false
    cancelLongPress()
    longPressTimer.current = window.setTimeout(() => {
      const now = Date.now()
      if (now - lastAudioAt.current < AUDIO_THROTTLE_MS) return
      lastAudioAt.current = now
      setIsLongPressing(true)
      playAudio(card.word.word)
      window.setTimeout(() => setIsLongPressing(false), 600)
    }, LONG_PRESS_MS)
  }, [card.word.word, playAudio, cancelLongPress])

  const handleDragStart = useCallback(() => {
    dragMoved.current = true
    cancelLongPress()
  }, [cancelLongPress])

  const handleClick = useCallback(() => {
    if (dragMoved.current) return
    onFlip(card.word.id)
  }, [card.word.id, onFlip])

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    cancelLongPress()
    onDragEnd(card.word.id, info)
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const newX = ((info.point.x - rect.left) / rect.width) * 100
    const newY = ((info.point.y - rect.top) / rect.height) * 100
    onPositionChange(card.word.id, newX, newY)
  }, [card.word.id, onDragEnd, onPositionChange, containerRef, cancelLongPress])

  const handleDrag = useCallback((_: unknown, info: PanInfo) => {
    onDrag(card.word.id, info)
  }, [card.word.id, onDrag])

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragConstraints={containerRef}
      dragElastic={0.1}
      onPointerDown={handlePointerDown}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onClick={handleClick}
      onDragEnd={handleDragEnd}
      whileDrag={{ scale: 1.12, zIndex: 999 }}
      style={{
        position: 'absolute',
        left: `${card.x}%`,
        top: `${card.y}%`,
        rotate: `${card.rotation}deg`,
        translateX: '-50%',
        translateY: '-50%',
        zIndex: card.zIndex,
        WebkitTouchCallout: 'none',
        userSelect: 'none',
        touchAction: 'none',
      }}
      className="w-[120px] h-[160px] cursor-grab active:cursor-grabbing"
    >
      <div
        className="relative w-full h-full"
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 0.5s',
          transform: card.flipped ? 'rotateY(180deg)' : 'rotateY(0)',
        }}
      >
        {/* 正面：近白卡(比暖池更亮更冷一点)+ 实暖描边 + 软阴影，从池子里浮起来 */}
        <div
          className="absolute inset-0 rounded-lg p-3 flex flex-col items-center justify-center"
          style={{
            backfaceVisibility: 'hidden',
            background: 'oklch(0.995 0.004 240)',
            border: '1px solid oklch(0.82 0.085 65)',
            boxShadow: '0 6px 16px -6px oklch(0.6 0.12 55 / 0.35), 0 2px 4px oklch(0.6 0.12 55 / 0.16)',
          }}
        >
          <div className="text-center font-display text-xl font-bold text-ink leading-tight">
            {card.word.word}
          </div>
          {card.word.phonetic && (
            <div className="mt-2 text-xs font-medium" style={{ color: 'oklch(0.62 0.19 40)' }}>
              {card.word.phonetic}
            </div>
          )}
          <div
            className={`absolute bottom-1 right-1 text-sm transition-colors ${
              isLongPressing ? 'text-accent-warm' : 'text-ink-mute'
            }`}
          >
            🔊
          </div>
        </div>
        {/* 背面：冷天空蓝(品牌 #00D9FF 淡版)，与暖橙池子冷暖对比，翻面像揭晓答案 */}
        <div
          className="absolute inset-0 rounded-lg p-3 flex flex-col items-center justify-center"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            background: 'oklch(0.95 0.045 230)',
            border: '1px solid oklch(0.78 0.1 230)',
            boxShadow: '0 6px 16px -6px oklch(0.6 0.1 230 / 0.35), 0 2px 4px oklch(0.6 0.1 230 / 0.16)',
          }}
        >
          <div className="text-center text-base font-semibold text-ink">
            {card.word.meaning}
          </div>
          {card.word.example_sentence && (
            <div className="mt-1 text-[10px] text-center line-clamp-2" style={{ color: 'oklch(0.42 0.05 230)' }}>
              {card.word.example_sentence}
            </div>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); playAudio(card.word.word) }}
            className="absolute bottom-1 right-1 text-sm hover:text-accent-warm"
            style={{ color: 'oklch(0.55 0.09 230)' }}
          >
            🔊
          </button>
        </div>
      </div>
    </motion.div>
  )
}
