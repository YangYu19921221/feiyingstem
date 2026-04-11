/**
 * 音节加速度卡片
 * 夹生词：分音节显示 + 加速度动画，循环2轮
 * 陌生词：先播放4遍完整发音，再进入音节加速度动画，循环3轮
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { WordData } from '../../api/progress';
import ColoredPhonetic from '../ColoredPhonetic';
import { useSyllableRhythm } from '../../hooks/useSyllableRhythm';

// 音节颜色（与 ColoredWord 一致）
const SYLLABLE_COLORS = [
  'text-orange-500',
  'text-sky-500',
  'text-emerald-500',
  'text-violet-500',
  'text-rose-500',
  'text-amber-500',
];

type CardMode = 'unknown_listen' | 'rhythm' | 'done';

interface SyllableRhythmCardProps {
  word: WordData;
  isUnknown: boolean; // true=陌生词(4遍+3轮), false=夹生词(2轮)
  onComplete: () => void;
  playAudio: (word: string) => void;
}

export default function SyllableRhythmCard({
  word,
  isUnknown,
  onComplete,
  playAudio,
}: SyllableRhythmCardProps) {
  const syllables = word.syllables ? word.syllables.split('#') : [word.word];
  const totalRounds = isUnknown ? 3 : 2;

  // 陌生词先听4遍的状态
  const [mode, setMode] = useState<CardMode>(isUnknown ? 'unknown_listen' : 'rhythm');
  const [listenCount, setListenCount] = useState(0);
  const [canConfirmListen, setCanConfirmListen] = useState(false);
  const listenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedListenRef = useRef(false);

  // 音节节奏
  const onRoundStart = useCallback(() => {
    playAudio(word.word);
  }, [word.word, playAudio]);

  const onRhythmComplete = useCallback(() => {
    setMode('done');
  }, []);

  const {
    currentSyllableIndex,
    currentRound,
    start: startRhythm,
    stop: stopRhythm,
  } = useSyllableRhythm({
    syllables,
    totalRounds,
    onRoundStart,
    onComplete: onRhythmComplete,
  });

  // 陌生词：播放4遍
  useEffect(() => {
    if (mode !== 'unknown_listen' || startedListenRef.current) return;
    startedListenRef.current = true;

    let count = 0;
    const playNext = () => {
      if (count >= 4) {
        setCanConfirmListen(true);
        return;
      }
      playAudio(word.word);
      count++;
      setListenCount(count);
      listenTimerRef.current = setTimeout(playNext, 1500);
    };

    // 稍微延迟开始
    listenTimerRef.current = setTimeout(playNext, 300);

    return () => {
      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
    };
  }, [mode, word.id, word.word, playAudio]);

  // 进入节奏模式时自动开始
  useEffect(() => {
    if (mode === 'rhythm') {
      const timer = setTimeout(() => startRhythm(), 300);
      return () => clearTimeout(timer);
    }
    return () => stopRhythm();
  }, [mode, startRhythm, stopRhythm]);

  const handleListenConfirm = () => {
    if (!canConfirmListen) return;
    setMode('rhythm');
  };

  // 预计算音节切片，避免每次节拍渲染时重复计算
  const syllableSlices = useMemo(() => {
    let cursor = 0;
    return syllables.map((syl, i) => {
      const isLast = i === syllables.length - 1;
      let end = cursor + syl.length;
      if (isLast) {
        end = word.word.length;
      } else {
        while (end < word.word.length && word.word[end] !== ' ' && !/[a-zA-Z]/.test(word.word[end])) {
          end++;
        }
      }
      const slice = word.word.slice(cursor, end);
      cursor = end;
      return slice;
    });
  }, [word.word, syllables]);

  // 陌生词听4遍阶段
  if (mode === 'unknown_listen') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
      >
        <div className="mb-4">
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium">
            😰 陌生词 · 听读阶段
          </span>
        </div>

        <div className="text-4xl font-bold mb-3 text-gray-800">{word.word}</div>

        {word.phonetic && (
          <div className="mb-3 flex justify-center">
            <ColoredPhonetic phonetic={word.phonetic} size="sm" />
          </div>
        )}

        {word.meaning && (
          <p className="text-lg text-gray-600 mb-6">
            {word.part_of_speech && (
              <span className="text-sm text-gray-400 mr-1">{word.part_of_speech}</span>
            )}
            {word.meaning}
          </p>
        )}

        {/* 播放进度 */}
        <div className="mb-6">
          <div className="flex justify-center gap-2 mb-2">
            {[1, 2, 3, 4].map(i => (
              <motion.div
                key={i}
                animate={{
                  scale: i === listenCount ? [1, 1.3, 1] : 1,
                  backgroundColor: i <= listenCount ? '#FF5757' : '#e5e7eb',
                }}
                transition={{ duration: 0.3 }}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
              >
                {i <= listenCount ? '🔊' : i}
              </motion.div>
            ))}
          </div>
          <p className="text-sm text-gray-400">已播放 {listenCount}/4 遍</p>
        </div>

        <motion.button
          whileHover={canConfirmListen ? { scale: 1.05 } : {}}
          whileTap={canConfirmListen ? { scale: 0.95 } : {}}
          onClick={handleListenConfirm}
          disabled={!canConfirmListen}
          className={`px-8 py-3 rounded-2xl text-lg font-medium transition ${
            canConfirmListen
              ? 'bg-red-500 text-white shadow-lg hover:bg-red-600 cursor-pointer'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          😰 开始音节练习
        </motion.button>
      </motion.div>
    );
  }

  // 完成阶段
  if (mode === 'done') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
      >
        <div className="text-5xl mb-4">✅</div>
        <div className="text-2xl font-bold mb-2 text-gray-800">{word.word}</div>
        <p className="text-gray-500 mb-6">音节练习完成</p>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onComplete}
          className="px-8 py-3 rounded-2xl text-lg font-medium bg-primary text-white shadow-lg hover:opacity-90 cursor-pointer"
        >
          下一个
        </motion.button>
      </motion.div>
    );
  }

  // 音节节奏阶段
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
    >
      <div className="mb-4">
        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
          isUnknown ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
        }`}>
          {isUnknown ? '😰 陌生词' : '🤔 夹生词'} · 音节节奏 第{currentRound}/{totalRounds}轮
        </span>
      </div>

      {/* 音节显示 — 用 word.word 的字符渲染，避免大小写不一致 */}
      <div className="flex items-center justify-center gap-2 mb-6 min-h-[80px]">
        {syllableSlices.map((slice, i) => (
          <motion.span
            key={i}
            animate={{
              scale: i === currentSyllableIndex ? 1.3 : 1,
              opacity: i === currentSyllableIndex ? 1 : 0.4,
            }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className={`text-4xl font-bold ${SYLLABLE_COLORS[i % SYLLABLE_COLORS.length]}`}
          >
            {slice}
          </motion.span>
        ))}
      </div>

      {/* 音标 */}
      {word.phonetic && (
        <div className="mb-4 flex justify-center">
          <ColoredPhonetic phonetic={word.phonetic} size="sm" />
        </div>
      )}

      {/* 释义 */}
      {word.meaning && (
        <p className="text-gray-600 mb-4">
          {word.part_of_speech && (
            <span className="text-sm text-gray-400 mr-1">{word.part_of_speech}</span>
          )}
          {word.meaning}
        </p>
      )}

      {/* 轮次进度 */}
      <div className="flex justify-center gap-2">
        {Array.from({ length: totalRounds }, (_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-full transition ${
              i + 1 <= currentRound ? 'bg-primary' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
    </motion.div>
  );
}
