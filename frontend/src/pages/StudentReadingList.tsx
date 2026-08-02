import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, BookOpenText, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { getStudentPassages } from '../api/reading';
import type { StudentPassageListItem } from '../api/reading';
import useGoBack from '../hooks/useGoBack';

const StudentReadingList = () => {
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
  const [passages, setPassages] = useState<StudentPassageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState({
    topic: '',
    difficulty: 0,
    only_assigned: false,
  });

  useEffect(() => {
    loadPassages();
  }, [filter]);

  const loadPassages = async () => {
    try {
      setLoading(true);
      setError('');
      const params: { topic?: string; difficulty?: number; only_assigned?: boolean } = {};
      if (filter.topic) params.topic = filter.topic;
      if (filter.difficulty) params.difficulty = filter.difficulty;
      if (filter.only_assigned) params.only_assigned = true;

      const data = await getStudentPassages(params);
      setPassages(data);
    } catch (error) {
      console.error('加载阅读文章失败:', error);
      setError('阅读文章暂时没有加载出来，请检查网络后重试。');
    } finally {
      setLoading(false);
    }
  };

  const getDifficultyLabel = (difficulty: number) => {
    const labels = ['', '⭐ 简单', '⭐⭐ 一般', '⭐⭐⭐ 中等', '⭐⭐⭐⭐ 困难', '⭐⭐⭐⭐⭐ 挑战'];
    return labels[difficulty] || '';
  };

  const getDifficultyColor = (difficulty: number) => {
    const colors = [
      '',
      'from-green-400 to-emerald-500',
      'from-lime-400 to-green-500',
      'from-yellow-400 to-orange-500',
      'from-orange-500 to-red-500',
      'from-red-500 to-rose-600',
    ];
    return colors[difficulty] || colors[3];
  };

  const getStatusBadge = (passage: StudentPassageListItem) => {
    if (passage.is_completed) {
      return (
        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
          ✅ 已完成
        </span>
      );
    }
    if (passage.is_started) {
      return (
        <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700">
          📝 进行中
        </span>
      );
    }
    if (passage.is_assigned) {
      return (
        <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
          📌 已布置
        </span>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      {/* 顶部导航 */}
      <nav className="sticky top-0 z-20 mb-6 border-b border-slate-200/80 bg-white/85 shadow-sm backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => goBack()}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition hover:bg-orange-50 hover:text-orange-600"
              aria-label="返回学生首页"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-accent-warm">
              <BookOpenText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-slate-800">阅读理解</h1>
              <p className="hidden text-xs text-slate-500 sm:block">从短篇阅读开始积累语感</p>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 pb-12">
        <section className="student-colorful-surface mb-6 overflow-hidden rounded-2xl border border-orange-100 p-5 shadow-md sm:p-6">
          <div className="flex items-center justify-between gap-6">
            <div className="max-w-xl">
              <h2 className="font-display text-2xl font-bold text-slate-800">读懂一篇，比刷十道题更重要</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">按主题和难度选择文章，完成后查看得分与解析。</p>
            </div>
            <img src="/hero-reading.jpeg" alt="" className="hidden h-28 w-40 rounded-xl object-cover shadow-sm sm:block" />
          </div>
        </section>

        {/* 筛选栏 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-soft rounded-xl p-4 sm:p-5 mb-6"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <SlidersHorizontal className="h-4 w-4 text-orange-500" /> 筛选文章
          </div>
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">📚 主题:</span>
              <select
                value={filter.topic}
                onChange={(e) => setFilter({ ...filter, topic: e.target.value })}
                className="min-h-11 rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-accent-warm/30"
              >
                <option value="">全部</option>
                <option value="故事">故事</option>
                <option value="科学">科学</option>
                <option value="历史">历史</option>
                <option value="日常">日常</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">🎯 难度:</span>
              <select
                value={filter.difficulty}
                onChange={(e) => setFilter({ ...filter, difficulty: Number(e.target.value) })}
                className="min-h-11 rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-accent-warm/30"
              >
                <option value={0}>全部</option>
                <option value={1}>简单</option>
                <option value={2}>一般</option>
                <option value={3}>中等</option>
                <option value={4}>困难</option>
                <option value={5}>挑战</option>
              </select>
            </div>

            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 transition hover:bg-orange-50">
              <input
                type="checkbox"
                checked={filter.only_assigned}
                onChange={(e) => setFilter({ ...filter, only_assigned: e.target.checked })}
                className="w-4 h-4 text-primary focus:ring-primary rounded"
              />
              <span className="text-sm font-medium text-gray-700">只看作业</span>
            </label>
          </div>
        </motion.div>

        {/* 文章列表 */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="mt-4 text-gray-600">加载中...</p>
          </div>
        ) : error ? (
          <div className="card-soft rounded-2xl px-5 py-12 text-center" role="alert">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
              <RefreshCw className="h-7 w-7" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-bold text-slate-700">阅读列表暂时没打开</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{error}</p>
            <button
              type="button"
              onClick={() => void loadPassages()}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              重新加载
            </button>
          </div>
        ) : passages.length === 0 ? (
          <div className="card-soft rounded-2xl px-5 py-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
              <BookOpenText className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-bold text-slate-700">老师还没有发布阅读文章</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              新文章发布后会显示在这里。现在可以先回书架继续单词学习。
            </p>
            <button
              type="button"
              onClick={() => navigate('/student/dashboard')}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              返回我的书架
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {passages.map((passage, index) => (
              <motion.article
                key={passage.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="card-soft group overflow-hidden rounded-2xl transition-all duration-300 hover:shadow-xl"
              >
                <Link
                  to={`/student/reading/${passage.id}`}
                  className="block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-warm focus-visible:ring-offset-2"
                  aria-label={`${passage.title}，${passage.is_completed ? '查看成绩' : passage.is_started ? '继续答题' : '开始阅读'}`}
                >
                {/* 封面图 */}
                <div className="h-32 relative overflow-hidden bg-slate-100">
                  <img
                    src={['/hero-reading.jpeg', '/hero-memory.jpeg', '/hero-challenge.jpeg'][index % 3]}
                    alt=""
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className={`absolute inset-0 bg-gradient-to-br ${getDifficultyColor(passage.difficulty)} opacity-30 group-hover:opacity-20 transition`} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                  <div className="absolute top-3 left-3">{getStatusBadge(passage)}</div>
                  {passage.deadline && (
                    <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-medium text-gray-700">
                      ⏰ {new Date(passage.deadline).toLocaleDateString()}
                    </div>
                  )}
                  <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-xs font-semibold text-white drop-shadow-lg">
                    <BookOpenText className="h-4 w-4" /> 分级阅读
                  </div>
                </div>

                {/* 内容 */}
                <div className="p-5">
                  <h3 className="text-lg font-bold text-gray-800 mb-2 line-clamp-2 group-hover:text-primary transition">
                    {passage.title}
                  </h3>

                  <div className="flex items-center gap-2 mb-3">
                    {passage.topic && (
                      <span className="rounded bg-orange-50 px-2 py-1 text-xs text-orange-700">
                        {passage.topic}
                      </span>
                    )}
                    <span className="rounded bg-orange-50 px-2 py-1 text-xs text-orange-700">
                      {getDifficultyLabel(passage.difficulty)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm text-gray-600 mb-3">
                    <span>📝 {passage.word_count} 词</span>
                    <span>❓ {passage.question_count} 题</span>
                    {passage.grade_level && <span>🎓 {passage.grade_level}</span>}
                  </div>

                  {/* 进度信息 */}
                  {passage.is_started && (
                    <div className="pt-3 border-t border-gray-100">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>已尝试 {passage.attempts_count} 次</span>
                        {passage.best_score !== null && passage.best_score !== undefined && (
                          <span className="font-medium text-primary">最高分: {passage.best_score}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 开始/继续按钮 */}
                  <span
                    className={`mt-4 block w-full rounded-lg py-2.5 text-center font-medium text-white transition ${
                      passage.is_completed
                        ? 'bg-green-500 hover:bg-green-600'
                        : 'bg-accent-warm hover:opacity-90'
                    }`}
                  >
                    {passage.is_completed
                      ? '🎉 查看成绩'
                      : passage.is_started
                      ? '📝 继续答题'
                      : '🚀 开始阅读'}
                  </span>
                </div>
                </Link>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentReadingList;
