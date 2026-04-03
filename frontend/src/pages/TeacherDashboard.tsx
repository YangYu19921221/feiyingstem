import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import ChangePasswordModal from '../components/ChangePasswordModal';

interface UserData {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface DashboardStats {
  total_words: number;
  total_books: number;
  total_students: number;
  weekly_passages: number;
  recent_words: Array<{
    word: string;
    status: string;
    date: string;
  }>;
  today_active_students: number;
  pending_assignments: number;
  completion_rate: number;
  weekly_new_assignments: number;
}

const TeacherDashboard = () => {
  const navigate = useNavigate();

  // 直接从 localStorage 初始化用户数据,避免闪烁
  const [user] = useState<UserData | null>(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  });

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/teacher/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('加载统计数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const [showChangePassword, setShowChangePassword] = useState(false);

  const quickActions = [
    { icon: '📚', title: '单词本管理', desc: '管理单元和单词', color: 'from-blue-500 to-cyan-500', route: '/teacher/books' },
    { icon: '🏫', title: '班级管理', desc: '班级分组和每日数据', color: 'from-indigo-500 to-purple-500', route: '/teacher/classes' },
    { icon: '📝', title: '阅读理解', desc: '文章和题目', color: 'from-yellow-500 to-orange-500', route: '/teacher/reading' },
    { icon: '🏆', title: '竞赛管理', desc: 'AI生成题目', color: 'from-red-500 to-pink-500', route: '/teacher/competition' },
    { icon: '📤', title: '分配作业', desc: '分配给学生', color: 'from-orange-500 to-red-500', route: '/teacher/assignments' },
    { icon: '📊', title: '学生监控', desc: '查看学习数据', color: 'from-green-500 to-teal-500', route: '/teacher/students' },
  ];

  const statsCards = [
    { label: '总单词数', valueKey: 'total_words', icon: '📚', color: 'bg-blue-100 text-blue-600' },
    { label: '单词本数', valueKey: 'total_books', icon: '📖', color: 'bg-purple-100 text-purple-600' },
    { label: '学生人数', valueKey: 'total_students', icon: '👥', color: 'bg-green-100 text-green-600' },
    { label: '本周文章', valueKey: 'weekly_passages', icon: '📝', color: 'bg-orange-100 text-orange-600' },
  ];

  // 学生学习情况 - 暂时使用占位数据,未来可以从API获取
  const students = [
    { name: '学生数据', progress: 0, words: 0, emoji: '📊' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-3xl">👨‍🏫</span>
            <h1 className="text-xl font-bold text-gray-800">教师工作台</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              👤 {user?.full_name || '教师'}
            </span>
            <button
              onClick={() => setShowChangePassword(true)}
              className="text-sm px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-md transition"
            >
              修改密码
            </button>
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
        <div
          className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-6 mb-8 text-white shadow-lg"
        >
          <h2 className="text-2xl font-bold mb-2">
            👋 欢迎回来, {user?.full_name}老师!
          </h2>
          <p className="opacity-90">今天有 {stats?.today_active_students || 0} 个学生完成了学习任务,继续加油!</p>
        </div>

        {/* 数据统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {statsCards.map((card) => (
            <div
              key={card.label}
              className="bg-white rounded-xl p-6 shadow-md"
            >
              <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg ${card.color} mb-3`}>
                <span className="text-2xl">{card.icon}</span>
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-1">
                {loading ? '...' : String(stats?.[card.valueKey as keyof DashboardStats] || 0)}
              </h3>
              <p className="text-sm text-gray-500">{card.label}</p>
            </div>
          ))}
        </div>

        {/* 快速操作 */}
        <div className="mb-8">
          <h3 className="text-lg font-bold text-gray-800 mb-4">快速操作</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {quickActions.map((action) => (
              <button
                key={action.title}
                onClick={() => navigate(action.route)}
                className="bg-white rounded-xl p-6 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all text-center group"
              >
                <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-r ${action.color} mb-3 group-hover:scale-110 transition`}>
                  <span className="text-3xl">{action.icon}</span>
                </div>
                <h4 className="font-bold text-gray-800 mb-1">{action.title}</h4>
                <p className="text-xs text-gray-500">{action.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* 最近录入的单词 */}
          <div
            className="bg-white rounded-2xl p-6 shadow-md"
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <span>📝</span> 最近录入的单词
              </h3>
              <button className="text-sm text-blue-600 hover:text-blue-700">
                查看全部 →
              </button>
            </div>
            <div className="space-y-3">
              {loading ? (
                <div className="text-center text-gray-500 py-4">加载中...</div>
              ) : stats?.recent_words && stats.recent_words.length > 0 ? (
                stats.recent_words.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                  >
                    <div>
                      <h4 className="font-medium text-gray-800">{item.word}</h4>
                      <p className="text-xs text-gray-500">{item.date}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      item.status === 'published'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {item.status === 'published' ? '已发布' : '草稿'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-4">暂无数据</div>
              )}
            </div>
          </div>

          {/* 学生学习情况 */}
          <div
            className="bg-white rounded-2xl p-6 shadow-md"
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <span>📊</span> 学生学习情况
              </h3>
              <button className="text-sm text-blue-600 hover:text-blue-700">
                查看全部 →
              </button>
            </div>
            <div className="space-y-4">
              {students.map((student, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{student.emoji}</span>
                      <span className="font-medium text-gray-800">{student.name}</span>
                    </div>
                    <span className="text-sm text-gray-600">{student.words} 词</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-green-400 to-blue-500"
                      style={{ width: `${student.progress}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">进度: {student.progress}%</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 单词本分配统计 */}
        <div
          className="mt-8 bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-6 border-2 border-blue-200"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-5xl">📚</div>
              <div>
                <h3 className="text-lg font-bold text-gray-800 mb-2">
                  单词本分配管理
                </h3>
                <p className="text-sm text-gray-600">
                  学生通过AI系统会根据他们的薄弱单词自动生成个性化练习题
                </p>
                <div className="flex gap-6 mt-3">
                  <div>
                    <span className="text-xs text-gray-500">待分配单词本</span>
                    <p className="text-2xl font-bold text-blue-600">{stats?.pending_assignments || 0}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">学生完成率</span>
                    <p className="text-2xl font-bold text-green-600">{stats?.completion_rate || 0}%</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">本周新增</span>
                    <p className="text-2xl font-bold text-purple-600">{stats?.weekly_new_assignments || 0}</p>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() => navigate('/teacher/assignments')}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:shadow-lg transition font-medium whitespace-nowrap"
            >
              分配单词本 →
            </button>
          </div>
        </div>
      </div>

      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </div>
  );
};

export default TeacherDashboard;
