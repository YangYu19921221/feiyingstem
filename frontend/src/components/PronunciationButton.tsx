import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { evaluatePronunciation, type PronunciationScore } from '../api/pronunciation';

interface Props {
  word: string;
  sentence?: string;
}

function scoreColor(score: number) {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-500';
}

function scoreEmoji(score: number) {
  if (score >= 90) return '🌟';
  if (score >= 80) return '👍';
  if (score >= 60) return '💪';
  return '🔄';
}

const PronunciationButton = ({ word, sentence }: Props) => {
  const { isRecording, audioBlob, error, duration, startRecording, stopRecording } = useAudioRecorder(10);
  const [evaluating, setEvaluating] = useState(false);
  const [scores, setScores] = useState<PronunciationScore | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  const handleClick = async () => {
    if (evaluating) return;

    if (isRecording) {
      stopRecording();
      return;
    }

    // 重置状态并开始录音
    setScores(null);
    setEvalError(null);
    await startRecording();
  };

  // 录音结束后自动评测
  const doEvaluate = async (blob: Blob) => {
    setEvaluating(true);
    setEvalError(null);
    try {
      const text = sentence || word;
      const category = sentence ? 'read_sentence' : 'read_word';
      const result = await evaluatePronunciation(blob, text, category);
      setScores(result);
    } catch (err: unknown) {
      setEvalError(err instanceof Error ? err.message : '评测失败');
    } finally {
      setEvaluating(false);
    }
  };

  // 监听audioBlob变化，自动触发评测
  if (audioBlob && !evaluating && !scores && !evalError) {
    doEvaluate(audioBlob);
  }

  const btnColor = isRecording
    ? 'bg-red-500 hover:bg-red-600'
    : evaluating
      ? 'bg-gray-400 cursor-not-allowed'
      : 'bg-sky-500 hover:bg-sky-600';

  return (
    <div className="inline-flex flex-col items-center gap-1">
      {/* 麦克风按钮 */}
      <button
        onClick={(e) => { e.stopPropagation(); handleClick(); }}
        disabled={evaluating}
        className={`relative p-2 rounded-full transition-all ${btnColor} text-white`}
        title="语音评测"
      >
        {isRecording && (
          <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-50" />
        )}
        {evaluating ? (
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5 relative z-10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        )}
      </button>

      {/* 录音时长 */}
      {isRecording && (
        <span className="text-xs text-red-500 font-mono">{duration}s</span>
      )}

      {/* 错误提示 */}
      {(error || evalError) && (
        <p className="text-xs text-red-500 max-w-[160px] text-center">
          {error || evalError}
        </p>
      )}

      {/* 评分结果面板 */}
      <AnimatePresence>
        {scores && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="bg-white rounded-xl shadow-lg border p-3 mt-1 min-w-[180px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 总分 */}
            <div className="text-center mb-2">
              <span className="text-2xl mr-1">{scoreEmoji(scores.total_score)}</span>
              <span className={`text-3xl font-bold ${scoreColor(scores.total_score)}`}>
                {scores.total_score.toFixed(1)}
              </span>
              <span className="text-gray-400 text-sm ml-1">分</span>
            </div>
            {/* 细项 */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <p className="text-gray-500">准确度</p>
                <p className={`font-bold ${scoreColor(scores.accuracy)}`}>
                  {scores.accuracy.toFixed(1)}
                </p>
              </div>
              <div>
                <p className="text-gray-500">流利度</p>
                <p className={`font-bold ${scoreColor(scores.fluency)}`}>
                  {scores.fluency.toFixed(1)}
                </p>
              </div>
              <div>
                <p className="text-gray-500">完整度</p>
                <p className={`font-bold ${scoreColor(scores.integrity)}`}>
                  {scores.integrity.toFixed(1)}
                </p>
              </div>
            </div>
            {/* 重试按钮 */}
            <button
              onClick={(e) => { e.stopPropagation(); setScores(null); }}
              className="w-full mt-2 text-xs text-sky-500 hover:text-sky-700"
            >
              再试一次
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PronunciationButton;
