import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface UserData {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface Statistics {
  total_users: number;
  total_words: number;
  total_books: number;
  total_units: number;
  active_users_today: number;
  active_users_week: number;
  learning_records_today: number;
  learning_records_week: number;
  students: number;
  teachers: number;
  admins: number;
}

interface RecentUser {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string | null;
  last_login: string | null;
}

const AdminDashboard = () => {
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

  const [stats, setStats] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [currentVersion, setCurrentVersion] = useState('');
  // 最近注册用户(真实数据，取自 /admin/users 按创建时间倒序)
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);

  useEffect(() => {
    loadStatistics();
    loadRecentUsers();
    // 检查版本更新
    axios.get(`${API_BASE_URL}/admin/system/version`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` }
    }).then(res => {
      setCurrentVersion(res.data.version || '');
    }).catch(() => {});
    axios.get(`${API_BASE_URL}/admin/system/check-update`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` }
    }).then(res => {
      setHasUpdate(res.data.has_update);
    }).catch(() => {});
  }, []);

  const loadStatistics = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('加载统计数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 加载最近注册的 5 个用户(真实数据)
  const loadRecentUsers = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/admin/users`, {
        params: { page: 1, page_size: 5 },
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecentUsers(response.data?.users || []);
    } catch (error) {
      console.error('加载最近用户失败:', error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const quickActions = [
    { icon: '👥', title: '用户管理', desc: '管理师生账号', color: 'from-blue-500 to-cyan-500', path: '/admin/users' },
    { icon: '👨‍🏫', title: '教师管理', desc: '教师列表与班级', color: 'from-teal-500 to-green-500', path: '/admin/teachers' },
    { icon: '📊', title: '班级数据', desc: '学习统计与名册', color: 'from-sky-500 to-blue-500', path: '/admin/classes' },
    { icon: '📚', title: '内容管理', desc: '单词/单词本', color: 'from-purple-500 to-pink-500', path: '/admin/content' },
    { icon: '🤖', title: 'AI配置', desc: '通义千问等服务', color: 'from-indigo-500 to-purple-500', path: '/admin/ai-config' },
    { icon: '📊', title: '数据统计', desc: '系统使用情况', color: 'from-green-500 to-teal-500', path: '/admin/statistics' },
    { icon: '⚙️', title: '系统设置', desc: '配置管理', color: 'from-orange-500 to-red-500', path: '/admin/settings' },
    { icon: '🎫', title: '订阅管理', desc: '兑换码管理', color: 'from-amber-500 to-orange-500', path: '/admin/subscriptions' },
    { icon: '🏆', title: '单词比赛', desc: '竞赛排行与概览', color: 'from-yellow-500 to-amber-500', path: '/admin/competition' },
  ];

  const systemStats = loading ? [] : [
    { label: '总用户数', value: stats?.total_users.toString() || '0', trend: '+' + (stats?.students || 0), icon: '👥', color: 'bg-blue-100 text-blue-600' },
    { label: '总单词数', value: stats?.total_words.toLocaleString() || '0', trend: '+' + (stats?.total_books || 0) + '本', icon: '📚', color: 'bg-purple-100 text-purple-600' },
    { label: '今日活跃', value: stats?.active_users_today.toString() || '0', trend: '本周' + (stats?.active_users_week || 0), icon: '🔥', color: 'bg-orange-100 text-orange-600' },
    { label: '本周学习', value: stats?.learning_records_week.toLocaleString() || '0', trend: '今日' + (stats?.learning_records_today || 0), icon: '📈', color: 'bg-green-100 text-green-600' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-3xl">⚡</span>
            <h1 className="text-xl font-bold text-gray-800">系统管理后台</h1>
            {currentVersion && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-mono shadow-sm ${hasUpdate ? 'bg-gradient-to-r from-red-500 to-orange-500 text-white animate-pulse' : 'bg-gray-100 text-gray-500'}`}>v{currentVersion}</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {hasUpdate && (
              <button
                onClick={() => navigate('/admin/settings')}
                className="flex items-center gap-1 px-3 py-1 bg-red-500 text-white rounded-full text-sm font-medium animate-pulse hover:bg-red-600 transition"
              >
                🔔 有新版本可更新
              </button>
            )}
            <div className="flex items-center gap-2 px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm">
              <span>👑</span>
              <span className="font-medium">{user?.full_name || '管理员'}</span>
            </div>
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
          className="bg-gradient-to-r from-slate-700 to-gray-800 rounded-2xl p-6 mb-8 text-white shadow-lg"
        >
          <h2 className="text-2xl font-bold mb-2">
            ⚡ 系统管理面板
          </h2>
          <p className="opacity-90">欢迎回来,{user?.full_name}。系统运行正常,所有服务在线。</p>
        </div>

        {/* 系统统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {loading ? (
            <div className="col-span-4 text-center py-8 text-gray-600">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-blue-600 mx-auto mb-4"></div>
              <p>加载统计数据中...</p>
            </div>
          ) : (
            systemStats.map((stat) => (
            <div
              key={stat.label}
              className="bg-white rounded-xl p-6 shadow-md border border-gray-100"
            >
              <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg ${stat.color} mb-3`}>
                <span className="text-2xl">{stat.icon}</span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-gray-800">{stat.value}</h3>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                </div>
                <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded">
                  {stat.trend}
                </span>
              </div>
            </div>
            ))
          )}
        </div>

        {/* 快速操作 */}
        <div className="mb-8">
          <h3 className="text-lg font-bold text-gray-800 mb-4">快速操作</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {quickActions.map((action) => (
              <button
                key={action.title}
                onClick={() => action.path && navigate(action.path)}
                disabled={!action.path}
                className={`bg-white rounded-xl p-6 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all text-center group border border-gray-100 ${
                  !action.path ? 'opacity-50 cursor-not-allowed' : ''
                }`}
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

        {/* 最近用户 — 真实数据(最近注册的 5 个账号) */}
        <div className="bg-white rounded-2xl p-6 shadow-md border border-gray-100">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span>👥</span> 最近用户
            </h3>
            <button
              onClick={() => navigate('/admin/users')}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              查看全部 →
            </button>
          </div>
          {recentUsers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">暂无用户数据</p>
          ) : (
            <div className="space-y-3">
              {recentUsers.map((item) => {
                const roleLabel = item.role === 'teacher' ? '👨‍🏫' : item.role === 'admin' ? '👑' : '👨‍🎓';
                const displayName = item.full_name || item.username;
                const dateText = item.created_at
                  ? new Date(item.created_at).toLocaleDateString('zh-CN')
                  : '';
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        item.role === 'teacher' ? 'bg-purple-100 text-purple-600'
                          : item.role === 'admin' ? 'bg-red-100 text-red-600'
                          : 'bg-blue-100 text-blue-600'
                      }`}>
                        <span className="text-lg">{roleLabel}</span>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-800">{displayName}</h4>
                        <p className="text-xs text-gray-500">注册于 {dateText}</p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      item.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {item.is_active ? '已激活' : '已停用'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
