import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Users, UserPlus, X, Mail, Check, Eye, Search } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

interface UserData {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface Student {
  id: number;
  username: string;
  full_name: string | null;
  email: string | null;
  phone?: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
}

interface WordBook {
  id: number;
  name: string;
  description: string | null;
  grade_level: string;
  cover_color: string;
  word_count: number;
}

const PAGE_SIZE = 50;

const TeacherStudents = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserData | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [books, setBooks] = useState<WordBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [debouncedKw, setDebouncedKw] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [newStudent, setNewStudent] = useState({
    username: '',
    password: '',
    full_name: '',
    email: ''
  });

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedKw(searchKeyword.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchKeyword]);

  useEffect(() => {
    loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKw, page]);

  useEffect(() => {
    loadBooks();
  }, []);

  const loadStudents = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('access_token');
      const res = await axios.get(`${API_BASE_URL}/teacher/students`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { q: debouncedKw || undefined, page, size: PAGE_SIZE },
      });
      setStudents(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (error) {
      console.error('加载学生列表失败:', error);
      toast.error('加载学生列表失败,请重试');
    } finally {
      setLoading(false);
    }
  };

  const loadBooks = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await axios.get(`${API_BASE_URL}/words/books`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setBooks(res.data);
    } catch (error) {
      console.error('加载单词本失败:', error);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleCreateStudent = async () => {
    if (!newStudent.username.trim()) {
      toast.warning('请输入用户名');
      return;
    }
    if (!newStudent.password.trim()) {
      toast.warning('请输入密码');
      return;
    }

    setCreatingStudent(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await axios.post(
        `${API_BASE_URL}/teacher/students`,
        {
          username: newStudent.username.trim(),
          password: newStudent.password,
          full_name: newStudent.full_name.trim() || newStudent.username.trim(),
          email: newStudent.email.trim() || undefined,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      toast.success(`学生「${res.data.username}」已创建并加入您的班级`);
      setShowCreateDialog(false);
      setNewStudent({ username: '', password: '', full_name: '', email: '' });
      if (page === 1) {
        loadStudents();
      } else {
        setPage(1);
      }
    } catch (error: any) {
      toast.error(getErrorMessage(error, '创建学生失败'));
    } finally {
      setCreatingStudent(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-primary" />
            <h1 className="text-xl font-bold text-gray-800">教师端 - 学生管理</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/teacher/dashboard')}
              className="text-sm px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-md transition font-medium"
            >
              返回首页
            </button>
            <span className="text-sm text-gray-600">
              👨‍🏫 {user?.full_name || '教师'}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md transition"
            >
              退出
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 欢迎横幅 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 mb-8 text-white shadow-lg"
        >
          <h2 className="text-2xl font-bold mb-2">
            👥 学生管理
          </h2>
          <p className="opacity-90">管理学生账号,查看学习进度</p>
        </motion.div>

        {/* 统计卡片 */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-6 shadow-md"
          >
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-indigo-100 rounded-xl flex items-center justify-center">
                <Users className="w-7 h-7 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">学生总数</p>
                <p className="text-3xl font-bold text-gray-800">{total}</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl p-6 shadow-md"
          >
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center">
                <BookOpen className="w-7 h-7 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">单词本数量</p>
                <p className="text-3xl font-bold text-gray-800">{books.length}</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl p-6 shadow-md"
          >
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-purple-100 rounded-xl flex items-center justify-center">
                <Check className="w-7 h-7 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">当前页</p>
                <p className="text-3xl font-bold text-gray-800">
                  {students.length}
                  <span className="text-sm font-normal text-gray-500 ml-2">/ {total}</span>
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* 学生列表 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl p-6 shadow-md"
        >
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Users className="w-5 h-5" />
              学生列表
              <span className="text-sm font-normal text-gray-500">
                （第 {page} / {totalPages} 页，共 {total} 人{debouncedKw ? ` · 含「${debouncedKw}」` : ''}）
              </span>
            </h3>
            <div className="flex items-center gap-3 flex-1 max-w-md ml-auto">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder="搜索用户名 / 姓名 / 手机 / 邮箱"
                  className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
                />
                {searchKeyword && (
                  <button
                    onClick={() => setSearchKeyword('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    title="清空"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                onClick={() => setShowCreateDialog(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition font-medium shadow-md whitespace-nowrap"
              >
                <UserPlus className="w-5 h-5" />
                添加学生
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-gray-500 mt-4">加载中...</p>
            </div>
          ) : total === 0 && !debouncedKw ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 mb-2">暂无学生</p>
              <p className="text-sm text-gray-400 mb-4">点击"添加学生"按钮创建新学生，会自动归到您的班级</p>
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-12">
              <Search className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">没有匹配「{debouncedKw}」的学生</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">姓名</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">用户名</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">邮箱</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">状态</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">注册时间</th>
                    <th className="text-center py-3 px-4 font-semibold text-gray-700">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, index) => (
                    <motion.tr
                      key={student.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 * index }}
                      onClick={() => navigate(`/teacher/students/${student.id}`)}
                      className="border-b border-gray-100 hover:bg-indigo-50 transition cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                            <span className="text-indigo-600 font-semibold">
                              {(student.full_name || student.username).charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="font-medium text-gray-800">
                            {student.full_name || student.username}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {student.username}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {student.email || '-'}
                      </td>
                      <td className="py-3 px-4">
                        {student.is_active ? (
                          <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                            活跃
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded-full">
                            禁用
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-500">
                        {new Date(student.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/teacher/students/${student.id}`);
                          }}
                          className="flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-sm rounded-lg transition shadow-md hover:shadow-lg mx-auto"
                        >
                          <Eye className="w-4 h-4" />
                          查看详情
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 分页 */}
          {totalPages > 1 && !loading && (
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >上一页</button>
              <span className="text-sm text-gray-500 px-2">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >下一页</button>
            </div>
          )}
        </motion.div>

        {/* 提示信息 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 mt-6 border border-blue-200"
        >
          <h3 className="text-lg font-bold text-blue-800 mb-3 flex items-center gap-2">
            💡 功能提示
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white/50 rounded-lg p-3">
              <p className="text-sm font-semibold text-indigo-700 mb-1">📊 数据分析</p>
              <p className="text-sm text-blue-700">点击"查看详情"按钮进入学生详情页,可查看学习数据、薄弱点分析</p>
            </div>
            <div className="bg-white/50 rounded-lg p-3">
              <p className="text-sm font-semibold text-purple-700 mb-1">🤖 AI试卷生成</p>
              <p className="text-sm text-blue-700">在学生详情页底部,使用"AI深度分析"和"一键生成试卷"功能</p>
            </div>
            <div className="bg-white/50 rounded-lg p-3">
              <p className="text-sm font-semibold text-green-700 mb-1">📚 学习进度</p>
              <p className="text-sm text-blue-700">学生学习进度会自动保存,支持断点续学</p>
            </div>
            <div className="bg-white/50 rounded-lg p-3">
              <p className="text-sm font-semibold text-orange-700 mb-1">👥 学生管理</p>
              <p className="text-sm text-blue-700">学生注册后即可使用用户名和密码登录系统</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* 创建学生对话框 */}
      <AnimatePresence>
        {showCreateDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowCreateDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <UserPlus className="w-6 h-6 text-primary" />
                  添加新学生
                </h3>
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="text-gray-400 hover:text-gray-600 transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    用户名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newStudent.username}
                    onChange={(e) => setNewStudent({ ...newStudent, username: e.target.value })}
                    placeholder="例如: zhangsan"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    密码 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={newStudent.password}
                    onChange={(e) => setNewStudent({ ...newStudent, password: e.target.value })}
                    placeholder="至少6个字符"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    姓名
                  </label>
                  <input
                    type="text"
                    value={newStudent.full_name}
                    onChange={(e) => setNewStudent({ ...newStudent, full_name: e.target.value })}
                    placeholder="例如: 张三"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    邮箱
                  </label>
                  <input
                    type="email"
                    value={newStudent.email}
                    onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
                    placeholder="例如: zhangsan@example.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCreateDialog(false)}
                  disabled={creatingStudent}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateStudent}
                  disabled={creatingStudent}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:shadow-lg transition font-medium disabled:opacity-50"
                >
                  {creatingStudent ? '创建中...' : '创建'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TeacherStudents;
