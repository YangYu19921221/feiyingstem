import { motion } from 'framer-motion'
import type { WordData } from '../../../api/progress'

const CARD_W = 120
const CARD_H = 160

export interface FlyingCard {
  id: number              // 自增 key
  word: WordData
  from: { x: number; y: number }   // 松手点（视口坐标，px）
  to: { x: number; y: number }     // 篮子中心（视口坐标，px）
  verdict: 'mastered' | 'practice'
  rotation: number
}

interface Props {
  fly: FlyingCard
  onDone: (id: number) => void
}

const EASE = [0.16, 1, 0.3, 1] as const  // ease-out-expo，丝滑收束

/**
 * 卡片放进篮子后的「飞入并收窄」过场。
 * 从松手点出发飞向篮子中心，过程中宽度快速收窄(scaleX→很小)、
 * 高度只略缩(scaleY 收一半)，像一张卡被竖着塞进篮子的投币口，最后淡出。
 * 用 transform(x/y/scale) 而非 left/top，GPU 友好、符合 motion 规范。
 * 尊重 prefers-reduced-motion：直接快速淡出。
 */
export default function FlyingCardLayer({ fly, onDone }: Props) {
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const tint = fly.verdict === 'mastered'
    ? 'oklch(0.97 0.03 80)'   // 暖金，对应「我会了」
    : 'oklch(0.96 0.03 20)'   // 暖珊瑚，对应「再练」
  const edge = fly.verdict === 'mastered'
    ? 'oklch(0.8 0.12 80)'
    : 'oklch(0.78 0.13 22)'

  // 卡片左上角定位到松手点(减去半卡尺寸即居中)，之后用 transform 位移到篮子
  const baseStyle: React.CSSProperties = {
    position: 'fixed',
    left: fly.from.x - CARD_W / 2,
    top: fly.from.y - CARD_H / 2,
    zIndex: 1000,
    pointerEvents: 'none',
  }
  const dx = fly.to.x - fly.from.x
  const dy = fly.to.y - fly.from.y

  if (reduce) {
    return (
      <motion.div
        initial={{ x: 0, y: 0, opacity: 0.9 }}
        animate={{ x: dx, y: dy, opacity: 0 }}
        transition={{ duration: 0.28, ease: EASE }}
        onAnimationComplete={() => onDone(fly.id)}
        style={baseStyle}
      >
        <Card word={fly.word} tint={tint} edge={edge} />
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1, rotate: fly.rotation }}
      animate={{
        x: dx,
        y: dy,
        // 宽变窄：宽度从 1 → 略撑 → 收到很窄(0.06)；高度只收一半，呈竖条被吸入
        scaleX: [1, 1.05, 0.06],
        scaleY: [1, 1.05, 0.4],
        opacity: [1, 1, 0],
        rotate: 0,
      }}
      transition={{ duration: 0.7, ease: EASE, times: [0, 0.22, 1] }}
      onAnimationComplete={() => onDone(fly.id)}
      style={{ ...baseStyle, transformOrigin: 'center center' }}
    >
      <Card word={fly.word} tint={tint} edge={edge} />
    </motion.div>
  )
}

function Card({ word, tint, edge }: { word: WordData; tint: string; edge: string }) {
  return (
    <div
      className="rounded-lg shadow-lg flex flex-col items-center justify-center p-3"
      style={{ width: CARD_W, height: CARD_H, background: tint, border: `1.5px solid ${edge}` }}
    >
      <div className="text-center font-display text-xl font-bold text-ink leading-tight">
        {word.word}
      </div>
      {word.phonetic && (
        <div className="mt-2 text-xs text-ink-soft">{word.phonetic}</div>
      )}
    </div>
  )
}
