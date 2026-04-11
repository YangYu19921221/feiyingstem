import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '../components/Toast';
import {
  createPassage,
  updatePassage,
  getTeacherPassageDetail,
  addQuestion,
  deleteQuestion,
  addVocabulary,
  deleteVocabulary,
} from '../api/reading';
import type { ReadingPassageDetail, CreateQuestionRequest } from '../api/reading';

const TeacherReadingEditor = () => {
  const { passageId } = useParams<{ passageId?: string }>();
  const navigate = useNavigate();
  const isEdit = !!passageId;

  // 文章基本信息
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    content_translation: '',
    difficulty: 3,
    grade_level: '',
    topic: '',
    tags: [] as string[],
    is_public: false,
  });

  const [passage, setPassage] = useState<ReadingPassageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 新建题目表单
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [newQuestion, setNewQuestion] = useState<CreateQuestionRequest>({
    question_type: 'multiple_choice',
    question_text: '',
    order_index: 0,
    points: 1,
    options: [
      { option_text: '', option_label: 'A', is_correct: false, order_index: 0 },
      { option_text: '', option_label: 'B', is_correct: false, order_index: 1 },
      { option_text: '', option_label: 'C', is_correct: false, order_index: 2 },
      { option_text: '', option_label: 'D', is_correct: false, order_index: 3 },
    ],
    answer: {
      answer_text: '',
      answer_explanation: '',
      is_primary: true,
      accept_alternatives: [],
    },
  });

  useEffect(() => {
    if (isEdit && passageId) {
      loadPassage();
    }
  }, [isEdit, passageId]);

  const loadPassage = async () => {
    try {
      setLoading(true);
      const data = await getTeacherPassageDetail(Number(passageId));
      setPassage(data);
      setFormData({
        title: data.title,
        content: data.content,
        content_translation: data.content_translation || '',
        difficulty: data.difficulty,
        grade_level: data.grade_level || '',
        topic: data.topic || '',
        tags: data.tags || [],
        is_public: data.is_public,
      });
    } catch (error: any) {
      console.error('加载文章失败:', error);
      toast.error(error.response?.data?.detail || '加载失败');
      navigate('/teacher/reading');
    } finally {
      setLoading(false);
    }
  };

  const handleSavePassage = async () => {
    if (!formData.title || !formData.content) {
      toast.warning('请填写标题和内容');
      return;
    }

    try {
      setSaving(true);
      if (isEdit && passageId) {
        await updatePassage(Number(passageId), formData);
        toast.success('更新成功！');
        await loadPassage();
      } else {
        const newPassage = await createPassage(formData);
        toast.success('创建成功！');
        navigate(`/teacher/reading/${newPassage.id}/edit`);
      }
    } catch (error: any) {
      console.error('保存失败:', error);
      toast.error(error.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuestion = async () => {
    if (!passage) {
      toast.warning('请先保存文章');
      return;
    }

    if (!newQuestion.question_text) {
      toast.warning('请填写题目内容');
      return;
    }

    try {
      await addQuestion(passage.id, newQuestion);
      toast.success('题目添加成功！');
      setShowQuestionForm(false);
      resetQuestionForm();
      await loadPassage();
    } catch (error: any) {
      console.error('添加题目失败:', error);
      toast.error(error.response?.data?.detail || '添加失败');
    }
  };

  const handleDeleteQuestion = async (questionId: number) => {
    if (!window.confirm('确定要删除这道题目吗？')) return;

    try {
      await deleteQuestion(questionId);
      toast.success('删除成功！');
      await loadPassage();
    } catch (error: any) {
      console.error('删除失败:', error);
      toast.error(error.response?.data?.detail || '删除失败');
    }
  };

  const resetQuestionForm = () => {
    setNewQuestion({
      question_type: 'multiple_choice',
      question_text: '',
      order_index: passage?.questions.length || 0,
      points: 1,
      options: [
        { option_text: '', option_label: 'A', is_correct: false, order_index: 0 },
        { option_text: '', option_label: 'B', is_correct: false, order_index: 1 },
        { option_text: '', option_label: 'C', is_correct: false, order_index: 2 },
        { option_text: '', option_label: 'D', is_correct: false, order_index: 3 },
      ],
      answer: {
        answer_text: '',
        answer_explanation: '',
        is_primary: true,
        accept_alternatives: [],
      },
    });
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm mb-6 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/teacher/reading')}
              className="text-gray-600 hover:text-gray-800 transition"
            >
              ← 返回
            </button>
            <h1 className="text-2xl font-bold text-gray-800">
              {isEdit ? '编辑文章' : '创建新文章'}
            </h1>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSavePassage}
            disabled={saving}
            className={`px-6 py-3 rounded-lg font-medium text-white shadow-lg transition ${
              saving
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-primary to-secondary hover:shadow-xl'
            }`}
          >
            {saving ? '保存中...' : '💾 保存文章'}
          </motion.button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 pb-12">
        {/* 基本信息 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-md p-8 mb-6"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <span>📝</span> 基本信息
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                文章标题 *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
                placeholder="请输入文章标题..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  难度 *
                </label>
                <select
                  value={formData.difficulty}
                  onChange={(e) => setFormData({ ...formData, difficulty: Number(e.target.value) })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary outline-none"
                >
                  <option value={1}>⭐ 简单</option>
                  <option value={2}>⭐⭐ 一般</option>
                  <option value={3}>⭐⭐⭐ 中等</option>
                  <option value={4}>⭐⭐⭐⭐ 困难</option>
                  <option value={5}>⭐⭐⭐⭐⭐ 挑战</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  年级
                </label>
                <input
                  type="text"
                  value={formData.grade_level}
                  onChange={(e) => setFormData({ ...formData, grade_level: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary outline-none"
                  placeholder="如: 小学3年级"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  主题
                </label>
                <select
                  value={formData.topic}
                  onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary outline-none"
                >
                  <option value="">选择主题</option>
                  <option value="故事">故事</option>
                  <option value="科学">科学</option>
                  <option value="历史">历史</option>
                  <option value="日常">日常</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_public"
                checked={formData.is_public}
                onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                className="w-5 h-5 text-primary focus:ring-primary rounded"
              />
              <label htmlFor="is_public" className="text-sm font-medium text-gray-700">
                🌐 公开给所有学生
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                文章内容 (英文) *
              </label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                rows={12}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition resize-none font-mono"
                placeholder="粘贴或输入英文文章内容..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                中文翻译 (可选)
              </label>
              <textarea
                value={formData.content_translation}
                onChange={(e) => setFormData({ ...formData, content_translation: e.target.value })}
                rows={8}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary outline-none resize-none"
                placeholder="输入中文翻译..."
              />
            </div>
          </div>
        </motion.div>

        {/* 题目管理 - 只有编辑模式才显示 */}
        {isEdit && passage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl shadow-md p-8"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <span>❓</span> 题目管理 ({passage.questions.length} 题)
              </h2>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  resetQuestionForm();
                  setShowQuestionForm(true);
                }}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition"
              >
                + 添加题目
              </motion.button>
            </div>

            {/* 题目列表 */}
            <div className="space-y-4 mb-6">
              {passage.questions.map((question, index) => (
                <div
                  key={question.id}
                  className="border-2 border-gray-200 rounded-xl p-4 hover:border-primary/30 transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-bold text-primary">第 {index + 1} 题</span>
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                          {getQuestionTypeLabel(question.question_type)}
                        </span>
                        <span className="text-sm text-gray-500">{question.points} 分</span>
                      </div>
                      <p className="text-gray-800 mb-2">{question.question_text}</p>
                      {question.options.length > 0 && (
                        <div className="space-y-1 text-sm text-gray-600">
                          {question.options.map((opt) => (
                            <div key={opt.id} className={opt.is_correct ? 'text-green-600 font-medium' : ''}>
                              {opt.option_label}. {opt.option_text} {opt.is_correct && '✓'}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteQuestion(question.id)}
                      className="ml-4 px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-sm transition"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* 添加题目表单 */}
            <AnimatePresence>
              {showQuestionForm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-2 border-primary rounded-xl p-6 bg-primary/5"
                >
                  <h3 className="font-bold text-gray-800 mb-4">新建题目</h3>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          题型
                        </label>
                        <select
                          value={newQuestion.question_type}
                          onChange={(e) => setNewQuestion({ ...newQuestion, question_type: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none"
                        >
                          <option value="multiple_choice">选择题</option>
                          <option value="true_false">判断题</option>
                          <option value="fill_blank">填空题</option>
                          <option value="short_answer">简答题</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          分值
                        </label>
                        <input
                          type="number"
                          value={newQuestion.points}
                          onChange={(e) => setNewQuestion({ ...newQuestion, points: Number(e.target.value) })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none"
                          min={1}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        题目内容 *
                      </label>
                      <textarea
                        value={newQuestion.question_text}
                        onChange={(e) => setNewQuestion({ ...newQuestion, question_text: e.target.value })}
                        rows={3}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none resize-none"
                        placeholder="输入题目..."
                      />
                    </div>

                    {/* 选择题/判断题选项 */}
                    {(newQuestion.question_type === 'multiple_choice' || newQuestion.question_type === 'true_false') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          选项 (勾选正确答案)
                        </label>
                        <div className="space-y-2">
                          {newQuestion.options?.map((opt, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="correct_option"
                                checked={opt.is_correct}
                                onChange={() => {
                                  const updatedOptions = newQuestion.options!.map((o, i) => ({
                                    ...o,
                                    is_correct: i === idx,
                                  }));
                                  setNewQuestion({ ...newQuestion, options: updatedOptions });
                                }}
                                className="w-4 h-4"
                              />
                              <span className="font-medium">{opt.option_label}.</span>
                              <input
                                type="text"
                                value={opt.option_text}
                                onChange={(e) => {
                                  const updatedOptions = [...newQuestion.options!];
                                  updatedOptions[idx].option_text = e.target.value;
                                  setNewQuestion({ ...newQuestion, options: updatedOptions });
                                }}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg outline-none"
                                placeholder={`选项 ${opt.option_label}`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 填空题/简答题答案 */}
                    {(newQuestion.question_type === 'fill_blank' || newQuestion.question_type === 'short_answer') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          标准答案 *
                        </label>
                        <input
                          type="text"
                          value={newQuestion.answer?.answer_text || ''}
                          onChange={(e) =>
                            setNewQuestion({
                              ...newQuestion,
                              answer: { ...newQuestion.answer!, answer_text: e.target.value },
                            })
                          }
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none"
                          placeholder="输入标准答案..."
                        />

                        <label className="block text-sm font-medium text-gray-700 mb-2 mt-3">
                          答案解析 (可选)
                        </label>
                        <textarea
                          value={newQuestion.answer?.answer_explanation || ''}
                          onChange={(e) =>
                            setNewQuestion({
                              ...newQuestion,
                              answer: { ...newQuestion.answer!, answer_explanation: e.target.value },
                            })
                          }
                          rows={2}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none resize-none"
                          placeholder="输入答案解析..."
                        />
                      </div>
                    )}

                    <div className="flex gap-3 pt-4">
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleAddQuestion}
                        className="px-6 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition"
                      >
                        ✓ 确认添加
                      </motion.button>
                      <button
                        onClick={() => setShowQuestionForm(false)}
                        className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {!isEdit && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center text-sm text-yellow-700">
            💡 提示：请先保存文章基本信息,然后再添加题目
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherReadingEditor;
