import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getTeacherHomework,
  createHomework,
  getHomeworkStudentStatus,
  getStudentHomeworkAttempts,
  deleteHomework,
  toggleHomeworkClosed,
  type HomeworkResponse,
  type CreateHomeworkRequest,
  type StudentHomeworkStatusResponse,
  type HomeworkAttemptResponse,
} from '../api/homework';
import { getTeacherWordBooks, getStudentsList, type TeacherWordBook, type StudentInfo } from '../api/teacher';
import { ScopeSelector } from '../components/teacher/ScopeSelector';
import type { ScopeValue } from '../components/teacher/ScopeSelector';
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
  failed: { label: '未达标(次数用完)', color: 'bg-red-100 text-red-600 font-bold', emoji: '❗' },
};

const TeacherHomework: React.FC = () => {
  // 状态管理
  const [homeworkList, setHomeworkList] = useState<HomeworkResponse[]>([]);
  const [wordBooks, setWordBooks] = useState<TeacherWordBook[]>([]);
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
    group_index: null,
    learning_mode: 'flashcard',
    student_ids: [],
    target_score: 80,
    max_attempts: 3,
    deadline: '',
  });
  // ScopeSelector state: allowBook=false means book_id is used for cascading but not submitted.
  // Only unit_id and group_index are included in the homework create payload.
  const [scope, setScope] = useState<ScopeValue>({
    scope_type: 'unit', book_id: null, unit_id: null, group_index: null,
  });
  // 创建弹窗里的学生搜索关键词
  const [studentQuery, setStudentQuery] = useState('');
  // 列表:搜索 / 分页 / 多选
  const [listQuery, setListQuery] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 过滤 + 分页派生(前端过滤:作业总量在几百级,无需后端分页)
  const filteredList = useMemo(() => {
    const kw = listQuery.trim().toLowerCase();
    if (!kw) return homeworkList;
    return homeworkList.filter(h =>
      (h.title || '').toLowerCase().includes(kw) ||
      (h.unit_name || '').toLowerCase().includes(kw) ||
      (h.book_name || '').toLowerCase().includes(kw) ||
      (LEARNING_MODE_MAP[h.learning_mode] || h.learning_mode || '').toLowerCase().includes(kw)
    );
  }, [homeworkList, listQuery]);
  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const pagedList = useMemo(
    () => filteredList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredList, page]
  );
  // 搜索词变化回到第一页;数据变化时页码越界纠正
  useEffect(() => { setPage(1); }, [listQuery]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const pageAllSelected = pagedList.length > 0 && pagedList.every(h => selectedIds.has(h.id));
  const togglePageAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (pageAllSelected) pagedList.forEach(h => next.delete(h.id));
      else pagedList.forEach(h => next.add(h.id));
      return next;
    });
  };

  // 关闭/重新开放作业(保留做题记录的"撤回")
  const handleToggleClosed = async (homeworkId: number) => {
    try {
      const r = await toggleHomeworkClosed(homeworkId);
      toast.success(r.message);
      loadHomework();
    } catch (error: any) {
      toast.error(getErrorMessage(error, '操作失败'));
    }
  };

  // 批量删除:allSettled 容忍部分失败
  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`确定删除选中的 ${ids.length} 份作业吗?删除后无法恢复!`)) return;
    setLoading(true);
    const results = await Promise.allSettled(ids.map(id => deleteHomework(id)));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = ids.length - ok;
    setSelectedIds(new Set());
    if (fail > 0) toast.error(`已删除 ${ok} 份,${fail} 份失败`);
    else toast.success(`已删除 ${ok} 份作业`);
    setLoading(false);
    loadHomework();
  };

  // 加载数据
  useEffect(() => {
    loadHomework();
    loadWordBooks();
    loadStudents();
  }, []);

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
    if (!scope.unit_id && !(scope.unit_ids?.length)) {
      toast.warning('请选择单元');
      return;
    }
    if (formData.student_ids.length === 0) {
      toast.warning('请至少选择一个学生');
      return;
    }

    const unitIds = scope.unit_ids ?? [];
    const multi = unitIds.length > 1;

    try {
      setLoading(true);
      const result = await createHomework({
        ...formData,
        unit_id: scope.unit_id ?? unitIds[0],
        group_index: multi ? null : (scope.group_index ?? null),
        // 多选:一次为每个单元建一份作业
        unit_ids: multi ? unitIds : undefined,
      });
      toast.success(multi ? `已创建 ${result.homework_ids?.length ?? unitIds.length} 份作业!` : '作业创建成功!');
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
      group_index: null,
      learning_mode: 'flashcard',
      student_ids: [],
      target_score: 80,
      max_attempts: 3,
      deadline: '',
    });
    setScope({ scope_type: 'unit', book_id: null, unit_id: null, group_index: null, unit_ids: [] });
    setStudentQuery('');
  };

  // 处理删除作业
  const handleDeleteHomework = async (homeworkId: number) => {
    if (!confirm('确定要彻底删除这个作业吗?学生的做题记录会一起删除且无法恢复!\n(只是发错了或想提前结束,建议用 ⏸ 关闭——学生端隐藏但记录保留)')) {
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
    <div className="min-h-screen bg-[#f5f8fc] p-4 text-slate-800 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* 头部 */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="mb-1 text-2xl font-bold text-gray-800 sm:text-3xl">📚 作业管理</h1>
            <p className="text-gray-600">创建和管理学生作业</p>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowCreateModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-slate-700 sm:w-auto"
          >
            <span className="text-xl">➕</span>
            <span>创建新作业</span>
          </motion.button>
        </div>

        {/* 工具栏:搜索 + 批量删除 */}
        {homeworkList.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
              <input
                type="text"
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder="搜索作业标题 / 单元 / 单词本 / 模式"
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-400 focus:border-transparent shadow-sm"
              />
            </div>
            {selectedIds.size > 0 && (
              <button
                onClick={handleBatchDelete}
                className="px-4 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 transition shadow-sm whitespace-nowrap"
              >
                🗑️ 删除选中({selectedIds.size})
              </button>
            )}
            <div className="flex items-center text-sm text-gray-500 whitespace-nowrap">
              共 {filteredList.length} 份{listQuery.trim() && ` · 匹配「${listQuery.trim()}」`}
            </div>
          </div>
        )}

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
          /* 列表模式:一行一份作业,信息密度高,方便扫视和对比 */
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b-2 border-gray-100 text-left text-sm text-gray-500">
                    <th className="py-3 px-3 w-10">
                      <input
                        type="checkbox"
                        checked={pageAllSelected}
                        onChange={togglePageAll}
                        className="w-4 h-4 cursor-pointer accent-orange-500"
                        title="全选本页"
                      />
                    </th>
                    <th className="py-3 px-4 font-medium">作业</th>
                    <th className="py-3 px-3 font-medium">单元</th>
                    <th className="py-3 px-3 font-medium">模式</th>
                    <th className="py-3 px-3 font-medium text-center">目标分</th>
                    <th className="py-3 px-3 font-medium">截止</th>
                    <th className="py-3 px-3 font-medium text-center">完成/进行/待做</th>
                    <th className="py-3 px-3 font-medium w-40">完成率</th>
                    <th className="py-3 px-3 font-medium text-center w-16">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 不做逐行进出场动画:搜索时整表 layout+exit 动画同时触发会闪屏 */}
                  {pagedList.map((homework) => {
                      const rate = calculateCompletionRate(homework);
                      const overdue = homework.deadline && new Date(homework.deadline) < new Date();
                      return (
                        <tr
                          key={homework.id}
                          className={`border-b border-gray-50 hover:bg-orange-50/40 cursor-pointer transition ${
                            selectedIds.has(homework.id) ? 'bg-orange-50/60' : ''
                          }`}
                          onClick={() => handleViewHomeworkDetail(homework)}
                        >
                          <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(homework.id)}
                              onChange={() => toggleSelect(homework.id)}
                              className="w-4 h-4 cursor-pointer accent-orange-500"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-gray-800">
                              {homework.title}
                              {homework.is_closed && (
                                <span className="ml-2 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-normal">
                                  ⏸ 已关闭
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">{homework.book_name}</div>
                          </td>
                          <td className="py-3 px-3 text-sm text-gray-600">{homework.unit_name}</td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium whitespace-nowrap">
                              {LEARNING_MODE_MAP[homework.learning_mode] || homework.learning_mode}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-sm text-gray-700 text-center font-mono">{homework.target_score}</td>
                          <td className="py-3 px-3 text-sm whitespace-nowrap">
                            {homework.deadline ? (
                              <span className={overdue ? 'text-red-500 font-medium' : 'text-gray-600'}>
                                {formatDate(homework.deadline)}
                                {overdue && ' · 已截止'}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center text-sm font-mono whitespace-nowrap">
                            <span className="text-green-600 font-semibold">{homework.completed_count}</span>
                            <span className="text-gray-300 mx-1">/</span>
                            <span className="text-blue-500">{homework.in_progress_count}</span>
                            <span className="text-gray-300 mx-1">/</span>
                            <span className="text-gray-400">{homework.pending_count}</span>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    rate >= 80 ? 'bg-green-500' : rate >= 40 ? 'bg-yellow-400' : 'bg-gray-300'
                                  }`}
                                  style={{ width: `${rate}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono text-gray-600 w-9 text-right">{rate}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleClosed(homework.id);
                              }}
                              className={`p-1.5 rounded-lg transition ${
                                homework.is_closed
                                  ? 'text-green-500 hover:text-green-700 hover:bg-green-50'
                                  : 'text-orange-400 hover:text-orange-600 hover:bg-orange-50'
                              }`}
                              title={homework.is_closed ? '重新开放(学生端恢复显示)' : '关闭作业(学生端隐藏,做题记录保留)'}
                            >
                              {homework.is_closed ? '▶️' : '⏸'}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteHomework(homework.id);
                              }}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                              title="彻底删除(连做题记录一起删,建议优先用关闭)"
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {/* 搜索无结果 */}
              {filteredList.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">
                  没有匹配「{listQuery.trim()}」的作业
                </div>
              )}
            </div>
            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  第 {page}/{totalPages} 页 · 每页 {PAGE_SIZE} 份
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition"
                  >
                    ← 上一页
                  </button>
                  {/* 页码:最多显示 7 个,当前页居中 */}
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                    .reduce<(number | '…')[]>((acc, p) => {
                      const last = acc[acc.length - 1];
                      if (typeof last === 'number' && p - last > 1) acc.push('…');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) =>
                      p === '…' ? (
                        <span key={`e${i}`} className="px-1 text-gray-300">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          className={`w-8 h-8 rounded-lg text-sm transition ${
                            p === page
                              ? 'bg-orange-500 text-white font-semibold'
                              : 'border border-gray-200 hover:bg-gray-50 text-gray-600'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition"
                  >
                    下一页 →
                  </button>
                </div>
              </div>
            )}
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
                className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
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

                  {/* 选择单元和分组（ScopeSelector 内部处理书→单元的级联，allowBook=false 不提交整本范围） */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      📚 选择单词本 / 单元 *
                    </label>
                    <ScopeSelector
                      books={wordBooks}
                      value={scope}
                      onChange={setScope}
                      allowBook={false}
                      multiUnit
                    />
                    {(scope.unit_ids?.length || 0) > 1 && (
                      <p className="mt-1.5 text-xs text-blue-600">
                        已选 {scope.unit_ids!.length} 个单元,将创建 {scope.unit_ids!.length} 份独立作业(标题自动加单元名),各自追踪完成情况
                      </p>
                    )}
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
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-gray-700">
                        👥 选择学生 * (已选择 {formData.student_ids.length} / 共 {students.length} 人)
                      </label>
                      {(() => {
                        const kw = studentQuery.trim().toLowerCase();
                        const filtered = kw
                          ? students.filter(s =>
                              (s.full_name || '').toLowerCase().includes(kw) ||
                              (s.username || '').toLowerCase().includes(kw))
                          : students;
                        const allSelected = filtered.length > 0 && filtered.every(s => formData.student_ids.includes(s.id));
                        return (
                          <div className="flex gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => {
                                const ids = filtered.map(s => s.id);
                                setFormData(prev => ({
                                  ...prev,
                                  student_ids: allSelected
                                    ? prev.student_ids.filter(id => !ids.includes(id))
                                    : Array.from(new Set([...prev.student_ids, ...ids])),
                                }));
                              }}
                              className="text-orange-600 hover:text-orange-700 font-medium"
                            >
                              {allSelected ? '取消全选' : kw ? '全选搜索结果' : '全选'}
                            </button>
                            {formData.student_ids.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setFormData(prev => ({ ...prev, student_ids: [] }))}
                                className="text-gray-500 hover:text-gray-700"
                              >
                                清空
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    {/* 搜索框 */}
                    <div className="relative mb-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
                      <input
                        type="text"
                        value={studentQuery}
                        onChange={(e) => setStudentQuery(e.target.value)}
                        placeholder="搜索学生姓名 / 用户名"
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                    </div>
                    <div className="border border-gray-300 rounded-xl p-3 max-h-56 overflow-y-auto">
                      {(() => {
                        const kw = studentQuery.trim().toLowerCase();
                        const filtered = kw
                          ? students.filter(s =>
                              (s.full_name || '').toLowerCase().includes(kw) ||
                              (s.username || '').toLowerCase().includes(kw))
                          : students;
                        if (students.length === 0) {
                          return <p className="text-gray-500 text-center py-4">暂无学生</p>;
                        }
                        if (filtered.length === 0) {
                          return <p className="text-gray-400 text-center py-4">没有匹配「{studentQuery}」的学生</p>;
                        }
                        return (
                          <div className="space-y-1">
                            {filtered.map((student) => (
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
                                <div className="flex-1 flex items-baseline gap-2 min-w-0">
                                  <span className="font-medium text-gray-800 truncate">{student.full_name}</span>
                                  <span className="text-xs text-gray-400 truncate">{student.username}</span>
                                </div>
                              </label>
                            ))}
                          </div>
                        );
                      })()}
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
                      className="flex-1 px-6 py-3 bg-slate-900 text-white rounded-lg font-semibold shadow-sm hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
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
                                {(status.student_name || '?').charAt(0).toUpperCase()}
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
                className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
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
