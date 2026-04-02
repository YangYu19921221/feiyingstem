import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getBookProgress } from '../api/progress';
import type { BookProgress } from '../api/progress';
import { ArrowLeft, ChevronDown } from 'lucide-react';

const UnitSelector = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [bookProgress, setBookProgress] = useState<BookProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [expandedUnitId, setExpandedUnitId] = useState<number | null>(null);

  useEffect(() => {
    if (bookId) {
      loadBookProgress(parseInt(bookId));
    }
  }, [bookId]);

  const loadBookProgress = async (id: number) => {
    try {
      setLoading(true);
      const data = await getBookProgress(id);
      setBookProgress(data);
    } catch (error) {
      console.error('加载单词本进度失败:', error);
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true;
    }
  };

  const handleStartLearning = (unitId: number, mode: string) => {
    navigate(`/student/units/${unitId}/${mode}`);
  };

  const handleBack = () => {
    navigate('/student/dashboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    );
  }

  if (!bookProgress) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <span className="text-6xl mb-4 block">😞</span>
          <p className="text-gray-500">加载失败</p>
          <button
            onClick={handleBack}
            className="mt-4 px-4 py-2 bg-primary text-white rounded-lg"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  const learningModes = [
    { key: 'classify', icon: '🧠', name: '分类', color: 'from-teal-500 to-emerald-500', requiresPrevious: null },
    { key: 'quiz', icon: '✅', name: '测试', color: 'from-green-500 to-teal-500', badge: 'AI', requiresPrevious: 'classify' },
    { key: 'spelling', icon: '✏️', name: '拼写', color: 'from-purple-500 to-pink-500', badge: 'AI', requiresPrevious: 'quiz' },
    { key: 'fillblank', icon: '📝', name: '填空', color: 'from-orange-500 to-red-500', badge: 'AI', requiresPrevious: 'spelling' },
    { key: 'exam', icon: '📋', name: '考试', color: 'from-indigo-500 to-purple-600', badge: '测验', requiresPrevious: 'classify' },
  ];

  // 按 unit_number 排序
  const sortedUnits = bookProgress
    ? [...bookProgress.units].sort((a, b) => (a.unit_number || 0) - (b.unit_number || 0))
    : [];

  // 找到第一个未完成的单元，作为"当前学习"高亮
  const firstIncompleteIndex = sortedUnits.findIndex(u => !u.is_completed);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div className="flex items-center gap-3 flex-1">
              <span className="text-2xl">📖</span>
              <div>
                <h1 className="text-lg font-bold text-gray-800">{bookProgress.book_name}</h1>
                <p className="text-xs text-gray-500">
                  {bookProgress.unit_count} 个单元 · {bookProgress.word_count} 个单词
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">整体进度</p>
              <p className="text-xl font-bold text-primary">
                {bookProgress.progress_percentage.toFixed(0)}%
              </p>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* 单元列表 */}
        {bookProgress.units.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white rounded-2xl p-12 text-center shadow-md"
          >
            <span className="text-6xl mb-4 block">📭</span>
            <p className="text-gray-500 mb-2">该单词本还没有单元</p>
            <p className="text-sm text-gray-400">等待老师添加单元</p>
          </motion.div>
        ) : (
          <div className="bg-white rounded-2xl shadow-md overflow-hidden divide-y divide-gray-100">
            {sortedUnits.map((unit, index) => {
              const isExpanded = expandedUnitId === unit.unit_id;
              const isCurrent = index === firstIncompleteIndex;
              const progressColor = unit.is_completed
                ? 'from-green-400 to-green-500'
                : unit.progress_percentage > 0
                ? 'from-blue-400 to-cyan-500'
                : 'from-gray-300 to-gray-300';

              return (
                <motion.div
                  key={unit.unit_id}
                  initial={!hasLoadedOnce.current ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: !hasLoadedOnce.current ? Math.min(0.03 * index, 0.3) : 0 }}
                >
                  {/* 单元行 */}
                  <div
                    className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition ${isCurrent ? 'bg-teal-50/50' : ''}`}
                    onClick={() => setExpandedUnitId(isExpanded ? null : unit.unit_id)}
                  >
                    {/* 序号 */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      unit.is_completed
                        ? 'bg-green-100 text-green-600'
                        : isCurrent
                        ? 'bg-teal-500 text-white'
                        : 'bg-gray-100 text-gray-400'
                    }`}>
                      {unit.is_completed ? '✓' : unit.unit_number || index + 1}
                    </div>

                    {/* 单元信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className={`font-bold truncate ${isCurrent ? 'text-teal-700' : 'text-gray-800'}`}>
                          {unit.unit_name}
                        </h3>
                        {isCurrent && (
                          <span className="px-1.5 py-0.5 bg-teal-500 text-white text-[10px] rounded font-medium shrink-0">
                            当前
                          </span>
                        )}
                      </div>
                      {/* 进度条 */}
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-gradient-to-r ${progressColor} rounded-full transition-all duration-500`}
                            style={{ width: `${Math.max(unit.progress_percentage, 0)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 w-8 text-right shrink-0">
                          {unit.progress_percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>

                    {/* 右侧按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartLearning(unit.unit_id, 'classify');
                      }}
                      className="px-4 py-2 bg-gradient-to-r from-teal-500 to-emerald-500 text-white rounded-lg text-sm font-medium hover:shadow-md transition shrink-0 active:scale-95"
                    >
                      学习
                    </button>

                    {/* 展开箭头 */}
                    <ChevronDown className={`w-4 h-4 text-gray-300 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>

                  {/* 展开详情 */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pt-1 bg-gray-50/50">
                          {/* 单元详情 */}
                          <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                            <span>{unit.word_count} 个单词</span>
                            <span>已掌握 {unit.completed_words} 个</span>
                            <span>剩余 {unit.word_count - unit.completed_words} 个</span>
                          </div>

                          {/* 断点续学提示 */}
                          {unit.has_progress && !unit.is_completed && (
                            <div className="mb-3 p-2.5 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2 text-sm">
                              <span>💡</span>
                              <span className="text-yellow-800">
                                从第 <span className="font-bold">{unit.current_word_index + 1}</span> 个单词继续
                                {unit.last_studied_at && (
                                  <span className="text-xs ml-1 opacity-75">
                                    (上次: {new Date(unit.last_studied_at).toLocaleString('zh-CN', {
                                      month: 'numeric',
                                      day: 'numeric',
                                      hour: 'numeric',
                                      minute: 'numeric'
                                    })})
                                  </span>
                                )}
                              </span>
                            </div>
                          )}

                          {unit.is_completed && (
                            <div className="mb-3 p-2.5 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-sm">
                              <span>🔄</span>
                              <span className="text-green-800">已完成，可重新复习巩固</span>
                            </div>
                          )}

                          {/* 其他学习模式 */}
                          <p className="text-xs text-gray-400 mb-2">其他学习模式:</p>
                          <div className="grid grid-cols-4 gap-2">
                            {learningModes.filter(m => m.key !== 'classify').map((mode) => (
                              <button
                                key={mode.key}
                                onClick={() => handleStartLearning(unit.unit_id, mode.key)}
                                className={`relative py-2 px-2 rounded-lg shadow-sm font-medium flex items-center justify-center gap-1 bg-gradient-to-r ${mode.color} text-white hover:shadow-md transition text-xs active:scale-95`}
                              >
                                <span>{mode.icon}</span>
                                <span>{mode.name}</span>
                                {mode.badge && (
                                  <span className="absolute -top-1 -right-1 px-1 py-0.5 bg-white text-purple-600 text-[10px] rounded-full font-bold shadow leading-none">
                                    {mode.badge}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default UnitSelector;
