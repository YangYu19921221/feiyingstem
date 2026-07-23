import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import {
  getMistakeBookStats,
  getMistakeWords,
  getChallengeReviewDue,
  getChallengeLevels,
  type MistakeWordDetail,
  type MistakeBookStats,
} from '../api/mistakeBook';
import StudentIdentityBadge from '../components/StudentIdentityBadge';
import ColoredPhonetic from '../components/ColoredPhonetic';
import ColoredWord from '../components/ColoredWord';
import { toast } from '../components/Toast';

const PAGE_SIZE = 20;

const MistakeBook = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [stats, setStats] = useState<MistakeBookStats | null>(null);
  const [mistakeWords, setMistakeWords] = useState<MistakeWordDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [reviewDueCount, setReviewDueCount] = useState(0);
  const [challengeSummary, setChallengeSummary] = useState<{ totalLevels: number; totalUnresolved: number } | null>(null);

  // 刷新统计数据（返回页面时调用）
  const refreshStats = useCallback(() => {
    getMistakeBookStats().then(setStats).catch(() => {});
    getChallengeReviewDue().then(d => setReviewDueCount(d.due_count)).catch(() => {});
    getChallengeLevels()
      .then(d => setChallengeSummary({ totalLevels: d.total_levels, totalUnresolved: d.total_unresolved }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats, showResolved, location.key]);

  // 从练习/闯关页返回时自动刷新（页面重新可见时触发）
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) refreshStats(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshStats]);

  // SPA 内从闯关页 navigate(-1) 回来时，location.key 会变 → 刷新词列表（也负责首次挂载加载）
  useEffect(() => {
    loadWords(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // 筛选切换时重置到第1页。跳过首次挂载，避免和上面的 location.key effect 重复请求最重的查询
  const didMountFilter = useRef(false);
  useEffect(() => {
    if (!didMountFilter.current) {
      didMountFilter.current = true;
      return;
    }
    setCurrentPage(1);
    loadWords(1);
  }, [showResolved]);

  const loadWords = async (page: number) => {
    try {
      setLoading(true);
      // 词列表改为展示分类学习中的夹生/陌生词
      const data = await getMistakeWords(!showResolved, undefined, page, PAGE_SIZE, 'classify');
      setMistakeWords(data.items || []);
      setTotalPages(data.total_pages);
      setTotalCount(data.total);
      setCurrentPage(data.page);
    } catch (error) {
      console.error('加载错题集失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    loadWords(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 分页页码（含省略号）
  const paginationPages = useMemo(() => {
    const pages: (number | 'dots')[] = [];
    const nums = Array.from({ length: totalPages }, (_, i) => i + 1)
      .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2);
    nums.forEach((p, i) => {
      if (i > 0 && p - nums[i - 1] > 1) pages.push('dots');
      pages.push(p);
    });
    return pages;
  }, [currentPage, totalPages]);

  const handleStartPractice = async () => {
    try {
      // 获取分类学习中未掌握的词（夹生+陌生）
      const data = await getMistakeWords(true, undefined, 1, 50, 'classify');

      if (!data.items || data.items.length === 0) {
        toast.info('没有分类学习中待攻克的词，先去做分类记忆法学习吧！');
        return;
      }

      // 转换为 WordClassifyLearning 需要的 WordData 格式
      const words = data.items.map(w => ({
        id: w.word_id,
        word: w.word,
        phonetic: w.phonetic,
        syllables: w.syllables,
        difficulty: 3,
        audio_url: null,
        image_url: null,
        order_index: 0,
        meaning: w.meaning,
        part_of_speech: w.part_of_speech,
        example_sentence: null,
        example_translation: null,
      }));

      // 走分类记忆法流程复习这些词
      sessionStorage.setItem('mistake_practice_words', JSON.stringify(words));
      sessionStorage.setItem('is_mistake_practice', 'true');
      navigate('/student/units/0/classify');
    } catch (error) {
      console.error('开始练习失败:', error);
      toast.error('开始练习失败,请重试');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink-mute text-sm">加载中…</p>
      </div>
    );
  }

  const unresolvedTotal = stats?.total_mistakes ? stats.total_mistakes - stats.resolved_mistakes : 0;

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      {/* 顶部导航 */}
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-ink-soft hover:text-ink transition text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">错题集</h1>
          <div className="w-12" />
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-5 py-10">
        {/* 学生身份：家长拍照时一眼知道是谁 */}
        <StudentIdentityBadge tone="paper" className="mb-6" />

        {/* Hero：共情 + 飞鹰陪伴 */}
        <section className="mb-10 grid md:grid-cols-[1fr_auto] gap-6 md:gap-10 items-center">
          <div>
            <p className="text-ink-mute text-sm mb-2">错题是进步的台阶</p>
            {unresolvedTotal > 0 ? (
              <>
                <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-[1.1] tracking-tight mb-3">
                  一起攻克这 <span className="font-numeric text-accent-warm">{unresolvedTotal}</span> 个词
                </h2>
                <p className="text-ink-soft text-base max-w-xl leading-relaxed">
                  错题记录让你看清薄弱点。每次认真复习一个，都会变成牢固的记忆。
                </p>
              </>
            ) : (
              <>
                <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-[1.1] tracking-tight mb-3">
                  {stats?.total_mistakes ? '暂时没有待攻克的词' : '还没有错题记录'}
                </h2>
                <p className="text-ink-soft text-base max-w-xl leading-relaxed">
                  {stats?.total_mistakes
                    ? '保持下去，继续多做练习就好。'
                    : '开始学习后，答错的单词会自动收录在这里。'}
                </p>
              </>
            )}
          </div>
          <img
            src="/eagle-mistake.jpeg"
            alt=""
            className="w-32 h-32 md:w-44 md:h-44 justify-self-center md:justify-self-end rounded-2xl select-none"
            loading="lazy"
          />
        </section>

        {/* 统计 — 数据条带 */}
        {stats && (
          <section className="mb-10">
            <div className="card-soft rounded-2xl divide-y divide-black/[0.05]">
              {[
                { label: '总错题数', value: stats.total_mistakes, suffix: '' },
                { label: '待攻克', value: stats.classify_mistakes || 0, suffix: '', hint: '分类学习夹生 / 陌生词' },
                { label: '已掌握', value: stats.resolved_mistakes, suffix: '' },
                { label: '今日练习', value: stats.today_practice_count, suffix: '' },
              ].map((row) => (
                <div key={row.label} className="px-5 py-4 flex items-baseline justify-between">
                  <div>
                    <span className="text-ink-soft text-sm">{row.label}</span>
                    {row.hint && <span className="ml-2 text-xs text-ink-mute">{row.hint}</span>}
                  </div>
                  <span className="font-display font-semibold text-2xl text-ink font-numeric">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 练习入口 */}
        <section className="mb-10">
          {/* 到期复习优先 */}
          {reviewDueCount > 0 && (
            <button
              onClick={() => navigate('/student/mistake-challenge')}
              className="w-full mb-3 px-5 py-4 border-l-2 border-accent-warm bg-white hover:bg-black/[0.02] transition flex items-center justify-between text-left rounded-r-md"
            >
              <div>
                <p className="font-medium text-ink">
                  有 <span className="font-numeric text-accent-warm">{reviewDueCount}</span> 个错词到了复习节点
                </p>
                <p className="text-xs text-ink-mute mt-0.5">现在复习，记忆最牢</p>
              </div>
              <span className="text-ink-soft text-sm">立即闯关 →</span>
            </button>
          )}

          {/* 主练习按钮 */}
          <button
            onClick={handleStartPractice}
            disabled={!stats || (stats.classify_mistakes || 0) === 0}
            className="w-full py-4 bg-accent-warm text-white rounded-xl text-base font-semibold hover:opacity-90 disabled:bg-black/[0.08] disabled:text-ink-mute disabled:cursor-not-allowed transition"
          >
            {stats && (stats.classify_mistakes || 0) > 0
              ? `开始练习 · ${stats.classify_mistakes} 个待攻克`
              : '暂无待攻克词'}
          </button>

          {/* 闯关模式 */}
          {challengeSummary && challengeSummary.totalLevels > 0 && (
            <button
              onClick={() => navigate('/student/mistake-challenge')}
              className="w-full mt-3 py-3.5 border border-black/15 text-ink rounded-xl text-sm font-medium hover:bg-black/5 transition"
            >
              错题闯关模式 · {challengeSummary.totalUnresolved} 词 / {challengeSummary.totalLevels} 关
            </button>
          )}
        </section>

        {/* 错题列表 */}
        <div className="card-soft rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">错题列表</h2>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showResolved}
                  onChange={(e) => setShowResolved(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-600">显示已掌握</span>
              </label>
            </div>
          </div>

          {mistakeWords.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🎉</div>
              <p className="text-gray-500 text-lg">
                {showResolved ? '还没有错题记录' : '太棒了!没有需要攻克的错题'}
              </p>
            </div>
          ) : (
            <>
            <div className="grid grid-cols-1 gap-4">
              <AnimatePresence>
                {mistakeWords.map((word, index) => {
                  const cardStyle = word.is_resolved
                    ? 'border-green-200 bg-green-50'
                    : word.mastery_level === 0
                    ? 'border-red-300 bg-red-50'
                    : word.mastery_level <= 2
                    ? 'border-orange-300 bg-orange-50'
                    : 'border-blue-300 bg-blue-50';

                  const categoryBadge = word.is_resolved
                    ? { label: '已掌握', cls: 'bg-green-500 text-white' }
                    : word.mastery_level === 0
                    ? { label: '😰 陌生', cls: 'bg-red-100 text-red-700' }
                    : word.mastery_level <= 2
                    ? { label: '🤔 夹生', cls: 'bg-orange-100 text-orange-700' }
                    : { label: '💡 接近', cls: 'bg-blue-100 text-blue-700' };

                  return (
                    <motion.div
                      key={word.word_id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ delay: index * 0.05 }}
                      className={`border-2 rounded-xl p-4 ${cardStyle}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <ColoredWord
                              word={word.word}
                              syllables={word.syllables}
                              className="text-2xl font-bold"
                            />
                            {word.phonetic && (
                              <ColoredPhonetic phonetic={word.phonetic} className="text-base" />
                            )}
                            <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${categoryBadge.cls}`}>
                              {categoryBadge.label}
                            </span>
                          </div>
                          <p className="text-gray-700 mb-3">{word.meaning}</p>

                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">分类错误:</span>
                              <span className="font-bold text-red-600">{word.total_mistakes}次</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">掌握度:</span>
                              <span className="font-bold text-blue-600">{word.mastery_level}/5</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">正确率:</span>
                              <span className="font-bold text-green-600">
                                {word.correct_count + word.wrong_count > 0
                                  ? Math.round((word.correct_count / (word.correct_count + word.wrong_count)) * 100)
                                  : 0}%
                              </span>
                            </div>
                          </div>

                          {/* 最近错误时间 */}
                          {word.last_mistake_at && (
                            <p className="text-xs text-gray-400 mt-2">
                              最近一次: {new Date(word.last_mistake_at).toLocaleDateString('zh-CN')}
                            </p>
                          )}
                        </div>

                        <div className="ml-4">
                          <div className="flex gap-1">
                            {[0, 1, 2, 3, 4].map((level) => (
                              <div
                                key={level}
                                className={`w-2 h-8 rounded ${
                                  level < word.mastery_level ? 'bg-green-500' : 'bg-gray-200'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* 分页控件 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-30 disabled:cursor-not-allowed bg-white shadow hover:bg-gray-50"
                >
                  上一页
                </button>
                {paginationPages.map((p, i) =>
                  p === 'dots' ? (
                    <span key={`dots-${i}`} className="px-2 text-gray-400">...</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => handlePageChange(p)}
                      className={`w-10 h-10 rounded-lg text-sm font-medium transition ${
                        p === currentPage
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-white shadow hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-30 disabled:cursor-not-allowed bg-white shadow hover:bg-gray-50"
                >
                  下一页
                </button>
                <span className="text-xs text-gray-400 ml-2">共 {totalCount} 个</span>
              </div>
            )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MistakeBook;
