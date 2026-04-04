import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, X, Trash2, ChevronRight, Calendar, BookOpen, Target, Clock, TrendingUp, UserPlus, ArrowLeft } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

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
      const res = await axios.get(`${API_BASE_URL}/teacher/classes/${classId}/students`, { headers: headers() });
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
      alert('请输入班级名称');
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
      alert(error.response?.data?.detail || '创建失败');
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
      alert(error.response?.data?.detail || '删除失败');
    }
  };

  const loadAvailableStudents = async (classId: number) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/teacher/classes/${classId}/available-students`, { headers: headers() });
      setAvailableStudents(res.data);
    } catch (error) {
      console.error('加载可用学生失败:', error);
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
      alert(error.response?.data?.detail || '添加失败');
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
      alert(error.response?.data?.detail || '移除失败');
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
      alert(error.response?.data?.detail || '移除失败');
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
                    <button
                      onClick={() => {
                        loadAvailableStudents(selectedClass.id);
                        setShowAddStudents(true);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl transition font-medium"
                    >
                      <UserPlus className="w-5 h-5" />
                      添加学生
                    </button>
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
                                      {s.full_name.charAt(0)}
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
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    班级成员 ({classStudents.length})
                  </h3>

                  {classStudents.length === 0 ? (
                    <div className="text-center py-8">
                      <Users className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                      <p className="text-gray-400 mb-3">暂无学生</p>
                      <button
                        onClick={() => {
                          loadAvailableStudents(selectedClass.id);
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
                                {s.full_name.charAt(0)}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-800 text-sm">{s.full_name}</p>
                              <p className="text-xs text-gray-400">@{s.username}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveStudent(s.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 transition"
                            title="移出班级"
                          >
                            <X className="w-4 h-4" />
                          </button>
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
            onClick={() => { setShowAddStudents(false); setSelectedStudentIds([]); }}
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

              {availableStudents.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">所有学生都已分配到该班级</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-gray-500">
                      已选 {selectedStudentIds.length} / {availableStudents.length} 名学生
                    </p>
                    <button
                      onClick={() => {
                        if (selectedStudentIds.length === availableStudents.length) {
                          setSelectedStudentIds([]);
                        } else {
                          setSelectedStudentIds(availableStudents.map(s => s.id));
                        }
                      }}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      {selectedStudentIds.length === availableStudents.length ? '取消全选' : '全选'}
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
                          <span className="text-indigo-600 font-semibold text-sm">{s.full_name.charAt(0)}</span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-800 text-sm">{s.full_name}</p>
                          <p className="text-xs text-gray-400">@{s.username}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}

              <div className="flex gap-3 mt-6">
                <button onClick={() => { setShowAddStudents(false); setSelectedStudentIds([]); }} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
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
                    <span className="text-indigo-600 font-bold text-xl">{studentDetail.full_name.charAt(0)}</span>
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
