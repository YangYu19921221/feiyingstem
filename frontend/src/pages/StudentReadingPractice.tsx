import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getPassageDetail, submitReadingAttempt } from '../api/reading';
import type { ReadingPassageDetail, AnswerSubmission, ReadingAttemptResult } from '../api/reading';
import ColoredPhonetic from '../components/ColoredPhonetic';

const StudentReadingPractice = () => {
  const { passageId } = useParams<{ passageId: string }>();
  const navigate = useNavigate();

  const [passage, setPassage] = useState<ReadingPassageDetail | null>(null);
  const [loading, setLoading] = useState(true);
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
      const data = await getPassageDetail(Number(passageId));
      setPassage(data);
    } catch (error: any) {
      console.error('加载文章失败:', error);
      alert(error.response?.data?.detail || '加载失败');
      navigate('/student/reading');
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error: any) {
      console.error('提交失败:', error);
      alert(error.response?.data?.detail || '提交失败');
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
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (!passage) {
    return null;
  }

  // 显示结果页面
  if (result) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
        <nav className="bg-white shadow-sm mb-6">
          <div className="max-w-5xl mx-auto px-4 py-4">
            <h1 className="text-2xl font-bold text-gray-800">📊 答题结果</h1>
          </div>
        </nav>

        <div className="max-w-5xl mx-auto px-4 pb-12">
          {/* 成绩卡片 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl p-8 mb-6 text-center"
          >
            <div className="text-6xl mb-4">
              {result.is_passed ? '🎉' : '💪'}
            </div>
            <h2 className="text-3xl font-bold mb-2">
              {result.is_passed ? '恭喜通过！' : '继续加油！'}
            </h2>
            <div className="text-5xl font-bold text-primary mb-4">
              {result.score} / {result.total_points}
            </div>
            <div className="text-xl text-gray-600 mb-6">
              正确率: {result.percentage.toFixed(1)}%
            </div>

            <div className="flex gap-4 justify-center">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => navigate('/student/reading')}
                className="px-6 py-3 bg-gray-200 hover:bg-gray-300 rounded-lg font-medium transition"
              >
                返回列表
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-lg font-medium shadow-lg transition"
              >
                再做一次
              </motion.button>
            </div>
          </motion.div>

          {/* 题目详解 */}
          <div className="space-y-4">
            {result.question_results.map((qr, index) => (
              <motion.div
                key={qr.question_id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`bg-white rounded-xl p-6 shadow-md border-l-4 ${
                  qr.is_correct ? 'border-green-500' : 'border-red-500'
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
                    <span className="text-lg font-bold text-primary">
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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm mb-6 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (window.confirm('确定要退出吗？当前进度不会保存。')) {
                  navigate('/student/reading');
                }
              }}
              className="text-gray-600 hover:text-gray-800 transition"
            >
              ← 返回
            </button>
            <h1 className="text-xl font-bold text-gray-800">{passage.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              {passage.questions.filter((q) => answers[q.id]).length} / {passage.questions.length} 题
            </span>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 pb-12">
        {/* 文章内容 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-md p-8 mb-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-800">📖 阅读文章</h2>
            <button
              onClick={() => setShowTranslation(!showTranslation)}
              className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg text-sm font-medium transition"
            >
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
                  <div key={vocab.id} className="bg-gray-50 rounded-lg p-3">
                    <div className="font-bold text-primary">{vocab.word}</div>
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
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-white rounded-xl shadow-md p-6"
            >
              <div className="flex items-start gap-3 mb-4">
                <span className="flex-shrink-0 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center font-bold">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                      {getQuestionTypeLabel(question.question_type)}
                    </span>
                    <span className="text-sm text-gray-500">{question.points} 分</span>
                  </div>
                  <p className="text-gray-800 text-lg">{question.question_text}</p>
                </div>
              </div>

              {/* 选择题/判断题 */}
              {(question.question_type === 'multiple_choice' || question.question_type === 'true_false') && (
                <div className="space-y-2 ml-11">
                  {question.options.map((option) => (
                    <label
                      key={option.id}
                      className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition ${
                        answers[question.id] === option.option_label
                          ? 'border-primary bg-primary/5'
                          : 'border-gray-200 hover:border-primary/30 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`question-${question.id}`}
                        value={option.option_label}
                        checked={answers[question.id] === option.option_label}
                        onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                        className="w-5 h-5 text-primary focus:ring-primary"
                      />
                      <span className="font-medium text-gray-700">{option.option_label}.</span>
                      <span className="text-gray-800">{option.option_text}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* 填空题/简答题 */}
              {(question.question_type === 'fill_blank' || question.question_type === 'short_answer') && (
                <div className="ml-11">
                  <textarea
                    value={answers[question.id] || ''}
                    onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                    placeholder="请输入你的答案..."
                    rows={question.question_type === 'short_answer' ? 4 : 2}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition resize-none"
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
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSubmit}
            disabled={submitting}
            className={`px-12 py-4 rounded-xl font-bold text-white text-lg shadow-lg transition ${
              submitting
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-primary via-secondary to-accent hover:shadow-xl'
            }`}
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                提交中...
              </span>
            ) : (
              '🚀 提交答案'
            )}
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
};

export default StudentReadingPractice;
