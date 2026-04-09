/**
 * 独立听写练习页面
 * 加载单元全部单词，使用 DictationPhase 组件
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { startLearning, updateProgress } from '../api/progress';
import type { StartLearningResponse, WordData } from '../api/progress';
import DictationPhase, { type DictationResult } from '../components/classify/DictationPhase';
import { useAudio } from '../hooks/useAudio';

export default function DictationPractice() {
  const { unitId } = useParams<{ unitId: string }>();
  const navigate = useNavigate();
  const { playAudio } = useAudio();

  const [learningData, setLearningData] = useState<StartLearningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const [results, setResults] = useState<DictationResult[]>([]);

  useEffect(() => {
    if (!unitId) return;
    (async () => {
      try {
        const data = await startLearning({ unit_id: parseInt(unitId), learning_mode: 'dictation' });
        setLearningData(data);
      } catch (e: any) {
        setError(e?.response?.data?.detail || '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [unitId]);

  const handleComplete = async (dictResults: DictationResult[]) => {
    setResults(dictResults);
    setCompleted(true);

    // 上报进度
    if (unitId && learningData) {
      const correctCount = dictResults.filter(r => r.isCorrect).length;
      try {
        await updateProgress({
          unit_id: parseInt(unitId),
          learning_mode: 'dictation',
          current_word_index: learningData.words.length - 1,
          is_completed: true,
        });
      } catch {}
    }
  };

  const playAudioSlow = (word: string) => {
    playAudio(word, 0.75);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          <p className="text-gray-500 mt-4">加载听写练习...</p>
        </div>
      </div>
    );
  }

  if (error || !learningData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <span className="text-6xl mb-4 block">😞</span>
          <p className="text-gray-500">{error || '加载失败'}</p>
          <button onClick={() => navigate(-1)} className="mt-4 px-4 py-2 bg-primary text-white rounded-lg">返回</button>
        </div>
      </div>
    );
  }

  const correctCount = results.filter(r => r.isCorrect).length;
  const totalCount = results.length;
  const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-800">✍️ 听写练习</h1>
            <p className="text-xs text-gray-500">{learningData.unit_info.name} · {learningData.words.length} 个单词</p>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto">
        {!completed ? (
          <DictationPhase
            words={learningData.words}
            onComplete={handleComplete}
            playAudioSlow={playAudioSlow}
          />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
            <div className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center">
              <div className="text-5xl mb-4">{accuracy >= 80 ? '🎉' : accuracy >= 60 ? '👍' : '💪'}</div>
              <h3 className="text-2xl font-bold text-gray-800 mb-2">听写完成！</h3>
              <div className={`text-4xl font-bold mb-2 ${accuracy >= 80 ? 'text-green-500' : accuracy >= 60 ? 'text-blue-500' : 'text-orange-500'}`}>
                {accuracy}%
              </div>
              <p className="text-gray-500 mb-6">
                答对 {correctCount}/{totalCount} 个单词
              </p>

              {/* 错词回顾 */}
              {results.some(r => !r.isCorrect) && (
                <div className="text-left mb-6 max-h-48 overflow-y-auto">
                  <p className="text-sm font-medium text-gray-600 mb-2">错词回顾：</p>
                  {results.filter(r => !r.isCorrect).map(r => (
                    <div key={r.wordId} className="flex items-center gap-2 py-1.5 border-b border-gray-100 text-sm">
                      <span className="text-red-400">✗</span>
                      <span className="font-medium">{r.word}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    setCompleted(false);
                    setResults([]);
                    setLoading(true);
                    startLearning({ unit_id: parseInt(unitId!), learning_mode: 'dictation' })
                      .then(data => { setLearningData(data); setLoading(false); })
                      .catch(() => setLoading(false));
                  }}
                  className="w-full py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold rounded-xl shadow-md"
                >
                  再来一次
                </button>
                <button
                  onClick={() => navigate(-1)}
                  className="w-full py-3 bg-gray-100 text-gray-600 font-medium rounded-xl"
                >
                  返回
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
