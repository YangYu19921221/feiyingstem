import { motion } from 'framer-motion'
import type { WordData } from '../../../api/progress'

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
 * 卡片放进篮子后的「飞入并缩小」过场。
 * 从松手点出发，沿 ease-out-expo 飞向篮子中心，同时缩小、淡出、转正，
 * 像被吸进篮子。用 fixed 视口定位，脱离卡池布局，落点精准。
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

  if (reduce) {
    return (
      <motion.div
        initial={{ opacity: 0.9 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        onAnimationComplete={() => onDone(fly.id)}
        style={{
          position: 'fixed', left: fly.to.x, top: fly.to.y,
          translateX: '-50%', translateY: '-50%', zIndex: 1000, pointerEvents: 'none',
        }}
      >
        <Card word={fly.word} tint={tint} edge={edge} />
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{
        left: fly.from.x, top: fly.from.y,
        scale: 1.1, opacity: 1, rotate: fly.rotation,
      }}
      animate={{
        left: fly.to.x, top: fly.to.y,
        // 先稍微放大被「拎起」，再一路缩到很小被吸入篮子
        scale: [1.1, 1.15, 0.18],
        opacity: [1, 1, 0],
        rotate: 0,
      }}
      transition={{
        duration: 0.62,
        ease: EASE,
        times: [0, 0.18, 1],
      }}
      onAnimationComplete={() => onDone(fly.id)}
      style={{
        position: 'fixed',
        translateX: '-50%', translateY: '-50%',
        zIndex: 1000, pointerEvents: 'none',
      }}
    >
      <Card word={fly.word} tint={tint} edge={edge} />
    </motion.div>
  )
}

function Card({ word, tint, edge }: { word: WordData; tint: string; edge: string }) {
  return (
    <div
      className="w-[120px] h-[160px] rounded-lg shadow-lg flex flex-col items-center justify-center p-3"
      style={{ background: tint, border: `1.5px solid ${edge}` }}
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
