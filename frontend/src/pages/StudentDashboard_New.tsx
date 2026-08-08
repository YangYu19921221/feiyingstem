import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Reorder } from 'framer-motion';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { API_BASE_URL } from '../config/env';
import { getStudentBooks } from '../api/progress';
import type { StudentBook } from '../api/progress';
import { getMistakeBookStats } from '../api/mistakeBook';
import { getReviewDueCount, getReviewDueWords } from '../api/memoryCurve';
import { getMyAchievements, type Achievement } from '../api/achievements';
import { getMyHomework, startHomework, type StudentHomeworkResponse } from '../api/homework';
import { formatOpenDay } from '../utils/openDay';
import { toast } from '../components/Toast';
import PetWidget from '../components/PetWidget';
import MyCoinsCard from '../components/MyCoinsCard';
import RankingBanner from '../components/leaderboard/RankingBanner';
import ChangePasswordModal from '../components/ChangePasswordModal';
import ChangeUsernameModal from '../components/ChangeUsernameModal';
import { BookGridSkeleton } from '../components/Skeleton';
import { AchievementIcon } from '../components/AchievementIcon';
import { BarChart3, BookOpenText, Check, ChevronDown, Hand, KeyRound, LogOut, MapPin, PencilLine, Search, Settings2, Volume2, Wifi } from 'lucide-react';
import { pendingCount, flushQueue } from '../api/submitQueue';

gsap.registerPlugin(useGSAP);

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
  const pageRef = useRef<HTMLDivElement>(null);

  // 直接从 localStorage 初始化用户数据,避免闪烁
  const [user, setUser] = useState<UserData | null>(() => {
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
  const [pendingHomeworkCount, setPendingHomeworkCount] = useState<number>(0);
  const [pendingSync, setPendingSync] = useState<number>(0);  // 本机未上传的学习记录数
  // 老师布置的待办任务(待开始/进行中),显示在 Hero 下方
  const [pendingTasks, setPendingTasks] = useState<StudentHomeworkResponse[]>([]);
  // 每日签到:未签到时置顶大卡引导,签到后小徽章
  const [checkin, setCheckin] = useState<{ checked_in: boolean; checkin_time: string | null } | null>(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [showAllOwnedBooks, setShowAllOwnedBooks] = useState(false);
  const [showMoreBooks, setShowMoreBooks] = useState(false);
  const [showAllQuickTools, setShowAllQuickTools] = useState(false);
  const [showLearningDetails, setShowLearningDetails] = useState(false);

  const loadCheckin = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const r = await axios.get(`${API_BASE_URL}/student/checkin/today`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCheckin(r.data);
    } catch { /* 静默 */ }
  };

  const handleCheckin = async () => {
    if (checkinBusy) return;
    setCheckinBusy(true);
    try {
      const token = localStorage.getItem('access_token');
      const r = await axios.post(`${API_BASE_URL}/student/checkin`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCheckin({ checked_in: true, checkin_time: r.data.checkin_time });
    } catch (e) {
      console.error('签到失败:', e);
    } finally {
      setCheckinBusy(false);
    }
  };


  useEffect(() => {
    // 加载学生的单词本列表和统计数据
    loadBooks();
    loadStats();
    loadOnlineUsers();
    loadMistakeStats();
    loadReviewDueCount();
    loadAchievements();
    loadPendingHomework();
    loadCheckin();
    const interval = setInterval(loadOnlineUsers, 30000);
    // 老师布置的任务近实时:60 秒轮询 + 切回页面立即刷(布置作业后学生开着仪表盘也能看到)
    const hwInterval = setInterval(() => {
      if (!document.hidden) loadPendingHomework();
    }, 60000);
    const onVisible = () => {
      if (!document.hidden) { loadPendingHomework(); refreshPendingSync(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    // 未上传学习记录:进页刷一次 + 每 10 秒刷(补交成功后数字会自动降到 0)
    const refreshPendingSync = () => { void flushQueue().finally(() => setPendingSync(pendingCount())); };
    refreshPendingSync();
    const syncInterval = setInterval(refreshPendingSync, 10000);
    return () => {
      clearInterval(interval);
      clearInterval(hwInterval);
      clearInterval(syncInterval);
      document.removeEventListener('visibilitychange', onVisible);
    };
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

  const loadPendingHomework = async () => {
    try {
      const data = await getMyHomework();
      const undone = data.filter((h) =>
        h.status !== 'completed' && h.status !== 'graded' && h.status !== 'failed',
      );
      // 红点/「去完成」数字只算**现在能做的**,否则显示 2 却一个都点不动。
      // 但任务卡要把未开放的也列出来(带🔒标明哪天开放)—— 老师排好了后面几天,
      // 首页藏起来学生就完全不知道有这回事(全是未开放任务时首页会空成一片)。
      setPendingHomeworkCount(undone.filter((h) => !h.is_locked).length);
      // 排序:能做的在前(逾期/快到期优先),未开放的按开放日排在后面
      const sorted = [...undone].sort((a, b) => {
        if (!!a.is_locked !== !!b.is_locked) return a.is_locked ? 1 : -1;
        if (a.is_locked && b.is_locked) {
          const oa = a.available_from ? new Date(a.available_from).getTime() : Infinity;
          const ob = b.available_from ? new Date(b.available_from).getTime() : Infinity;
          return oa - ob;
        }
        const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const db_ = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        return da - db_;
      });
      setPendingTasks(sorted);
    } catch (error) {
      console.error('加载作业失败:', error);
    }
  };

  const handleStartTask = async (task: StudentHomeworkResponse) => {
    try {
      const result = await startHomework(task.id);
      navigate(`/student/units/${result.unit_id}/${result.learning_mode}`, {
        state: { fromHomework: true, assignmentId: task.id },
      });
    } catch (error: any) {
      console.error('开始作业失败:', error);
    }
  };

  const ownedBooks = useMemo(() => books.filter(b => b.owned), [books]);
  const unownedBooks = useMemo(() => books.filter(b => !b.owned), [books]);
  const resumeBook = useMemo(
    () => ownedBooks.find((book) => book.progress_percentage > 0 && book.progress_percentage < 100),
    [ownedBooks],
  );

  const BOOKSHELF_ORDER_KEY = 'bookshelf_order';
  // useState 而非 useMemo：拖拽事件也需要直接写入排序结果
  const [sortedOwnedBooks, setSortedOwnedBooks] = useState<StudentBook[]>([]);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  // 书架搜索：按书名筛选(忽略大小写、去首尾空格)
  const [bookQuery, setBookQuery] = useState('');
  // 教材版本筛选(书架 chips):''=全部
  const [shelfSeries, setShelfSeries] = useState<string>('');
  const displayedBooks = useMemo(() => {
    const q = bookQuery.trim().toLowerCase();
    let list = sortedOwnedBooks;
    if (shelfSeries) list = list.filter(b => b.series === shelfSeries);
    if (!q) return list;
    return list.filter(b => b.name.toLowerCase().includes(q));
  }, [sortedOwnedBooks, bookQuery, shelfSeries]);
  const isShelfFiltered = Boolean(bookQuery.trim() || shelfSeries);
  const visibleOwnedBooks = !isShelfFiltered && !showAllOwnedBooks
    ? displayedBooks.slice(0, 3)
    : displayedBooks;

  // 书架上实际存在的版本(有两种以上才显示 chips,单一版本没有筛选意义)
  const shelfSeriesOptions = useMemo(() => {
    const set = new Set<string>();
    sortedOwnedBooks.forEach(b => { if (b.series) set.add(b.series); });
    return Array.from(set);
  }, [sortedOwnedBooks]);

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
    navigate('/login');
  };

  /**
   * 启动一次复习：拉随机打乱的到期词 → 塞 sessionStorage → 跳 classify 复习流程。
   */
  const handleStartReview = async () => {
    try {
      const words = await getReviewDueWords(20, true);
      if (!words.length) {
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
      console.error('启动复习失败:', e);
    }
  };

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showChangeUsername, setShowChangeUsername] = useState(false);

  const handleStartLearning = (bookId: number) => {
    navigate(`/student/books/${bookId}/units`);
  };

  const handleBookCoverError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const fallback = '/book-cover-1.jpeg';
    if (image.src.endsWith(fallback)) {
      image.classList.add('hidden');
      return;
    }
    image.src = fallback;
  };

  // 取首页展示的成就（已解锁优先 + 兜底未解锁，最多 6 个）
  const previewAchievements = useMemo(() => {
    const unlocked = achievements.filter(a => a.unlocked);
    const locked = achievements.filter(a => !a.unlocked);
    return [...unlocked, ...locked].slice(0, 6);
  }, [achievements]);

  const unlockedCount = achievements.filter(a => a.unlocked).length;

  // 飞鹰状态：跟随今日学习节奏，给学生情感反馈
  // - alert 警觉：有待复习
  // - soaring 翱翔：有书架且全部 100% 完成（毕业感）
  // - studying 苦读：有书架，且至少一本进度 0~100%（学习中）
  // - idle 睡觉：默认（无书 / 全 0%）
  const eagleState: 'idle' | 'alert' | 'studying' | 'soaring' = useMemo(() => {
    if (reviewDueCount > 0) return 'alert';
    if (ownedBooks.length === 0) return 'idle';
    const allDone = ownedBooks.every(b => b.progress_percentage >= 100);
    if (allDone) return 'soaring';
    const anyInProgress = ownedBooks.some(b => b.progress_percentage > 0);
    return anyInProgress ? 'studying' : 'idle';
  }, [reviewDueCount, ownedBooks]);

  const quickTools = [
    { title: '纸笔听写', desc: '纸上手写，拍照 AI 批改', route: '/student/handwriting', image: '/hero-memory.jpeg' },
    { title: '句子背诵', desc: '听写 + 翻译两种练法', route: '/student/sentences', image: '/hero-memory.jpeg' },
    { title: '加入班级', desc: '输入老师给的邀请码', route: '/student/join-class', image: '/dashboard-banner.jpeg' },
    { title: '光荣榜', desc: '看看本周学习进展', route: '/student/leaderboard', image: '/result-champion.jpeg' },
    { title: '阅读理解', desc: '通过短篇阅读积累语感', route: '/student/reading', image: '/hero-reading.jpeg' },
    { title: '竞赛模式', desc: '实时 PK', route: '/student/competition', image: '/hero-competition.jpeg', metric: onlineUsers, metricLabel: '在线' },
    { title: '我的成就', desc: '查看已解锁徽章', route: '/student/achievements', image: '/fx-achievement.jpeg' },
    { title: '学习数据', desc: '查看学习趋势和掌握情况', route: '/student/analytics', image: '/hero-exam-result.jpeg' },
    { title: 'PK 竞技场', desc: '和同班同学实时对战', route: '/pk/lobby', image: '/hero-challenge.jpeg' },
  ];
  const visibleQuickTools = showAllQuickTools ? quickTools : quickTools.slice(0, 4);

  useGSAP(() => {
    const root = pageRef.current;
    if (!root) return;

    const targets = root.querySelectorAll<HTMLElement>('[data-dashboard-reveal]');
    const media = gsap.matchMedia();
    media.add(
      { reduceMotion: '(prefers-reduced-motion: reduce)' },
      (context) => {
        if (context.conditions?.reduceMotion) return;
        gsap.from(targets, {
          autoAlpha: 0,
          y: 16,
          duration: 0.45,
          stagger: 0.07,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        });
      },
    );

    return () => media.revert();
  }, { scope: pageRef });


  return (
    <div ref={pageRef} className="min-h-screen bg-paper text-slate-800">
      {/* 顶部导航 */}
      <nav className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8 2xl:max-w-[1440px]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><BookOpenText className="h-5 w-5" /></div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-slate-800">飞鹰学习中心</h1>
              <p className="truncate text-xs text-slate-500">今天也一起进步</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="hidden min-h-11 items-center gap-2 rounded-xl bg-slate-50 px-3 text-sm sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="max-w-[10rem] truncate">{user?.full_name || user?.username || '同学'}</span>
            </div>
            <button type="button" onClick={() => setShowChangeUsername(true)} className="hidden h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 sm:flex" title="修改用户名" aria-label="修改用户名"><PencilLine className="h-4 w-4" /></button>
            <button type="button" onClick={() => setShowChangePassword(true)} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100" title="修改密码" aria-label="修改密码"><Settings2 className="h-4 w-4" /></button>
            <button type="button" onClick={handleLogout} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100" title="退出登录" aria-label="退出登录"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8 2xl:max-w-[1440px]">
        {/* 未上传学习记录提醒:本机还有数据没传成功时,提醒别换设备/关页,保持联网等它传完 */}
        {pendingSync > 0 && (
          <div className="flex flex-col items-stretch gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center">
            <Wifi className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              还有 <b>{pendingSync}</b> 条学习记录正在上传中,请保持联网、暂时别换设备或关闭页面,以免这部分学习数据丢失。
            </span>
            <button
              onClick={() => { void flushQueue().finally(() => setPendingSync(pendingCount())); }}
              className="min-h-11 shrink-0 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-white transition hover:bg-amber-600"
            >
              立即上传
            </button>
          </div>
        )}
        {/* 每日签到:未签到时置顶引导(签到才能开始学习);已签到显示小徽章 */}
        {checkin && !checkin.checked_in && (
          <section className="mb-5 sm:mb-7">
            <div className="student-colorful-surface flex flex-col items-stretch gap-4 rounded-2xl border border-orange-200 p-4 sm:flex-row sm:items-center sm:p-5">
              <div className="flex min-w-0 flex-1 items-start gap-3 text-left">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-accent-warm">
                  <Hand className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                <h2 className="font-display text-lg font-semibold text-ink sm:text-xl">
                  今天还没签到
                </h2>
                <p className="mt-1 text-sm text-ink-soft">
                  签到后再开始今天的学习，老师也能看到你的记录。
                </p>
                </div>
              </div>
              <button
                onClick={handleCheckin}
                disabled={checkinBusy}
                className="btn-glow inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-60"
              >
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {checkinBusy ? '签到中…' : '立即签到'}
              </button>
            </div>
          </section>
        )}
        {checkin?.checked_in && (
          <div className="mb-6 -mt-4 flex justify-end">
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-green-50 px-3 text-xs font-medium text-green-700">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              今日已签到 {checkin.checkin_time && `· ${checkin.checkin_time}`}
            </span>
          </div>
        )}

        {/* Hero：今日核心任务 + 飞鹰陪伴 */}
        <section data-dashboard-reveal className="student-colorful-surface mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 overflow-hidden rounded-2xl border border-orange-100 p-4 shadow-md sm:mb-8 sm:gap-8 sm:p-7 md:gap-10">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-medium text-slate-500 sm:text-sm">
              你好，{user?.full_name || user?.username || '同学'}
              {stats && stats.streak_days > 0 && (
                <> · 连续学习 <span className="font-numeric text-ink-soft">{stats.streak_days}</span> 天</>
              )}
            </p>
            {reviewDueCount > 0 ? (
              <>
                <h1 className="font-display mb-3 text-2xl font-semibold leading-[1.08] tracking-tight text-slate-800 sm:mb-4 sm:text-3xl md:text-5xl">
                  今天，先复习<span className="hidden sm:inline"><br /></span>{' '}
                  <span className="font-numeric text-accent-warm text-glow-warm">{Math.min(20, reviewDueCount)}</span>{' '}
                  <span className="text-ink-soft">个该回顾的词</span>
                </h1>
                <p className="text-ink-soft mb-4 max-w-xl text-sm leading-relaxed sm:mb-6 sm:text-base">
                  根据艾宾浩斯曲线，这些是你现在最该温习的单词。预计花费 5 分钟。
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleStartReview}
                    className="px-7 py-3.5 btn-glow text-white rounded-xl text-base font-semibold"
                  >
                    开始复习 →
                  </button>
                  <button
                    onClick={() => navigate('/student/memory-curve')}
                    className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-ink-soft transition hover:bg-orange-50 hover:text-ink"
                  >
                    查看完整复习计划
                  </button>
                </div>
              </>
            ) : eagleState === 'soaring' ? (
              <>
                <h1 className="font-display mb-3 text-2xl font-semibold leading-[1.08] tracking-tight text-ink sm:mb-4 sm:text-4xl md:text-5xl">
                  全部完成。<span className="hidden sm:inline"><br /></span>{' '}
                  <span className="text-slate-600">了不起。</span>
                </h1>
                <p className="text-ink-soft max-w-xl text-sm leading-relaxed sm:text-base">
                  今天的任务都做完了，明天再来。
                </p>
              </>
            ) : eagleState === 'studying' ? (
              <>
                <h1 className="font-display mb-3 text-2xl font-semibold leading-[1.08] tracking-tight text-slate-800 sm:mb-4 sm:text-3xl md:text-5xl">
                  继续上次的进度<span className="hidden sm:inline"><br /></span>{' '}
                  <span className="text-slate-600">从书架挑一本</span>
                </h1>
                <p className="text-ink-soft max-w-xl text-sm leading-relaxed sm:text-base">
                  你正在学习中。完成单元后，单词会自动进入复习计划。
                </p>
                {resumeBook && (
                  <button
                    type="button"
                    onClick={() => handleStartLearning(resumeBook.id)}
                    className="btn-glow mt-5 inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white"
                  >
                    继续学习「{resumeBook.name}」→
                  </button>
                )}
              </>
            ) : (
              <>
                <h1 className="font-display mb-3 text-2xl font-semibold leading-[1.08] tracking-tight text-slate-800 sm:mb-4 sm:text-3xl md:text-5xl">
                  开始第一本<span className="hidden sm:inline"><br /></span>{' '}
                  <span className="text-slate-600">单词本吧</span>
                </h1>
                <p className="text-ink-soft mb-4 max-w-xl text-sm leading-relaxed sm:text-base">
                  从书架挑一本，每天 20 分钟，三个月看到变化。
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/subscription/redeem')}
                  className="btn-glow rounded-lg px-4 py-2 text-sm font-semibold text-white sm:rounded-xl sm:px-5 sm:py-2.5"
                >
                  获取第一本教材 →
                </button>
              </>
            )}
          </div>
          {/* 飞鹰陪伴：根据学习状态切换 */}
          <img
            key={eagleState}
            src={`/eagle-${eagleState}.jpeg`}
            alt=""
            className="h-20 w-20 justify-self-end rounded-xl object-cover select-none sm:h-32 sm:w-32 sm:rounded-2xl md:h-44 md:w-44"
            style={{ animation: 'fadeIn 0.4s ease-out' }}
            loading="lazy"
          />
        </section>

        {/* 我的金币 — 放在今日任务之后，保留奖励感但不抢先学习任务的注意力 */}
        <section data-dashboard-reveal className="mb-5 sm:mb-8">
          <MyCoinsCard />
        </section>

        {/* 老师布置的任务:一登录就看到今天要做什么(最多3条,更多去「我的作业」) */}
        {pendingTasks.length > 0 && (
          <section className="mb-10">
            <div className="rounded-2xl border-2 border-accent-warm/40 bg-accent-warm/[0.06] overflow-hidden">
              <div className="px-5 py-3 flex items-center gap-2 border-b border-accent-warm/20">
                <span className="text-lg">📣</span>
                <h3 className="font-semibold text-ink text-sm">老师布置的任务</h3>
                {/* 徽章只数今天能做的(= pendingHomeworkCount);未开放的另标,
                    否则"3"里混着做不了的,孩子会以为自己漏做 */}
                {pendingHomeworkCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-accent-warm text-white text-[11px] font-numeric font-semibold">
                    {pendingHomeworkCount}
                  </span>
                )}
                {pendingTasks.length > pendingHomeworkCount && (
                  <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[11px] font-numeric font-semibold">
                    🔒{pendingTasks.length - pendingHomeworkCount}
                  </span>
                )}
                {pendingTasks.length > 3 && (
                  <button
                    onClick={() => navigate('/student/homework')}
                    className="ml-auto text-xs text-accent-warm hover:opacity-80"
                  >
                    查看全部 →
                  </button>
                )}
              </div>
              <div className="divide-y divide-accent-warm/10">
                {pendingTasks.slice(0, 3).map((task) => {
                  const overdue = task.deadline && new Date(task.deadline) < new Date();
                  // 未开放的任务:列出来让学生知道后面几天要练什么,但点不动
                  const locked = !!task.is_locked;
                  const openDay = formatOpenDay(task.available_from);
                  return (
                    <div key={task.id} className={`px-5 py-3.5 flex items-center gap-3 ${locked ? 'opacity-70' : ''}`}>
                      <span className="text-xl shrink-0">{locked ? '🔒' : '📘'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-ink text-sm truncate">{task.title}</p>
                        <p className="text-xs text-ink-mute mt-0.5 truncate">
                          {task.book_name} · {task.unit_name} · 目标 {task.target_score} 分
                          {task.attempts_count > 0 && (
                            <span className="text-accent-warm font-medium">
                              {' '}· 最好 {task.best_score} 分,差 {Math.max(0, task.target_score - task.best_score)} 分达标(剩 {Math.max(0, task.max_attempts - task.attempts_count)} 次)
                            </span>
                          )}
                          {locked ? (
                            <span className="font-semibold text-slate-500">{' '}· {openDay}开放</span>
                          ) : task.deadline && (
                            <span className={overdue ? 'text-red-500 font-semibold' : ''}>
                              {' '}· {overdue ? '已逾期!' : `截止 ${new Date(task.deadline).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`}
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => locked
                          ? toast.info(`这是${openDay}的任务，${openDay}才能开始做哦`)
                          : handleStartTask(task)}
                        className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition active:scale-95 ${
                          locked
                            ? 'cursor-not-allowed bg-black/[0.06] text-ink-mute'
                            : overdue ? 'bg-red-500 text-white hover:opacity-90' : 'btn-glow text-white'
                        }`}
                      >
                        {locked
                          ? `${openDay}开放`
                          : task.attempts_count > 0 ? '再战一次 →' : task.status === 'in_progress' ? '继续 →' : '去完成 →'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* 光荣榜入口横幅 — 一进首页就看到「上榜」钩子 */}
        <div data-dashboard-reveal className="hidden md:block">
          <RankingBanner />
        </div>

        {/* 我的书架 */}
        <section className="mb-9 sm:mb-12">
          <header className="mb-4 flex items-baseline justify-between sm:mb-5">
            <h2 className="font-display text-xl font-semibold text-ink">我的书架</h2>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => navigate('/subscription/redeem')}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 text-xs font-semibold text-accent-warm transition hover:bg-orange-100 sm:px-3 sm:text-sm"
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                兑换教材
              </button>
              {sortedOwnedBooks.length > 1 && !loading && (
                <button
                  type="button"
                  onClick={() => setIsEditingOrder(!isEditingOrder)}
                  className={`min-h-11 rounded-lg px-2.5 text-xs transition sm:px-3 sm:text-sm ${
                    isEditingOrder
                      ? 'bg-orange-50 text-accent-warm font-semibold'
                      : 'text-ink-soft hover:bg-black/[0.04] hover:text-ink'
                  }`}
                >
                  {isEditingOrder ? '完成排序' : '调整顺序'}
                </button>
              )}
            </div>
          </header>

          {/* 书架搜索：书多时按书名快速筛选(排序模式下隐藏) */}
          {!loading && !isEditingOrder && sortedOwnedBooks.length > 3 && (
            <div className="relative mb-5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
              <input
                type="text"
                value={bookQuery}
                onChange={(e) => setBookQuery(e.target.value)}
                placeholder="搜索书名"
                className="w-full sm:max-w-xs pl-9 pr-9 py-2 rounded-xl border border-black/[0.08] bg-white text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:ring-2 focus:ring-accent-warm/40"
              />
              {bookQuery && (
                <button
                  type="button"
                  onClick={() => setBookQuery('')}
                  className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-sm text-ink-mute transition hover:bg-orange-50 hover:text-ink"
                  aria-label="清除搜索"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* 教材版本筛选 chips:书架上有两种以上版本才显示(单一版本没有筛选意义) */}
          {!loading && !isEditingOrder && shelfSeriesOptions.length >= 2 && (
            <div className="flex items-center gap-1.5 mb-5 flex-wrap">
              <button
                type="button"
                onClick={() => setShelfSeries('')}
                className={`min-h-11 rounded-full px-4 py-2 text-xs font-medium transition ${
                  shelfSeries === '' ? 'bg-accent-warm text-white' : 'bg-black/5 text-ink-soft hover:bg-black/10'
                }`}
              >
                全部
              </button>
              {shelfSeriesOptions.map(sn => (
                <button
                  type="button"
                  key={sn}
                  onClick={() => setShelfSeries(shelfSeries === sn ? '' : sn)}
                  className={`min-h-11 rounded-full px-4 py-2 text-xs font-medium transition ${
                    shelfSeries === sn ? 'bg-accent-warm text-white' : 'bg-black/5 text-ink-soft hover:bg-black/10'
                  }`}
                >
                  {sn}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <BookGridSkeleton count={3} />
          ) : ownedBooks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-orange-200 bg-white/70 px-5 py-9 text-center sm:py-14">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
                <BookOpenText className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="font-display text-lg font-semibold text-ink">书架正在等第一本教材</p>
              <p className="mx-auto mb-5 mt-2 max-w-md text-sm leading-6 text-ink-mute">输入老师发放的兑换码，教材会立即加入这里；也可以请老师直接分配。</p>
              <button
                type="button"
                onClick={() => navigate('/subscription/redeem')}
                className="btn-glow inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white"
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                兑换第一本教材
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
                      <img onError={handleBookCoverError} src={book.cover_url || `/book-cover-${coverIndex}.jpeg`} alt={book.name} className="w-full h-full object-cover" />
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
          ) : displayedBooks.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-black/10 rounded-2xl">
              <p className="text-ink-soft">没有匹配「{bookQuery}」的书</p>
              <button
                onClick={() => setBookQuery('')}
                className="mt-3 text-sm text-accent-warm hover:underline"
              >
                清除搜索
              </button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {visibleOwnedBooks.map((book) => {
                const coverIndex = (book.id % 4) + 1;
                return (
                  <button
                    type="button"
                    key={book.id}
                    className="card-soft flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl text-left"
                    onClick={() => handleStartLearning(book.id)}
                  >
                    <div className="relative h-36 overflow-hidden bg-black/5">
                      <img
                        onError={handleBookCoverError}
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
                        <div className="w-full h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              book.progress_percentage >= 100
                                ? 'progress-gold'
                                : book.progress_percentage > 0
                                ? 'bg-accent-warm progress-striped'
                                : 'bg-accent-warm'
                            }`}
                            style={{ width: `${book.progress_percentage}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!loading && !isEditingOrder && !isShelfFiltered && displayedBooks.length > 3 && (
            <div className="mt-5 flex flex-col items-center gap-2 border-t border-black/[0.06] pt-5 sm:flex-row sm:justify-between">
              <p className="text-center text-xs text-ink-mute sm:text-left">
                先显示书架前 3 本，今天更容易找到要学的内容。
              </p>
              <button
                type="button"
                onClick={() => setShowAllOwnedBooks((visible) => !visible)}
                aria-expanded={showAllOwnedBooks}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-accent-warm transition hover:bg-orange-50"
              >
                {showAllOwnedBooks ? '收起书架' : `查看全部 ${displayedBooks.length} 本`}
                <ChevronDown className={`h-4 w-4 transition-transform ${showAllOwnedBooks ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
            </div>
          )}

          {unownedBooks.length > 0 && !loading && (
            <>
              <header className="flex items-baseline justify-between mt-10 mb-5">
                <h2 className="font-display text-xl font-semibold text-ink">更多书籍</h2>
                <button
                  type="button"
                  onClick={() => setShowMoreBooks((visible) => !visible)}
                  aria-expanded={showMoreBooks}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-soft transition hover:bg-black/[0.05] hover:text-ink"
                >
                  <span>{showMoreBooks ? '收起书籍' : `展开更多 (${unownedBooks.length})`}</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMoreBooks ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              </header>
              {showMoreBooks ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {unownedBooks.map((book) => {
                    const coverIndex = (book.id % 4) + 1;
                    return (
                      <button
                        type="button"
                        key={book.id}
                        className="group flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-black/[0.05] bg-white text-left opacity-75 transition hover:border-black/15 hover:opacity-100"
                        onClick={() => navigate('/subscription/redeem')}
                      >
                        <div className="relative h-32 overflow-hidden bg-black/5">
                          <img onError={handleBookCoverError} src={book.cover_url || `/book-cover-${coverIndex}.jpeg`} alt={book.name} className="w-full h-full object-cover grayscale" />
                          <div className="absolute inset-0 bg-black/30" />
                        </div>
                        <div className="p-4">
                          <h3 className="font-display text-base font-semibold text-ink mb-1.5 line-clamp-1">{book.name}</h3>
                          <p className="text-xs text-ink-mute font-numeric mb-3">
                            {book.unit_count} 单元 · {book.word_count} 词
                          </p>
                          <span
                            className="block w-full rounded-lg border border-black/15 py-2 text-center text-sm font-medium text-ink transition group-hover:bg-black/5"
                          >
                            输入兑换码
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-black/[0.08] bg-white/60 px-4 py-3 text-center text-xs text-ink-mute">
                  还有 {unownedBooks.length} 本书可解锁，点“展开更多”查看，或直接兑换教材
                </p>
              )}
            </>
          )}
        </section>

        {/* 错题提醒 — 只在有错题时显示，做成轻量内联条带不打扰 */}
        {mistakeStats && mistakeStats.unresolved_mistakes > 0 && (
          <button
            onClick={() => navigate('/student/mistake-book')}
            className="mb-10 flex w-full items-center justify-between rounded-xl border border-orange-200 bg-white px-5 py-4 text-left transition hover:border-orange-300 hover:bg-orange-50/40"
          >
            <div>
              <p className="font-medium text-ink">有 <span className="font-numeric text-accent-warm">{mistakeStats.unresolved_mistakes}</span> 个错题待处理</p>
              <p className="text-xs text-ink-mute mt-0.5">及时复习薄弱知识点</p>
            </div>
            <span className="text-ink-soft text-sm">去处理 →</span>
          </button>
        )}

        {/* 学习工具 — 分层：3 主磁贴 + 4 小磁贴 */}
        <section className="mb-9 sm:mb-12">
          <header className="flex items-baseline justify-between mb-5">
            <h2 className="font-display text-xl font-semibold text-ink">学习工具</h2>
          </header>

          {/* 3 大磁贴：图 + 数字 + 动作 */}
          <div className="grid md:grid-cols-3 gap-3 mb-3">
            {[
              {
                title: '今日复习',
                route: '/student/memory-curve',
                image: reviewDueCount > 0 ? '/eagle-alert.jpeg' : '/eagle-idle.jpeg',
                metric: reviewDueCount > 0 ? Math.min(20, reviewDueCount) : null,
                metricLabel: '个词待回顾',
                empty: '今日无需复习',
                action: reviewDueCount > 0 ? '开始复习 →' : '查看计划 →',
              },
              {
                title: '错题集',
                route: '/student/mistake-book',
                image: '/eagle-mistake.jpeg',
                metric: mistakeStats?.unresolved_mistakes || null,
                metricLabel: '个错题待处理',
                empty: '没有待攻克的词',
                action: (mistakeStats?.unresolved_mistakes || 0) > 0 ? '去攻克 →' : '查看记录 →',
              },
              {
                title: '我的作业',
                route: '/student/homework',
                image: '/eagle-homework.jpeg',
                metric: pendingHomeworkCount || null,
                metricLabel: '份作业待完成',
                empty: '作业都做完了',
                action: pendingHomeworkCount > 0 ? '去完成 →' : '查看历史 →',
              },
            ].map((tile) => (
              <button
                key={tile.title}
                onClick={() => navigate(tile.route)}
                className="text-left card-soft rounded-2xl p-5 flex gap-4 items-center"
              >
                <img
                  src={tile.image}
                  alt=""
                  className="tile-image w-16 h-16 md:w-20 md:h-20 rounded-xl object-cover shrink-0 select-none"
                  loading="lazy"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-ink-mute text-xs mb-1">{tile.title}</p>
                  {tile.metric ? (
                    <>
                      <p className="font-display text-2xl font-semibold text-ink leading-tight mb-1">
                        <span className="font-numeric text-accent-warm">{tile.metric}</span>
                        <span className="text-sm text-ink-soft ml-1.5 font-normal">{tile.metricLabel}</span>
                      </p>
                      <p className="text-xs text-ink-soft">{tile.action}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-display text-base font-semibold text-ink leading-tight mb-1">
                        {tile.empty}
                      </p>
                      <p className="text-xs text-ink-mute">{tile.action}</p>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* 音标学习 —— 单独一条横幅而不是混在下面的小卡里:
              音标是整个英语学习的地基(会读音标才能自己拼读、听写不靠猜),
              放进 8 个并列小入口会被当成"又一个功能"而被跳过。 */}
          <button
            onClick={() => navigate('/student/phonetics')}
            className="group mb-4 grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 via-amber-50 to-white p-3 text-left shadow-sm transition hover:border-orange-300 hover:shadow-md sm:gap-4 sm:p-5"
          >
            <img
              /* ?v= 防 nginx 的 immutable 缓存:图名固定,换图不带版本号老用户看到旧图 */
              src="/phonics-hero.jpeg?v=2" alt=""
              loading="lazy"
              className="h-16 w-16 shrink-0 rounded-xl object-cover transition duration-300 group-hover:scale-[1.03] sm:h-20 sm:w-32"
            />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-1.5 sm:gap-2">
                <span className="hidden rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white sm:inline-flex">英语基础</span>
                <h3 className="font-display inline-flex items-center gap-1.5 text-base font-bold text-ink sm:text-xl"><Volume2 className="h-4 w-4 text-primary sm:h-5 sm:w-5" />音标学习</h3>
              </div>
              <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-soft sm:text-sm">
                音标是英语的<span className="font-semibold text-ink">地基</span> ——
                会读音标,才能自己拼出生词读音、听写不靠猜、背单词快一倍。
              </p>
            </div>
            <span className="inline-flex min-h-11 shrink-0 items-center self-center rounded-lg bg-primary px-2.5 text-xs font-semibold text-white sm:rounded-xl sm:px-4 sm:text-sm">
              学习 →
            </span>
          </button>

          {/* 快捷工具：先展示高频入口，其余按需展开，避免手机首页再次变成长目录。 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {visibleQuickTools.map((tile) => (
              <button
                key={tile.title}
                onClick={() => navigate(tile.route)}
                className="group card-soft rounded-xl p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md sm:p-3.5"
              >
                <div className="mb-2.5 h-14 overflow-hidden rounded-lg bg-slate-100 sm:mb-3 sm:h-20">
                  <img src={tile.image} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-display text-sm font-semibold text-ink sm:text-base">{tile.title}</h3>
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
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setShowAllQuickTools((visible) => !visible)}
              aria-expanded={showAllQuickTools}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-accent-warm transition hover:bg-orange-50"
            >
              {showAllQuickTools ? '收起更多工具' : `展开更多工具（${quickTools.length - 4}）`}
              <ChevronDown className={`h-4 w-4 transition-transform ${showAllQuickTools ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </section>

        {/* 宠物是陪伴型功能，放在核心学习工具之后，避免空态打断首要任务。 */}
        <section className="mb-9 sm:mb-12">
          <PetWidget />
        </section>

        {/* 手机端把次级统计收成一条摘要，首页先聚焦今天的任务；桌面端保持完整展示。 */}
        <button
          type="button"
          onClick={() => setShowLearningDetails((visible) => !visible)}
          aria-expanded={showLearningDetails}
          aria-controls="dashboard-learning-details"
          className="card-soft mb-9 flex min-h-16 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left md:hidden"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-accent-warm">
            <BarChart3 className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-sm font-semibold text-ink">学习记录</span>
            <span className="mt-0.5 block truncate text-xs text-ink-mute">
              已学 {stats?.total_words_studied || 0} 词 · 掌握 {stats?.mastered_words || 0} 词 · {unlockedCount} 个成就
            </span>
          </span>
          <span className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-accent-warm">
            {showLearningDetails ? '收起' : '展开'}
            <ChevronDown className={`h-4 w-4 transition-transform ${showLearningDetails ? 'rotate-180' : ''}`} aria-hidden="true" />
          </span>
        </button>

        <div id="dashboard-learning-details" className={`${showLearningDetails ? 'block' : 'hidden'} md:block`}>
          {/* 学习概览 — 数据条带式，紧凑 */}
          <section className="mb-9 sm:mb-12">
          <header className="flex items-baseline justify-between mb-5">
            <h2 className="font-display text-xl font-semibold text-ink">学习概览</h2>
            <button
              onClick={() => navigate('/student/analytics')}
              className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-ink-soft transition hover:bg-orange-50 hover:text-ink"
            >
              详细数据 →
            </button>
          </header>
          <div className="card-soft grid grid-cols-2 overflow-hidden rounded-2xl">
            {[
              { label: '已学单词', value: stats?.total_words_studied || 0, suffix: stats?.today_words ? `今日 +${stats.today_words}` : '' },
              { label: '已掌握', value: stats?.mastered_words || 0, suffix: `${stats?.mastery_rate || 0}% 掌握率` },
              { label: '连续打卡', value: stats?.streak_days || 0, suffix: '天' },
              { label: '学习时长', value: stats?.total_minutes || 0, suffix: '分钟' },
            ].map((row) => (
              <div key={row.label} className="flex min-w-0 flex-col gap-1 border-black/[0.05] p-4 odd:border-r [&:nth-child(-n+2)]:border-b sm:flex-row sm:items-baseline sm:justify-between sm:px-5">
                <span className="text-sm text-ink-soft">{row.label}</span>
                <div className="flex min-w-0 items-baseline gap-1.5 sm:gap-2">
                  <span className="font-display font-numeric text-2xl font-semibold text-ink">{row.value}</span>
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
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="card-soft rounded-xl p-3 sm:p-5">
                <p className="text-xs text-ink-mute mb-1.5">满分轮次</p>
                <p className="font-display font-numeric text-2xl font-semibold text-ink sm:text-3xl">{stats.perfect_sessions}</p>
                <p className="mt-1 text-xs text-ink-mute">共 {stats.total_sessions} 次</p>
              </div>
              <div className="card-soft rounded-xl p-3 sm:p-5">
                <p className="text-xs text-ink-mute mb-1.5">首次正确率</p>
                <p className="font-display font-numeric text-2xl font-semibold text-ink sm:text-3xl">{stats.first_time_accuracy}<span className="text-base text-ink-soft">%</span></p>
                <p className="mt-1 text-xs text-ink-mute">首次答对</p>
              </div>
              <div className="card-soft rounded-xl p-3 sm:p-5">
                <p className="text-xs text-ink-mute mb-1.5">满分率</p>
                <p className="font-display font-numeric text-2xl font-semibold text-ink sm:text-3xl">
                  {Math.round(stats.perfect_sessions / stats.total_sessions * 100)}<span className="text-base text-ink-soft">%</span>
                </p>
                <p className="mt-1 text-xs text-ink-mute">满分练习</p>
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
                className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-ink-soft transition hover:bg-orange-50 hover:text-ink"
              >
                查看全部 →
              </button>
            </header>
            <div className="card-soft rounded-2xl p-5">
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
                {previewAchievements.map((achievement, achievementIndex) => (
                  <button
                    key={achievement.id}
                    onClick={() => navigate('/student/achievements')}
                    className={`${achievementIndex >= 3 ? 'hidden sm:block' : ''} rounded-lg p-3 text-center transition ${
                      achievement.unlocked
                        ? 'hover:bg-black/[0.04]'
                        : 'opacity-40'
                    }`}
                    title={achievement.description || achievement.name}
                  >
                  <div className="mb-1.5 flex items-center justify-center">
                    <AchievementIcon icon={achievement.icon} size={48} />
                  </div>
                    <p className="truncate text-xs text-ink-soft">{achievement.name}</p>
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
      </div>

      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />

      <ChangeUsernameModal
        isOpen={showChangeUsername}
        onClose={() => setShowChangeUsername(false)}
        currentUsername={user?.username}
        onSuccess={(newName) => setUser((prev) => (prev ? { ...prev, username: newName } : prev))}
      />
    </div>
  );
};

export default StudentDashboard;
