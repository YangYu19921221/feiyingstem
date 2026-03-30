import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { getExamAIAnalysis, type ExamResult, type AIAnalysis, EXAM_TYPE_LABELS } from '../api/unitExam';

const GRADE_CONFIG: Record<string, { emoji: string; color: string; text: string }> = {
  A: { emoji: '🏆', color: 'from-yellow-400 to-orange-500', text: '太棒了！' },
  B: { emoji: '🌟', color: 'from-green-400 to-emerald-500', text: '很不错！' },
  C: { emoji: '💪', color: 'from-blue-400 to-cyan-500', text: '继续加油！' },
  D: { emoji: '📚', color: 'from-gray-400 to-gray-500', text: '需要多练习' },
};

const UnitExamResult = () => {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const result = (location.state as any)?.result as ExamResult | undefined;
  const unitId = (location.state as any)?.unitId;

  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showAI, setShowAI] = useState(false);

  useEffect(() => {
    if (showAI && paperId && !aiAnalysis && !loadingAI) {
      loadAIAnalysis(parseInt(paperId));
    }
  }, [showAI, paperId, aiAnalysis, loadingAI]);

  const loadAIAnalysis = async (id: number) => {
    try {
      setLoadingAI(true);
      const data = await getExamAIAnalysis(id);
      setAiAnalysis(data);
    } catch (err) {
      console.error('AI分析加载失败:', err);
    } finally {
      setLoadingAI(false);
    }
  };

  if (!result) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <span className="text-5xl">📄</span>
          <h3 className="text-xl font-bold mt-4 mb-2">未找到考试结果</h3>
          <button onClick={() => navigate(-1)} className="mt-4 px-6 py-2 bg-primary text-white rounded-xl">返回</button>
        </div>
      </div>
    );
  }

  const gradeInfo = GRADE_CONFIG[result.grade] || GRADE_CONFIG.D;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-blue-50 to-purple-50">
      {/* 导航栏 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(-1)} className="flex items-center gap-2 hover:bg-white px-3 py-2 rounded-xl transition">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
              <span className="text-gray-600 font-medium">返回</span>
            </button>
            <h1 className="text-lg font-bold text-gray-800">考试成绩</h1>
            <div className="w-20"></div>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* 得分卡 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`bg-gradient-to-r ${gradeInfo.color} rounded-3xl p-8 text-white text-center shadow-xl relative overflow-hidden`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.3, 1] }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="text-6xl mb-3"
          >
            {gradeInfo.emoji}
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <div className="text-5xl font-bold mb-1">
              {result.score} <span className="text-2xl text-white/70">/ {result.max_score}</span>
            </div>
            <div className="text-white/80 text-lg mb-2">{gradeInfo.text}</div>
            <div className="flex justify-center gap-6 text-sm text-white/70">
              <span>正确率 {result.accuracy}%</span>
              <span>等级 {result.grade}</span>
              <span>用时 {Math.floor(result.time_spent / 60)}分{result.time_spent % 60}秒</span>
            </div>
          </motion.div>
        </motion.div>

        {/* 题型统计 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-6 shadow-lg"
        >
          <h3 className="text-lg font-bold text-gray-800 mb-4">📊 各题型表现</h3>
          <div className="space-y-3">
            {Object.entries(result.type_stats).map(([type, stat]) => {
              const pct = stat.total > 0 ? Math.round(stat.correct / stat.total * 100) : 0;
              return (
                <div key={type} className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">{EXAM_TYPE_LABELS[type] || type}</span>
                  <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ delay: 0.5, duration: 0.5 }}
                      className={`h-full rounded-full ${
                        pct >= 80 ? 'bg-green-400' : pct >= 60 ? 'bg-yellow-400' : 'bg-red-400'
                      }`}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-700 w-16 text-right">
                    {stat.correct}/{stat.total}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* 逐题回顾 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl p-6 shadow-lg"
        >
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between"
          >
            <h3 className="text-lg font-bold text-gray-800">📋 逐题回顾</h3>
            <span className={`text-gray-400 transition-transform ${showDetails ? 'rotate-180' : ''}`}>▼</span>
          </button>

          <AnimatePresence>
            {showDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
                  {result.details.map((d, i) => (
                    <div
                      key={d.question_id}
                      className={`p-3 rounded-xl border-2 ${
                        d.is_correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-500">
                          第{i + 1}题 · {EXAM_TYPE_LABELS[d.type] || d.type} · {d.score}/{d.max_score}分
                        </span>
                        <span className={d.is_correct ? 'text-green-500' : 'text-red-500'}>
                          {d.is_correct ? '✅' : '❌'}
                        </span>
                      </div>
                      {!d.is_correct && (
                        <div className="text-sm space-y-1">
                          <p className="text-red-600">
                            你的答案: <span className="font-medium">{d.user_answer || '(未作答)'}</span>
                          </p>
                          <p className="text-green-600">
                            正确答案: <span className="font-medium">{d.correct_answer}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* AI 分析 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white rounded-2xl p-6 shadow-lg"
        >
          <button
            onClick={() => setShowAI(!showAI)}
            className="w-full flex items-center justify-between"
          >
            <h3 className="text-lg font-bold text-gray-800">🤖 AI 学习建议</h3>
            <span className={`text-gray-400 transition-transform ${showAI ? 'rotate-180' : ''}`}>▼</span>
          </button>

          <AnimatePresence>
            {showAI && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                {loadingAI ? (
                  <div className="mt-4 text-center py-8">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    <p className="text-gray-500 mt-2">AI 正在分析...</p>
                  </div>
                ) : aiAnalysis ? (
                  <div className="mt-4 space-y-4">
                    {/* 错误模式 */}
                    {Object.keys(aiAnalysis.error_patterns).length > 0 && (
                      <div>
                        <h4 className="text-sm font-bold text-gray-700 mb-2">错误分布</h4>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(aiAnalysis.error_patterns).map(([type, count]) => (
                            <span key={type} className="px-3 py-1 bg-red-50 text-red-600 text-sm rounded-full">
                              {type}: {count}题
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 薄弱词汇 */}
                    {aiAnalysis.wrong_words.length > 0 && (
                      <div>
                        <h4 className="text-sm font-bold text-gray-700 mb-2">需要重点复习的单词</h4>
                        <div className="flex flex-wrap gap-2">
                          {aiAnalysis.wrong_words.map((w, i) => (
                            <span key={i} className="px-3 py-1 bg-orange-50 text-orange-600 text-sm rounded-full border border-orange-200">
                              {w.word} ({w.meaning})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 建议 */}
                    {aiAnalysis.analysis.suggestions.length > 0 && (
                      <div>
                        <h4 className="text-sm font-bold text-gray-700 mb-2">学习建议</h4>
                        <ul className="space-y-2">
                          {aiAnalysis.analysis.suggestions.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                              <span className="text-blue-500 mt-0.5">💡</span>
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-4 text-gray-400 text-sm">暂无分析数据</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* 操作按钮 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col gap-3 pb-8"
        >
          <button
            onClick={() => navigate(`/student/units/${unitId}/exam`, { replace: true })}
            className="w-full py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-xl shadow-md hover:shadow-lg transition"
          >
            重新考试
          </button>
          <button
            onClick={() => navigate('/student/mistake-book')}
            className="w-full py-3 bg-orange-50 text-orange-600 font-medium rounded-xl hover:bg-orange-100 transition"
          >
            复习错词
          </button>
          <button
            onClick={() => navigate(-1)}
            className="w-full py-3 bg-gray-100 text-gray-600 font-medium rounded-xl hover:bg-gray-200 transition"
          >
            返回
          </button>
        </motion.div>
      </div>
    </div>
  );
};

export default UnitExamResult;
