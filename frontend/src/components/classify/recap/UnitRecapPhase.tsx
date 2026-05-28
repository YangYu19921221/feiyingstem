import { useState, useCallback, useEffect } from 'react'
import type { WordData } from '../../../api/progress'
import FlashStage from './FlashStage'
import CardPool from './CardPool'
import RecapSummary from './RecapSummary'

type Sub = 'flash' | 'pool' | 'summary'

interface Props {
  words: WordData[]
  unitName?: string
  initialSub?: Sub
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

  // 极小单元 (N <= 2) 跳过整个 recap
  // 用 useEffect 调 onSkipToSummary 避免渲染时副作用
  useEffect(() => {
    if (words.length <= 2) {
      onSkipToSummary()
    }
  }, [words.length, onSkipToSummary])

  const handleFlashDone = useCallback(() => setSub('pool'), [])

  const handlePoolComplete = useCallback((result: {
    masteredWordIds: number[]
    practiceWords: WordData[]
  }) => {
    setMasteredWordIds(result.masteredWordIds)
    setPracticeWords(result.practiceWords)
    setSub('summary')
  }, [])

  if (words.length <= 2) {
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
