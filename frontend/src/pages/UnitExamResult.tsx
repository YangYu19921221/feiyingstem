import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import useGoBack from '../hooks/useGoBack';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowLeft, FileQuestion, RefreshCw } from 'lucide-react';
import { getExamAIAnalysis, type ExamResult, type AIAnalysis, EXAM_TYPE_LABELS } from '../api/unitExam';

const GRADE_CONFIG: Record<string, { image: string; text: string }> = {
  A: { image: '/result-excellent.jpeg', text: '太棒了' },
  B: { image: '/result-good.jpeg',      text: '很不错' },
  C: { image: '/result-pass.jpeg',      text: '继续加油' },
  D: { image: '/result-retry.jpeg',     text: '需要多练习' },
};

const UnitExamResult = () => {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  const result = (location.state as any)?.result as ExamResult | undefined;
  const unitId = (location.state as any)?.unitId;

  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiError, setAIError] = useState('');
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
      setAIError('');
      const data = await getExamAIAnalysis(id);
      setAiAnalysis(data);
    } catch (err) {
      console.error('AI分析加载失败:', err);
      setAIError('学习建议暂时没有加载出来，请稍后重试。');
    } finally {
      setLoadingAI(false);
    }
  };

  if (!result) {
    return (
      <main className="page-warm-glow flex min-h-screen items-center justify-center bg-paper p-4">
        <section className="card-soft w-full max-w-md rounded-2xl p-6 text-center sm:p-8" role="alert">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
            <FileQuestion className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">没有找到这次考试成绩</h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">可能是结果地址已经过期。返回单元列表后，可以重新进入考试。</p>
          <button type="button" onClick={() => goBack()} className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回学习中心
          </button>
        </section>
      </main>
    );
  }

  const gradeInfo = GRADE_CONFIG[result.grade] || GRADE_CONFIG.D;

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      {/* 顶部导航 */}
      <nav className="border-b border-slate-200/80 bg-white/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button type="button" onClick={() => goBack()} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-ink-soft transition hover:bg-orange-50 hover:text-ink">
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">考试成绩</h1>
          <div className="w-12" />
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-5 pt-10 pb-12">
        {/* Hero：按 Grade 显示插图 + 大数字 */}
        <section className="text-center mb-12">
          <motion.img
            src={gradeInfo.image}
            alt=""
            initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="w-44 h-44 md:w-56 md:h-56 mx-auto mb-6 rounded-2xl object-cover"
          />
          <p className="text-ink-mute text-sm mb-2">单元考试成绩 · 等级 {result.grade}</p>
          <h2 className="font-display text-5xl md:text-6xl font-semibold text-ink leading-none tracking-tight mb-3 font-numeric">
            {result.score}<span className="text-3xl md:text-4xl text-ink-soft"> / {result.max_score}</span>
          </h2>
          <p className="text-ink-soft text-base">{gradeInfo.text}</p>
        </section>

        {/* 关键指标 — 数据条带 */}
        <div className="bg-white rounded-2xl border border-black/[0.05] divide-y divide-black/[0.05] mb-8">
          <div className="px-5 py-4 flex items-baseline justify-between">
            <span className="text-ink-soft text-sm">正确率</span>
            <span className="font-display font-semibold text-2xl text-ink font-numeric">
              {result.accuracy}<span className="text-base text-ink-soft">%</span>
            </span>
          </div>
          <div className="px-5 py-4 flex items-baseline justify-between">
            <span className="text-ink-soft text-sm">用时</span>
            <span className="font-display font-semibold text-2xl text-ink font-numeric">
              {Math.floor(result.time_spent / 60)}分{result.time_spent % 60}秒
            </span>
          </div>
        </div>

        {/* 题型表现 */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.36, delay: reduceMotion ? 0 : 0.14, ease: [0.16, 1, 0.3, 1] }}
          className="bg-white rounded-2xl border border-black/[0.05] p-5 mb-8"
        >
          <h3 className="font-display text-base font-semibold text-ink mb-4">各题型表现</h3>
          <div className="space-y-3">
            {Object.entries(result.type_stats).map(([type, stat]) => {
              const pct = stat.total > 0 ? Math.round(stat.correct / stat.total * 100) : 0;
              return (
                <div key={type} className="flex items-center gap-3">
                  <span className="text-sm text-ink-soft w-16 shrink-0">{EXAM_TYPE_LABELS[type] || type}</span>
                  <div className="flex-1 h-1.5 bg-black/[0.05] rounded-full overflow-hidden">
                    <motion.div
                      initial={reduceMotion ? false : { width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ delay: reduceMotion ? 0 : 0.32, duration: reduceMotion ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
                      className={`h-full rounded-full ${
                        pct >= 80 ? 'bg-accent-warm' : 'bg-ink-mute'
                      }`}
                    />
                  </div>
                  <span className="text-sm font-numeric text-ink-soft w-14 text-right shrink-0">
                    {stat.correct}/{stat.total}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* 逐题回顾 */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.36, delay: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="bg-white rounded-2xl border border-black/[0.05] p-5 mb-8"
        >
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 transition hover:bg-orange-50"
            aria-expanded={showDetails}
          >
            <h3 className="font-display text-base font-semibold text-ink">逐题回顾</h3>
            <span className={`text-ink-mute transition-transform ${showDetails ? 'rotate-180' : ''}`}>▼</span>
          </button>

          <AnimatePresence>
            {showDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
                  {result.details.map((d, i) => (
                    <div
                      key={d.question_id}
                      className={`rounded-xl border p-3 ${
                        d.is_correct ? 'border-emerald-100 bg-emerald-50/50' : 'border-orange-100 bg-orange-50/60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-ink-mute font-numeric">
                          第{i + 1}题 · {EXAM_TYPE_LABELS[d.type] || d.type} · {d.score}/{d.max_score}分
                        </span>
                        <span className={d.is_correct ? 'text-ink-soft text-sm' : 'text-accent-warm text-sm'}>
                          {d.is_correct ? '✓' : '✗'}
                        </span>
                      </div>
                      {!d.is_correct && (
                        <div className="text-sm space-y-0.5 mt-1">
                          <p className="text-ink-soft">
                            你的答案: <span className="font-medium line-through">{d.user_answer || '(未作答)'}</span>
                          </p>
                          <p className="text-ink">
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
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.36, delay: reduceMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
          className="bg-white rounded-2xl border border-black/[0.05] p-5 mb-8"
        >
          <button
            type="button"
            onClick={() => setShowAI(!showAI)}
            className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 transition hover:bg-orange-50"
            aria-expanded={showAI}
          >
            <h3 className="font-display text-base font-semibold text-ink">学习建议</h3>
            <span className={`text-ink-mute transition-transform ${showAI ? 'rotate-180' : ''}`}>▼</span>
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
                  <p className="mt-4 py-6 text-center text-sm text-ink-mute">正在整理学习建议…</p>
                ) : aiError ? (
                  <div className="mt-4 rounded-xl bg-orange-50 p-4 text-center" role="alert">
                    <p className="text-sm leading-6 text-orange-800">{aiError}</p>
                    <button type="button" onClick={() => paperId && void loadAIAnalysis(Number(paperId))} className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-accent-warm transition hover:bg-orange-100">
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      再试一次
                    </button>
                  </div>
                ) : aiAnalysis ? (
                  <div className="mt-4 space-y-4">
                    {Object.keys(aiAnalysis.error_patterns).length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-ink-soft mb-2">错误分布</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(aiAnalysis.error_patterns).map(([type, count]) => (
                            <span key={type} className="px-2.5 py-1 border border-black/[0.08] text-ink-soft text-xs rounded">
                              {type} · <span className="font-numeric">{count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {aiAnalysis.wrong_words.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-ink-soft mb-2">需要重点复习的单词</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {aiAnalysis.wrong_words.map((w, i) => (
                            <span key={i} className="px-2.5 py-1 border border-accent-warm/30 text-accent-warm text-xs rounded">
                              {w.word} <span className="text-ink-mute">{w.meaning}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {aiAnalysis.analysis.suggestions.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-ink-soft mb-2">学习建议</h4>
                        <ul className="space-y-1.5">
                          {aiAnalysis.analysis.suggestions.map((s, i) => (
                            <li key={i} className="text-sm text-ink-soft leading-relaxed">
                              <span className="text-accent-warm mr-1.5">·</span>
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-4 text-ink-mute text-sm">暂无分析数据</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* 操作按钮 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => navigate('/student/mistake-book')}
            className="min-h-12 rounded-xl border border-black/15 px-5 text-base font-medium text-ink transition hover:bg-black/5"
          >
            复习错词
          </button>
          <button
            type="button"
            onClick={() => unitId && navigate(`/student/units/${unitId}/exam`, { replace: true })}
            disabled={!unitId}
            className="min-h-12 rounded-xl bg-accent-warm px-5 text-base font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-black/[0.08] disabled:text-ink-mute"
          >
            重新考试
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnitExamResult;
