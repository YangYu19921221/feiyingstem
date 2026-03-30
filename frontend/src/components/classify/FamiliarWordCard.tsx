/**
 * 熟悉词学习卡片
 * 显示单词+释义，自动播放2遍（间隔0.5s），点😊确认快速过
 */
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import type { WordData } from '../../api/progress';
import ColoredWord from '../ColoredWord';
import ColoredPhonetic from '../ColoredPhonetic';

interface FamiliarWordCardProps {
  word: WordData;
  onConfirm: () => void;
  playAudio: (word: string) => void;
}

export default function FamiliarWordCard({
  word,
  onConfirm,
  playAudio,
}: FamiliarWordCardProps) {
  const [playCount, setPlayCount] = useState(0);
  const [canConfirm, setCanConfirm] = useState(false);
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;

    // 播放第1遍（通过setTimeout避免同步setState）
    const t1 = setTimeout(() => {
      playAudio(word.word);
      setPlayCount(1);
    }, 100);

    // 播放第2遍
    const t2 = setTimeout(() => {
      playAudio(word.word);
      setPlayCount(2);
    }, 1300);

    // 允许确认
    const t3 = setTimeout(() => setCanConfirm(true), 2100);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [word.id, word.word, playAudio]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
    >
      {/* 标签 */}
      <div className="mb-4">
        <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
          😊 熟悉词
        </span>
      </div>

      {/* 单词 */}
      <div className="mb-3">
        <ColoredWord
          word={word.word}
          syllables={word.syllables}
          className="text-4xl font-bold"
        />
      </div>

      {/* 音标 */}
      {word.phonetic && (
        <div className="mb-3 flex justify-center">
          <ColoredPhonetic phonetic={word.phonetic} size="sm" />
        </div>
      )}

      {/* 释义 */}
      {word.meaning && (
        <p className="text-lg text-gray-600 mb-4">
          {word.part_of_speech && (
            <span className="text-sm text-gray-400 mr-1">{word.part_of_speech}</span>
          )}
          {word.meaning}
        </p>
      )}

      {/* 播放状态 */}
      <div className="mb-6 text-sm text-gray-400">
        🔊 已播放 {playCount}/2 遍
      </div>

      {/* 确认按钮 */}
      <motion.button
        whileHover={canConfirm ? { scale: 1.05 } : {}}
        whileTap={canConfirm ? { scale: 0.95 } : {}}
        onClick={() => canConfirm && onConfirm()}
        disabled={!canConfirm}
        className={`px-8 py-3 rounded-2xl text-lg font-medium transition ${
          canConfirm
            ? 'bg-green-500 text-white shadow-lg hover:bg-green-600 cursor-pointer'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
        }`}
      >
        😊 确认，下一个
      </motion.button>
    </motion.div>
  );
}
