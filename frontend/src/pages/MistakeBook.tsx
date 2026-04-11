import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BookOpen, TrendingUp, Clock, Target, PlayCircle } from 'lucide-react';
import {
  getMistakeBookStats,
  getMistakeWords,
  startMistakePractice,
  type MistakeWordDetail,
  type MistakeBookStats,
} from '../api/mistakeBook';
import ColoredPhonetic from '../components/ColoredPhonetic';
import { toast } from '../components/Toast';

const PAGE_SIZE = 20;

const PAGE_SIZE = 20;

const MistakeBook = () => {
  const navigate = useNavigate();

  const [stats, setStats] = useState<MistakeBookStats | null>(null);
  const [mistakeWords, setMistakeWords] = useState<MistakeWordDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [selectedMode, setSelectedMode] = useState<string>('quiz');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // 统计只在挂载和切换筛选时加载
  useEffect(() => {
    getMistakeBookStats().then(setStats).catch(() => {});
  }, [showResolved]);

  // 单词列表在筛选切换时重置到第1页
  useEffect(() => {
    setCurrentPage(1);
    loadWords(1);
  }, [showResolved]);

  const loadWords = async (page: number) => {
    try {
      setLoading(true);
      const data = await getMistakeWords(!showResolved, undefined, page, PAGE_SIZE);
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
      const response = await startMistakePractice({
        learning_mode: selectedMode,
        limit: 20,
        only_unresolved: true,
      });

      if (response.practice_words.length === 0) {
        toast.info(response.message);
        return;
      }

      // 将错题单词存储到sessionStorage,供学习页面使用
      sessionStorage.setItem('mistake_practice_words', JSON.stringify(response.practice_words));
      sessionStorage.setItem('is_mistake_practice', 'true');

      // 跳转到对应的学习模式
      // 注意: 这里使用一个特殊的unitId (0或'mistake')来标识错题练习模式
      const modeRoutes: { [key: string]: string } = {
        quiz: '/student/units/0/quiz',
        spelling: '/student/units/0/spelling',
        fillblank: '/student/units/0/fillblank',
      };

      const route = modeRoutes[selectedMode];
      if (route) {
        navigate(route);
      } else {
        toast.warning('暂不支持该学习模式');
      }
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

            <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">
              📕 我的错题集
            </h1>

            <div className="w-24"></div>
          </div>
        </div>
      </nav>

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
                <span className="text-3xl font-bold">{stats.unresolved_mistakes}</span>
              </div>
              <p className="text-white/90">待攻克</p>
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

          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { id: 'quiz', name: '选择题', icon: '✅' },
              { id: 'spelling', name: '拼写', icon: '✏️' },
              { id: 'fillblank', name: '填空', icon: '📝' },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => setSelectedMode(mode.id)}
                className={`p-4 rounded-xl border-2 transition-all ${
                  selectedMode === mode.id
                    ? 'border-primary bg-primary/10 scale-105'
                    : 'border-gray-200 hover:border-primary/50'
                }`}
              >
                <div className="text-3xl mb-2">{mode.icon}</div>
                <div className="font-medium">{mode.name}</div>
              </button>
            ))}
          </div>

          <button
            onClick={handleStartPractice}
            disabled={!stats || stats.unresolved_mistakes === 0}
            className="w-full py-4 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {stats && stats.unresolved_mistakes > 0
              ? `开始练习 (${stats.unresolved_mistakes}个待攻克)`
              : '暂无待练习错题'}
          </button>

          {/* 错题闯关入口 */}
          {stats && stats.unresolved_mistakes > 0 && (
            <button
              onClick={() => navigate('/student/mistake-challenge')}
              className="w-full mt-3 py-4 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all"
            >
              🏰 错题闯关模式 ({Math.ceil(stats.unresolved_mistakes / 5)} 关)
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
                {mistakeWords.map((word, index) => (
                  <motion.div
                    key={word.word_id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: index * 0.05 }}
                    className={`border-2 rounded-xl p-4 ${
                      word.is_resolved
                        ? 'border-green-200 bg-green-50'
                        : 'border-red-200 bg-red-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-2xl font-bold">{word.word}</h3>
                          {word.phonetic && (
                            <ColoredPhonetic phonetic={word.phonetic} className="text-base" />
                          )}
                          {word.is_resolved && (
                            <span className="px-2 py-1 bg-green-500 text-white text-xs rounded-full">
                              已掌握
                            </span>
                          )}
                        </div>
                        <p className="text-gray-700 mb-3">{word.meaning}</p>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500">总错误:</span>
                            <span className="font-bold text-red-600">{word.total_mistakes}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500">最近7天:</span>
                            <span className="font-bold text-orange-600">{word.recent_mistakes}</span>
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

                        {/* 错误模式统计 */}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {word.quiz_wrong > 0 && (
                            <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded">
                              选择题错{word.quiz_wrong}次
                            </span>
                          )}
                          {word.spelling_wrong > 0 && (
                            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded">
                              拼写错{word.spelling_wrong}次
                            </span>
                          )}
                          {word.fillblank_wrong > 0 && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                              填空错{word.fillblank_wrong}次
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="ml-4">
                        <div className="flex gap-1">
                          {[0, 1, 2, 3, 4].map((level) => (
                            <div
                              key={level}
                              className={`w-2 h-8 rounded ${
                                level < word.mastery_level
                                  ? 'bg-green-500'
                                  : 'bg-gray-200'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
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
