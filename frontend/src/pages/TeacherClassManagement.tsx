import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, X, Trash2, ChevronRight, Calendar, BookOpen, Target, Clock, TrendingUp, UserPlus, ArrowLeft, ArrowLeftRight, KeyRound, FileSpreadsheet, Copy, RefreshCw, Search } from 'lucide-react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { toast } from '../components/Toast';
import { API_BASE_URL } from '../config/env';
import { getErrorMessage } from '../utils/errorMessage';

interface ClassInfo {
  id: number;
  name: string;
  description: string | null;
  teacher_id: number;
  student_count: number;
  created_at: string;
}

interface ClassStudent {
  id: number;
  username: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  joined_at: string | null;
}

interface AvailableStudent {
  id: number;
  username: string;
  full_name: string;
  phone: string | null;
  email?: string | null;
  from_class?: { class_id: number; class_name: string } | null;
  created_at?: string | null;
}

interface DailyStudentData {
  user_id: number;
  username: string;
  full_name: string;
  study_date: string;
  words_learned: number;
  study_duration: number;
  correct_count: number;
  wrong_count: number;
  accuracy_rate: number;
  sessions_count: number;
  review_due_today?: number;
  review_done_today?: number;
  graduated_words?: number;
}

interface StudentDetail {
  user_id: number;
  username: string;
  full_name: string;
  today_words: number;
  today_duration: number;
  today_accuracy: number;
  today_sessions: number;
  total_words_learned: number;
  total_mastered: number;
  total_study_days: number;
  total_study_time: number;
  overall_accuracy: number;
  weak_words_count: number;
  last_active: string | null;
  recent_daily_words: number[];
  recent_daily_dates: string[];
}

const getToken = () => localStorage.getItem('access_token');
const headers = () => ({ Authorization: `Bearer ${getToken()}` });

const AVAILABLE_PAGE_SIZE = 50;

const TeacherClassManagement = () => {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // 选中的班级
  const [selectedClass, setSelectedClass] = useState<ClassInfo | null>(null);
  const [classStudents, setClassStudents] = useState<ClassStudent[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStudentData[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // 学生详情弹窗
  const [studentDetail, setStudentDetail] = useState<StudentDetail | null>(null);

  // AI学习建议
  const [aiAdvice, setAiAdvice] = useState<any>(null);
  const [loadingAdvice, setLoadingAdvice] = useState(false);

  // 创建班级弹窗
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassDesc, setNewClassDesc] = useState('');

  // 添加学生弹窗
  const [showAddStudents, setShowAddStudents] = useState(false);
  const [availableStudents, setAvailableStudents] = useState<AvailableStudent[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [availableSearch, setAvailableSearch] = useState('');
  const [availableDebouncedKw, setAvailableDebouncedKw] = useState('');
  const [availablePage, setAvailablePage] = useState(1);
  const [availableTotal, setAvailableTotal] = useState(0);
  const [availableLoading, setAvailableLoading] = useState(false);

  // 邀请码弹窗
  const [showInviteCode, setShowInviteCode] = useState(false);
  const [inviteCode, setInviteCode] = useState<{
    code: string; class_name: string;
    expires_at: string; hours_left: number; redemption_count: number;
  } | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);

  // Excel 批量入班
  const [importingExcel, setImportingExcel] = useState(false);

  // 学生搜索
  const [studentSearch, setStudentSearch] = useState('');

  // 转班弹窗
  const [transferStudent, setTransferStudent] = useState<{ id: number; full_name: string; username: string } | null>(null);
  const [transferTargetClassId, setTransferTargetClassId] = useState<number | null>(null);
  const [transferring, setTransferring] = useState(false);

  // 顶部使用说明卡片：本地记住"是否已折叠"
  const [helpOpen, setHelpOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('teacher_classes_help_collapsed') !== '1'; }
    catch { return true; }
  });
  const toggleHelp = () => {
    setHelpOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('teacher_classes_help_collapsed', next ? '0' : '1'); } catch {}
      return next;
    });
  };

  // 每日数据多选删除
  const [selectedForRemove, setSelectedForRemove] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    if (selectedClass) {
      loadClassStudents(selectedClass.id);
      loadDailyStats(selectedClass.id, selectedDate);
    }
  }, [selectedClass, selectedDate]);

  // 添加学生弹窗：debounce 关键字，搜索变化时同步把页码重置回 1（避免 setPage 单独触发额外一次请求）
  useEffect(() => {
    const t = setTimeout(() => {
      setAvailableDebouncedKw(availableSearch.trim());
      setAvailablePage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [availableSearch]);

  useEffect(() => {
    if (showAddStudents && selectedClass) {
      loadAvailableStudents(selectedClass.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableDebouncedKw, availablePage, showAddStudents]);

  // 搜索防抖：studentSearch 变化时重新加载学生列表
  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedClass) loadClassStudents(selectedClass.id);
    }, 300);
    return () => clearTimeout(timer);
  }, [studentSearch]);

  const loadClasses = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/teacher/classes`, { headers: headers() });
      setClasses(res.data);
      if (res.data.length > 0 && !selectedClass) {
        setSelectedClass(res.data[0]);
      }
    } catch (error) {
      console.error('加载班级失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClassStudents = async (classId: number) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/teacher/classes/${classId}/students`, {
        headers: headers(),
        params: studentSearch ? { q: studentSearch } : {},
      });
      setClassStudents(res.data);
    } catch (error) {
      console.error('加载班级学生失败:', error);
    }
  };

  const loadDailyStats = async (classId: number, date: string) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/teacher/classes/${classId}/daily-stats`, {
        headers: headers(),
        params: { target_date: date }
      });
      setDailyStats(res.data.students || []);
    } catch (error) {
      console.error('加载每日数据失败:', error);
    }
  };

  const handleCreateClass = async () => {
    if (!newClassName.trim()) {
      toast.warning('请输入班级名称');
      return;
    }
    try {
      await axios.post(`${API_BASE_URL}/teacher/classes`, {
        name: newClassName.trim(),
        description: newClassDesc.trim() || null
      }, { headers: headers() });
      setShowCreateDialog(false);
      setNewClassName('');
      setNewClassDesc('');
      loadClasses();
    } catch (error: any) {
      toast.error(getErrorMessage(error, '创建失败'));
    }
  };

  const handleDeleteClass = async (classId: number) => {
    if (!confirm('确定要删除这个班级吗？删除后不可恢复。')) return;
    try {
      await axios.delete(`${API_BASE_URL}/teacher/classes/${classId}`, { headers: headers() });
      if (selectedClass?.id === classId) {
        setSelectedClass(null);
      }
      loadClasses();
    } catch (error: any) {
      toast.error(getErrorMessage(error, '删除失败'));
    }
  };

  const loadAvailableStudents = async (classId: number) => {
    try {
      setAvailableLoading(true);
      const res = await axios.get(`${API_BASE_URL}/teacher/classes/${classId}/available-students`, {
        headers: headers(),
        params: {
          q: availableDebouncedKw || undefined,
          page: availablePage,
          size: AVAILABLE_PAGE_SIZE,
        },
      });
      setAvailableStudents(res.data.items || []);
      setAvailableTotal(res.data.total || 0);
    } catch (error) {
      console.error('加载可用学生失败:', error);
    } finally {
      setAvailableLoading(false);
    }
  };

  const handleAddStudents = async () => {
    if (!selectedClass || selectedStudentIds.length === 0) return;
    try {
      await axios.post(`${API_BASE_URL}/teacher/classes/${selectedClass.id}/students`, {
        student_ids: selectedStudentIds
      }, { headers: headers() });
      setShowAddStudents(false);
      setSelectedStudentIds([]);
      loadClassStudents(selectedClass.id);
      loadClasses();
      loadDailyStats(selectedClass.id, selectedDate);
    } catch (error: any) {
      toast.error(getErrorMessage(error, '添加失败'));
    }
  };

  const handleRemoveStudent = async (studentId: number) => {
    if (!selectedClass) return;
    if (!confirm('确定要从班级中移除该学生吗？')) return;
    try {
      await axios.delete(`${API_BASE_URL}/teacher/classes/${selectedClass.id}/students/${studentId}`, { headers: headers() });
      loadClassStudents(selectedClass.id);
      loadClasses();
      loadDailyStats(selectedClass.id, selectedDate);
    } catch (error: any) {
      toast.error(getErrorMessage(error, '移除失败'));
    }
  };

  // 邀请码
  const handleOpenInvite = async (classId: number) => {
    setShowInviteCode(true);
    setInviteCode(null);
    try {
      const res = await axios.get(`${API_BASE_URL}/teacher/classes/${classId}/invite-code`, { headers: headers() });
      if (res.data) {
        setInviteCode(res.data);
      }
    } catch (error: any) {
      // 没有也不报错，让用户主动生成
    }
  };

  const handleRefreshInvite = async () => {
    if (!selectedClass) return;
    setGeneratingInvite(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/teacher/classes/${selectedClass.id}/invite-code`, {}, { headers: headers() });
      setInviteCode(res.data);
      toast.success('已生成新邀请码（24 小时有效）');
    } catch (error: any) {
      toast.error(getErrorMessage(error, '生成失败'));
    } finally {
      setGeneratingInvite(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode.code);
      toast.success('邀请码已复制');
    } catch {
      toast.error('复制失败，请手动选中复制');
    }
  };

  // Excel 批量入班
  const handleDownloadInviteTemplate = () => {
    const data = [
      { '手机号': '13800000000' },
      { '手机号': '13800000001' },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '入班手机号');
    XLSX.writeFile(wb, '入班手机号模板.xlsx');
  };

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedClass) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportingExcel(true);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws);
      const phones: string[] = [];
      for (const row of rows) {
        const v = (row['手机号'] ?? row['phone'] ?? row['Phone'] ?? '').toString().trim();
        if (v) phones.push(v);
      }
      if (phones.length === 0) {
        toast.warning('Excel 中没有"手机号"列或内容为空');
        return;
      }

      const res = await axios.post(
        `${API_BASE_URL}/teacher/classes/${selectedClass.id}/students-by-phones`,
        { phones },
        { headers: headers() }
      );
      const d = res.data;
      const lines: string[] = [
        `成功入班 ${d.added} 人${d.transferred ? `（含从你其他班转入 ${d.transferred} 人）` : ''}`,
      ];
      if (d.already_in?.length) lines.push(`已在本班 ${d.already_in.length} 人：${d.already_in.slice(0, 5).join(', ')}${d.already_in.length > 5 ? ' …' : ''}`);
      if (d.blocked?.length) lines.push(`在其他教师班，跳过 ${d.blocked.length} 人：${d.blocked.slice(0, 5).join(', ')}${d.blocked.length > 5 ? ' …' : ''}`);
      if (d.not_found?.length) lines.push(`没找到对应学生 ${d.not_found.length} 个：${d.not_found.slice(0, 5).join(', ')}${d.not_found.length > 5 ? ' …' : ''}`);
      toast.info(lines.join('\n'));
      loadClassStudents(selectedClass.id);
      loadClasses();
      loadDailyStats(selectedClass.id, selectedDate);
    } catch (error: any) {
      toast.error(getErrorMessage(error, '导入失败'));
    } finally {
      setImportingExcel(false);
    }
  };

  const handleConfirmTransfer = async () => {
    if (!selectedClass || !transferStudent || transferTargetClassId === null) return;
    if (transferTargetClassId === selectedClass.id) {
      toast.error('请选择不同的目标班级');
      return;
    }
    try {
      setTransferring(true);
      await axios.post(
        `${API_BASE_URL}/teacher/students/${transferStudent.id}/transfer`,
        { from_class_id: selectedClass.id, to_class_id: transferTargetClassId },
        { headers: headers() }
      );
      const targetName = classes.find(c => c.id === transferTargetClassId)?.name || '目标班级';
      toast.success(`已将「${transferStudent.full_name}」转到「${targetName}」`);
      setTransferStudent(null);
      setTransferTargetClassId(null);
      loadClassStudents(selectedClass.id);
      loadClasses();
      loadDailyStats(selectedClass.id, selectedDate);
    } catch (error: any) {
      toast.error(getErrorMessage(error, '转班失败'));
    } finally {
      setTransferring(false);
    }
  };

  const handleBatchRemove = async () => {
    if (!selectedClass || selectedForRemove.size === 0) return;
    if (!confirm(`确定要从班级中移除选中的 ${selectedForRemove.size} 名学生吗？`)) return;
    try {
      await Promise.all(
        Array.from(selectedForRemove).map(sid =>
          axios.delete(`${API_BASE_URL}/teacher/classes/${selectedClass.id}/students/${sid}`, { headers: headers() })
        )
      );
      setSelectedForRemove(new Set());
      loadClassStudents(selectedClass.id);
      loadClasses();
      loadDailyStats(selectedClass.id, selectedDate);
    } catch (error: any) {
      toast.error(getErrorMessage(error, '移除失败'));
    }
  };

  const handleViewStudentDetail = async (studentId: number) => {
    if (!selectedClass) return;
    setAiAdvice(null);
    try {
      const res = await axios.get(`${API_BASE_URL}/teacher/classes/${selectedClass.id}/student/${studentId}/detail`, { headers: headers() });
      setStudentDetail(res.data);
      // 同时加载AI建议
      setLoadingAdvice(true);
      axios.get(`${API_BASE_URL}/teacher/student/${studentId}/ai-advice`, { headers: headers() })
        .then(r => setAiAdvice(r.data))
        .catch(() => {})
        .finally(() => setLoadingAdvice(false));
    } catch (error) {
      console.error('加载学生详情失败:', error);
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}秒`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}分钟`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}小时${remainMins}分钟`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Users className="w-7 h-7 text-indigo-600" />
            <h1 className="text-xl font-bold text-gray-800">班级管理</h1>
          </div>
          <button
            onClick={() => navigate('/teacher/dashboard')}
            className="flex items-center gap-1 text-sm px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-md transition font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            返回首页
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 使用说明 */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <KeyRound className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-800">三种方式把学生加进班级（推荐顺序：邀请码 → Excel → 手动添加）</p>
                {helpOpen && (
                  <ul className="mt-2 space-y-1.5 text-amber-900/80 text-[13px] leading-relaxed">
                    <li>
                      <span className="font-medium">① 邀请码（推荐）</span>：点右上「邀请码」生成 6 位数字（24h 有效），转发到家长群。
                      学生在「学生端首页 → 加入班级」输码即可自动入班；如果学生原本在你别的班，会自动转过来。
                    </li>
                    <li>
                      <span className="font-medium">② Excel 批量入班</span>：点右上「Excel 导入」，上传一列「手机号」清单。
                      命中数据库里已注册的学生 → 入班；模板可在「邀请码」弹窗里下载。
                    </li>
                    <li>
                      <span className="font-medium">③ 手动添加</span>：点右上「添加学生」，弹窗里能搜姓名 / 用户名 / 手机 / 邮箱。
                      候选池 = 还没归班的散户 + 你自己其他班的学生（标签会显示"我的『某班』"，加进来等于内部转班）。
                    </li>
                    <li className="text-amber-700/70">
                      注：别的老师班里的学生看不到、加不了，需要找管理员转。
                    </li>
                  </ul>
                )}
              </div>
            </div>
            <button
              onClick={toggleHelp}
              className="text-xs text-amber-700 hover:text-amber-900 underline flex-shrink-0"
            >
              {helpOpen ? '收起' : '展开使用说明'}
            </button>
          </div>
        </div>

        <div className="flex gap-6">
          {/* 左侧 - 班级列表 */}
          <div className="w-72 flex-shrink-0">
            <div className="bg-white rounded-2xl shadow-md p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-800">我的班级</h2>
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="p-1.5 bg-indigo-100 hover:bg-indigo-200 rounded-lg transition"
                  title="创建班级"
                >
                  <Plus className="w-5 h-5 text-indigo-600" />
                </button>
              </div>

              {loading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                </div>
              ) : classes.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400">暂无班级</p>
                  <button
                    onClick={() => setShowCreateDialog(true)}
                    className="mt-3 text-sm text-indigo-600 hover:underline"
                  >
                    创建第一个班级
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {classes.map(cls => (
                    <div
                      key={cls.id}
                      onClick={() => setSelectedClass(cls)}
                      className={`p-3 rounded-xl cursor-pointer transition-all ${
                        selectedClass?.id === cls.id
                          ? 'bg-indigo-100 border-2 border-indigo-300'
                          : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 truncate">{cls.name}</p>
                          <p className="text-xs text-gray-500">{cls.student_count} 名学生</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteClass(cls.id); }}
                            className="p-1 text-gray-400 hover:text-red-500 transition"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <ChevronRight className={`w-4 h-4 transition ${selectedClass?.id === cls.id ? 'text-indigo-600' : 'text-gray-300'}`} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 右侧 - 班级详情和学习数据 */}
          <div className="flex-1 min-w-0">
            {selectedClass ? (
              <div className="space-y-6">
                {/* 班级信息头部 */}
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={selectedClass.id}
                  className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 text-white shadow-lg"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold">{selectedClass.name}</h2>
                      {selectedClass.description && (
                        <p className="text-white/70 mt-1">{selectedClass.description}</p>
                      )}
                      <p className="text-white/60 text-sm mt-2">{selectedClass.student_count} 名学生</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <button
                        onClick={() => handleOpenInvite(selectedClass.id)}
                        className="flex items-center gap-2 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-xl transition font-medium text-sm"
                        title="生成班级邀请码，发给学生自助加入"
                      >
                        <KeyRound className="w-4 h-4" />
                        邀请码
                      </button>
                      <label
                        className="flex items-center gap-2 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-xl transition font-medium text-sm cursor-pointer"
                        title="按 Excel 中的手机号批量入班"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                        {importingExcel ? '导入中...' : 'Excel 导入'}
                        <input type="file" accept=".xlsx,.xls" disabled={importingExcel} onChange={handleExcelImport} className="hidden" />
                      </label>
                      <button
                        onClick={() => {
                          setSelectedStudentIds([]);
                          setAvailableSearch('');
                          setAvailablePage(1);
                          setShowAddStudents(true);
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl transition font-medium text-sm"
                      >
                        <UserPlus className="w-4 h-4" />
                        添加学生
                      </button>
                    </div>
                  </div>
                </motion.div>

                {/* 每日学习数据 */}
                <div className="bg-white rounded-2xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-indigo-600" />
                      每日学习数据
                    </h3>
                    <div className="flex items-center gap-3">
                      {selectedForRemove.size > 0 && (
                        <button
                          onClick={handleBatchRemove}
                          className="px-3 py-1.5 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600 transition font-medium"
                        >
                          移除选中 ({selectedForRemove.size})
                        </button>
                      )}
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        max={new Date().toISOString().split('T')[0]}
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {dailyStats.length === 0 ? (
                    <div className="text-center py-8">
                      <BookOpen className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                      <p className="text-gray-400">该日期暂无学习数据</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b-2 border-gray-200">
                            <th className="py-3 px-2 w-8">
                              <input
                                type="checkbox"
                                checked={dailyStats.length > 0 && selectedForRemove.size === dailyStats.length}
                                onChange={() => {
                                  if (selectedForRemove.size === dailyStats.length) {
                                    setSelectedForRemove(new Set());
                                  } else {
                                    setSelectedForRemove(new Set(dailyStats.map(s => s.user_id)));
                                  }
                                }}
                                className="w-4 h-4 text-indigo-600 rounded"
                              />
                            </th>
                            <th className="text-left py-3 px-3 font-semibold text-gray-700 text-sm">学生</th>
                            <th className="text-center py-3 px-3 font-semibold text-gray-700 text-sm">学习单词</th>
                            <th className="text-center py-3 px-3 font-semibold text-gray-700 text-sm">学习时长</th>
                            <th className="text-center py-3 px-3 font-semibold text-gray-700 text-sm">正确/错误</th>
                            <th className="text-center py-3 px-3 font-semibold text-gray-700 text-sm">准确率</th>
                            <th className="text-center py-3 px-3 font-semibold text-gray-700 text-sm">会话数</th>
                            <th className="text-center py-3 px-3 font-semibold text-gray-700 text-sm" title="艾宾浩斯曲线下今日还应回顾的单词">复习待</th>
                            <th className="text-center py-3 px-3 font-semibold text-gray-700 text-sm" title="今日已完成的复习数（去重）">复习已</th>
                            <th className="text-center py-3 px-3 font-semibold text-gray-700 text-sm" title="掌握度达到顶档（30天间隔）的累计数">已毕业</th>
                            <th className="text-center py-3 px-3 font-semibold text-gray-700 text-sm">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailyStats.map((s, i) => {
                            const isLowScore = s.correct_count + s.wrong_count > 0 && s.accuracy_rate < 50;
                            return (
                            <motion.tr
                              key={s.user_id}
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.03 }}
                              className="border-b border-gray-100 hover:bg-indigo-50/50 transition"
                            >
                              <td className="py-3 px-2 w-8">
                                <input
                                  type="checkbox"
                                  checked={selectedForRemove.has(s.user_id)}
                                  onChange={() => {
                                    setSelectedForRemove(prev => {
                                      const next = new Set(prev);
                                      if (next.has(s.user_id)) next.delete(s.user_id);
                                      else next.add(s.user_id);
                                      return next;
                                    });
                                  }}
                                  className="w-4 h-4 text-indigo-600 rounded"
                                />
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-2">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                    isLowScore ? 'bg-red-100' : 'bg-indigo-100'
                                  }`}>
                                    <span className={`font-semibold text-sm ${
                                      isLowScore ? 'text-red-600' : 'text-indigo-600'
                                    }`}>
                                      {(s.full_name || s.username || '?').charAt(0)}
                                    </span>
                                  </div>
                                  <span className="font-medium text-gray-800 text-sm">{s.full_name}</span>
                                  {isLowScore && (
                                    <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] rounded font-bold" title="准确率偏低，需重点关注">
                                      需关注
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-3 text-center">
                                <span className={`font-bold ${s.words_learned > 0 ? 'text-indigo-600' : 'text-gray-400'}`}>
                                  {s.words_learned}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-center text-sm text-gray-600">
                                {s.study_duration > 0 ? formatDuration(s.study_duration) : '-'}
                              </td>
                              <td className="py-3 px-3 text-center text-sm">
                                <span className="text-green-600">{s.correct_count}</span>
                                {' / '}
                                <span className="text-red-500">{s.wrong_count}</span>
                              </td>
                              <td className="py-3 px-3 text-center">
                                {s.correct_count + s.wrong_count > 0 ? (
                                  <span className={`font-bold text-sm ${
                                    s.accuracy_rate >= 80 ? 'text-green-600' :
                                    s.accuracy_rate >= 60 ? 'text-yellow-600' : 'text-red-500'
                                  }`}>
                                    {s.accuracy_rate}%
                                  </span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td className="py-3 px-3 text-center text-sm text-gray-600">
                                {s.sessions_count || '-'}
                              </td>
                              <td className="py-3 px-3 text-center text-sm">
                                <span className={s.review_due_today ? 'font-bold text-orange-600' : 'text-gray-400'}>
                                  {s.review_due_today ?? 0}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-center text-sm">
                                <span className={s.review_done_today ? 'text-gray-700' : 'text-gray-400'}>
                                  {s.review_done_today ?? 0}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-center text-sm">
                                <span className={s.graduated_words ? 'font-medium text-green-600' : 'text-gray-400'}>
                                  {s.graduated_words ?? 0}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-center">
                                <button
                                  onClick={() => handleViewStudentDetail(s.user_id)}
                                  className="text-xs px-3 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg transition font-medium"
                                >
                                  详情
                                </button>
                              </td>
                            </motion.tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* 班级学生列表 */}
                <div className="bg-white rounded-2xl shadow-md p-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    班级成员 ({classStudents.length})
                  </h3>
                  <p className="text-xs text-gray-500 mb-4">
                    💡 每位学生右侧可点击：<span className="text-orange-600 font-medium">监控</span> 查看学习数据 ·
                    <span className="text-indigo-600 font-medium ml-1">转班</span> 调整到你的其他班级 ·
                    <span className="text-red-500 font-medium ml-1">×</span> 移出班级
                  </p>

                  {/* 学生搜索框 */}
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="搜索学生姓名/用户名"
                    className="w-full px-3 py-2 border rounded-lg mb-3 text-sm focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                  />

                  {classStudents.length === 0 ? (
                    <div className="text-center py-8">
                      <Users className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                      <p className="text-gray-400 mb-3">暂无学生</p>
                      <button
                        onClick={() => {
                          setSelectedStudentIds([]);
                          setAvailableSearch('');
                          setAvailablePage(1);
                          setShowAddStudents(true);
                        }}
                        className="text-sm text-indigo-600 hover:underline"
                      >
                        添加学生到班级
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {classStudents.map(s => (
                        <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                          <div className="flex items-center gap-2">
                            <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center">
                              <span className="text-indigo-600 font-semibold text-sm">
                                {(s.full_name || s.username || '?').charAt(0)}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-800 text-sm">{s.full_name}</p>
                              <p className="text-xs text-gray-400">@{s.username}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/teacher/students/${s.id}/monitor`); }}
                              className="text-xs text-orange-500 hover:text-orange-700 px-1.5 py-1 rounded transition"
                              title="学习监控"
                            >
                              监控
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (classes.length < 2) {
                                  toast.warning('需要至少 2 个班级才能转班，请先创建另一个班级');
                                  return;
                                }
                                setTransferStudent({ id: s.id, full_name: s.full_name || s.username, username: s.username });
                                setTransferTargetClassId(null);
                              }}
                              className={`text-xs px-2 py-1 rounded transition flex items-center gap-1 ${
                                classes.length < 2
                                  ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                                  : 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                              }`}
                              title={classes.length < 2 ? '至少需要 2 个班级才能转班' : '转到其他班级'}
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                              转班
                            </button>
                            <button
                              onClick={() => handleRemoveStudent(s.id)}
                              className="p-1.5 text-gray-400 hover:text-red-500 transition"
                              title="移出班级"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-md p-12 text-center">
                <Users className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500 text-lg mb-2">请选择一个班级</p>
                <p className="text-gray-400 text-sm">或创建新班级开始管理学生</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 创建班级弹窗 */}
      <AnimatePresence>
        {showCreateDialog && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowCreateDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Plus className="w-6 h-6 text-indigo-600" />
                创建新班级
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">班级名称 *</label>
                  <input
                    type="text"
                    value={newClassName}
                    onChange={e => setNewClassName(e.target.value)}
                    placeholder="例如: 三年级1班"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">描述（可选）</label>
                  <input
                    type="text"
                    value={newClassDesc}
                    onChange={e => setNewClassDesc(e.target.value)}
                    placeholder="例如: 2024年秋季班"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowCreateDialog(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
                  取消
                </button>
                <button onClick={handleCreateClass} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium">
                  创建
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 添加学生弹窗 */}
      <AnimatePresence>
        {showAddStudents && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => { setShowAddStudents(false); setSelectedStudentIds([]); setAvailableSearch(''); }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl max-h-[80vh] overflow-y-auto"
            >
              <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                <UserPlus className="w-6 h-6 text-indigo-600" />
                添加学生到班级
              </h3>

              {/* 搜索框 */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={availableSearch}
                  onChange={(e) => setAvailableSearch(e.target.value)}
                  placeholder="搜索姓名 / 用户名 / 手机 / 邮箱"
                  className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg outline-none focus:border-indigo-400 text-sm"
                />
                {availableSearch && (
                  <button
                    type="button"
                    onClick={() => setAvailableSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label="清空搜索"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {availableLoading ? (
                <div className="text-center py-8 text-gray-400 text-sm">加载中...</div>
              ) : availableTotal === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  {availableDebouncedKw
                    ? <>没有匹配「{availableDebouncedKw}」的学生</>
                    : '没有可加入的学生（所有人都已在其他教师的班）'}
                </div>
              ) : (
                <>
                  {(() => {
                    const pageIds = availableStudents.map(s => s.id);
                    const visibleSelected = pageIds.filter(id => selectedStudentIds.includes(id)).length;
                    const allPageSelected = pageIds.length > 0 && visibleSelected === pageIds.length;
                    return (
                      <>
                        <div className="flex items-center justify-between mb-3 text-sm">
                          <span className="text-gray-500">
                            已选 {selectedStudentIds.length} 人 · 当前页 {availableStudents.length} / 共 {availableTotal}
                          </span>
                          <button
                            onClick={() => {
                              if (allPageSelected) {
                                setSelectedStudentIds(prev => prev.filter(id => !pageIds.includes(id)));
                              } else {
                                setSelectedStudentIds(prev => Array.from(new Set([...prev, ...pageIds])));
                              }
                            }}
                            disabled={pageIds.length === 0}
                            className="text-indigo-600 hover:text-indigo-800 font-medium disabled:text-gray-300 disabled:cursor-not-allowed"
                          >
                            {allPageSelected ? '取消本页' : '全选本页'}
                          </button>
                        </div>
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                          {availableStudents.map(s => (
                            <label
                              key={s.id}
                              className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition ${
                                selectedStudentIds.includes(s.id) ? 'bg-indigo-100 border-2 border-indigo-300' : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedStudentIds.includes(s.id)}
                                onChange={() => {
                                  setSelectedStudentIds(prev =>
                                    prev.includes(s.id)
                                      ? prev.filter(id => id !== s.id)
                                      : [...prev, s.id]
                                  );
                                }}
                                className="w-4 h-4 text-indigo-600 rounded"
                              />
                              <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                                <span className="text-indigo-600 font-semibold text-sm">{(s.full_name || s.username || '?').charAt(0)}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-800 text-sm truncate">{s.full_name || s.username}</p>
                                <p className="text-xs text-gray-400 truncate">
                                  @{s.username}{s.phone ? ` · ${s.phone}` : ''}
                                </p>
                              </div>
                              {s.from_class ? (
                                <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded shrink-0" title="将从该班转出">
                                  我的「{s.from_class.class_name}」
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded shrink-0">未入班</span>
                              )}
                            </label>
                          ))}
                        </div>

                        {availableTotal > AVAILABLE_PAGE_SIZE && (
                          <div className="flex items-center justify-end gap-2 mt-3 text-sm">
                            <button
                              onClick={() => setAvailablePage(p => Math.max(1, p - 1))}
                              disabled={availablePage <= 1}
                              className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                            >上一页</button>
                            <span className="text-gray-500">
                              {availablePage} / {Math.max(1, Math.ceil(availableTotal / AVAILABLE_PAGE_SIZE))}
                            </span>
                            <button
                              onClick={() => setAvailablePage(p => Math.min(
                                Math.max(1, Math.ceil(availableTotal / AVAILABLE_PAGE_SIZE)),
                                p + 1
                              ))}
                              disabled={availablePage >= Math.ceil(availableTotal / AVAILABLE_PAGE_SIZE)}
                              className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                            >下一页</button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </>
              )}

              <div className="flex gap-3 mt-6">
                <button onClick={() => { setShowAddStudents(false); setSelectedStudentIds([]); setAvailableSearch(''); }} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
                  取消
                </button>
                <button
                  onClick={handleAddStudents}
                  disabled={selectedStudentIds.length === 0}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  添加 ({selectedStudentIds.length})
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 邀请码弹窗 */}
      <AnimatePresence>
        {showInviteCode && selectedClass && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowInviteCode(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <KeyRound className="w-6 h-6 text-amber-500" />
                  班级邀请码
                </h3>
                <button onClick={() => setShowInviteCode(false)} className="p-1 hover:bg-gray-100 rounded">
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <p className="text-sm text-gray-500 mb-4">
                把这串数字发给学生，让他们在「学生端 → 加入班级」里输入即可加入「{selectedClass.name}」。
              </p>

              {inviteCode ? (
                <div className="space-y-3">
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-6 text-center">
                    <div className="text-5xl font-bold tracking-[0.4em] text-amber-700 font-mono select-all">
                      {inviteCode.code}
                    </div>
                    <p className="text-xs text-amber-600 mt-3">
                      剩余 {inviteCode.hours_left} 小时 ·
                      已被 {inviteCode.redemption_count} 人兑换
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopyInvite}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition font-medium"
                    >
                      <Copy className="w-4 h-4" />
                      复制
                    </button>
                    <button
                      onClick={handleRefreshInvite}
                      disabled={generatingInvite}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg transition font-medium disabled:opacity-50"
                    >
                      <RefreshCw className={`w-4 h-4 ${generatingInvite ? 'animate-spin' : ''}`} />
                      重新生成
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-gray-500 text-sm mb-4">还没有有效的邀请码</p>
                  <button
                    onClick={handleRefreshInvite}
                    disabled={generatingInvite}
                    className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition font-medium disabled:opacity-50"
                  >
                    {generatingInvite ? '生成中…' : '生成邀请码'}
                  </button>
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  邀请码有效期 24 小时；学生输入后自动加入本班，若已在你其他班则会自动转过来。
                </p>
                <button
                  onClick={handleDownloadInviteTemplate}
                  className="mt-3 text-xs text-indigo-600 hover:underline flex items-center gap-1"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  顺便：下载 Excel 入班模板
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {transferStudent && selectedClass && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => { if (!transferring) { setTransferStudent(null); setTransferTargetClassId(null); } }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                <ArrowLeftRight className="w-6 h-6 text-indigo-600" />
                转到其他班级
              </h3>

              <div className="bg-gray-50 rounded-xl p-3 mb-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                  <span className="text-indigo-600 font-semibold">
                    {(transferStudent.full_name || transferStudent.username || '?').charAt(0)}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-gray-800">{transferStudent.full_name}</p>
                  <p className="text-xs text-gray-500">@{transferStudent.username} · 当前班级：{selectedClass.name}</p>
                </div>
              </div>

              {classes.filter(c => c.id !== selectedClass.id).length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm">
                  你只有这一个班级，无法转班。请先创建另一个班级。
                </div>
              ) : (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-2">选择目标班级</label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {classes.filter(c => c.id !== selectedClass.id).map(c => (
                      <label
                        key={c.id}
                        className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition ${
                          transferTargetClassId === c.id
                            ? 'bg-indigo-100 border-2 border-indigo-300'
                            : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                        }`}
                      >
                        <input
                          type="radio"
                          name="transferTarget"
                          checked={transferTargetClassId === c.id}
                          onChange={() => setTransferTargetClassId(c.id)}
                          className="w-4 h-4 text-indigo-600"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 text-sm truncate">{c.name}</p>
                          {c.description && (
                            <p className="text-xs text-gray-400 truncate">{c.description}</p>
                          )}
                        </div>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {c.student_count} 人
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => { setTransferStudent(null); setTransferTargetClassId(null); }}
                  disabled={transferring}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmTransfer}
                  disabled={transferring || transferTargetClassId === null}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {transferring ? '转班中...' : '确认转班'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 学生详情弹窗 */}
      <AnimatePresence>
        {studentDetail && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setStudentDetail(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              {/* 学生头部 */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center">
                    <span className="text-indigo-600 font-bold text-xl">{(studentDetail.full_name || studentDetail.username || '?').charAt(0)}</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">{studentDetail.full_name}</h3>
                    <p className="text-sm text-gray-400">@{studentDetail.username}</p>
                  </div>
                </div>
                <button onClick={() => setStudentDetail(null)} className="p-2 text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 今日数据 */}
              <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> 今日学习
              </h4>
              <div className="grid grid-cols-4 gap-3 mb-6">
                <div className="p-3 bg-blue-50 rounded-xl text-center">
                  <p className="text-2xl font-bold text-blue-600">{studentDetail.today_words}</p>
                  <p className="text-xs text-blue-500">学习单词</p>
                </div>
                <div className="p-3 bg-green-50 rounded-xl text-center">
                  <p className="text-2xl font-bold text-green-600">{formatDuration(studentDetail.today_duration)}</p>
                  <p className="text-xs text-green-500">学习时长</p>
                </div>
                <div className="p-3 bg-purple-50 rounded-xl text-center">
                  <p className="text-2xl font-bold text-purple-600">{studentDetail.today_accuracy}%</p>
                  <p className="text-xs text-purple-500">准确率</p>
                </div>
                <div className="p-3 bg-orange-50 rounded-xl text-center">
                  <p className="text-2xl font-bold text-orange-600">{studentDetail.today_sessions}</p>
                  <p className="text-xs text-orange-500">学习次数</p>
                </div>
              </div>

              {/* 累计数据 */}
              <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> 累计统计
              </h4>
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-lg font-bold text-gray-800">{studentDetail.total_words_learned}</p>
                  <p className="text-xs text-gray-500">学习单词</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-lg font-bold text-gray-800">{studentDetail.total_mastered}</p>
                  <p className="text-xs text-gray-500">已掌握</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-lg font-bold text-gray-800">{studentDetail.total_study_days}</p>
                  <p className="text-xs text-gray-500">学习天数</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-lg font-bold text-gray-800">{formatDuration(studentDetail.total_study_time)}</p>
                  <p className="text-xs text-gray-500">总学习时长</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-lg font-bold text-gray-800">{studentDetail.overall_accuracy}%</p>
                  <p className="text-xs text-gray-500">整体准确率</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-lg font-bold text-red-500">{studentDetail.weak_words_count}</p>
                  <p className="text-xs text-gray-500">薄弱单词</p>
                </div>
              </div>

              {/* 最近7天趋势 */}
              <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> 最近7天学习趋势
              </h4>
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-end justify-between h-32 gap-1">
                  {studentDetail.recent_daily_words.map((count, i) => {
                    const maxCount = Math.max(...studentDetail.recent_daily_words, 1);
                    const height = (count / maxCount) * 100;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-xs text-gray-600 font-medium">{count}</span>
                        <div
                          className="w-full bg-indigo-400 rounded-t-md transition-all"
                          style={{ height: `${Math.max(height, 4)}%` }}
                        />
                        <span className="text-xs text-gray-400">{studentDetail.recent_daily_dates[i]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AI学习建议 */}
              <div className="mt-6">
                <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <span>🤖</span> AI学习建议
                </h4>
                {loadingAdvice ? (
                  <div className="bg-gray-50 rounded-xl p-4 text-center text-gray-400 text-sm">分析中...</div>
                ) : aiAdvice ? (
                  <div className={`rounded-xl p-4 border ${
                    aiAdvice.level === 'danger' ? 'bg-red-50 border-red-200' :
                    aiAdvice.level === 'warning' ? 'bg-yellow-50 border-yellow-200' :
                    'bg-green-50 border-green-200'
                  }`}>
                    {/* 预警 */}
                    {aiAdvice.alerts?.length > 0 && (
                      <div className="mb-3">
                        {aiAdvice.alerts.map((a: string, i: number) => (
                          <div key={i} className="flex items-start gap-2 mb-1">
                            <span className="text-red-500 flex-shrink-0">⚠️</span>
                            <span className="text-red-700 text-sm font-medium">{a}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* 建议 */}
                    <div className="space-y-1.5">
                      {aiAdvice.suggestions?.map((s: string, i: number) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="text-blue-500 flex-shrink-0">💡</span>
                          <span className="text-gray-700 text-sm">{s}</span>
                        </div>
                      ))}
                    </div>
                    {/* 题型分析 */}
                    {aiAdvice.mode_analysis && Object.keys(aiAdvice.mode_analysis).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200/50">
                        <p className="text-xs text-gray-500 mb-2">各题型表现：</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(aiAdvice.mode_analysis).map(([mode, stats]: [string, any]) => (
                            <span key={mode} className={`px-2 py-1 rounded text-xs font-medium ${
                              stats.accuracy >= 80 ? 'bg-green-100 text-green-700' :
                              stats.accuracy >= 50 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {mode} {stats.accuracy}%
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-xl p-4 text-center text-gray-400 text-sm">暂无建议</div>
                )}
              </div>

              {/* 查看完整数据按钮 */}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => {
                    setStudentDetail(null);
                    navigate(`/teacher/students/${studentDetail.user_id}`);
                  }}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-medium hover:shadow-lg transition"
                >
                  查看完整数据
                </button>
                <button onClick={() => setStudentDetail(null)} className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition">
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TeacherClassManagement;
