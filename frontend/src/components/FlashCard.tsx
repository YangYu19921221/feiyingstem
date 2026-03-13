import { useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2 } from 'lucide-react';
import type { Word } from '../api/words';
import ColoredPhonetic from './ColoredPhonetic';

interface FlashCardProps {
  word: Word;
  onNext: () => void;
  onKnow: () => void;
  onDontKnow: () => void;
}

const FlashCard = ({ word, onNext, onKnow, onDontKnow }: FlashCardProps) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  // 语音播放函数 - 支持Web Speech API和自定义音频
  const handlePlayAudio = () => {
    if (isPlaying) return; // 防止重复播放

    setIsPlaying(true);

    // 如果有自定义音频URL(后续接入阿里云TTS后会有)
    if (word.audio_url) {
      const audio = new Audio(word.audio_url);
      audio.onended = () => setIsPlaying(false);
      audio.onerror = () => {
        setIsPlaying(false);
        console.error('音频播放失败,使用Web Speech API备用');
        playWithSpeechAPI();
      };
      audio.play().catch(() => {
        setIsPlaying(false);
        playWithSpeechAPI();
      });
    } else {
      // 使用浏览器自带的Web Speech API(临时方案)
      playWithSpeechAPI();
    }
  };

  // Web Speech API播放
  const playWithSpeechAPI = () => {
    if ('speechSynthesis' in window) {
      // 取消之前的语音
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(word.word);
      utterance.lang = 'en-US'; // 英语发音
      utterance.rate = 0.9; // 稍慢一点,适合学习
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onend = () => setIsPlaying(false);
      utterance.onerror = () => setIsPlaying(false);

      window.speechSynthesis.speak(utterance);
    } else {
      setIsPlaying(false);
      alert('您的浏览器不支持语音功能');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 p-4">
      {/* 进度提示 */}
      <div className="mb-8 text-center">
        <p className="text-lg text-gray-600">
          难度: <span className="font-bold text-primary">{'⭐'.repeat(word.difficulty)}</span>
        </p>
        {word.grade_level && (
          <p className="text-sm text-gray-500 mt-1">{word.grade_level}</p>
        )}
      </div>

      {/* 3D翻转卡片 */}
      <div className="perspective-1000 w-full max-w-md mb-8">
        <motion.div
          className="relative w-full h-96 cursor-pointer"
          onClick={handleFlip}
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.6, type: 'spring' }}
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* 正面 - 单词 */}
          <div
            className="absolute w-full h-full backface-hidden"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="w-full h-full bg-white rounded-3xl shadow-2xl p-8 flex flex-col items-center justify-center border-4 border-primary">
              <div className="text-center">
                <h1 className="text-5xl font-bold text-gray-800 mb-4">
                  {word.word}
                </h1>

                {word.phonetic && (
                  <div className="flex items-center justify-center gap-2 mb-6">
                    <ColoredPhonetic phonetic={word.phonetic || ''} size="lg" showLegend />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayAudio();
                      }}
                      disabled={isPlaying}
                      className={`p-2 rounded-full transition-colors ${
                        isPlaying
                          ? 'bg-accent/60 cursor-not-allowed'
                          : 'bg-accent hover:bg-accent/80'
                      }`}
                    >
                      <Volume2 className="w-5 h-5 text-white" />
                    </button>
                  </div>
                )}

                {word.image_url && (
                  <img
                    src={word.image_url}
                    alt={word.word}
                    className="w-48 h-48 object-cover rounded-2xl mx-auto mb-4"
                  />
                )}

                <p className="text-2xl mt-8">🤔</p>
                <p className="text-gray-500 mt-2">点击翻转查看释义</p>
              </div>
            </div>
          </div>

          {/* 背面 - 释义 */}
          <div
            className="absolute w-full h-full backface-hidden"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <div className="w-full h-full bg-gradient-to-br from-primary to-secondary rounded-3xl shadow-2xl p-8 overflow-y-auto">
              <div className="text-white">
                <h2 className="text-3xl font-bold mb-6">{word.word}</h2>

                {word.definitions && word.definitions.map((def, index) => (
                  <div key={def.id || index} className="mb-6 bg-white/20 rounded-2xl p-4 backdrop-blur-sm">
                    <p className="font-semibold text-lg mb-2">
                      {def.part_of_speech}
                    </p>
                    <p className="mb-3 text-white/95">{def.meaning}</p>
                    {def.example_sentence && (
                      <div className="bg-white/30 rounded-xl p-3">
                        <p className="text-sm italic mb-1">
                          {def.example_sentence}
                        </p>
                        {def.example_translation && (
                          <p className="text-xs text-white/80">
                            {def.example_translation}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {word.tags && word.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {word.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-white/30 rounded-full text-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <p className="text-center mt-6 text-white/80">
                  点击翻转回到正面
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-4 w-full max-w-md">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onDontKnow}
          className="flex-1 py-4 bg-error text-white rounded-2xl font-bold text-lg shadow-lg hover:shadow-xl transition-shadow"
        >
          不认识 😕
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onKnow}
          className="flex-1 py-4 bg-success text-white rounded-2xl font-bold text-lg shadow-lg hover:shadow-xl transition-shadow"
        >
          认识 😊
        </motion.button>
      </div>

      {/* 跳过按钮 */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onNext}
        className="mt-4 px-8 py-3 bg-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-300 transition-colors"
      >
        跳过 ⏭️
      </motion.button>
    </div>
  );
};

export default FlashCard;
