import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { assignBookToStudents, getBookAssignments, deleteAssignment } from '../api/assignments';
import type { BookAssignmentResponse } from '../api/assignments';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface Student {
  id: number;
  username: string;
  full_name: string;
  email: string;
}

interface WordBook {
  id: number;
  name: string;
  description: string;
  unit_count: number;
  word_count: number;
}

const TeacherBookAssignment = () => {
  const navigate = useNavigate();

  // 单词本列表和选中状态
  const [books, setBooks] = useState<WordBook[]>([]);
  const [selectedBook, setSelectedBook] = useState<WordBook | null>(null);

  // 学生列表和选中状态
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);

  // 分配列表
  const [assignments, setAssignments] = useState<BookAssignmentResponse[]>([]);

  // 表单数据
  const [deadline, setDeadline] = useState('');
  const [studentSearch, setStudentSearch] = useState('');

  // 加载状态
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 消息提示
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 分配记录批量选中（用于多选撤销）
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<Set<number>>(new Set());

  // 撤销快照：刚被删除的记录，10 秒内可一键恢复
  const [undoSnapshot, setUndoSnapshot] = useState<BookAssignmentResponse[] | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清掉残留 timer，防泄漏
  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  // 加载单词本列表
  useEffect(() => {
    loadBooks();
    loadAllAssignments();
  }, []);

  // 当选择单词本时,加载学生列表
  useEffect(() => {
    if (selectedBook) {
      loadStudents();
    }
  }, [selectedBook]);

  const loadBooks = async () => {
    try {
      setLoadingBooks(true);
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/teacher/books`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setBooks(response.data);
    } catch (error) {
      console.error('加载单词本失败:', error);
      showMessage('error', '加载单词本失败');
    } finally {
      setLoadingBooks(false);
    }
  };

  const loadStudents = async () => {
    try {
      setLoadingStudents(true);
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/auth/students`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStudents(response.data);
    } catch (error) {
      console.error('加载学生列表失败:', error);
      showMessage('error', '加载学生列表失败');
    } finally {
      setLoadingStudents(false);
    }
  };

  const loadAllAssignments = async () => {
    try {
      setLoadingAssignments(true);
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/teacher/assignments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAssignments(response.data);
    } catch (error) {
      console.error('加载分配记录失败:', error);
    } finally {
      setLoadingAssignments(false);
    }
  };

  const toggleStudent = (studentId: number) => {
    if (selectedStudents.includes(studentId)) {
      setSelectedStudents(selectedStudents.filter((id) => id !== studentId));
    } else {
      setSelectedStudents([...selectedStudents, studentId]);
    }
  };

  const handleAssign = async () => {
    if (!selectedBook) {
      showMessage('error', '请先选择单词本');
      return;
    }

    if (selectedStudents.length === 0) {
      showMessage('error', '请至少选择一个学生');
      return;
    }

    try {
      setSubmitting(true);
      const result = await assignBookToStudents({
        book_id: selectedBook.id,
        student_ids: selectedStudents,
        deadline: deadline || undefined,
      });

      showMessage(
        'success',
        `分配成功! 共分配 ${result.assigned_count} 个,跳过 ${result.skipped_count} 个(已分配过)`
      );
      setSelectedStudents([]);
      setDeadline('');
      await loadAllAssignments();
    } catch (error: any) {
      console.error('分配失败:', error);
      showMessage('error', error.response?.data?.detail || '分配失败');
    } finally {
      setSubmitting(false);
    }
  };

  /** 单个删除：删完留快照，10s 内可撤回（不再二次确认弹窗） */
  const handleDeleteAssignment = async (assignmentId: number) => {
    const target = assignments.find(a => a.id === assignmentId);
    if (!target) return;
    try {
      await deleteAssignment(assignmentId);
      armUndo([target]);
      showMessage('success', '已撤销 1 条分配');
      await loadAllAssignments();
    } catch (error: any) {
      console.error('删除失败:', error);
      showMessage('error', error.response?.data?.detail || '删除失败');
    }
  };

  /** 批量撤销 */
  const handleBatchDelete = async () => {
    const targets = assignments.filter(a => selectedAssignmentIds.has(a.id));
    if (targets.length === 0) return;
    // 用 allSettled 容忍部分失败，已成功删除的仍纳入撤销快照
    const results = await Promise.allSettled(targets.map(t => deleteAssignment(t.id)));
    const succeeded = targets.filter((_, i) => results[i].status === 'fulfilled');
    const failedCount = results.length - succeeded.length;

    if (succeeded.length > 0) armUndo(succeeded);
    setSelectedAssignmentIds(new Set());
    if (failedCount > 0) {
      showMessage('error', `已撤销 ${succeeded.length} 条，${failedCount} 条失败`);
    } else {
      showMessage('success', `已撤销 ${succeeded.length} 条分配`);
    }
    await loadAllAssignments();
  };

  /** 装载撤销快照 + 10 秒过期 */
  const armUndo = (snapshot: BookAssignmentResponse[]) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoSnapshot(snapshot);
    undoTimerRef.current = setTimeout(() => {
      setUndoSnapshot(null);
      undoTimerRef.current = null;
    }, 10000);
  };

  /** 撤回：按 (book_id, deadline) 分组重新分配 */
  const handleUndo = async () => {
    if (!undoSnapshot || undoSnapshot.length === 0) return;
    try {
      const groups = new Map<string, { book_id: number; student_ids: number[]; deadline?: string }>();
      for (const a of undoSnapshot) {
        const key = `${a.book_id}|${a.deadline ?? ''}`;
        const existing = groups.get(key);
        if (existing) {
          existing.student_ids.push(a.student_id);
        } else {
          groups.set(key, { book_id: a.book_id, student_ids: [a.student_id], deadline: a.deadline });
        }
      }
      await Promise.all(Array.from(groups.values()).map(g => assignBookToStudents(g)));
      showMessage('success', `已恢复 ${undoSnapshot.length} 条分配`);
      setUndoSnapshot(null);
      if (undoTimerRef.current) { clearTimeout(undoTimerRef.current); undoTimerRef.current = null; }
      await loadAllAssignments();
    } catch (error: any) {
      console.error('撤回失败:', error);
      showMessage('error', error.response?.data?.detail || '撤回失败');
    }
  };

  /** 单行复选框切换 */
  const toggleAssignmentSelected = (id: number) => {
    setSelectedAssignmentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** 全选 / 反选当前列表 */
  const toggleSelectAll = () => {
    if (selectedAssignmentIds.size === assignments.length) {
      setSelectedAssignmentIds(new Set());
    } else {
      setSelectedAssignmentIds(new Set(assignments.map(a => a.id)));
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // 获取某个单词本已分配的学生ID列表
  const getAssignedStudentIds = (bookId: number): number[] => {
    return assignments
      .filter((a) => a.book_id === bookId)
      .map((a) => a.student_id);
  };

  // 过滤当前选中单词本的分配记录
  const currentBookAssignments = selectedBook
    ? assignments.filter((a) => a.book_id === selectedBook.id)
    : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm mb-6">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/teacher/dashboard')}
              className="text-gray-600 hover:text-gray-800 transition"
            >
              ← 返回
            </button>
            <h1 className="text-2xl font-bold text-gray-800">📚 单词本分配管理</h1>
          </div>
        </div>
      </nav>

      {/* 消息提示 */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={`max-w-7xl mx-auto px-4 mb-4`}
        >
          <div
            className={`px-4 py-3 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {message.text}
          </div>
        </motion.div>
      )}

      <div className="max-w-7xl mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧: 单词本列表 */}
          <div className="lg:col-span-1">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-2xl shadow-md p-6"
            >
              <h2 className="text-xl font-bold text-gray-800 mb-4">📖 选择单词本</h2>

              {loadingBooks ? (
                <div className="text-center py-8 text-gray-500">加载中...</div>
              ) : books.length === 0 ? (
                <div className="text-center py-8 text-gray-500">暂无单词本</div>
              ) : (
                <div className="space-y-3 max-h-[calc(100vh-250px)] overflow-y-auto">
                  {books.map((book) => (
                    <motion.div
                      key={book.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedBook(book)}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition ${
                        selectedBook?.id === book.id
                          ? 'border-orange-400 bg-orange-50'
                          : 'border-gray-200 hover:border-orange-200'
                      }`}
                    >
                      <div className="font-medium text-gray-800 mb-1">{book.name}</div>
                      <div className="text-xs text-gray-500 mb-2">
                        {book.description || '暂无描述'}
                      </div>
                      <div className="flex gap-3 text-xs text-gray-600">
                        <span>📑 {book.unit_count} 单元</span>
                        <span>📝 {book.word_count} 单词</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBook(book);
                        }}
                        className={`w-full mt-3 py-2 rounded-lg text-sm font-medium transition ${
                          selectedBook?.id === book.id
                            ? 'bg-orange-500 text-white'
                            : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                        }`}
                      >
                        {selectedBook?.id === book.id ? '✓ 已选择' : '选择分配'}
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>

          {/* 右侧: 分配界面 */}
          <div className="lg:col-span-2">
            {!selectedBook ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white rounded-2xl shadow-md p-12 text-center"
              >
                <div className="text-6xl mb-4">📚</div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">请先选择单词本</h3>
                <p className="text-gray-500">从左侧列表中选择要分配的单词本</p>
              </motion.div>
            ) : (
              <div className="space-y-6">
                {/* 单词本信息 */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gradient-to-r from-orange-100 to-yellow-100 rounded-2xl shadow-md p-6"
                >
                  <h2 className="text-xl font-bold text-gray-800 mb-3">
                    📖 {selectedBook.name}
                  </h2>
                  <p className="text-sm text-gray-700 mb-4">
                    {selectedBook.description || '暂无描述'}
                  </p>
                  <div className="flex gap-4 text-sm">
                    <span className="bg-white px-3 py-1 rounded-full">
                      📑 {selectedBook.unit_count} 单元
                    </span>
                    <span className="bg-white px-3 py-1 rounded-full">
                      📝 {selectedBook.word_count} 单词
                    </span>
                  </div>
                </motion.div>

                {/* 学生选择 */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-white rounded-2xl shadow-md p-6"
                >
                  <h2 className="text-xl font-bold text-gray-800 mb-4">👥 选择学生</h2>

                  {/* 搜索 + 批量操作 */}
                  <div className="flex flex-col sm:flex-row gap-2 mb-3">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="🔍 搜索姓名 / 用户名 / 邮箱"
                        className="w-full pl-10 pr-8 py-2 border border-gray-300 rounded-lg outline-none focus:border-orange-400"
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔎</span>
                      {studentSearch && (
                        <button
                          type="button"
                          onClick={() => setStudentSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg"
                          aria-label="清空搜索"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {(() => {
                      const assignedIds = getAssignedStudentIds(selectedBook.id);
                      const kw = studentSearch.trim().toLowerCase();
                      const filtered = students.filter(s => {
                        if (!kw) return true;
                        return (s.full_name || '').toLowerCase().includes(kw)
                          || (s.username || '').toLowerCase().includes(kw)
                          || (s.email || '').toLowerCase().includes(kw);
                      });
                      const selectableIds = filtered.filter(s => !assignedIds.includes(s.id)).map(s => s.id);
                      const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedStudents.includes(id));
                      return (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (allSelected) {
                                setSelectedStudents(selectedStudents.filter(id => !selectableIds.includes(id)));
                              } else {
                                setSelectedStudents(Array.from(new Set([...selectedStudents, ...selectableIds])));
                              }
                            }}
                            disabled={selectableIds.length === 0}
                            className="px-3 py-2 text-sm rounded-lg bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            {allSelected ? '取消全选' : `全选(${selectableIds.length})`}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedStudents([])}
                            disabled={selectedStudents.length === 0}
                            className="px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            清空
                          </button>
                        </div>
                      );
                    })()}
                  </div>

                  {loadingStudents ? (
                    <div className="text-center py-8 text-gray-500">加载中...</div>
                  ) : students.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">暂无学生</div>
                  ) : (() => {
                    const kw = studentSearch.trim().toLowerCase();
                    const filtered = students.filter(s => {
                      if (!kw) return true;
                      return (s.full_name || '').toLowerCase().includes(kw)
                        || (s.username || '').toLowerCase().includes(kw)
                        || (s.email || '').toLowerCase().includes(kw);
                    });
                    if (filtered.length === 0) {
                      return <div className="text-center py-8 text-gray-400">没有匹配的学生</div>;
                    }
                    return (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {filtered.map((student) => {
                        const isAssigned = getAssignedStudentIds(selectedBook.id).includes(
                          student.id
                        );
                        return (
                          <label
                            key={student.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition ${
                              selectedStudents.includes(student.id)
                                ? 'border-orange-400 bg-orange-50'
                                : 'border-gray-200 hover:border-orange-200'
                            } ${isAssigned ? 'opacity-50' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedStudents.includes(student.id)}
                              onChange={() => toggleStudent(student.id)}
                              disabled={isAssigned}
                              className="w-5 h-5 text-orange-500 focus:ring-orange-400 rounded"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-800">{student.full_name}</div>
                              <div className="text-xs text-gray-500">{student.username}</div>
                            </div>
                            {isAssigned && (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                                已分配
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                    );
                  })()}
                </motion.div>

                {/* 截止时间和分配按钮 */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="bg-white rounded-2xl shadow-md p-6"
                >
                  <h2 className="text-xl font-bold text-gray-800 mb-4">⚙️ 分配设置</h2>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      截止时间 (可选)
                    </label>
                    <input
                      type="datetime-local"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none focus:border-orange-400"
                    />
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleAssign}
                    disabled={submitting || selectedStudents.length === 0}
                    className={`w-full py-3 rounded-lg font-medium text-white transition ${
                      submitting || selectedStudents.length === 0
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-orange-500 to-yellow-500 hover:shadow-lg'
                    }`}
                  >
                    {submitting
                      ? '分配中...'
                      : selectedStudents.length > 0
                      ? `📌 分配给 ${selectedStudents.length} 名学生`
                      : '请选择学生'}
                  </motion.button>
                </motion.div>
              </div>
            )}
          </div>
        </div>

        {/* 底部: 已分配列表 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-6 bg-white rounded-2xl shadow-md p-6"
        >
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="text-xl font-bold text-gray-800">📊 分配记录</h2>
            {assignments.length > 0 && (
              <div className="flex items-center gap-3 text-sm">
                <button
                  onClick={toggleSelectAll}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
                >
                  {selectedAssignmentIds.size === assignments.length ? '取消全选' : '全选'}
                </button>
                <span className="text-gray-500">已选 {selectedAssignmentIds.size}</span>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  disabled={selectedAssignmentIds.size === 0}
                  onClick={handleBatchDelete}
                  className={`px-4 py-1.5 rounded-lg font-medium transition ${
                    selectedAssignmentIds.size === 0
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-red-500 text-white hover:bg-red-600 shadow-md'
                  }`}
                >
                  🗑️ 批量撤销
                </motion.button>
              </div>
            )}
          </div>

          {loadingAssignments ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">暂无分配记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="py-3 px-3 w-10">
                      <input
                        type="checkbox"
                        className="w-4 h-4 cursor-pointer"
                        checked={selectedAssignmentIds.size > 0 && selectedAssignmentIds.size === assignments.length}
                        ref={el => {
                          if (el) el.indeterminate = selectedAssignmentIds.size > 0 && selectedAssignmentIds.size < assignments.length;
                        }}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">单词本</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">学生</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">分配时间</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">截止时间</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">状态</th>
                    <th className="text-center py-3 px-4 font-medium text-gray-700">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => (
                    <motion.tr
                      key={assignment.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`border-b border-gray-100 transition ${
                        selectedAssignmentIds.has(assignment.id) ? 'bg-orange-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="py-3 px-3">
                        <input
                          type="checkbox"
                          className="w-4 h-4 cursor-pointer"
                          checked={selectedAssignmentIds.has(assignment.id)}
                          onChange={() => toggleAssignmentSelected(assignment.id)}
                        />
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-gray-800">{assignment.book_name}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-gray-700">{assignment.student_name}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm text-gray-600">
                          {new Date(assignment.assigned_at).toLocaleDateString('zh-CN')}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm text-gray-600">
                          {assignment.deadline
                            ? new Date(assignment.deadline).toLocaleDateString('zh-CN')
                            : '无截止时间'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {assignment.is_completed ? (
                          <span className="inline-block text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full">
                            ✅ 已完成
                          </span>
                        ) : (
                          <span className="inline-block text-xs bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full">
                            ⏳ 进行中
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleDeleteAssignment(assignment.id)}
                          className="text-red-500 hover:text-red-700 transition"
                        >
                          🗑️ 删除
                        </motion.button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>

      {/* 撤销提示（删除后 10 秒内可点击恢复） */}
      <AnimatePresence>
        {undoSnapshot && undoSnapshot.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-4"
          >
            <span className="text-sm">
              已撤销 <span className="font-bold text-yellow-300">{undoSnapshot.length}</span> 条分配
            </span>
            <button
              onClick={handleUndo}
              className="px-3 py-1.5 rounded-lg bg-yellow-400 text-gray-900 font-bold text-sm hover:bg-yellow-300 transition"
            >
              ↺ 撤回
            </button>
            <button
              onClick={() => {
                if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
                setUndoSnapshot(null);
                undoTimerRef.current = null;
              }}
              className="text-gray-400 hover:text-white transition text-sm"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TeacherBookAssignment;
