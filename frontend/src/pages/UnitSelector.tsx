import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getBookProgress } from '../api/progress';
import type { BookProgress } from '../api/progress';
import { ArrowLeft } from 'lucide-react';

const UnitSelector = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [bookProgress, setBookProgress] = useState<BookProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false); // 使用ref避免触发重新渲染

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
      hasLoadedOnce.current = true; // 标记已加载,不触发渲染
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div className="flex items-center gap-3 flex-1">
              <span className="text-3xl">📖</span>
              <div>
                <h1 className="text-xl font-bold text-gray-800">{bookProgress.book_name}</h1>
                <p className="text-sm text-gray-500">
                  {bookProgress.unit_count} 个单元 · {bookProgress.word_count} 个单词
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">整体进度</p>
              <p className="text-2xl font-bold text-primary">
                {bookProgress.progress_percentage.toFixed(0)}%
              </p>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* 选择提示 */}
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">请选择要学习的单元</h2>
          <p className="text-gray-500">点击学习模式按钮开始学习</p>
        </div>

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
          <div className="space-y-6">
            {bookProgress.units.map((unit, index) => (
              <motion.div
                key={unit.unit_id}
                initial={!hasLoadedOnce.current ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: !hasLoadedOnce.current ? Math.min(0.05 * index, 0.3) : 0 }}
                className="bg-white rounded-2xl p-6 shadow-md hover:shadow-lg transition"
              >
                {/* 单元标题 */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl">📌</span>
                      <h3 className="text-xl font-bold text-gray-800">{unit.unit_name}</h3>
                      {unit.is_completed && (
                        <span className="px-3 py-1 bg-green-100 text-green-700 text-sm rounded-full font-medium">
                          ✅ 已完成
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 ml-11">
                      {unit.word_count} 个单词 · 已掌握 {unit.completed_words} 个 · 剩余 {unit.word_count - unit.completed_words} 个
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-primary">
                      {unit.progress_percentage.toFixed(0)}%
                    </p>
                    <p className="text-xs text-gray-500">完成度</p>
                  </div>
                </div>

                {/* 进度条 */}
                <div className="mb-4">
                  <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                    <motion.div
                      initial={!hasLoadedOnce.current ? { width: 0 } : { width: `${unit.progress_percentage}%` }}
                      animate={{ width: `${unit.progress_percentage}%` }}
                      transition={{ duration: 0.5, delay: !hasLoadedOnce.current ? 0.2 : 0 }}
                      className="h-full bg-gradient-to-r from-green-400 to-blue-500"
                    />
                  </div>
                </div>

                {/* 断点续学提示 */}
                {unit.has_progress && !unit.is_completed && (
                  <motion.div
                    initial={!hasLoadedOnce.current ? { opacity: 0, y: 5 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: !hasLoadedOnce.current ? 0.3 : 0 }}
                    className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2"
                  >
                    <span className="text-xl">💡</span>
                    <p className="text-sm text-yellow-800 flex-1">
                      继续上次的学习,从第 <span className="font-bold">{unit.current_word_index + 1}</span> 个单词开始
                      {unit.last_studied_at && (
                        <span className="text-xs ml-2 opacity-75">
                          (上次学习: {new Date(unit.last_studied_at).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: 'numeric'
                          })})
                        </span>
                      )}
                    </p>
                  </motion.div>
                )}

                {/* 已完成单元的复习提示 */}
                {unit.is_completed && (
                  <motion.div
                    initial={!hasLoadedOnce.current ? { opacity: 0, y: 5 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: !hasLoadedOnce.current ? 0.3 : 0 }}
                    className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2"
                  >
                    <span className="text-xl">🔄</span>
                    <p className="text-sm text-green-800 flex-1">
                      已完成学习，点击下方按钮可以重新复习巩固
                    </p>
                  </motion.div>
                )}

                {/* 学习模式按钮 */}
                <div>
                  <p className="text-sm text-gray-500 mb-3">选择学习模式:</p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {learningModes.map((mode, modeIndex) => {
                      return (
                        <motion.button
                          key={mode.key}
                          initial={!hasLoadedOnce.current ? { opacity: 0, scale: 0.95 } : false}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.2, delay: !hasLoadedOnce.current ? 0.3 + 0.03 * modeIndex : 0 }}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleStartLearning(unit.unit_id, mode.key)}
                          className={`relative py-3 px-4 rounded-lg shadow-md transition font-medium flex items-center justify-center gap-2 bg-gradient-to-r ${mode.color} text-white hover:shadow-lg cursor-pointer`}
                        >
                          <span className="text-xl">{mode.icon}</span>
                          <span>{mode.name}</span>
                          {mode.badge && (
                            <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-white text-purple-600 text-xs rounded-full font-bold shadow">
                              {mode.badge}
                            </span>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UnitSelector;
