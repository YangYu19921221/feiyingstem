import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { imeSafeInputProps } from '../../utils/noSuggestInput';
import { useAudio } from '../../hooks/useAudio';

/** 过关题型(与后端 adapters.EXAM_TYPES 对齐) */
export type PkExamType = 'en_to_cn' | 'cn_to_en' | 'listening' | 'spelling';

interface PkExamCardProps {
  word: { id: number; word: string; translation: string };
  examType: PkExamType;
  /** 选择题(en_to_cn/cn_to_en)的选项;听写/拼写为空 */
  options?: string[];
  /** 选择题回传 {selected};听写/拼写回传 {text}。ms=作答耗时 */
  onSelect: (selected: string, ms: number) => void;
  onText: (text: string, ms: number) => void;
  disabled?: boolean;
  /** 服务端超时(ms),仅用于本地倒计时显示,判分以服务端为准 */
  timeoutMs?: number;
}

const TYPE_LABEL: Record<PkExamType, string> = {
  en_to_cn: '🏁 过关 · 选中文意思',
  cn_to_en: '🏁 过关 · 选对应单词',
  listening: '🏁 过关 · 听音拼写',
  spelling: '🏁 过关 · 看义拼写',
};

export default function PkExamCard({
  word,
  examType,
  options = [],
  onSelect,
  onText,
  disabled = false,
  timeoutMs = 30_000,
}: PkExamCardProps) {
  const [text, setText] = useState('');
  const [remaining, setRemaining] = useState(timeoutMs);
  const [playCount, setPlayCount] = useState(0);
  const startRef = useRef<number>(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const { playAudio } = useAudio();

  const isChoice = examType === 'en_to_cn' || examType === 'cn_to_en';
  const isInput = examType === 'listening' || examType === 'spelling';

  // 切题重置(word.id 或题型变化都重置);听写题自动播一次发音
  useEffect(() => {
    setText('');
    setPlayCount(0);
    startRef.current = Date.now();
    setRemaining(timeoutMs);
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, timeoutMs - (Date.now() - startRef.current)));
    }, 200);
    if (examType === 'listening') {
      const t = setTimeout(() => {
        playAudio(word.word, 1, word.id).then(() => setPlayCount(1)).catch(() => {});
      }, 300);
      return () => { window.clearInterval(timer); clearTimeout(t); };
    }
    if (isInput) setTimeout(() => inputRef.current?.focus(), 100);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.id, examType, timeoutMs]);

  const replay = () => {
    if (playCount >= 3) return;
    playAudio(word.word, 1, word.id).then(() => setPlayCount((p) => p + 1)).catch(() => {});
  };

  const submitText = () => {
    if (disabled || !text.trim()) return;
    onText(text.trim(), Date.now() - startRef.current);
  };

  const pick = (opt: string) => {
    if (disabled) return;
    onSelect(opt, Date.now() - startRef.current);
  };

  // 拼写题:首字母提示(与分类记忆法过关一致)
  const spellingHint = word.word ? word.word[0] + '_'.repeat(Math.max(0, word.word.length - 1)) : '';

  return (
    <div className="flex flex-col p-6 bg-white rounded-2xl shadow-md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs px-3 py-1 rounded-full bg-orange-100 text-primary font-medium">
          {TYPE_LABEL[examType]}
        </span>
        <span className="text-xs text-gray-400">剩余 {Math.ceil(remaining / 1000)} 秒</span>
      </div>

      {/* 英译中 / 中译英:选择题 */}
      {isChoice && (
        <div>
          <h3 className={`${examType === 'en_to_cn' ? 'text-3xl' : 'text-xl'} font-bold text-ink text-center mb-5`}>
            {examType === 'en_to_cn' ? word.word : word.translation}
          </h3>
          <div className="space-y-2.5">
            {options.map((opt, i) => (
              <motion.button
                key={`${opt}-${i}`}
                whileTap={{ scale: 0.98 }}
                onClick={() => pick(opt)}
                disabled={disabled}
                className="w-full text-left p-3.5 rounded-xl border-2 border-gray-200 hover:border-primary/50 transition font-medium disabled:opacity-50"
              >
                <span className="text-gray-400 mr-2">{String.fromCharCode(65 + i)}.</span>
                {opt}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* 听音拼写 */}
      {examType === 'listening' && (
        <div className="text-center">
          <p className="text-gray-500 mb-4">听发音,拼出单词</p>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={replay}
            disabled={playCount >= 3}
            className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl mx-auto mb-2 shadow-lg ${
              playCount >= 3 ? 'bg-gray-200' : 'bg-gradient-to-br from-primary to-orange-500 text-white'
            }`}
          >
            🔊
          </motion.button>
          <p className="text-xs text-gray-400 mb-4">可播放 {3 - playCount} 次</p>
        </div>
      )}

      {/* 看义拼写 */}
      {examType === 'spelling' && (
        <div className="text-center">
          <h3 className="text-xl font-bold text-ink mb-2">{word.translation}</h3>
          <p className="text-sm text-primary mb-4">
            提示: <span className="font-mono font-bold tracking-widest">{spellingHint}</span>
          </p>
        </div>
      )}

      {/* 输入题:统一输入框 + 提交 */}
      {isInput && (
        <>
          <input
            {...imeSafeInputProps()}
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitText()}
            disabled={disabled}
            className="w-full text-center text-2xl font-bold border-b-2 border-gray-300 focus:border-primary outline-none py-3 bg-transparent disabled:opacity-50"
            placeholder="输入英文"
          />
          <button
            onClick={submitText}
            disabled={disabled || !text.trim()}
            className="mt-4 px-4 py-2 bg-primary text-white rounded-lg font-medium disabled:opacity-50"
          >
            提交
          </button>
        </>
      )}
    </div>
  );
}
