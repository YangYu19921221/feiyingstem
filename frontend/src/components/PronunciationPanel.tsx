import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { evaluatePronunciation, type PronunciationScore } from '../api/pronunciation';
import ColoredPhonetic from './ColoredPhonetic';

interface PronunciationPanelProps {
  word: string;
  phonetic?: string;
  gateStatus: {
    translationPassed: boolean;
    spellingPassed: boolean;
    pronunciationPassed: boolean;
  };
  currentGate: 1 | 2 | 3;
  onScoreReceived: (score: PronunciationScore) => void;
  threshold: number;
}

function scoreColor(score: number) {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-500';
}

function scoreBg(score: number) {
  if (score >= 80) return 'bg-green-50 border-green-200';
  if (score >= 60) return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
}

function scoreEmoji(score: number) {
  if (score >= 90) return '🌟';
  if (score >= 80) return '👍';
  if (score >= 60) return '💪';
  return '🔄';
}

const PronunciationPanel = ({
  word,
  phonetic,
  gateStatus,
  currentGate,
  onScoreReceived,
  threshold,
}: PronunciationPanelProps) => {
  const { isRecording, audioBlob, error, duration, startRecording, stopRecording } =
    useAudioRecorder(10);
  const [evaluating, setEvaluating] = useState(false);
  const [scores, setScores] = useState<PronunciationScore | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [hasEvaluated, setHasEvaluated] = useState(false);

  // 当单词变化时重置状态
  useEffect(() => {
    setScores(null);
    setEvalError(null);
    setHasEvaluated(false);
  }, [word]);

  // 录音结束后自动评测
  useEffect(() => {
    if (audioBlob && !evaluating && !hasEvaluated) {
      doEvaluate(audioBlob);
    }
  }, [audioBlob]);

  const doEvaluate = async (blob: Blob) => {
    setEvaluating(true);
    setEvalError(null);
    setHasEvaluated(true);
    try {
      const result = await evaluatePronunciation(blob, word, 'read_word');
      setScores(result);
      onScoreReceived(result);
    } catch (err: unknown) {
      setEvalError(err instanceof Error ? err.message : '评测失败');
    } finally {
      setEvaluating(false);
    }
  };

  const handleMicClick = async () => {
    if (evaluating) return;
    if (isRecording) {
      stopRecording();
      return;
    }
    setScores(null);
    setEvalError(null);
    setHasEvaluated(false);
    await startRecording();
  };

  const handleRetry = () => {
    setScores(null);
    setEvalError(null);
    setHasEvaluated(false);
  };

  const isActive = currentGate === 3;
  const passed = gateStatus.pronunciationPassed;

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 lg:sticky lg:top-24">
      {/* 三关进度指示器 */}
      <div className="flex items-center justify-between mb-6">
        {[
          { label: '英译中', done: gateStatus.translationPassed, gate: 1 },
          { label: '中译英', done: gateStatus.spellingPassed, gate: 2 },
          { label: '发音', done: gateStatus.pronunciationPassed, gate: 3 },
        ].map((step, i) => (
          <div key={step.gate} className="flex items-center">
            {i > 0 && (
              <div className={`w-6 h-0.5 mx-1 ${
                step.done || currentGate > step.gate ? 'bg-green-400' : 'bg-gray-200'
              }`} />
            )}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              step.done
                ? 'bg-green-100 text-green-700'
                : currentGate === step.gate
                  ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
                  : 'bg-gray-100 text-gray-400'
            }`}>
              <span>{step.done ? '✓' : step.gate}</span>
              <span>{step.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 单词显示 */}
      <div className="text-center mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-1">{word}</h2>
        {phonetic && <ColoredPhonetic phonetic={phonetic} className="text-sm" />}
      </div>

      {/* 麦克风录音按钮 */}
      <div className="flex flex-col items-center mb-6">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={(e) => { e.stopPropagation(); handleMicClick(); }}
          disabled={evaluating || !isActive || passed}
          className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg ${
            passed
              ? 'bg-green-500 cursor-default'
              : !isActive
                ? 'bg-gray-300 cursor-not-allowed'
                : isRecording
                  ? 'bg-red-500 hover:bg-red-600'
                  : evaluating
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-br from-blue-500 to-sky-400 hover:from-blue-600 hover:to-sky-500'
          }`}
        >
          {isRecording && (
            <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-40" />
          )}
          {passed ? (
            <span className="text-white text-3xl">✓</span>
          ) : evaluating ? (
            <svg className="w-8 h-8 animate-spin text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-8 h-8 text-white relative z-10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
        </motion.button>

        {/* 录音时长 */}
        {isRecording && (
          <span className="mt-2 text-sm text-red-500 font-mono">{duration}s / 10s</span>
        )}

        {/* 状态提示 */}
        <p className="mt-2 text-xs text-gray-500">
          {passed
            ? '发音达标 ✓'
            : !isActive
              ? '请先完成前两关'
              : isRecording
                ? '正在录音，点击停止...'
                : evaluating
                  ? '评测中...'
                  : '点击麦克风开始录音'}
        </p>
      </div>

      {/* 错误提示 */}
      {(error || evalError) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-center">
          <p className="text-sm text-red-600">{error || evalError}</p>
        </div>
      )}

      {/* 分数展示区 */}
      <AnimatePresence>
        {scores && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`rounded-xl border p-4 ${scoreBg(scores.total_score)}`}
          >
            <div className="text-center mb-3">
              <span className="text-3xl mr-1">{scoreEmoji(scores.total_score)}</span>
              <span className={`text-4xl font-bold ${scoreColor(scores.total_score)}`}>
                {scores.total_score.toFixed(1)}
              </span>
              <span className="text-gray-400 text-sm ml-1">分</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
              {[
                { label: '准确度', value: scores.accuracy },
                { label: '流利度', value: scores.fluency },
                { label: '完整度', value: scores.integrity },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-gray-500 mb-1">{item.label}</p>
                  <p className={`font-bold text-lg ${scoreColor(item.value)}`}>
                    {item.value.toFixed(1)}
                  </p>
                </div>
              ))}
            </div>

            {scores.total_score < threshold && !passed && (
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-2">
                  需要 {threshold} 分以上才能通过
                </p>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRetry(); }}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition"
                >
                  再试一次
                </button>
              </div>
            )}

            {passed && (
              <p className="text-center text-sm text-green-600 font-medium">
                发音达标，即将进入下一个单词
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PronunciationPanel;
