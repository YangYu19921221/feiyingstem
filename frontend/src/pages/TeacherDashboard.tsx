import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import ChangePasswordModal from '../components/ChangePasswordModal';
import ChangeUsernameModal from '../components/ChangeUsernameModal';

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

interface RecentActivity {
  type: 'homework' | 'unit';
  student_name: string;
  title: string;
  score: number | null;
  time: string; // 北京时间 MM-DD HH:MM,后端已格式化
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
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('access_token');
      const headers = { Authorization: `Bearer ${token}` };
      // 统计与动态并行加载,动态失败不影响统计展示
      // 注意:必须用 /teacher/dashboard/stats——/teacher/stats 被"单词本分配统计"路由遮蔽
      const [statsRes, actRes] = await Promise.allSettled([
        axios.get(`${API_BASE_URL}/teacher/dashboard/stats`, { headers }),
        axios.get(`${API_BASE_URL}/teacher/recent-activities`, { headers }),
      ]);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
      if (actRes.status === 'fulfilled') setActivities(actRes.value.data.activities || []);
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
  const [showChangeUsername, setShowChangeUsername] = useState(false);

  const quickActions = [
    { icon: '📚', title: '单词本管理', desc: '管理单元和单词', color: 'from-blue-500 to-cyan-500', route: '/teacher/books' },
    { icon: '🏫', title: '班级管理', desc: '班级分组和每日数据', color: 'from-indigo-500 to-purple-500', route: '/teacher/classes' },
    { icon: '📝', title: '阅读理解', desc: '文章和题目', color: 'from-yellow-500 to-orange-500', route: '/teacher/reading' },
    { icon: '💬', title: '句子背诵', desc: '句子集 · 单元 · CSV 导入', color: 'from-green-500 to-emerald-500', route: '/teacher/sentences' },
    { icon: '🏆', title: '竞赛管理', desc: 'AI生成题目', color: 'from-red-500 to-pink-500', route: '/teacher/competition' },
    { icon: '⚔️', title: 'PK 晋级赛', desc: '分组·淘汰·自动出冠军', color: 'from-violet-500 to-fuchsia-500', route: '/teacher/tournaments' },
    { icon: '📡', title: '实时课堂', desc: '谁在学·谁切屏了', color: 'from-emerald-500 to-green-500', route: '/teacher/live' },
    { icon: '📍', title: '签到记录', desc: '每日签到·历史可查', color: 'from-cyan-500 to-sky-500', route: '/teacher/checkins' },
    { icon: '📤', title: '分配单词本', desc: '划学习范围:整本/单元/分组', color: 'from-orange-500 to-red-500', route: '/teacher/assignments' },
    { icon: '📘', title: '作业管理', desc: '布置作业·目标分·截止', color: 'from-sky-500 to-blue-500', route: '/teacher/homework' },
    { icon: '📊', title: '学生监控', desc: '查看学习数据', color: 'from-green-500 to-teal-500', route: '/teacher/students' },
    { icon: '📋', title: '测评线索', desc: '地推扫码线索', color: 'from-pink-500 to-rose-500', route: '/teacher/leads' },
  ];

  const statsCards = [
    { label: '总单词数', valueKey: 'total_words', icon: '📚', color: 'bg-blue-100 text-blue-600' },
    { label: '单词本数', valueKey: 'total_books', icon: '📖', color: 'bg-purple-100 text-purple-600' },
    { label: '学生人数', valueKey: 'total_students', icon: '👥', color: 'bg-green-100 text-green-600' },
    { label: '本周文章', valueKey: 'weekly_passages', icon: '📝', color: 'bg-orange-100 text-orange-600' },
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
              onClick={() => setShowChangeUsername(true)}
              className="text-sm px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-md transition"
            >
              修改用户名
            </button>
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
              <button onClick={() => navigate('/teacher/books')} className="text-sm text-blue-600 hover:text-blue-700">
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
            className="bg-white rounded-2xl p-6 shadow-md hover:shadow-lg transition cursor-pointer"
            onClick={() => navigate('/teacher/activities')}
            title="点击查看全部动态并搜索"
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <span>🔔</span> 今日动态
              </h3>
              <span className="text-sm text-blue-600 hover:text-blue-700">
                查看全部 / 搜索 →
              </span>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {loading ? (
                <div className="text-center text-gray-500 py-4">加载中...</div>
              ) : activities.length > 0 ? (
                activities.map((act, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                  >
                    <span className="text-lg shrink-0">{act.type === 'homework' ? '📘' : '✅'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800">
                        <span className="font-semibold">{act.student_name}</span>
                        {act.type === 'homework' ? ' 完成了作业 ' : ' 学完了 '}
                        <span className="font-medium">{act.title}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{act.time}</p>
                    </div>
                    {act.score !== null && (
                      <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-full ${
                        act.score >= 80
                          ? 'bg-green-100 text-green-700'
                          : act.score >= 60
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-600'
                      }`}>
                        {act.score}分
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-8">
                  <div className="text-4xl mb-2">🌱</div>
                  <p className="text-sm">最近 3 天还没有学生完成作业或单元</p>
                </div>
              )}
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

      <ChangeUsernameModal
        isOpen={showChangeUsername}
        onClose={() => setShowChangeUsername(false)}
        currentUsername={user?.username}
      />
    </div>
  );
};

export default TeacherDashboard;
