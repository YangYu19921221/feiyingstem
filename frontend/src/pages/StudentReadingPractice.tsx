import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowLeft, BookOpenText, Languages, RefreshCw, Send } from 'lucide-react';
import { getPassageDetail, submitReadingAttempt } from '../api/reading';
import type { ReadingPassageDetail, AnswerSubmission, ReadingAttemptResult } from '../api/reading';
import ColoredPhonetic from '../components/ColoredPhonetic';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import { usePreventCopy } from '../hooks/usePreventCopy';

const StudentReadingPractice = () => {
  usePreventCopy();  // 防划走答案:禁右键/复制/选中(输入框内放行)
  const { passageId } = useParams<{ passageId: string }>();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const [passage, setPassage] = useState<ReadingPassageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [startTime] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReadingAttemptResult | null>(null);

  useEffect(() => {
    if (passageId) {
      loadPassage();
    }
  }, [passageId]);

  const loadPassage = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const id = Number(passageId);
      if (!Number.isFinite(id)) throw new Error('invalid passage id');
      const data = await getPassageDetail(id);
      setPassage(data);
    } catch (error: any) {
      console.error('加载文章失败:', error);
      setPassage(null);
      setLoadError(getErrorMessage(error, '阅读文章暂时没有加载出来'));
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (questionId: number, answer: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
  };

  const handleSubmit = async () => {
    if (!passage) return;

    // 检查是否所有题目都已作答
    const unanswered = passage.questions.filter((q) => !answers[q.id] || answers[q.id].trim() === '');
    if (unanswered.length > 0) {
      const confirm = window.confirm(
        `还有 ${unanswered.length} 道题未作答，确定要提交吗？`
      );
      if (!confirm) return;
    }

    try {
      setSubmitting(true);

      const answerSubmissions: AnswerSubmission[] = passage.questions.map((q) => ({
        question_id: q.id,
        answer: answers[q.id] || '',
      }));

      const timeSpent = Math.floor((Date.now() - startTime) / 1000);

      const result = await submitReadingAttempt({
        passage_id: passage.id,
        answers: answerSubmissions,
        time_spent: timeSpent,
      });

      setResult(result);
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    } catch (error: any) {
      console.error('提交失败:', error);
      toast.error(getErrorMessage(error, '提交失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const getQuestionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      multiple_choice: '选择题',
      true_false: '判断题',
      fill_blank: '填空题',
      short_answer: '简答题',
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <div className="page-warm-glow flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-2 border-orange-100 border-t-accent-warm" />
          <p className="mt-4 text-ink-soft">正在打开阅读文章...</p>
        </div>
      </div>
    );
  }

  if (loadError || !passage) {
    return (
      <main className="page-warm-glow flex min-h-screen items-center justify-center bg-paper px-4 py-10">
        <section className="card-soft w-full max-w-md rounded-2xl p-6 text-center sm:p-8" role="alert">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
            <BookOpenText className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">阅读文章暂时没打开</h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{loadError || '没有找到这篇阅读文章。'} 已有答题记录不会受影响。</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" onClick={() => void loadPassage()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              再试一次
            </button>
            <button type="button" onClick={() => navigate('/student/reading')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-black/[0.05] px-5 text-sm font-semibold text-ink transition hover:bg-black/[0.08]">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              返回阅读列表
            </button>
          </div>
        </section>
      </main>
    );
  }

  // 显示结果页面
  if (result) {
    return (
      <div className="min-h-screen bg-paper page-warm-glow">
        <nav className="border-b border-slate-200/80 bg-white/85 shadow-sm backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <button type="button" onClick={() => navigate('/student/reading')} className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft transition hover:bg-orange-50 hover:text-ink" aria-label="返回阅读列表">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="font-display text-xl font-bold text-ink">答题结果</h1>
          </div>
        </nav>

        {/* Hero 横幅 */}
        <div className="relative overflow-hidden" style={{ height: 140 }}>
          <img src="/hero-reading.jpeg" alt="" className="absolute inset-0 w-full h-full object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/30 to-transparent" />
          <div className="relative z-10 h-full flex items-center px-6 max-w-5xl mx-auto">
            <div className="text-white">
              <h2 className="text-2xl font-bold drop-shadow">📖 阅读完成</h2>
              <p className="text-sm opacity-80 mt-1 drop-shadow">查看你的答题成绩</p>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 pb-12 mt-6">
          {/* 成绩卡片 */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="card-soft mb-6 rounded-2xl p-6 text-center sm:p-8"
          >
            <div className="text-6xl mb-4">
              {result.is_passed ? '🎉' : '💪'}
            </div>
            <h2 className="text-3xl font-bold mb-2">
              {result.is_passed ? '恭喜通过！' : '继续加油！'}
            </h2>
            <div className="font-numeric mb-4 text-5xl font-bold text-accent-warm">
              {result.score} / {result.total_points}
            </div>
            <div className="text-xl text-gray-600 mb-6">
              正确率: {result.percentage.toFixed(1)}%
            </div>

            <div className="flex flex-col justify-center gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => navigate('/student/reading')}
                className="min-h-11 rounded-xl bg-black/[0.05] px-6 font-semibold text-ink transition hover:bg-black/[0.08]"
              >
                返回列表
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="btn-glow min-h-11 rounded-xl px-6 font-semibold text-white"
              >
                再做一次
              </button>
            </div>
          </motion.div>

          {/* 题目详解 */}
          <div className="space-y-4">
            {result.question_results.map((qr, index) => (
              <motion.div
                key={qr.question_id}
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.34, delay: reduceMotion ? 0 : Math.min(index * 0.04, 0.24), ease: [0.16, 1, 0.3, 1] }}
                className={`rounded-xl border p-5 sm:p-6 ${
                  qr.is_correct ? 'border-emerald-200 bg-emerald-50/60' : 'border-rose-200 bg-rose-50/60'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{qr.is_correct ? '✅' : '❌'}</span>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-800 mb-2">
                      第 {index + 1} 题 ({qr.points} 分)
                    </h3>
                    <div className="space-y-2 text-sm">
                      <p>
                        <span className="font-medium text-gray-700">你的答案: </span>
                        <span className={qr.is_correct ? 'text-green-600' : 'text-red-600'}>
                          {qr.user_answer || '(未作答)'}
                        </span>
                      </p>
                      {!qr.is_correct && (
                        <p>
                          <span className="font-medium text-gray-700">正确答案: </span>
                          <span className="text-green-600">{qr.correct_answer}</span>
                        </p>
                      )}
                      {qr.explanation && (
                        <p className="text-gray-600 bg-gray-50 p-3 rounded">
                          💡 {qr.explanation}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-numeric text-lg font-bold text-accent-warm">
                      {qr.earned_points}/{qr.points}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 答题页面
  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      {/* 顶部导航 */}
      <nav className="bg-white/85 shadow-sm mb-6 sticky top-0 z-10 border-b border-slate-200/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (window.confirm('确定要退出吗？当前进度不会保存。')) {
                  navigate('/student/reading');
                }
              }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-orange-50 hover:text-ink"
              aria-label="退出阅读练习"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="truncate font-display text-lg font-bold text-ink sm:text-xl">{passage.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-numeric whitespace-nowrap text-sm text-ink-soft">
              {passage.questions.filter((q) => answers[q.id]).length} / {passage.questions.length} 题
            </span>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 pb-12">
        {/* 文章内容 */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
          className="card-soft mb-6 rounded-2xl p-5 sm:p-8"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold text-ink sm:text-2xl"><BookOpenText className="h-5 w-5 text-accent-warm" />阅读文章</h2>
            <button
              type="button"
              onClick={() => setShowTranslation(!showTranslation)}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-orange-50 px-3 text-sm font-semibold text-accent-warm transition hover:bg-orange-100 sm:px-4"
            >
              <Languages className="h-4 w-4" aria-hidden="true" />
              {showTranslation ? '隐藏' : '显示'}翻译
            </button>
          </div>

          <div className="prose prose-lg max-w-none">
            <p className="whitespace-pre-wrap text-gray-700 leading-relaxed">{passage.content}</p>
          </div>

          <AnimatePresence>
            {showTranslation && passage.content_translation && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-6 pt-6 border-t border-gray-200"
              >
                <h3 className="text-lg font-bold text-gray-700 mb-3">🇨🇳 中文翻译</h3>
                <p className="text-gray-600 whitespace-pre-wrap leading-relaxed">
                  {passage.content_translation}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 重点词汇 */}
          {passage.vocabularies.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="text-lg font-bold text-gray-700 mb-3">📝 重点词汇</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {passage.vocabularies.map((vocab) => (
                  <div key={vocab.id} className="rounded-xl border border-orange-100 bg-orange-50/60 p-3">
                    <div className="font-bold text-accent-warm">{vocab.word}</div>
                    {vocab.phonetic && <ColoredPhonetic phonetic={vocab.phonetic} className="text-sm" />}
                    {vocab.meaning && <div className="text-sm text-gray-700">{vocab.meaning}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        {/* 题目列表 */}
        <div className="space-y-6">
          {passage.questions.map((question, index) => (
            <motion.div
              key={question.id}
              initial={reduceMotion ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.34, delay: reduceMotion ? 0 : Math.min(index * 0.04, 0.24), ease: [0.16, 1, 0.3, 1] }}
              className="card-soft rounded-xl p-5 sm:p-6"
            >
              <div className="flex items-start gap-3 mb-4">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-warm font-bold text-white">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="rounded bg-orange-50 px-2 py-1 text-xs font-medium text-orange-700">
                      {getQuestionTypeLabel(question.question_type)}
                    </span>
                    <span className="text-sm text-gray-500">{question.points} 分</span>
                  </div>
                  <p className="text-gray-800 text-lg">{question.question_text}</p>
                </div>
              </div>

              {/* 选择题/判断题 */}
              {(question.question_type === 'multiple_choice' || question.question_type === 'true_false') && (
                <div className="space-y-2 sm:ml-11">
                  {question.options.map((option) => (
                    <label
                      key={option.id}
                      className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition ${
                        answers[question.id] === option.option_label
                          ? 'border-accent-warm bg-orange-50/70'
                          : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`question-${question.id}`}
                        value={option.option_label}
                        checked={answers[question.id] === option.option_label}
                        onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                        className="h-5 w-5 text-accent-warm focus:ring-accent-warm"
                      />
                      <span className="font-medium text-gray-700">{option.option_label}.</span>
                      <span className="text-gray-800">{option.option_text}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* 填空题/简答题 */}
              {(question.question_type === 'fill_blank' || question.question_type === 'short_answer') && (
                <div className="sm:ml-11">
                  <textarea
                    value={answers[question.id] || ''}
                    onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                    placeholder="请输入你的答案..."
                    rows={question.question_type === 'short_answer' ? 4 : 2}
                    className="w-full resize-none rounded-xl border-2 border-gray-200 px-4 py-3 outline-none transition focus:border-accent-warm focus:ring-2 focus:ring-accent-warm/20"
                  />
                </div>
              )}
            </motion.div>
          ))}
        </div>

        {/* 提交按钮 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-8 text-center"
        >
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-10 text-lg font-bold text-white transition ${
              submitting
                ? 'bg-gray-400 cursor-not-allowed'
                : 'btn-glow'
            }`}
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                提交中...
              </span>
            ) : (
              <><Send className="h-5 w-5" aria-hidden="true" />提交答案</>
            )}
          </button>
        </motion.div>
      </div>
    </div>
  );
};

export default StudentReadingPractice;
