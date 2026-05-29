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
  const [showCurtain, setShowCurtain] = useState(false)
  const advanceTimer = useRef<number | null>(null)
  const audioTimer = useRef<number | null>(null)
  const cancelled = useRef(false)
  const doneCalled = useRef(false)

  // 卸载时清干净所有 timer + 标记取消
  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
      if (audioTimer.current !== null) window.clearTimeout(audioTimer.current)
    }
  }, [])

  useEffect(() => {
    if (showCurtain) return
    if (index >= words.length) {
      // 全部播完, 黑屏过渡然后调 onDone
      setShowCurtain(true)
      window.setTimeout(() => {
        if (!cancelled.current && !doneCalled.current) {
          doneCalled.current = true
          onDone()
        }
      }, 800)
      return
    }
    const word = words[index]
    // 入场后 0.2s 触发 TTS
    audioTimer.current = window.setTimeout(() => {
      if (!cancelled.current) playAudio(word.word)
    }, ENTER_MS - 200 > 0 ? ENTER_MS - 200 : 0)
    advanceTimer.current = window.setTimeout(() => {
      if (!cancelled.current) setIndex(i => i + 1)
    }, PER_CARD_MS)
    return () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
      if (audioTimer.current !== null) window.clearTimeout(audioTimer.current)
    }
  }, [index, words, playAudio, onDone, showCurtain])

  function skip() {
    if (showCurtain) return
    setShowCurtain(true)
    window.setTimeout(() => {
      if (!cancelled.current && !doneCalled.current) {
        doneCalled.current = true
        onDone()
      }
    }, 500)
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
      {/* 已经熟悉的学生可随时跳过快闪，直接进分类池 */}
      <button
        type="button"
        onClick={skip}
        className="absolute top-4 right-4 text-xs text-paper/70 hover:text-paper px-3 py-1.5 rounded-full border border-paper/25 hover:border-paper/50 transition"
      >
        都认识，跳过 →
      </button>

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
              <div className="text-lg text-ink-soft">{current.meaning ?? ''}</div>
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
