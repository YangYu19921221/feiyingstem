/**
 * 教师端 - 竞赛题库管理
 */
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from '../components/Toast';
import axios from 'axios';

interface QuestionOption {
  id: number;
  option_key: string;
  option_text: string;
  is_correct: boolean;
  display_order: number;
}

interface CompetitionQuestion {
  id: number;
  question_type: string;
  title?: string;
  content: string;
  passage?: string;
  correct_answer: string;
  answer_explanation?: string;
  difficulty: string;
  word_id?: number;
  unit_id?: number;
  tags?: string;
  created_by: number;
  source: string;
  is_active: boolean;
  use_count: number;
  correct_count: number;
  total_attempts: number;
  avg_time: number;
  created_at: string;
  updated_at: string;
  options: QuestionOption[];
}

interface Stats {
  total_questions: number;
  by_type: { [key: string]: number };
  by_difficulty: { [key: string]: number };
  by_source: { [key: string]: number };
  total_attempts: number;
  avg_accuracy: number;
}

const TeacherCompetitionManager: React.FC = () => {
  const [questions, setQuestions] = useState<CompetitionQuestion[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState(0);
  const [generatingMessage, setGeneratingMessage] = useState('');
  const [aiFormData, setAiFormData] = useState({
    word_ids: [] as number[],
    unit_id: null as number | null,
    question_types: ['choice'] as string[],
    difficulty: 'medium',
    count: 5,
    custom_prompt: ''
  });
  const [selectedQuestions, setSelectedQuestions] = useState<number[]>([]);
  const [deleting, setDeleting] = useState(false);

  // 表单状态
  const [formData, setFormData] = useState({
    question_type: 'choice',
    title: '',
    content: '',
    passage: '',
    correct_answer: '',
    answer_explanation: '',
    difficulty: 'medium',
    options: [
      { option_key: 'A', option_text: '', is_correct: false, display_order: 1 },
      { option_key: 'B', option_text: '', is_correct: false, display_order: 2 },
      { option_key: 'C', option_text: '', is_correct: false, display_order: 3 },
      { option_key: 'D', option_text: '', is_correct: false, display_order: 4 },
    ]
  });

  const token = localStorage.getItem('access_token');

  useEffect(() => {
    loadStats();
    loadQuestions();
  }, [selectedDifficulty, selectedType]);

  const loadStats = async () => {
    try {
      const response = await axios.get('/api/v1/teacher/competition-questions/statistics/overview', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('加载统计失败:', error);
    }
  };

  const loadQuestions = async () => {
    try {
      setLoading(true);
      const params: any = { limit: 100 };
      if (selectedDifficulty) params.difficulty = selectedDifficulty;
      if (selectedType) params.question_type = selectedType;
      if (searchKeyword) params.search = searchKeyword;

      const response = await axios.get('/api/v1/teacher/competition-questions', {
        headers: { Authorization: `Bearer ${token}` },
        params
      });
      setQuestions(response.data.questions || []);
    } catch (error) {
      console.error('加载题目失败:', error);
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    loadQuestions();
  };

  const handleCreateQuestion = async () => {
    try {
      setCreating(true);

      // 验证必填字段
      if (!formData.content.trim()) {
        toast.warning('请填写题目内容');
        return;
      }

      // 选择题需要验证选项
      if (formData.question_type === 'choice') {
        const hasCorrect = formData.options.some(opt => opt.is_correct);
        if (!hasCorrect) {
          toast.warning('请至少选择一个正确答案');
          return;
        }
        const filledOptions = formData.options.filter(opt => opt.option_text.trim());
        if (filledOptions.length < 4) {
          toast.warning('选择题必须填写所有4个选项(A/B/C/D)');
          return;
        }
      } else {
        // 非选择题需要填写正确答案
        if (!formData.correct_answer.trim()) {
          toast.warning('请填写正确答案');
          return;
        }
      }

      // 准备提交数据
      const submitData: any = {
        question_type: formData.question_type,
        content: formData.content,
        difficulty: formData.difficulty,
        source: 'manual',
      };

      if (formData.title) submitData.title = formData.title;
      if (formData.passage) submitData.passage = formData.passage;
      if (formData.answer_explanation) submitData.answer_explanation = formData.answer_explanation;

      // 选择题提交选项
      if (formData.question_type === 'choice') {
        submitData.options = formData.options
          .filter(opt => opt.option_text.trim())
          .map(opt => ({
            option_key: opt.option_key,
            option_text: opt.option_text,
            is_correct: opt.is_correct,
            display_order: opt.display_order
          }));
        // 正确答案设置为JSON格式
        const correctOption = formData.options.find(opt => opt.is_correct);
        submitData.correct_answer = JSON.stringify({ answer: correctOption?.option_key || 'A' });
      } else {
        submitData.correct_answer = formData.correct_answer;
      }

      const response = await axios.post(
        '/api/v1/teacher/competition-questions',
        submitData,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (response.status === 200) {
        toast.success('题目创建成功!');
        setShowCreateModal(false);
        // 重置表单
        setFormData({
          question_type: 'choice',
          title: '',
          content: '',
          passage: '',
          correct_answer: '',
          answer_explanation: '',
          difficulty: 'medium',
          options: [
            { option_key: 'A', option_text: '', is_correct: false, display_order: 1 },
            { option_key: 'B', option_text: '', is_correct: false, display_order: 2 },
            { option_key: 'C', option_text: '', is_correct: false, display_order: 3 },
            { option_key: 'D', option_text: '', is_correct: false, display_order: 4 },
          ]
        });
        // 刷新列表
        loadQuestions();
        loadStats();
      }
    } catch (error) {
      console.error('创建题目失败:', error);
      toast.error('创建题目失败,请检查输入');
    } finally {
      setCreating(false);
    }
  };

  const handleAIGenerate = async () => {
    try {
      setGenerating(true);
      setGeneratingProgress(0);
      setGeneratingMessage('🚀 正在启动AI生成引擎...');

      // 模拟进度更新
      const progressInterval = setInterval(() => {
        setGeneratingProgress(prev => {
          if (prev < 90) {
            const increment = Math.random() * 15;
            return Math.min(prev + increment, 90);
          }
          return prev;
        });
      }, 500);

      // 更新消息
      setTimeout(() => setGeneratingMessage('🔍 正在分析单词和难度...'), 1000);
      setTimeout(() => setGeneratingMessage('✨ AI正在创作题目...'), 2000);
      setTimeout(() => setGeneratingMessage('🎨 正在优化题目质量...'), 3500);

      const response = await axios.post('/api/v1/teacher/competition-questions/ai-generate', aiFormData, {
        headers: { Authorization: `Bearer ${token}` }
      });

      clearInterval(progressInterval);
      setGeneratingProgress(100);
      setGeneratingMessage('✅ 生成完成!');

      setTimeout(() => {
        if (response.data.success) {
          toast.success(`AI生成成功! 共生成 ${response.data.generated_count} 道题目`);
          setShowAIModal(false);
          // 重置表单
          setAiFormData({
            word_ids: [],
            unit_id: null,
            question_types: ['choice'],
            difficulty: 'medium',
            count: 5,
            custom_prompt: ''
          });
          setGeneratingProgress(0);
          setGeneratingMessage('');
          // 刷新列表
          loadQuestions();
          loadStats();
        }
      }, 500);
    } catch (error) {
      console.error('AI生成失败:', error);
      setGeneratingMessage('❌ 生成失败');
      setTimeout(() => {
        toast.error('AI生成失败,请检查输入或稍后重试');
        setGeneratingProgress(0);
        setGeneratingMessage('');
      }, 1000);
    } finally {
      setTimeout(() => {
        setGenerating(false);
      }, 1000);
    }
  };

  // 批量删除题目
  const handleBatchDelete = async () => {
    if (selectedQuestions.length === 0) {
      toast.warning('请先选择要删除的题目');
      return;
    }

    if (!confirm(`确定要删除选中的 ${selectedQuestions.length} 道题目吗?此操作不可恢复!`)) {
      return;
    }

    try {
      setDeleting(true);
      await axios.post('/api/v1/teacher/competition-questions/batch-delete', selectedQuestions, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      toast.success(`成功删除 ${selectedQuestions.length} 道题目`);
      setSelectedQuestions([]);
      loadQuestions();
      loadStats();
    } catch (error) {
      console.error('批量删除失败:', error);
      toast.error('批量删除失败,请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  // 全选/取消全选
  const handleSelectAll = () => {
    if (selectedQuestions.length === questions.length) {
      setSelectedQuestions([]);
    } else {
      setSelectedQuestions(questions.map(q => q.id));
    }
  };

  // 切换单个题目的选择状态
  const toggleQuestionSelection = (questionId: number) => {
    setSelectedQuestions(prev => {
      if (prev.includes(questionId)) {
        return prev.filter(id => id !== questionId);
      } else {
        return [...prev, questionId];
      }
    });
  };

  const updateFormField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateOption = (index: number, field: string, value: any) => {
    const newOptions = [...formData.options];
    newOptions[index] = { ...newOptions[index], [field]: value };
    // 如果设置为正确答案,取消其他选项的正确状态
    if (field === 'is_correct' && value === true) {
      newOptions.forEach((opt, i) => {
        if (i !== index) opt.is_correct = false;
      });
    }
    setFormData(prev => ({ ...prev, options: newOptions }));
  };

  const getDifficultyColor = (difficulty: string) => {
    const colors = {
      'easy': 'bg-green-100 text-green-700',
      'medium': 'bg-yellow-100 text-yellow-700',
      'hard': 'bg-red-100 text-red-700'
    };
    return colors[difficulty as keyof typeof colors] || colors['medium'];
  };

  const getDifficultyText = (difficulty: string) => {
    const texts = {
      'easy': '简单',
      'medium': '中等',
      'hard': '困难'
    };
    return texts[difficulty as keyof typeof texts] || difficulty;
  };

  const getTypeText = (type: string) => {
    const texts = {
      'choice': '选择题',
      'fill_blank': '填空题',
      'spelling': '拼写题',
      'reading': '阅读理解'
    };
    return texts[type as keyof typeof texts] || type;
  };

  const getTypeIcon = (type: string) => {
    const icons = {
      'choice': '📝',
      'fill_blank': '✏️',
      'spelling': '🔤',
      'reading': '📖'
    };
    return icons[type as keyof typeof icons] || '❓';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <div className="bg-white shadow-sm mb-6">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.history.back()}
                className="text-gray-600 hover:text-gray-800"
              >
                ← 返回
              </button>
              <h1 className="text-2xl font-bold text-gray-800">🏆 竞赛题库管理</h1>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowAIModal(true)}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition font-medium"
              >
                🤖 AI生成题目
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
              >
                ➕ 创建题目
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4">
        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <div className="text-3xl font-bold text-blue-600">{stats.total_questions}</div>
              <div className="text-sm text-gray-600 mt-1">总题目数</div>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <div className="text-3xl font-bold text-green-600">{stats.total_attempts}</div>
              <div className="text-sm text-gray-600 mt-1">总答题次数</div>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <div className="text-3xl font-bold text-orange-600">
                {(stats.avg_accuracy || 0).toFixed(1)}%
              </div>
              <div className="text-sm text-gray-600 mt-1">平均正确率</div>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <div className="text-3xl font-bold text-purple-600">
                {Object.keys(stats.by_type || {}).length}
              </div>
              <div className="text-sm text-gray-600 mt-1">题型种类</div>
            </div>
          </div>
        )}

        {/* 筛选条件 */}
        <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
          <h3 className="text-lg font-bold mb-4">筛选条件</h3>

          {/* 题型筛选 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">题型</label>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedType('')}
                className={`px-4 py-2 rounded-lg font-medium ${
                  selectedType === ''
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                全部 ({stats?.total_questions || 0})
              </button>
              {['choice', 'fill_blank', 'spelling', 'reading'].map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`px-4 py-2 rounded-lg font-medium ${
                    selectedType === type
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {getTypeIcon(type)} {getTypeText(type)} ({(stats?.by_type && stats.by_type[type]) || 0})
                </button>
              ))}
            </div>
          </div>

          {/* 难度筛选 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">难度</label>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedDifficulty('')}
                className={`px-4 py-2 rounded-lg font-medium ${
                  selectedDifficulty === ''
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                全部
              </button>
              {['easy', 'medium', 'hard'].map((level) => (
                <button
                  key={level}
                  onClick={() => setSelectedDifficulty(level)}
                  className={`px-4 py-2 rounded-lg font-medium ${
                    selectedDifficulty === level
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {getDifficultyText(level)} ({(stats?.by_difficulty && stats.by_difficulty[level]) || 0})
                </button>
              ))}
            </div>
          </div>

          {/* 搜索 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">搜索</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="搜索题目内容..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSearch}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
              >
                搜索
              </button>
            </div>
          </div>
        </div>

        {/* 题目列表 */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 border-b">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold">题目列表</h3>
                <p className="text-sm text-gray-600 mt-1">
                  共 {questions.length} 道题目
                  {selectedQuestions.length > 0 && (
                    <span className="ml-2 text-blue-600 font-medium">
                      (已选择 {selectedQuestions.length} 道)
                    </span>
                  )}
                </p>
              </div>

              {questions.length > 0 && (
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedQuestions.length === questions.length && questions.length > 0}
                      onChange={handleSelectAll}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">全选</span>
                  </label>

                  {selectedQuestions.length > 0 && (
                    <button
                      onClick={handleBatchDelete}
                      disabled={deleting}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {deleting ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span>删除中...</span>
                        </>
                      ) : (
                        <>
                          <span>🗑️</span>
                          <span>批量删除 ({selectedQuestions.length})</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="text-gray-500 mt-4">加载中...</p>
            </div>
          ) : (
            <div className="divide-y">
              {questions.map((question) => (
                <div key={question.id} className="p-6 hover:bg-gray-50 transition">
                  <div className="flex items-start gap-4">
                    {/* 复选框 */}
                    <input
                      type="checkbox"
                      checked={selectedQuestions.includes(question.id)}
                      onChange={() => toggleQuestionSelection(question.id)}
                      className="mt-1 w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    />

                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-2xl">{getTypeIcon(question.question_type)}</span>
                        <span className={`px-3 py-1 rounded text-sm font-medium ${getDifficultyColor(question.difficulty)}`}>
                          {getDifficultyText(question.difficulty)}
                        </span>
                        <span className="px-3 py-1 rounded text-sm font-medium bg-gray-100 text-gray-700">
                          {question.source === 'ai' ? '🤖 AI生成' : '✍️ 手动创建'}
                        </span>
                        {question.title && (
                          <span className="text-lg font-semibold text-gray-800">{question.title}</span>
                        )}
                      </div>

                      <div className="text-gray-800 mb-2 font-medium">
                        {question.content}
                      </div>

                      {question.options && question.options.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {question.options.map((option) => {
                            // AI生成的题目,正确答案使用更醒目的颜色
                            const isAI = question.source === 'ai';
                            const correctStyle = isAI
                              ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-2 border-emerald-400 shadow-sm'
                              : 'bg-green-50 border-2 border-green-200';
                            const incorrectStyle = isAI
                              ? 'bg-gray-50 border border-gray-300'
                              : 'bg-gray-50 border border-gray-200';

                            return (
                              <div
                                key={option.id}
                                className={`p-3 rounded-lg transition ${
                                  option.is_correct ? correctStyle : incorrectStyle
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`font-bold ${option.is_correct && isAI ? 'text-emerald-700' : 'text-gray-700'}`}>
                                    {option.option_key}.
                                  </span>
                                  <span className={`${option.is_correct && isAI ? 'text-emerald-900 font-medium' : 'text-gray-800'}`}>
                                    {option.option_text}
                                  </span>
                                  {option.is_correct && (
                                    <span className={`ml-auto font-bold text-sm ${isAI ? 'text-emerald-600' : 'text-green-600'}`}>
                                      ✓ 正确答案
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {question.answer_explanation && (
                        <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                          <span className="font-semibold text-blue-900">💡 解析：</span>
                          <span className="text-blue-800">{question.answer_explanation}</span>
                        </div>
                      )}

                      <div className="mt-3 flex gap-4 text-sm text-gray-500">
                        <span>📊 使用 {question.use_count} 次</span>
                        <span>✅ 答对 {question.correct_count} 次</span>
                        {question.total_attempts > 0 && (
                          <span>
                            正确率 {((question.correct_count / question.total_attempts) * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {questions.length === 0 && (
                <div className="p-12 text-center text-gray-500">
                  <div className="text-6xl mb-4">📝</div>
                  <p className="text-lg font-medium">暂无题目</p>
                  <p className="text-sm mt-2">点击右上角"创建题目"按钮添加新题目</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 说明卡片 */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h3 className="font-bold text-blue-900 mb-2">💡 使用说明</h3>
          <ul className="text-sm text-blue-800 space-y-2">
            <li>• 支持四种题型：选择题、填空题、拼写题、阅读理解</li>
            <li>• 可以手动创建题目,也可以使用AI自动生成</li>
            <li>• AI生成的题目会根据单词难度和释义智能创建</li>
            <li>• 题目统计数据会自动更新,帮助了解学生答题情况</li>
            <li>• 建议定期检查题目质量,确保准确性</li>
          </ul>
        </div>
      </div>

      {/* 创建题目表单 */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto"
          onClick={() => setShowCreateModal(false)}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl p-8 max-w-3xl w-full my-8 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold mb-6 text-center">📝 创建竞赛题目</h2>

            {/* 题型选择 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">题型</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { value: 'choice', label: '选择题', icon: '📝' },
                  { value: 'fill_blank', label: '填空题', icon: '✏️' },
                  { value: 'spelling', label: '拼写题', icon: '🔤' },
                  { value: 'reading', label: '阅读理解', icon: '📖' }
                ].map(type => (
                  <button
                    key={type.value}
                    onClick={() => updateFormField('question_type', type.value)}
                    className={`px-4 py-3 rounded-lg font-medium transition ${
                      formData.question_type === type.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <div className="text-xl mb-1">{type.icon}</div>
                    <div className="text-xs">{type.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 难度选择 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">难度</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'easy', label: '简单', color: 'green' },
                  { value: 'medium', label: '中等', color: 'yellow' },
                  { value: 'hard', label: '困难', color: 'red' }
                ].map(diff => (
                  <button
                    key={diff.value}
                    onClick={() => updateFormField('difficulty', diff.value)}
                    className={`px-4 py-2 rounded-lg font-medium transition ${
                      formData.difficulty === diff.value
                        ? `bg-${diff.color}-600 text-white`
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {diff.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 标题(可选) */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                标题 <span className="text-gray-400 text-xs">(选填)</span>
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => updateFormField('title', e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例如: 单词 happy 的意思"
              />
            </div>

            {/* 题目内容 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                题目内容 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={formData.content}
                onChange={(e) => updateFormField('content', e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="请输入题目内容..."
              />
            </div>

            {/* 阅读理解文章 */}
            {formData.question_type === 'reading' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  阅读文章
                </label>
                <textarea
                  value={formData.passage}
                  onChange={(e) => updateFormField('passage', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={6}
                  placeholder="请输入阅读理解文章..."
                />
              </div>
            )}

            {/* 选择题选项 */}
            {formData.question_type === 'choice' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选项 <span className="text-red-500">*</span>
                </label>
                {formData.options.map((option, index) => (
                  <div key={option.option_key} className="flex items-center gap-2 mb-2">
                    <input
                      type="radio"
                      checked={option.is_correct}
                      onChange={() => updateOption(index, 'is_correct', true)}
                      className="w-4 h-4"
                    />
                    <span className="font-bold text-gray-700 w-8">{option.option_key}.</span>
                    <input
                      type="text"
                      value={option.option_text}
                      onChange={(e) => updateOption(index, 'option_text', e.target.value)}
                      className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={`选项 ${option.option_key}`}
                    />
                  </div>
                ))}
                <p className="text-xs text-gray-500 mt-2">点击单选按钮选择正确答案</p>
              </div>
            )}

            {/* 非选择题的正确答案 */}
            {formData.question_type !== 'choice' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  正确答案 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.correct_answer}
                  onChange={(e) => updateFormField('correct_answer', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入正确答案..."
                />
              </div>
            )}

            {/* 答案解析 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                答案解析 <span className="text-gray-400 text-xs">(选填)</span>
              </label>
              <textarea
                value={formData.answer_explanation}
                onChange={(e) => updateFormField('answer_explanation', e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="为学生提供答案解析..."
              />
            </div>

            {/* 按钮组 */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-3 bg-gray-200 text-gray-700 font-bold rounded-lg hover:bg-gray-300 transition"
                disabled={creating}
              >
                取消
              </button>
              <button
                onClick={handleCreateQuestion}
                disabled={creating}
                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {creating ? '创建中...' : '创建题目'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* AI生成题目模态框 */}
      {showAIModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-2xl font-bold text-gray-800">🤖 AI生成竞赛题目</h2>
              <p className="text-sm text-gray-600 mt-1">使用AI自动生成高质量竞赛题目</p>
            </div>

            <div className="p-6 space-y-6">
              {/* 生成数量 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  生成数量 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={aiFormData.count}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    if (!isNaN(value)) {
                      // 限制在1-50范围内
                      const clampedValue = Math.max(1, Math.min(50, value));
                      setAiFormData(prev => ({ ...prev, count: clampedValue }));
                    } else if (e.target.value === '') {
                      // 如果清空,设置为最小值
                      setAiFormData(prev => ({ ...prev, count: 1 }));
                    }
                  }}
                  onBlur={(e) => {
                    // 失去焦点时,确保值在范围内
                    if (!e.target.value || parseInt(e.target.value) < 1) {
                      setAiFormData(prev => ({ ...prev, count: 1 }));
                    }
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="输入生成题目数量 (1-50)"
                />
              </div>

              {/* 题型选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  题型选择 <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'choice', label: '📝 选择题', emoji: '📝' },
                    { value: 'fill_blank', label: '✏️ 填空题', emoji: '✏️' },
                    { value: 'spelling', label: '🔤 拼写题', emoji: '🔤' },
                    { value: 'reading', label: '📖 阅读理解', emoji: '📖' }
                  ].map(type => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => {
                        const types = aiFormData.question_types;
                        if (types.includes(type.value)) {
                          setAiFormData(prev => ({
                            ...prev,
                            question_types: types.filter(t => t !== type.value)
                          }));
                        } else {
                          setAiFormData(prev => ({
                            ...prev,
                            question_types: [...types, type.value]
                          }));
                        }
                      }}
                      className={`px-4 py-2 rounded-lg border-2 transition ${
                        aiFormData.question_types.includes(type.value)
                          ? 'bg-purple-100 border-purple-500 text-purple-700'
                          : 'bg-white border-gray-300 text-gray-700 hover:border-purple-300'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 难度 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">难度</label>
                <div className="flex gap-2">
                  {[
                    { value: 'easy', label: '简单' },
                    { value: 'medium', label: '中等' },
                    { value: 'hard', label: '困难' }
                  ].map(level => (
                    <button
                      key={level.value}
                      type="button"
                      onClick={() => setAiFormData(prev => ({ ...prev, difficulty: level.value }))}
                      className={`flex-1 px-4 py-2 rounded-lg border-2 transition ${
                        aiFormData.difficulty === level.value
                          ? 'bg-purple-100 border-purple-500 text-purple-700'
                          : 'bg-white border-gray-300 text-gray-700 hover:border-purple-300'
                      }`}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 自定义提示词 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  自定义提示词 <span className="text-gray-400 text-xs">(选填)</span>
                </label>
                <textarea
                  value={aiFormData.custom_prompt}
                  onChange={(e) => setAiFormData(prev => ({ ...prev, custom_prompt: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  rows={4}
                  placeholder="例如: 生成的题目要贴近小学生日常生活场景,多使用家庭、学校、朋友等主题..."
                />
                <p className="text-xs text-gray-500 mt-1">
                  💡 输入您的特殊要求,AI会根据您的提示词调整生成的题目风格和内容
                </p>
              </div>
            </div>

            {/* 生成进度 */}
            {generating && (
              <div className="px-6 pb-4">
                <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-4 border border-purple-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-purple-900">{generatingMessage}</span>
                    <span className="text-sm font-bold text-purple-600">{Math.round(generatingProgress)}%</span>
                  </div>
                  <div className="w-full bg-purple-200 rounded-full h-3 overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${generatingProgress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-center gap-2">
                    <div className="flex gap-1">
                      <motion.div
                        className="w-2 h-2 bg-purple-500 rounded-full"
                        animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                        transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                      />
                      <motion.div
                        className="w-2 h-2 bg-pink-500 rounded-full"
                        animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                        transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                      />
                      <motion.div
                        className="w-2 h-2 bg-purple-500 rounded-full"
                        animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                        transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                      />
                    </div>
                    <span className="text-xs text-purple-700">AI正在努力工作中...</span>
                  </div>
                </div>
              </div>
            )}

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => !generating && setShowAIModal(false)}
                disabled={generating}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? '生成中...' : '取消'}
              </button>
              <button
                onClick={handleAIGenerate}
                disabled={generating || aiFormData.question_types.length === 0}
                className="px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {generating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>生成中...</span>
                  </>
                ) : (
                  <>
                    <span>🤖</span>
                    <span>开始生成</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default TeacherCompetitionManager;
