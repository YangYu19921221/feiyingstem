import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { getStudentBooks } from '../api/progress';
import type { StudentBook } from '../api/progress';
import { getMistakeBookStats } from '../api/mistakeBook';
import { getReviewDueCount } from '../api/memoryCurve';
import PetWidget from '../components/PetWidget';
import ChangePasswordModal from '../components/ChangePasswordModal';

interface UserData {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface DashboardStats {
  total_words_studied: number;
  today_words: number;
  mastered_words: number;
  mastery_rate: number;
  streak_days: number;
  total_minutes: number;
  rank_percentage: number;
  level: number;
  experience_points: number;
  total_points: number;
  perfect_sessions: number;
  total_sessions: number;
  first_time_accuracy: number;
}

const StudentDashboard = () => {
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

  const [books, setBooks] = useState<StudentBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<number>(0);
  const [mistakeStats, setMistakeStats] = useState<{ unresolved_mistakes: number } | null>(null);
  const [reviewDueCount, setReviewDueCount] = useState<number>(0);

  useEffect(() => {
    // 加载学生的单词本列表和统计数据
    loadBooks();
    loadStats();
    loadOnlineUsers();
    loadMistakeStats();
    loadReviewDueCount();

    // 定期更新在线人数(每30秒)
    const interval = setInterval(loadOnlineUsers, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadBooks = async () => {
    try {
      setLoading(true);
      const data = await getStudentBooks();
      setBooks(data);
    } catch (error) {
      console.error('加载单词本失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/student/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('加载统计数据失败:', error);
    }
  };

  const loadOnlineUsers = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/competition/online-users?season_id=1`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOnlineUsers(response.data.online_users);
    } catch (error) {
      console.error('加载在线人数失败:', error);
    }
  };

  const loadMistakeStats = async () => {
    try {
      const data = await getMistakeBookStats();
      setMistakeStats(data);
    } catch (error) {
      console.error('加载错题统计失败:', error);
    }
  };

  const loadReviewDueCount = async () => {
    try {
      const data = await getReviewDueCount();
      setReviewDueCount(data.due_today);
    } catch (error) {
      console.error('加载复习数据失败:', error);
    }
  };

  const ownedBooks = useMemo(() => books.filter(b => b.owned), [books]);
  const unownedBooks = useMemo(() => books.filter(b => !b.owned), [books]);

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const [showChangePassword, setShowChangePassword] = useState(false);

  const handleStartLearning = (bookId: number) => {
    navigate(`/student/books/${bookId}/units`);
  };

  const achievements = [
    { icon: '🌱', name: '初出茅庐', unlocked: true },
    { icon: '📚', name: '小有成就', unlocked: true },
    { icon: '🔥', name: '每日一练', unlocked: true },
    { icon: '💪', name: '坚持不懈', unlocked: true },
    { icon: '🔒', name: '单词大师', unlocked: false },
    { icon: '🔒', name: '精准射手', unlocked: false },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📚</span>
            <h1 className="text-xl font-bold text-gray-800">飞鹰AI英语</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              👤 {user?.full_name || '学生'}
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
          className="bg-gradient-to-r from-primary to-secondary rounded-2xl p-6 mb-8 text-white shadow-lg"
        >
          <h2 className="text-2xl font-bold mb-2">
            👋 Hi, {user?.full_name}!  今天是第 7 天打卡 🔥🔥🔥
          </h2>
          <p className="opacity-90">继续保持,你已经超越了85%的学习者!</p>
        </div>

        {/* 错题提醒 */}
        {mistakeStats && mistakeStats.unresolved_mistakes > 0 && (
          <div
            onClick={() => navigate('/student/mistake-book')}
            className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between cursor-pointer hover:bg-red-100 transition"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">📕</span>
              <div>
                <p className="font-bold text-red-700">
                  你有 {mistakeStats.unresolved_mistakes} 个错题待处理
                </p>
                <p className="text-xs text-red-500">及时复习错题，巩固薄弱知识点</p>
              </div>
            </div>
            <span className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition">
              去处理
            </span>
          </div>
        )}

        {/* 我的书架 — 置顶，一进来就能看到 */}
        <div className="mb-8">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-gray-500 mt-4">加载中...</p>
            </div>
          ) : (
            <>
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span>📚</span> 我的书架
              </h3>
              {ownedBooks.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 text-center shadow-md mb-8">
                  <span className="text-5xl mb-3 block">📭</span>
                  <p className="text-gray-500 mb-1">还没有书籍</p>
                  <p className="text-sm text-gray-400">请联系老师分配或使用兑换码获取</p>
                  <button
                    onClick={() => navigate('/subscription/redeem')}
                    className="mt-4 px-5 py-2 bg-gradient-to-r from-orange-400 to-pink-500 text-white rounded-lg font-medium hover:shadow-md transition"
                  >
                    🔑 输入兑换码
                  </button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                  {ownedBooks.map((book) => (
                    <div
                      key={book.id}
                      className="bg-white rounded-2xl p-6 shadow-md hover:shadow-lg transition group cursor-pointer flex flex-col"
                      onClick={() => handleStartLearning(book.id)}
                    >
                      <div
                        className="w-full h-32 rounded-xl mb-4 flex items-center justify-center text-white text-4xl relative"
                        style={{ background: book.cover_color }}
                      >
                        📖
                      </div>
                      <h4 className="text-lg font-bold text-gray-800 mb-2 group-hover:text-primary transition">
                        {book.name}
                      </h4>
                      {book.description && (
                        <p className="text-sm text-gray-500 mb-3">{book.description}</p>
                      )}
                      <div className="flex items-center gap-3 mb-4 text-sm text-gray-600 flex-wrap">
                        <span>📊 {book.unit_count} 个单元</span>
                        <span>📝 {book.word_count} 个单词</span>
                        {book.grade_level && (
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs">{book.grade_level}</span>
                        )}
                        {book.volume && (
                          <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full text-xs">{book.volume}</span>
                        )}
                      </div>
                      <div className="mt-auto">
                        <div className="mb-3">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-600">学习进度</span>
                            <span className="font-bold text-primary">
                              {book.progress_percentage.toFixed(0)}%
                            </span>
                          </div>
                          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-green-400 to-blue-500"
                              style={{ width: `${book.progress_percentage}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartLearning(book.id);
                            }}
                            className="flex-1 py-2 px-4 bg-gradient-to-r from-primary to-secondary text-white rounded-lg hover:shadow-md transition font-medium"
                          >
                            🧠 开始学习
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/student/books/${book.id}/progress`);
                            }}
                            className="py-2 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
                          >
                            📊
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 更多书籍（未购买） */}
              {unownedBooks.length > 0 && (
                <>
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span>🛒</span> 更多书籍
                  </h3>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                    {unownedBooks.map((book) => (
                      <div
                        key={book.id}
                        className="bg-white rounded-2xl p-6 shadow-md hover:shadow-lg transition cursor-pointer flex flex-col opacity-80"
                        onClick={() => navigate('/subscription/redeem')}
                      >
                        <div
                          className="w-full h-32 rounded-xl mb-4 flex items-center justify-center text-white text-4xl"
                          style={{ background: '#9CA3AF' }}
                        >
                          🔒
                        </div>
                        <h4 className="text-lg font-bold text-gray-800 mb-2">{book.name}</h4>
                        {book.description && (
                          <p className="text-sm text-gray-500 mb-3">{book.description}</p>
                        )}
                        <div className="flex items-center gap-3 mb-4 text-sm text-gray-600 flex-wrap">
                          <span>📊 {book.unit_count} 个单元</span>
                          <span>📝 {book.word_count} 个单词</span>
                          {book.grade_level && (
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs">{book.grade_level}</span>
                          )}
                          {book.volume && (
                            <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full text-xs">{book.volume}</span>
                          )}
                        </div>
                        <div className="mt-auto">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate('/subscription/redeem');
                            }}
                            className="w-full py-2 px-4 bg-gradient-to-r from-orange-400 to-pink-500 text-white rounded-lg hover:shadow-md transition font-medium"
                          >
                            🔑 去兑换
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* 宠物小组件 */}
        <div className="mb-8">
          <PetWidget />
        </div>

        {/* 学习数据概览 */}
        <div
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span>📊</span> 学习概览
            </h3>
            <button
              onClick={() => navigate('/student/analytics')}
              className="text-sm text-primary hover:text-secondary font-medium flex items-center gap-1 transition"
            >
              详细数据 →
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div
              className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl p-5 shadow-sm hover:shadow-md transition cursor-pointer"
              onClick={() => navigate('/student/analytics')}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl">📚</span>
                <span className="text-xs text-blue-600 font-medium">+{stats?.today_words || 0} 今日</span>
              </div>
              <div className="text-3xl font-bold text-gray-800 mb-1">{stats?.total_words_studied || 0}</div>
              <div className="text-sm text-gray-600">学习单词</div>
            </div>

            <div
              className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-5 shadow-sm hover:shadow-md transition cursor-pointer"
              onClick={() => navigate('/student/analytics')}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl">✅</span>
                <span className="text-xs text-green-600 font-medium">{stats?.mastery_rate || 0}%</span>
              </div>
              <div className="text-3xl font-bold text-gray-800 mb-1">{stats?.mastered_words || 0}</div>
              <div className="text-sm text-gray-600">已掌握</div>
            </div>

            <div
              className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl p-5 shadow-sm hover:shadow-md transition cursor-pointer"
              onClick={() => navigate('/student/analytics')}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl">🔥</span>
                <span className="text-xs text-orange-600 font-medium">连续</span>
              </div>
              <div className="text-3xl font-bold text-gray-800 mb-1">{stats?.streak_days || 0}</div>
              <div className="text-sm text-gray-600">打卡天数</div>
            </div>

            <div
              className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-5 shadow-sm hover:shadow-md transition cursor-pointer"
              onClick={() => navigate('/student/analytics')}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl">⏰</span>
                <span className="text-xs text-purple-600 font-medium">总计</span>
              </div>
              <div className="text-3xl font-bold text-gray-800 mb-1">{stats?.total_minutes || 0}</div>
              <div className="text-sm text-gray-600">学习分钟</div>
            </div>
          </div>
        </div>

        {/* 学习质量 */}
        {stats && (stats.perfect_sessions > 0 || stats.total_sessions > 0) && (
          <div className="mb-8">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span>🏅</span> 学习质量
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-yellow-50 to-amber-50 rounded-xl p-5 shadow-sm text-center">
                <div className="text-3xl mb-1">⭐</div>
                <div className="text-2xl font-bold text-amber-600">{stats.perfect_sessions}</div>
                <div className="text-sm text-gray-600">满分轮次</div>
                {stats.total_sessions > 0 && (
                  <div className="text-xs text-gray-400 mt-1">
                    共 {stats.total_sessions} 次练习
                  </div>
                )}
              </div>
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-5 shadow-sm text-center">
                <div className="text-3xl mb-1">🎯</div>
                <div className="text-2xl font-bold text-emerald-600">{stats.first_time_accuracy}%</div>
                <div className="text-sm text-gray-600">首次正确率</div>
                <div className="text-xs text-gray-400 mt-1">
                  第一次就答对
                </div>
              </div>
              <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-5 shadow-sm text-center">
                <div className="text-3xl mb-1">📈</div>
                <div className="text-2xl font-bold text-violet-600">
                  {stats.total_sessions > 0 ? Math.round(stats.perfect_sessions / stats.total_sessions * 100) : 0}%
                </div>
                <div className="text-sm text-gray-600">满分率</div>
                <div className="text-xs text-gray-400 mt-1">
                  满分/总练习
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 竞赛模式入口 */}
        <div
          className="mb-8"
        >
          <div
            onClick={() => navigate('/student/competition')}
            className="relative bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all cursor-pointer group overflow-hidden"
          >
            {/* 背景动画元素 */}
            <div className="absolute inset-0 bg-gradient-to-r from-yellow-400/20 to-transparent animate-pulse"></div>

            <div className="relative z-10 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-4xl">🏆</span>
                  <h3 className="text-2xl font-bold text-white">竞赛模式</h3>
                  <span className="px-3 py-1 bg-yellow-400 text-orange-900 text-xs font-bold rounded-full animate-bounce">
                    NEW
                  </span>
                </div>
                <p className="text-white/90 mb-3">
                  实时PK排名,边学边比赛!答题越快,得分越高!
                </p>
                <div className="flex items-center gap-4 text-sm text-white/80">
                  <span>🔥 连击系统</span>
                  <span>📊 实时排行</span>
                  <span>🎯 积分奖励</span>
                  <span>⚡ 成就徽章</span>
                </div>
              </div>

              <div className="hidden md:flex flex-col items-center gap-2 ml-6">
                <div className="bg-white/20 backdrop-blur-sm rounded-xl px-6 py-3 text-center">
                  <div className="text-3xl font-bold text-white">{onlineUsers}</div>
                  <div className="text-xs text-white/80">人在线</div>
                </div>
                <button className="px-6 py-2 bg-white text-orange-600 font-bold rounded-lg hover:bg-yellow-50 transition-colors group-hover:scale-110 transform">
                  立即挑战 →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 记忆曲线复习入口 */}
        <div className="mb-8">
          <div
            onClick={() => navigate('/student/memory-curve')}
            className="relative bg-gradient-to-r from-teal-500 via-cyan-500 to-blue-500 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all cursor-pointer group overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-teal-400/20 to-transparent animate-pulse"></div>

            <div className="relative z-10 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-4xl">🧠</span>
                  <h3 className="text-2xl font-bold text-white">记忆曲线</h3>
                  <span className="px-3 py-1 bg-white text-cyan-600 text-xs font-bold rounded-full">
                    NEW
                  </span>
                </div>
                <p className="text-white/90 mb-3">
                  基于艾宾浩斯遗忘曲线,科学安排复习时间,让记忆更持久!
                </p>
                <div className="flex items-center gap-4 text-sm text-white/80">
                  <span>📈 遗忘曲线</span>
                  <span>🔔 智能提醒</span>
                  <span>📅 复习计划</span>
                  <span>🎯 精准巩固</span>
                </div>
              </div>

              <div className="hidden md:flex flex-col items-center gap-2 ml-6">
                {reviewDueCount > 0 ? (
                  <>
                    <div className="bg-white/20 backdrop-blur-sm rounded-xl px-6 py-3 text-center">
                      <div className="text-3xl font-bold text-white">{reviewDueCount}</div>
                      <div className="text-xs text-white/80">待复习</div>
                    </div>
                    <button className="px-6 py-2 bg-white text-cyan-600 font-bold rounded-lg hover:bg-cyan-50 transition-colors group-hover:scale-110 transform">
                      立即复习 →
                    </button>
                  </>
                ) : (
                  <div className="bg-white/20 backdrop-blur-sm rounded-xl px-6 py-3 text-center">
                    <div className="text-2xl">📖</div>
                    <div className="text-xs text-white/80">学完单词后自动安排</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 阅读理解入口 */}
        <div
          className="mb-8"
        >
          <div
            onClick={() => navigate('/student/reading')}
            className="relative bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all cursor-pointer group overflow-hidden"
          >
            {/* 背景动画元素 */}
            <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 to-transparent animate-pulse"></div>

            <div className="relative z-10 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-4xl">📖</span>
                  <h3 className="text-2xl font-bold text-white">阅读理解</h3>
                  <span className="px-3 py-1 bg-white text-purple-600 text-xs font-bold rounded-full">
                    提升能力
                  </span>
                </div>
                <p className="text-white/90 mb-3">
                  精选英语文章,趣味阅读答题,全面提升阅读理解能力!
                </p>
                <div className="flex items-center gap-4 text-sm text-white/80">
                  <span>📚 精选文章</span>
                  <span>💡 重点词汇</span>
                  <span>❓ 多题型</span>
                  <span>🎯 自动判分</span>
                </div>
              </div>

              <div className="hidden md:flex flex-col items-center gap-2 ml-6">
                <div className="bg-white/20 backdrop-blur-sm rounded-xl px-6 py-3 text-center">
                  <div className="text-3xl font-bold text-white">--</div>
                  <div className="text-xs text-white/80">篇文章</div>
                </div>
                <button className="px-6 py-2 bg-white text-purple-600 font-bold rounded-lg hover:bg-purple-50 transition-colors group-hover:scale-110 transform">
                  开始阅读 →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 错题集入口 */}
        <div
          className="mb-8"
        >
          <div
            onClick={() => navigate('/student/mistake-book')}
            className="relative bg-gradient-to-r from-red-500 via-orange-500 to-yellow-500 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all cursor-pointer group overflow-hidden"
          >
            {/* 背景动画元素 */}
            <div className="absolute inset-0 bg-gradient-to-r from-red-400/20 to-transparent animate-pulse"></div>

            <div className="relative z-10 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-4xl">📕</span>
                  <h3 className="text-2xl font-bold text-white">我的错题集</h3>
                  <span className="px-3 py-1 bg-white text-red-600 text-xs font-bold rounded-full">
                    查漏补缺
                  </span>
                </div>
                <p className="text-white/90 mb-3">
                  自动整理答错的单词,针对性练习,快速攻克薄弱点!
                </p>
                <div className="flex items-center gap-4 text-sm text-white/80">
                  <span>🎯 智能排序</span>
                  <span>📊 统计分析</span>
                  <span>🔄 反复练习</span>
                  <span>✅ 掌握跟踪</span>
                </div>
              </div>

              <div className="hidden md:flex flex-col items-center gap-2 ml-6">
                <div className="bg-white/20 backdrop-blur-sm rounded-xl px-6 py-3 text-center">
                  <div className="text-3xl font-bold text-white">
                    {mistakeStats ? mistakeStats.unresolved_mistakes : '--'}
                  </div>
                  <div className="text-xs text-white/80">待攻克</div>
                </div>
                <button className="px-6 py-2 bg-white text-red-600 font-bold rounded-lg hover:bg-orange-50 transition-colors group-hover:scale-110 transform">
                  开始复习 →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 宠物小组件 */}
        <div className="mb-8">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>🎯</span> 快捷功能
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: '📝', title: '我的作业', desc: '老师分配的任务', route: '/student/assignments', color: 'from-indigo-400 to-blue-500' },
              { icon: '🧠', title: '记忆曲线', desc: '复习巩固', route: '/student/memory-curve', color: 'from-teal-400 to-cyan-500' },
              { icon: '🏆', title: '我的成就', desc: '查看成就徽章', route: '/student/achievements', color: 'from-yellow-400 to-orange-500' },
              { icon: '📊', title: '学习数据', desc: '统计与分析', route: '/student/analytics', color: 'from-blue-400 to-purple-500' },
              { icon: '🔥', title: '竞赛模式', desc: '实时PK排名', route: '/student/competition', color: 'from-red-400 to-pink-500' },
            ].map((action) => (
              <button
                key={action.title}
                onClick={() => navigate(action.route)}
                className="bg-white rounded-xl p-6 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all text-center group relative overflow-hidden"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${action.color} opacity-0 group-hover:opacity-10 transition-opacity`}></div>
                <div className="text-4xl mb-3 relative z-10">{action.icon}</div>
                <h4 className="font-bold text-gray-800 mb-1 relative z-10">{action.title}</h4>
                <p className="text-xs text-gray-500 relative z-10">{action.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 成就预览 */}
        <div
          className="bg-white rounded-2xl p-6 shadow-md"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span>🏆</span> 最近成就
            </h3>
            <button
              onClick={() => navigate('/student/achievements')}
              className="text-sm text-primary hover:text-secondary font-medium flex items-center gap-1 transition"
            >
              查看全部 →
            </button>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4 mb-4">
            {achievements.map((achievement) => (
              <div
                key={achievement.name}
                className={`text-center p-4 rounded-xl transition cursor-pointer hover:scale-105 ${
                  achievement.unlocked
                    ? 'bg-gradient-to-br from-yellow-100 to-orange-100'
                    : 'bg-gray-100 opacity-50'
                }`}
                onClick={() => navigate('/student/achievements')}
              >
                <div className="text-4xl mb-2">{achievement.icon}</div>
                <p className="text-xs font-medium text-gray-700">{achievement.name}</p>
              </div>
            ))}
          </div>
          <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-600">🎯 已解锁 {achievements.filter(a => a.unlocked).length} 个成就</span>
            <span className="text-gray-600">💎 总积分: {stats?.total_points || 0} 分</span>
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

export default StudentDashboard;
