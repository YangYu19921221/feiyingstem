import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BookOpen, TrendingUp, Clock, Target, PlayCircle } from 'lucide-react';
import {
  getMistakeBookStats,
  getMistakeWords,
  getChallengeReviewDue,
  type MistakeWordDetail,
  type MistakeBookStats,
} from '../api/mistakeBook';
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

  // 刷新统计数据（返回页面时调用）
  const refreshStats = useCallback(() => {
    getMistakeBookStats().then(setStats).catch(() => {});
    getChallengeReviewDue().then(d => setReviewDueCount(d.due_count)).catch(() => {});
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

  // SPA 内从闯关页 navigate(-1) 回来时，location.key 会变 → 同时刷新词列表
  useEffect(() => {
    loadWords(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // 单词列表在筛选切换时重置到第1页
  useEffect(() => {
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
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-blue-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 px-4 py-2 hover:bg-white rounded-xl transition-all hover:shadow-md"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
              <span className="text-gray-600 font-medium">返回</span>
            </button>

            <h1 className="text-xl font-bold text-gray-800">错题集</h1>

            <div className="w-24"></div>
          </div>
        </div>
      </nav>

      {/* Hero 横幅 */}
      <div className="relative overflow-hidden" style={{ height: 160 }}>
        <img src="/hero-mistake.jpeg" alt="" className="absolute inset-0 w-full h-full object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/30 to-transparent" />
        <div className="relative z-10 h-full flex items-center px-6 max-w-7xl mx-auto">
          <div className="text-white">
            <h2 className="text-3xl font-bold drop-shadow">📕 我的错题集</h2>
            <p className="text-sm opacity-80 mt-1 drop-shadow">攻克错题，每一次挑战都是成长</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-red-500 to-pink-500 rounded-2xl p-6 text-white shadow-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <BookOpen className="w-8 h-8" />
                <span className="text-3xl font-bold">{stats.total_mistakes}</span>
              </div>
              <p className="text-white/90">总错题数</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-gradient-to-br from-orange-500 to-yellow-500 rounded-2xl p-6 text-white shadow-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <Target className="w-8 h-8" />
                <span className="text-3xl font-bold">{stats.classify_mistakes || 0}</span>
              </div>
              <p className="text-white/90">待攻克</p>
              <p className="text-white/60 text-xs mt-1">分类学习夹生/陌生词</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl p-6 text-white shadow-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <TrendingUp className="w-8 h-8" />
                <span className="text-3xl font-bold">{stats.resolved_mistakes}</span>
              </div>
              <p className="text-white/90">已掌握</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl p-6 text-white shadow-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <Clock className="w-8 h-8" />
                <span className="text-3xl font-bold">{stats.today_practice_count}</span>
              </div>
              <p className="text-white/90">今日练习</p>
            </motion.div>
          </div>
        )}

        {/* 快速练习区域 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-lg mb-8"
        >
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <PlayCircle className="w-6 h-6 text-primary" />
            快速开始练习
          </h2>

          {/* 闯关复习到期强制提醒（置顶，优先级最高） */}
          {reviewDueCount > 0 && (
            <button
              onClick={() => navigate('/student/mistake-challenge')}
              className="w-full mb-3 py-4 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all animate-pulse"
            >
              ⏰ 有 {reviewDueCount} 个错词需要复习！点击立即闯关
            </button>
          )}

          <button
            onClick={handleStartPractice}
            disabled={!stats || (stats.classify_mistakes || 0) === 0}
            className="w-full py-4 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {stats && (stats.classify_mistakes || 0) > 0
              ? `🚀 开始练习（${stats.classify_mistakes}个待攻克）`
              : '暂无分类学习待攻克词'}
          </button>

          {/* 错题闯关入口 */}
          {stats && (stats.classify_mistakes || 0) > 0 && (
            <button
              onClick={() => navigate('/student/mistake-challenge')}
              className="w-full mt-3 py-4 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all"
            >
              🏰 错题闯关模式 ({Math.ceil((stats.classify_mistakes || 0) / 5)} 关)
            </button>
          )}
        </motion.div>

        {/* 错题列表 */}
        <div className="bg-white rounded-2xl p-6 shadow-lg">
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
