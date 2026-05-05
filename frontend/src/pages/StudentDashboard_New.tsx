import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Reorder } from 'framer-motion';
import { API_BASE_URL } from '../config/env';
import { getStudentBooks } from '../api/progress';
import type { StudentBook } from '../api/progress';
import { getMistakeBookStats } from '../api/mistakeBook';
import { getReviewDueCount, getReviewDueWords } from '../api/memoryCurve';
import { getMyAchievements, type Achievement } from '../api/achievements';
import PetWidget from '../components/PetWidget';
import ChangePasswordModal from '../components/ChangePasswordModal';
import { BookGridSkeleton } from '../components/Skeleton';

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
  const [achievements, setAchievements] = useState<Achievement[]>([]);

  // 强制复习：本次会话未完成复习则拦截
  const forcedReviewDone = sessionStorage.getItem('forced_review_done') === 'true';
  const showForcedReview = !loading && !forcedReviewDone && reviewDueCount > 0;

  useEffect(() => {
    // 加载学生的单词本列表和统计数据
    loadBooks();
    loadStats();
    loadOnlineUsers();
    loadMistakeStats();
    loadReviewDueCount();
    loadAchievements();

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

  const loadAchievements = async () => {
    try {
      const data = await getMyAchievements();
      setAchievements(data.achievements || []);
    } catch (error) {
      console.error('加载成就失败:', error);
    }
  };

  const ownedBooks = useMemo(() => books.filter(b => b.owned), [books]);
  const unownedBooks = useMemo(() => books.filter(b => !b.owned), [books]);

  const BOOKSHELF_ORDER_KEY = 'bookshelf_order';
  // useState 而非 useMemo：拖拽事件也需要直接写入排序结果
  const [sortedOwnedBooks, setSortedOwnedBooks] = useState<StudentBook[]>([]);
  const [isEditingOrder, setIsEditingOrder] = useState(false);

  useEffect(() => {
    if (ownedBooks.length === 0) {
      setSortedOwnedBooks([]);
      return;
    }
    let savedOrder: number[] = [];
    try {
      const raw = localStorage.getItem(BOOKSHELF_ORDER_KEY);
      savedOrder = raw ? JSON.parse(raw) : [];
    } catch { /* ignore */ }
    if (savedOrder.length > 0) {
      const orderMap = new Map(savedOrder.map((id: number, i: number) => [id, i]));
      const sorted = [...ownedBooks].sort((a, b) =>
        (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity)
      );
      setSortedOwnedBooks(sorted);
    } else {
      setSortedOwnedBooks(ownedBooks);
    }
  }, [ownedBooks]);

  const handleReorder = (newOrder: StudentBook[]) => {
    setSortedOwnedBooks(newOrder);
    localStorage.setItem(BOOKSHELF_ORDER_KEY, JSON.stringify(newOrder.map(b => b.id)));
  };

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('forced_review_done');
    navigate('/login');
  };

  /**
   * 强制复习：拉随机打乱的到期词 → 塞 sessionStorage → 跳 classify 复习流程。
   * 仅完成流程后 WordClassifyLearning 才会写 forced_review_done = true，保证学生必须做完才能进主页。
   */
  const handleStartForcedReview = async () => {
    try {
      const words = await getReviewDueWords(20, true);
      if (!words.length) {
        sessionStorage.setItem('forced_review_done', 'true');
        return;
      }
      const wordData = words.map((w, index) => ({
        id: w.word_id,
        word: w.word,
        phonetic: w.phonetic || '',
        meaning: w.meaning || '',
        part_of_speech: w.part_of_speech || '',
        example_sentence: w.example_sentence || '',
        example_translation: w.example_translation || '',
        difficulty: w.difficulty,
        syllables: w.syllables || '',
        audio_url: '',
        image_url: '',
        tags: [],
        definitions: w.meaning ? [{
          id: 0,
          part_of_speech: w.part_of_speech || '',
          meaning: w.meaning,
          example_sentence: w.example_sentence || '',
          example_translation: w.example_translation || '',
          is_primary: true,
        }] : [],
        order_index: index,
      }));
      sessionStorage.setItem('review_practice_words', JSON.stringify(wordData));
      sessionStorage.setItem('is_review_practice', 'true');
      navigate('/student/units/0/classify');
    } catch (e) {
      console.error('启动强制复习失败:', e);
    }
  };

  const [showChangePassword, setShowChangePassword] = useState(false);

  const handleStartLearning = (bookId: number) => {
    navigate(`/student/books/${bookId}/units`);
  };

  // 取首页展示的成就（已解锁优先 + 兜底未解锁，最多 6 个）
  const previewAchievements = useMemo(() => {
    const unlocked = achievements.filter(a => a.unlocked);
    const locked = achievements.filter(a => !a.unlocked);
    return [...unlocked, ...locked].slice(0, 6);
  }, [achievements]);

  const unlockedCount = achievements.filter(a => a.unlocked).length;


  return (
    <div className="min-h-screen bg-paper">
      {/* 强制复习遮罩 */}
      {showForcedReview && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
            <div className="flex items-baseline gap-3 mb-4">
              <span className="font-display text-5xl font-semibold text-accent-warm font-numeric">{reviewDueCount}</span>
              <span className="text-ink-soft text-lg">个词等你回顾</span>
            </div>
            <h2 className="font-display text-2xl font-semibold text-ink mb-2">先复习再学习</h2>
            <p className="text-ink-soft text-sm mb-6 leading-relaxed">
              根据记忆曲线，这些单词正处在最容易遗忘的节点。现在花 5 分钟，记忆会更牢固。
            </p>
            <button
              onClick={handleStartForcedReview}
              className="w-full py-3.5 bg-accent-warm text-white rounded-xl text-base font-semibold hover:opacity-90 transition"
            >
              开始复习
            </button>
            <button
              onClick={handleLogout}
              className="w-full mt-3 text-sm text-ink-mute hover:text-ink-soft transition"
            >
              退出登录
            </button>
          </div>
        </div>
      )}

      {/* 顶部导航 */}
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex justify-between items-center">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-xl font-semibold text-ink tracking-tight">飞鹰</span>
            <span className="text-xs text-ink-mute">AI 英语</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-ink-soft mr-2">{user?.full_name || '同学'}</span>
            <button
              onClick={() => setShowChangePassword(true)}
              className="px-2.5 py-1 text-ink-soft hover:text-ink hover:bg-black/5 rounded-md transition"
            >
              密码
            </button>
            <button
              onClick={handleLogout}
              className="px-2.5 py-1 text-ink-soft hover:text-ink hover:bg-black/5 rounded-md transition"
            >
              退出
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-5 py-10">
        {/* Hero：今日核心任务（最重要的一件事） */}
        <section className="mb-12">
          <p className="text-ink-mute text-sm mb-2">
            👋 {user?.full_name || '同学'}
            {stats && stats.streak_days > 0 && (
              <> · 连续学习 <span className="font-numeric text-ink-soft">{stats.streak_days}</span> 天</>
            )}
          </p>
          {reviewDueCount > 0 ? (
            <>
              <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink leading-[1.05] tracking-tight mb-4">
                今天，先复习<br />
                <span className="font-numeric text-accent-warm">{Math.min(20, reviewDueCount)}</span>{' '}
                <span className="text-ink-soft">个该回顾的词</span>
              </h1>
              <p className="text-ink-soft text-base mb-6 max-w-xl leading-relaxed">
                根据艾宾浩斯曲线，这些是你现在最该温习的单词。预计花费 5 分钟。
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleStartForcedReview}
                  className="px-7 py-3.5 bg-accent-warm text-white rounded-xl text-base font-semibold hover:opacity-90 transition"
                >
                  开始复习 →
                </button>
                <button
                  onClick={() => navigate('/student/memory-curve')}
                  className="text-ink-soft hover:text-ink text-sm transition"
                >
                  查看完整复习计划
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink leading-[1.05] tracking-tight mb-4">
                今天没有待复习。<br />
                <span className="text-ink-soft">从书架挑一本继续吧。</span>
              </h1>
              <p className="text-ink-soft text-base max-w-xl leading-relaxed">
                完成新单元学习后，单词会自动进入复习计划。
              </p>
            </>
          )}
        </section>

        {/* 我的书架 */}
        <section className="mb-12">
          <header className="flex items-baseline justify-between mb-5">
            <h2 className="font-display text-xl font-semibold text-ink">我的书架</h2>
            {sortedOwnedBooks.length > 1 && !loading && (
              <button
                onClick={() => setIsEditingOrder(!isEditingOrder)}
                className={`text-sm transition ${
                  isEditingOrder
                    ? 'text-accent-warm font-semibold'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                {isEditingOrder ? '完成排序' : '调整顺序'}
              </button>
            )}
          </header>

          {loading ? (
            <BookGridSkeleton count={3} />
          ) : ownedBooks.length === 0 ? (
            <div className="py-16 text-center border border-dashed border-black/10 rounded-2xl">
              <p className="text-ink-soft mb-1">还没有书籍</p>
              <p className="text-ink-mute text-sm mb-5">请联系老师分配，或使用兑换码获取</p>
              <button
                onClick={() => navigate('/subscription/redeem')}
                className="px-5 py-2.5 bg-accent-warm text-white rounded-lg text-sm font-medium hover:opacity-90 transition"
              >
                输入兑换码
              </button>
            </div>
          ) : isEditingOrder ? (
            <Reorder.Group
              axis="y"
              values={sortedOwnedBooks}
              onReorder={handleReorder}
              className="space-y-2"
            >
              {sortedOwnedBooks.map((book) => {
                const coverIndex = (book.id % 4) + 1;
                return (
                  <Reorder.Item
                    key={book.id}
                    value={book}
                    className="bg-white rounded-xl px-4 py-3 border border-black/[0.06] flex items-center gap-4 cursor-grab active:cursor-grabbing"
                    whileDrag={{ scale: 1.01, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
                  >
                    <span className="text-ink-mute select-none">⋮⋮</span>
                    <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-black/5">
                      <img src={book.cover_url || `/book-cover-${coverIndex}.jpeg`} alt={book.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-ink truncate">{book.name}</h3>
                      <p className="text-xs text-ink-mute font-numeric">{book.unit_count} 单元 · {book.word_count} 词</p>
                    </div>
                    <span className="text-sm font-numeric font-semibold text-accent-warm">{book.progress_percentage.toFixed(0)}%</span>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {sortedOwnedBooks.map((book) => {
                const coverIndex = (book.id % 4) + 1;
                return (
                  <article
                    key={book.id}
                    className="bg-white rounded-2xl overflow-hidden border border-black/[0.05] hover:border-black/15 transition cursor-pointer flex flex-col"
                    onClick={() => handleStartLearning(book.id)}
                  >
                    <div className="relative h-36 overflow-hidden bg-black/5">
                      <img
                        src={book.cover_url || `/book-cover-${coverIndex}.jpeg`}
                        alt={book.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-4 flex-1 flex flex-col">
                      <h3 className="font-display text-base font-semibold text-ink mb-1.5 line-clamp-1">{book.name}</h3>
                      <p className="text-xs text-ink-mute font-numeric mb-3">
                        {book.unit_count} 单元 · {book.word_count} 词
                        {book.grade_level && <span className="ml-1.5 text-ink-soft">· {book.grade_level}</span>}
                        {book.volume && <span className="text-ink-soft"> {book.volume}</span>}
                      </p>
                      <div className="mt-auto">
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-xs text-ink-soft">学习进度</span>
                          <span className="text-sm font-numeric font-semibold text-ink">{book.progress_percentage.toFixed(0)}%</span>
                        </div>
                        <div className="w-full h-1 bg-black/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent-warm rounded-full transition-all"
                            style={{ width: `${book.progress_percentage}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {unownedBooks.length > 0 && !loading && (
            <>
              <header className="flex items-baseline justify-between mt-10 mb-5">
                <h2 className="font-display text-xl font-semibold text-ink">更多书籍</h2>
                <span className="text-xs text-ink-mute">需兑换码解锁</span>
              </header>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {unownedBooks.map((book) => {
                  const coverIndex = (book.id % 4) + 1;
                  return (
                    <article
                      key={book.id}
                      className="rounded-2xl overflow-hidden border border-black/[0.05] hover:border-black/15 transition cursor-pointer flex flex-col bg-white opacity-75 hover:opacity-100"
                      onClick={() => navigate('/subscription/redeem')}
                    >
                      <div className="relative h-32 overflow-hidden bg-black/5">
                        <img src={book.cover_url || `/book-cover-${coverIndex}.jpeg`} alt={book.name} className="w-full h-full object-cover grayscale" />
                        <div className="absolute inset-0 bg-black/30" />
                      </div>
                      <div className="p-4">
                        <h3 className="font-display text-base font-semibold text-ink mb-1.5 line-clamp-1">{book.name}</h3>
                        <p className="text-xs text-ink-mute font-numeric mb-3">
                          {book.unit_count} 单元 · {book.word_count} 词
                        </p>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate('/subscription/redeem'); }}
                          className="w-full py-2 border border-black/15 text-ink rounded-lg text-sm font-medium hover:bg-black/5 transition"
                        >
                          输入兑换码
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* 错题提醒 — 只在有错题时显示，做成内联条带不打扰 */}
        {mistakeStats && mistakeStats.unresolved_mistakes > 0 && (
          <button
            onClick={() => navigate('/student/mistake-book')}
            className="w-full mb-10 px-5 py-4 border-l-2 border-accent-warm bg-white hover:bg-black/[0.02] transition flex items-center justify-between text-left rounded-r-md"
          >
            <div>
              <p className="font-medium text-ink">有 <span className="font-numeric text-accent-warm">{mistakeStats.unresolved_mistakes}</span> 个错题待处理</p>
              <p className="text-xs text-ink-mute mt-0.5">及时复习薄弱知识点</p>
            </div>
            <span className="text-ink-soft text-sm">去处理 →</span>
          </button>
        )}

        {/* 宠物 */}
        <section className="mb-12">
          <PetWidget />
        </section>

        {/* 功能磁贴 — 等权重，去渐变，去 hero 化 */}
        <section className="mb-12">
          <header className="flex items-baseline justify-between mb-5">
            <h2 className="font-display text-xl font-semibold text-ink">学习工具</h2>
          </header>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              { title: '记忆曲线', desc: '科学复习', route: '/student/memory-curve', metric: reviewDueCount > 0 ? Math.min(20, reviewDueCount) : null, metricLabel: '待复习' },
              { title: '错题集', desc: '查漏补缺', route: '/student/mistake-book', metric: mistakeStats?.unresolved_mistakes || null, metricLabel: '待攻克' },
              { title: '我的作业', desc: '老师分配', route: '/student/assignments' },
              { title: '阅读理解', desc: '提升能力', route: '/student/reading' },
              { title: '竞赛模式', desc: '实时 PK', route: '/student/competition', metric: onlineUsers, metricLabel: '在线' },
              { title: '我的成就', desc: '徽章收藏', route: '/student/achievements' },
              { title: '学习数据', desc: '统计分析', route: '/student/analytics' },
            ].map((tile) => (
              <button
                key={tile.title}
                onClick={() => navigate(tile.route)}
                className="text-left bg-white rounded-xl p-4 border border-black/[0.05] hover:border-black/15 hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-display text-base font-semibold text-ink">{tile.title}</h3>
                  {tile.metric != null && tile.metric > 0 && (
                    <span className="font-numeric text-sm font-semibold text-accent-warm">{tile.metric}</span>
                  )}
                </div>
                <p className="text-xs text-ink-mute">
                  {tile.metric != null && tile.metric > 0 && tile.metricLabel ? `${tile.metricLabel} · ` : ''}{tile.desc}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* 学习概览 — 数据条带式，紧凑 */}
        <section className="mb-12">
          <header className="flex items-baseline justify-between mb-5">
            <h2 className="font-display text-xl font-semibold text-ink">学习概览</h2>
            <button
              onClick={() => navigate('/student/analytics')}
              className="text-sm text-ink-soft hover:text-ink transition"
            >
              详细数据 →
            </button>
          </header>
          <div className="bg-white rounded-2xl border border-black/[0.05] divide-y divide-black/[0.05]">
            {[
              { label: '已学单词', value: stats?.total_words_studied || 0, suffix: stats?.today_words ? `今日 +${stats.today_words}` : '' },
              { label: '已掌握', value: stats?.mastered_words || 0, suffix: `${stats?.mastery_rate || 0}% 掌握率` },
              { label: '连续打卡', value: stats?.streak_days || 0, suffix: '天' },
              { label: '学习时长', value: stats?.total_minutes || 0, suffix: '分钟' },
            ].map((row) => (
              <div key={row.label} className="px-5 py-4 flex items-baseline justify-between">
                <span className="text-ink-soft text-sm">{row.label}</span>
                <div className="flex items-baseline gap-2">
                  <span className="font-display font-semibold text-2xl text-ink font-numeric">{row.value}</span>
                  {row.suffix && <span className="text-xs text-ink-mute">{row.suffix}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 学习质量 — 仅在有数据时出现 */}
        {stats && stats.total_sessions > 0 && (
          <section className="mb-12">
            <header className="mb-5">
              <h2 className="font-display text-xl font-semibold text-ink">学习质量</h2>
            </header>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-black/[0.05] p-5">
                <p className="text-xs text-ink-mute mb-1.5">满分轮次</p>
                <p className="font-display text-3xl font-semibold text-ink font-numeric">{stats.perfect_sessions}</p>
                <p className="text-[11px] text-ink-mute mt-1">共 {stats.total_sessions} 次完整轮</p>
              </div>
              <div className="bg-white rounded-xl border border-black/[0.05] p-5">
                <p className="text-xs text-ink-mute mb-1.5">首次正确率</p>
                <p className="font-display text-3xl font-semibold text-ink font-numeric">{stats.first_time_accuracy}<span className="text-base text-ink-soft">%</span></p>
                <p className="text-[11px] text-ink-mute mt-1">第一次就答对</p>
              </div>
              <div className="bg-white rounded-xl border border-black/[0.05] p-5">
                <p className="text-xs text-ink-mute mb-1.5">满分率</p>
                <p className="font-display text-3xl font-semibold text-ink font-numeric">
                  {Math.round(stats.perfect_sessions / stats.total_sessions * 100)}<span className="text-base text-ink-soft">%</span>
                </p>
                <p className="text-[11px] text-ink-mute mt-1">满分 / 总练习</p>
              </div>
            </div>
          </section>
        )}

        {/* 成就预览 — 紧凑（仅在有成就数据时显示） */}
        {achievements.length > 0 && (
          <section className="mb-12">
            <header className="flex items-baseline justify-between mb-5">
              <h2 className="font-display text-xl font-semibold text-ink">最近成就</h2>
              <button
                onClick={() => navigate('/student/achievements')}
                className="text-sm text-ink-soft hover:text-ink transition"
              >
                查看全部 →
              </button>
            </header>
            <div className="bg-white rounded-2xl border border-black/[0.05] p-5">
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
                {previewAchievements.map((achievement) => (
                  <button
                    key={achievement.id}
                    onClick={() => navigate('/student/achievements')}
                    className={`text-center p-3 rounded-lg transition ${
                      achievement.unlocked
                        ? 'hover:bg-black/[0.04]'
                        : 'opacity-40'
                    }`}
                    title={achievement.description || achievement.name}
                  >
                    <div className="text-3xl mb-1.5">{achievement.icon || '🏆'}</div>
                    <p className="text-[11px] text-ink-soft truncate">{achievement.name}</p>
                  </button>
                ))}
              </div>
              <div className="pt-4 border-t border-black/[0.05] flex items-center justify-between text-sm">
                <span className="text-ink-soft">已解锁 <span className="font-numeric font-semibold text-ink">{unlockedCount}</span> / {achievements.length} 个成就</span>
                <span className="text-ink-soft">总积分 <span className="font-numeric font-semibold text-ink">{stats?.total_points || 0}</span></span>
              </div>
            </div>
          </section>
        )}
      </div>

      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </div>
  );
};

export default StudentDashboard;
