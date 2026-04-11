import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getTeacherHomework,
  createHomework,
  getHomeworkStudentStatus,
  getStudentHomeworkAttempts,
  deleteHomework,
  type HomeworkResponse,
  type CreateHomeworkRequest,
  type StudentHomeworkStatusResponse,
  type HomeworkAttemptResponse,
} from '../api/homework';
import { getTeacherWordBooks, getUnitsByBook, getStudentsList, type TeacherWordBook, type UnitResponse, type StudentInfo } from '../api/teacher';
import { toast } from '../components/Toast';

// 学习模式映射
const LEARNING_MODE_MAP: Record<string, string> = {
  flashcard: '闪卡记忆',
  spelling: '拼写练习',
  fillblank: '填空练习',
  quiz: '选择题测试',
};

// 状态映射
const STATUS_MAP: Record<string, { label: string; color: string; emoji: string }> = {
  pending: { label: '待开始', color: 'bg-gray-100 text-gray-600', emoji: '⏳' },
  in_progress: { label: '进行中', color: 'bg-blue-100 text-blue-600', emoji: '✍️' },
  completed: { label: '已完成', color: 'bg-green-100 text-green-600', emoji: '✅' },
  overdue: { label: '已逾期', color: 'bg-red-100 text-red-600', emoji: '⏰' },
};

const TeacherHomework: React.FC = () => {
  // 状态管理
  const [homeworkList, setHomeworkList] = useState<HomeworkResponse[]>([]);
  const [wordBooks, setWordBooks] = useState<TeacherWordBook[]>([]);
  const [units, setUnits] = useState<UnitResponse[]>([]);
  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedHomework, setSelectedHomework] = useState<HomeworkResponse | null>(null);
  const [studentStatuses, setStudentStatuses] = useState<StudentHomeworkStatusResponse[]>([]);
  const [selectedStudentAttempts, setSelectedStudentAttempts] = useState<{
    studentId: number;
    studentName: string;
    attempts: HomeworkAttemptResponse[];
  } | null>(null);

  // 创建表单状态
  const [formData, setFormData] = useState<CreateHomeworkRequest>({
    title: '',
    description: '',
    unit_id: 0,
    learning_mode: 'flashcard',
    student_ids: [],
    target_score: 80,
    max_attempts: 3,
    deadline: '',
  });
  const [selectedBookId, setSelectedBookId] = useState<number>(0);

  // 加载数据
  useEffect(() => {
    loadHomework();
    loadWordBooks();
    loadStudents();
  }, []);

  // 当选择单词本时加载单元
  useEffect(() => {
    if (selectedBookId > 0) {
      loadUnits(selectedBookId);
    } else {
      setUnits([]);
    }
  }, [selectedBookId]);

  const loadHomework = async () => {
    try {
      setLoading(true);
      const data = await getTeacherHomework();
      setHomeworkList(data);
    } catch (error) {
      console.error('加载作业列表失败:', error);
      toast.error('加载作业列表失败,请重试');
    } finally {
      setLoading(false);
    }
  };

  const loadWordBooks = async () => {
    try {
      const data = await getTeacherWordBooks();
      setWordBooks(data);
    } catch (error) {
      console.error('加载单词本失败:', error);
    }
  };

  const loadUnits = async (bookId: number) => {
    try {
      const data = await getUnitsByBook(bookId);
      setUnits(data);
    } catch (error) {
      console.error('加载单元失败:', error);
    }
  };

  const loadStudents = async () => {
    try {
      const data = await getStudentsList();
      setStudents(data);
    } catch (error) {
      console.error('加载学生列表失败:', error);
    }
  };

  const loadStudentStatuses = async (homeworkId: number) => {
    try {
      const data = await getHomeworkStudentStatus(homeworkId);
      setStudentStatuses(data);
    } catch (error) {
      console.error('加载学生状态失败:', error);
    }
  };

  const loadStudentAttempts = async (homeworkId: number, studentId: number, studentName: string) => {
    try {
      const data = await getStudentHomeworkAttempts(homeworkId, studentId);
      setSelectedStudentAttempts({ studentId, studentName, attempts: data });
    } catch (error) {
      console.error('加载学生尝试记录失败:', error);
    }
  };

  // 处理创建作业
  const handleCreateHomework = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      toast.warning('请输入作业标题');
      return;
    }
    if (!formData.unit_id) {
      toast.warning('请选择单元');
      return;
    }
    if (formData.student_ids.length === 0) {
      toast.warning('请至少选择一个学生');
      return;
    }

    try {
      setLoading(true);
      await createHomework(formData);
      toast.success('作业创建成功!');
      setShowCreateModal(false);
      resetForm();
      loadHomework();
    } catch (error: any) {
      console.error('创建作业失败:', error);
      toast.error(`创建作业失败: ${error.response?.data?.detail || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 重置表单
  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      unit_id: 0,
      learning_mode: 'flashcard',
      student_ids: [],
      target_score: 80,
      max_attempts: 3,
      deadline: '',
    });
    setSelectedBookId(0);
  };

  // 处理删除作业
  const handleDeleteHomework = async (homeworkId: number) => {
    if (!confirm('确定要删除这个作业吗?删除后无法恢复!')) {
      return;
    }

    try {
      setLoading(true);
      await deleteHomework(homeworkId);
      toast.success('作业删除成功!');
      loadHomework();
      if (selectedHomework?.id === homeworkId) {
        setSelectedHomework(null);
      }
    } catch (error: any) {
      console.error('删除作业失败:', error);
      toast.error(`删除作业失败: ${error.response?.data?.detail || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 查看作业详情
  const handleViewHomeworkDetail = async (homework: HomeworkResponse) => {
    setSelectedHomework(homework);
    await loadStudentStatuses(homework.id);
  };

  // 切换学生选择
  const toggleStudentSelection = (studentId: number) => {
    setFormData((prev) => ({
      ...prev,
      student_ids: prev.student_ids.includes(studentId)
        ? prev.student_ids.filter((id) => id !== studentId)
        : [...prev.student_ids, studentId],
    }));
  };

  // 格式化时间
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 格式化时长
  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}分${secs}秒`;
  };

  // 计算完成率
  const calculateCompletionRate = (homework: HomeworkResponse) => {
    if (homework.total_assigned === 0) return 0;
    return Math.round((homework.completed_count / homework.total_assigned) * 100);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 头部 */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-800 mb-2">📚 作业管理</h1>
            <p className="text-gray-600">创建和管理学生作业</p>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowCreateModal(true)}
            className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-shadow flex items-center gap-2"
          >
            <span className="text-xl">➕</span>
            <span>创建新作业</span>
          </motion.button>
        </div>

        {/* 作业列表 */}
        {loading && homeworkList.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-orange-500 border-t-transparent"></div>
            <p className="mt-4 text-gray-600">加载中...</p>
          </div>
        ) : homeworkList.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-6xl mb-4">📝</p>
            <p className="text-xl text-gray-600">还没有创建任何作业</p>
            <p className="text-gray-500 mt-2">点击右上角按钮创建第一个作业吧!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence mode="popLayout">
              {homeworkList.map((homework) => (
                <motion.div
                  key={homework.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  whileHover={{ y: -5 }}
                  className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-shadow p-6 cursor-pointer"
                  onClick={() => handleViewHomeworkDetail(homework)}
                >
                  {/* 标题和学习模式 */}
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-bold text-gray-800 flex-1">{homework.title}</h3>
                    <span className="ml-2 px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-sm font-medium whitespace-nowrap">
                      {LEARNING_MODE_MAP[homework.learning_mode] || homework.learning_mode}
                    </span>
                  </div>

                  {/* 单词本和单元 */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-gray-600">
                      <span>📖</span>
                      <span className="text-sm">{homework.book_name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <span>📑</span>
                      <span className="text-sm">{homework.unit_name}</span>
                    </div>
                  </div>

                  {/* 目标和截止时间 */}
                  <div className="space-y-2 mb-4 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <span>🎯</span>
                      <span>目标分数: {homework.target_score}分</span>
                    </div>
                    {homework.deadline && (
                      <div className="flex items-center gap-2">
                        <span>⏰</span>
                        <span>截止: {formatDate(homework.deadline)}</span>
                      </div>
                    )}
                  </div>

                  {/* 统计数据 */}
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    <div className="text-center">
                      <div className="text-lg font-bold text-gray-800">{homework.total_assigned}</div>
                      <div className="text-xs text-gray-500">总数</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-green-600">{homework.completed_count}</div>
                      <div className="text-xs text-gray-500">完成</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-blue-600">{homework.in_progress_count}</div>
                      <div className="text-xs text-gray-500">进行中</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-gray-600">{homework.pending_count}</div>
                      <div className="text-xs text-gray-500">待开始</div>
                    </div>
                  </div>

                  {/* 完成率进度条 */}
                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-gray-600">完成率</span>
                      <span className="text-xs font-bold text-gray-800">{calculateCompletionRate(homework)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${calculateCompletionRate(homework)}%` }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                        className="bg-gradient-to-r from-green-400 to-green-600 h-full rounded-full"
                      />
                    </div>
                  </div>

                  {/* 删除按钮 */}
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteHomework(homework.id);
                    }}
                    className="w-full mt-2 px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors text-sm font-medium"
                  >
                    🗑️ 删除作业
                  </motion.button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* 创建作业模态框 */}
        <AnimatePresence>
          {showCreateModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
              onClick={() => setShowCreateModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center rounded-t-2xl">
                  <h2 className="text-2xl font-bold text-gray-800">✨ 创建新作业</h2>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="text-gray-500 hover:text-gray-700 text-2xl"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCreateHomework} className="p-6 space-y-6">
                  {/* 作业标题 */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      📝 作业标题 *
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      placeholder="例如: Unit 1 单词练习"
                      required
                    />
                  </div>

                  {/* 作业描述 */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      📄 作业描述
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      placeholder="可选,简单描述作业要求..."
                      rows={3}
                    />
                  </div>

                  {/* 选择单词本 */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      📚 选择单词本 *
                    </label>
                    <select
                      value={selectedBookId}
                      onChange={(e) => {
                        const bookId = Number(e.target.value);
                        setSelectedBookId(bookId);
                        setFormData({ ...formData, unit_id: 0 });
                      }}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      required
                    >
                      <option value={0}>请选择单词本</option>
                      {wordBooks.map((book) => (
                        <option key={book.id} value={book.id}>
                          {book.name} {book.grade_level ? `(${book.grade_level})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 选择单元 */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      📑 选择单元 *
                    </label>
                    <select
                      value={formData.unit_id}
                      onChange={(e) => setFormData({ ...formData, unit_id: Number(e.target.value) })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      required
                      disabled={!selectedBookId}
                    >
                      <option value={0}>请选择单元</option>
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name} ({unit.word_count}个单词)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 学习模式 */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      🎮 学习模式 *
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(LEARNING_MODE_MAP).map(([mode, label]) => (
                        <motion.div
                          key={mode}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setFormData({ ...formData, learning_mode: mode })}
                          className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                            formData.learning_mode === mode
                              ? 'border-orange-500 bg-orange-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="font-semibold text-gray-800">{label}</div>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* 目标分数和最大尝试次数 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        🎯 目标分数 *
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={formData.target_score}
                        onChange={(e) => setFormData({ ...formData, target_score: Number(e.target.value) })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        🔄 最大尝试次数 *
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={formData.max_attempts}
                        onChange={(e) => setFormData({ ...formData, max_attempts: Number(e.target.value) })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        required
                      />
                    </div>
                  </div>

                  {/* 截止时间 */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      ⏰ 截止时间
                    </label>
                    <input
                      type="datetime-local"
                      value={formData.deadline}
                      onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>

                  {/* 选择学生 */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      👥 选择学生 * (已选择 {formData.student_ids.length} 人)
                    </label>
                    <div className="border border-gray-300 rounded-xl p-4 max-h-48 overflow-y-auto">
                      {students.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">暂无学生</p>
                      ) : (
                        <div className="space-y-2">
                          {students.map((student) => (
                            <label
                              key={student.id}
                              className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={formData.student_ids.includes(student.id)}
                                onChange={() => toggleStudentSelection(student.id)}
                                className="w-5 h-5 text-orange-500 rounded focus:ring-2 focus:ring-orange-500"
                              />
                              <div className="flex-1">
                                <div className="font-medium text-gray-800">{student.full_name}</div>
                                <div className="text-sm text-gray-500">{student.username}</div>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 提交按钮 */}
                  <div className="flex gap-3 pt-4">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        setShowCreateModal(false);
                        resetForm();
                      }}
                      className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
                    >
                      取消
                    </motion.button>
                    <motion.button
                      type="submit"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      disabled={loading}
                      className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? '创建中...' : '✨ 创建作业'}
                    </motion.button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 作业详情模态框 */}
        <AnimatePresence>
          {selectedHomework && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
              onClick={() => {
                setSelectedHomework(null);
                setSelectedStudentAttempts(null);
              }}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center rounded-t-2xl">
                  <h2 className="text-2xl font-bold text-gray-800">📊 {selectedHomework.title}</h2>
                  <button
                    onClick={() => {
                      setSelectedHomework(null);
                      setSelectedStudentAttempts(null);
                    }}
                    className="text-gray-500 hover:text-gray-700 text-2xl"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-6">
                  {/* 作业信息 */}
                  <div className="bg-gradient-to-r from-orange-50 to-yellow-50 rounded-xl p-4 mb-6">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">📖 单词本:</span>
                        <span className="ml-2 font-semibold">{selectedHomework.book_name}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">📑 单元:</span>
                        <span className="ml-2 font-semibold">{selectedHomework.unit_name}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">🎮 学习模式:</span>
                        <span className="ml-2 font-semibold">
                          {LEARNING_MODE_MAP[selectedHomework.learning_mode]}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">🎯 目标分数:</span>
                        <span className="ml-2 font-semibold">{selectedHomework.target_score}分</span>
                      </div>
                      <div>
                        <span className="text-gray-600">🔄 最大尝试:</span>
                        <span className="ml-2 font-semibold">{selectedHomework.max_attempts}次</span>
                      </div>
                      {selectedHomework.deadline && (
                        <div>
                          <span className="text-gray-600">⏰ 截止时间:</span>
                          <span className="ml-2 font-semibold">{formatDate(selectedHomework.deadline)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 学生完成情况 */}
                  <h3 className="text-xl font-bold text-gray-800 mb-4">👥 学生完成情况</h3>
                  {studentStatuses.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">暂无学生数据</p>
                  ) : (
                    <div className="space-y-3">
                      {studentStatuses.map((status) => (
                        <div
                          key={status.id}
                          className="bg-gray-50 rounded-xl p-4 hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold">
                                {status.student_name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-semibold text-gray-800">{status.student_name}</div>
                                <div className="text-sm text-gray-500">
                                  分配时间: {formatDate(status.assigned_at)}
                                </div>
                              </div>
                            </div>
                            <span
                              className={`px-3 py-1 rounded-full text-sm font-medium ${
                                STATUS_MAP[status.status]?.color || 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {STATUS_MAP[status.status]?.emoji || ''} {STATUS_MAP[status.status]?.label || status.status}
                            </span>
                          </div>

                          <div className="grid grid-cols-4 gap-4 mt-3 text-sm">
                            <div className="text-center">
                              <div className="text-lg font-bold text-orange-600">{status.attempts_count}</div>
                              <div className="text-gray-500">尝试次数</div>
                            </div>
                            <div className="text-center">
                              <div className="text-lg font-bold text-green-600">{status.best_score}</div>
                              <div className="text-gray-500">最佳分数</div>
                            </div>
                            <div className="text-center">
                              <div className="text-lg font-bold text-blue-600">
                                {formatDuration(status.total_time_spent)}
                              </div>
                              <div className="text-gray-500">总用时</div>
                            </div>
                            <div className="text-center">
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() =>
                                  loadStudentAttempts(selectedHomework.id, status.student_id, status.student_name)
                                }
                                className="px-3 py-1 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors text-xs font-medium"
                              >
                                查看详情
                              </motion.button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 学生尝试历史模态框 */}
        <AnimatePresence>
          {selectedStudentAttempts && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]"
              onClick={() => setSelectedStudentAttempts(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center rounded-t-2xl">
                  <h2 className="text-2xl font-bold text-gray-800">
                    📈 {selectedStudentAttempts.studentName} 的尝试记录
                  </h2>
                  <button
                    onClick={() => setSelectedStudentAttempts(null)}
                    className="text-gray-500 hover:text-gray-700 text-2xl"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-6">
                  {selectedStudentAttempts.attempts.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">暂无尝试记录</p>
                  ) : (
                    <div className="space-y-4">
                      {selectedStudentAttempts.attempts.map((attempt) => (
                        <div
                          key={attempt.id}
                          className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-lg font-bold text-gray-800">
                              第 {attempt.attempt_number} 次尝试
                            </div>
                            <div className="text-sm text-gray-600">{formatDate(attempt.completed_at)}</div>
                          </div>

                          <div className="grid grid-cols-3 gap-4">
                            <div className="bg-white rounded-lg p-3 text-center">
                              <div className="text-2xl font-bold text-orange-600">{attempt.score}</div>
                              <div className="text-sm text-gray-500">分数</div>
                            </div>
                            <div className="bg-white rounded-lg p-3 text-center">
                              <div className="text-2xl font-bold text-green-600">{attempt.correct_count}</div>
                              <div className="text-sm text-gray-500">正确</div>
                            </div>
                            <div className="bg-white rounded-lg p-3 text-center">
                              <div className="text-2xl font-bold text-red-600">{attempt.wrong_count}</div>
                              <div className="text-sm text-gray-500">错误</div>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
                            <div>
                              总题数: <span className="font-semibold">{attempt.total_words}</span>
                            </div>
                            <div>
                              用时: <span className="font-semibold">{formatDuration(attempt.time_spent)}</span>
                            </div>
                            <div>
                              正确率:{' '}
                              <span className="font-semibold">
                                {Math.round((attempt.correct_count / attempt.total_words) * 100)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default TeacherHomework;
