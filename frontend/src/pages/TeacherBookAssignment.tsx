import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { deleteAssignment } from '../api/assignments';
import type { BookAssignmentResponse } from '../api/assignments';
import { teacherAssignments } from '../api/teacherAssignments';
import { ScopeSelector } from '../components/teacher/ScopeSelector';
import type { ScopeValue } from '../components/teacher/ScopeSelector';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { getErrorMessage } from '../utils/errorMessage';

interface Student {
  id: number;
  username: string;
  full_name: string;
  email: string;
}

interface ClassOption {
  id: number;
  name: string;
  student_count: number;
}

interface WordBook {
  id: number;
  name: string;
  description: string;
  unit_count: number;
  word_count: number;
}

/** 分配范围文案:整本 / Unit X·名称 / Unit X·第 Y 组 */
const scopeLabel = (a: BookAssignmentResponse): string => {
  if (a.scope_type === 'unit' || a.scope_type === 'group') {
    const unitPart = a.unit_number != null
      ? `Unit ${a.unit_number}${a.unit_name ? `·${a.unit_name}` : ''}`
      : (a.unit_name || '指定单元');
    return a.scope_type === 'group' && a.group_index != null
      ? `${unitPart}·第 ${a.group_index} 组`
      : unitPart;
  }
  return '整本';
};

const TeacherBookAssignment = () => {
  const navigate = useNavigate();

  // 单词本列表和选中状态
  const [books, setBooks] = useState<WordBook[]>([]);
  const [scope, setScope] = useState<ScopeValue>({
    scope_type: 'book', book_id: null, unit_id: null, group_index: null, unit_ids: [],
  });
  // selectedBook derived from scope so the rest of the UI stays unchanged
  const selectedBook = books.find(b => b.id === scope.book_id) ?? null;

  // 学生列表和选中状态
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);

  // 班级筛选：老师先选班，再在班里勾学生（避免几百人平铺、也绕开学生总表分页上限）
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | 'all'>('all');
  const [loadingClasses, setLoadingClasses] = useState(true);

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

  // 视图切换：平铺列表 vs 按学生分组
  const [viewMode, setViewMode] = useState<'flat' | 'byStudent'>('flat');
  const [expandedStudents, setExpandedStudents] = useState<Set<number>>(new Set());

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
    loadClasses();
    loadStudents();
  }, []);

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

  // 班级列表（含在册人数），老师按班筛选学生
  const loadClasses = async () => {
    try {
      setLoadingClasses(true);
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/teacher/classes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setClasses(response.data || []);
    } catch (error) {
      console.error('加载班级失败:', error);
    } finally {
      setLoadingClasses(false);
    }
  };

  // 加载学生：选了某个班就拉该班全员（无分页上限），否则拉全部在册学生。
  // 注意 /teacher/students 上限 size=200，学生多时必须按班拉，否则会漏人。
  const loadStudents = async (classId: number | 'all' = 'all') => {
    try {
      setLoadingStudents(true);
      const token = localStorage.getItem('access_token');
      const headers = { Authorization: `Bearer ${token}` };
      if (classId !== 'all') {
        const response = await axios.get(
          `${API_BASE_URL}/teacher/classes/${classId}/students`, { headers });
        setStudents(response.data || []);
      } else {
        // 全部学生：循环翻页拉全，避免 size 上限(200)把人数多的老师截断、201+ 选不到也搜不到
        const PAGE = 200;
        let page = 1;
        let all: Student[] = [];
        while (true) {
          const response = await axios.get(`${API_BASE_URL}/teacher/students`, {
            headers,
            params: { page, size: PAGE },
          });
          const items: Student[] = response.data.items || [];
          all = all.concat(items);
          const total: number = response.data.total ?? all.length;
          if (items.length < PAGE || all.length >= total) break;
          page += 1;
        }
        setStudents(all);
      }
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

  // 切换班级筛选：重拉该班学生，并清空已勾选（避免选了别班看不见的人）
  const handleClassChange = (next: number | 'all') => {
    setSelectedClassId(next);
    setSelectedStudents([]);
    setStudentSearch('');
    loadStudents(next);
  };

  const toggleStudent = (studentId: number) => {
    if (selectedStudents.includes(studentId)) {
      setSelectedStudents(selectedStudents.filter((id) => id !== studentId));
    } else {
      setSelectedStudents([...selectedStudents, studentId]);
    }
  };

  const handleAssign = async () => {
    if (!scope.book_id) {
      showMessage('error', '请先选择单词本');
      return;
    }

    if (scope.scope_type === 'unit' && !(scope.unit_ids?.length || scope.unit_id)) {
      showMessage('error', '请至少选择一个单元');
      return;
    }

    if (scope.scope_type === 'group' && scope.group_index === null) {
      showMessage('error', '请选择具体分组');
      return;
    }

    if (selectedStudents.length === 0) {
      showMessage('error', '请至少选择一个学生');
      return;
    }

    const unitCount = scope.scope_type === 'unit' ? (scope.unit_ids?.length || 1) : 1;

    try {
      setSubmitting(true);
      const result = await teacherAssignments.assignBook({
        book_id: scope.book_id,
        student_ids: selectedStudents,
        scope_type: scope.scope_type,
        unit_id: scope.unit_id ?? null,
        group_index: scope.group_index ?? null,
        // 单元多选:一次分配多个单元(后端按 学生×单元 逐条创建)
        unit_ids: scope.scope_type === 'unit' ? (scope.unit_ids ?? undefined) : undefined,
        deadline: deadline || undefined,
      });

      showMessage(
        'success',
        unitCount > 1
          ? `已创建 ${result.created} 条分配(${selectedStudents.length} 名学生 × ${unitCount} 个单元),跳过 ${result.skipped} 条重复`
          : `已分配 ${result.created} 个学生,跳过 ${result.skipped} 个重复(共 ${result.total} 人)`
      );
      setSelectedStudents([]);
      setDeadline('');
      await loadAllAssignments();
    } catch (error: any) {
      console.error('分配失败:', error);
      showMessage('error', getErrorMessage(error, '分配失败'));
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
      showMessage('error', getErrorMessage(error, '删除失败'));
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

  /** 撤回：按 (book_id, scope_type, unit_id, group_index, deadline) 分组重新分配，保留原始范围 */
  const handleUndo = async () => {
    if (!undoSnapshot || undoSnapshot.length === 0) return;
    try {
      const groups = new Map<string, {
        book_id: number;
        student_ids: number[];
        scope_type: string;
        unit_id: number | null;
        group_index: number | null;
        deadline?: string;
      }>();
      for (const a of undoSnapshot) {
        const key = `${a.book_id}|${a.scope_type ?? 'book'}|${a.unit_id ?? ''}|${a.group_index ?? ''}|${a.deadline ?? ''}`;
        const existing = groups.get(key);
        if (existing) {
          existing.student_ids.push(a.student_id);
        } else {
          groups.set(key, {
            book_id: a.book_id,
            student_ids: [a.student_id],
            scope_type: a.scope_type || 'book',
            unit_id: a.unit_id ?? null,
            group_index: a.group_index ?? null,
            deadline: a.deadline,
          });
        }
      }
      await Promise.all(Array.from(groups.values()).map(g => teacherAssignments.assignBook({
        book_id: g.book_id,
        student_ids: g.student_ids,
        scope_type: g.scope_type as 'book' | 'unit' | 'group',
        unit_id: g.unit_id,
        group_index: g.group_index,
        deadline: g.deadline || undefined,
      })));
      showMessage('success', `已恢复 ${undoSnapshot.length} 条分配`);
      setUndoSnapshot(null);
      if (undoTimerRef.current) { clearTimeout(undoTimerRef.current); undoTimerRef.current = null; }
      await loadAllAssignments();
    } catch (error: any) {
      console.error('撤回失败:', error);
      showMessage('error', getErrorMessage(error, '撤回失败'));
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

  /** 按 student_id 分组（视图模式 byStudent 用） */
  const groupedByStudent = useMemo(() => {
    const map = new Map<number, { studentName: string; items: BookAssignmentResponse[] }>();
    for (const a of assignments) {
      const g = map.get(a.student_id);
      if (g) g.items.push(a);
      else map.set(a.student_id, { studentName: a.student_name || '未命名', items: [a] });
    }
    return Array.from(map.entries())
      .map(([studentId, v]) => ({ studentId, ...v }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh'));
  }, [assignments]);

  /** 折叠/展开某学生分组 */
  const toggleStudentExpand = (studentId: number) => {
    setExpandedStudents(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId); else next.add(studentId);
      return next;
    });
  };

  /** 一次勾选/取消该学生的所有分配 */
  const toggleSelectStudentGroup = (studentId: number) => {
    const ids = assignments.filter(a => a.student_id === studentId).map(a => a.id);
    if (ids.length === 0) return;
    const allSelected = ids.every(id => selectedAssignmentIds.has(id));
    setSelectedAssignmentIds(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
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
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      {/* 顶部导航 */}
      <nav className="sticky top-0 z-10 mb-5 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/teacher/dashboard')}
              className="text-gray-600 hover:text-gray-800 transition"
            >
              ← 返回
            </button>
            <h1 className="text-xl font-bold text-gray-800 sm:text-2xl">📚 单词本分配管理</h1>
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
          {/* 左侧: 单词本 + 范围选择 */}
          <div className="lg:col-span-1">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
            >
              <h2 className="text-xl font-bold text-gray-800 mb-4">📖 选择范围</h2>

              {loadingBooks ? (
                <div className="text-center py-8 text-gray-500">加载中...</div>
              ) : (
                <ScopeSelector books={books} value={scope} onChange={setScope} multiUnit />
              )}
            </motion.div>
          </div>

          {/* 右侧: 分配界面（始终可见） */}
          <div className="lg:col-span-2">
            <div className="space-y-6">
              {/* 当前范围提示 */}
              {selectedBook ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm sm:p-6"
                >
                  <h2 className="text-xl font-bold text-gray-800 mb-3">
                    📖 {selectedBook.name}
                    <span className="ml-2 text-sm font-normal text-gray-600">
                      {scope.scope_type === 'unit' &&
                        ` · ${(scope.unit_ids?.length || 1) > 1 ? `${scope.unit_ids!.length} 个单元` : '单元粒度'}`}
                      {scope.scope_type === 'group' && ` · 分组粒度`}
                    </span>
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
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 text-sm text-yellow-800"
                >
                  💡 请先在左侧选择单词本和分配范围。学生可以先勾选，选好范围后一起分配。
                </motion.div>
              )}

              {/* 学生选择 */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
              >
                <h2 className="text-xl font-bold text-gray-800 mb-4">
                  👥 选择学生
                  {students.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      （共 {students.length} 人）
                    </span>
                  )}
                </h2>

                {/* 第一步：先选班级（老师的真实心智是"把这本书发给我的某个班"） */}
                {!loadingClasses && classes.length > 0 && (
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      先选班级
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleClassChange('all')}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                          selectedClassId === 'all'
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-orange-50'
                        }`}
                      >
                        全部学生
                      </button>
                      {classes.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleClassChange(c.id)}
                          className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                            selectedClassId === c.id
                              ? 'bg-orange-500 text-white border-orange-500'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-orange-50'
                          }`}
                        >
                          {c.name}
                          <span className={`ml-1.5 text-xs ${
                            selectedClassId === c.id ? 'text-orange-100' : 'text-gray-400'
                          }`}>
                            {c.student_count}人
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

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
                    const assignedIds = selectedBook ? getAssignedStudentIds(selectedBook.id) : [];
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
                  <div className="text-center py-10 px-4">
                    <div className="text-5xl mb-3">{classes.length === 0 ? '🏫' : '🙋'}</div>
                    {classes.length === 0 ? (
                      <>
                        <p className="text-gray-800 font-medium mb-1">你还没有创建班级</p>
                        <p className="text-gray-500 text-sm mb-4">
                          分三步走：① 建一个班 → ② 把学生加进班 → ③ 回这里就能选学生发单词本
                        </p>
                        <button
                          onClick={() => navigate('/teacher/classes')}
                          className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-medium hover:shadow-lg transition"
                        >
                          ① 去创建班级 →
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-gray-800 font-medium mb-1">
                          {selectedClassId === 'all' ? '还没有任何学生加入你的班级' : '这个班还没有学生'}
                        </p>
                        <p className="text-gray-500 text-sm mb-4">
                          先把学生加进班级，回到这里就能勾选他们发单词本
                        </p>
                        <button
                          onClick={() => navigate('/teacher/classes')}
                          className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-medium hover:shadow-lg transition"
                        >
                          去班级管理添加学生 →
                        </button>
                      </>
                    )}
                  </div>
                ) : (() => {
                  const kw = studentSearch.trim().toLowerCase();
                  const assignedIds = selectedBook ? getAssignedStudentIds(selectedBook.id) : [];
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
                      const isAssigned = assignedIds.includes(student.id);
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
                            <div className="font-medium text-gray-800">{student.full_name || student.username}</div>
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
                  disabled={
                    submitting ||
                    scope.book_id === null ||
                    (scope.scope_type === 'group' && scope.group_index === null) ||
                    selectedStudents.length === 0
                  }
                  className={`w-full py-3 rounded-lg font-medium text-white transition ${
                    submitting ||
                    scope.book_id === null ||
                    (scope.scope_type === 'group' && scope.group_index === null) ||
                    selectedStudents.length === 0
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-orange-500 to-yellow-500 hover:shadow-lg'
                  }`}
                >
                  {submitting
                    ? '分配中...'
                    : scope.book_id === null
                    ? '请先选择单词本'
                    : scope.scope_type === 'group' && scope.group_index === null
                    ? '请选择具体分组'
                    : selectedStudents.length === 0
                    ? '请选择学生'
                    : `📌 分配给 ${selectedStudents.length} 名学生`}
                </motion.button>
              </motion.div>
            </div>
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
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-gray-800">📊 分配记录</h2>
              {assignments.length > 0 && (
                <div className="inline-flex rounded-lg overflow-hidden border border-gray-200 text-sm">
                  <button
                    onClick={() => setViewMode('flat')}
                    className={`px-3 py-1.5 transition ${
                      viewMode === 'flat' ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    📋 平铺
                  </button>
                  <button
                    onClick={() => setViewMode('byStudent')}
                    className={`px-3 py-1.5 transition border-l border-gray-200 ${
                      viewMode === 'byStudent' ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    👥 按学生
                  </button>
                </div>
              )}
            </div>
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
          ) : viewMode === 'byStudent' ? (
            <div className="space-y-3">
              {groupedByStudent.map(group => {
                const expanded = expandedStudents.has(group.studentId);
                const groupIds = group.items.map(i => i.id);
                const allSelected = groupIds.every(id => selectedAssignmentIds.has(id));
                const someSelected = groupIds.some(id => selectedAssignmentIds.has(id));
                return (
                  <div key={group.studentId} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition">
                      <input
                        type="checkbox"
                        className="w-4 h-4 cursor-pointer"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
                        onChange={() => toggleSelectStudentGroup(group.studentId)}
                      />
                      <button
                        onClick={() => toggleStudentExpand(group.studentId)}
                        className="flex-1 flex items-center justify-between text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-sm">{expanded ? '▼' : '▶'}</span>
                          <span className="font-medium text-gray-800">{group.studentName}</span>
                          <span className="text-xs text-gray-500">· {group.items.length} 本</span>
                        </div>
                      </button>
                    </div>
                    {expanded && (
                      <ul className="divide-y divide-gray-100">
                        {group.items.map(a => (
                          <li
                            key={a.id}
                            className={`flex items-center gap-3 px-4 py-2.5 transition ${
                              selectedAssignmentIds.has(a.id) ? 'bg-orange-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="w-4 h-4 cursor-pointer"
                              checked={selectedAssignmentIds.has(a.id)}
                              onChange={() => toggleAssignmentSelected(a.id)}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-800 truncate">
                                {a.book_name}
                                <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-normal ${
                                  a.scope_type === 'unit' || a.scope_type === 'group'
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'bg-gray-100 text-gray-500'
                                }`}>
                                  {scopeLabel(a)}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {new Date(a.assigned_at).toLocaleDateString('zh-CN')}
                                {a.deadline && ` · 截止 ${new Date(a.deadline).toLocaleDateString('zh-CN')}`}
                                {a.is_completed
                                  ? <span className="ml-2 text-green-600">✅ 已完成</span>
                                  : <span className="ml-2 text-yellow-600">⏳ 进行中</span>}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteAssignment(a.id)}
                              className="text-red-500 hover:text-red-700 transition text-sm"
                              title="撤销该分配"
                            >
                              🗑️
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
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
                        <div className="font-medium text-gray-800">
                          {assignment.book_name}
                          <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-normal ${
                            assignment.scope_type === 'unit' || assignment.scope_type === 'group'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}>
                            {scopeLabel(assignment)}
                          </span>
                        </div>
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
