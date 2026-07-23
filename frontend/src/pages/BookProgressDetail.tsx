import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../api/client';

interface UnitProgress {
  unit_id: number;
  unit_number: number;
  unit_name: string;
  word_count: number;
  completed_words: number;
  progress_percentage: number;
  has_progress: boolean;
  current_word_index: number;
  last_studied_at: string | null;
  learning_mode: string | null;
  is_completed: boolean;
}

interface BookProgress {
  book_id: number;
  book_name: string;
  unit_count: number;
  word_count: number;
  completed_words: number;
  progress_percentage: number;
  units: UnitProgress[];
}

const BookProgressDetail = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<BookProgress | null>(null);

  useEffect(() => {
    fetchProgress();
  }, [bookId]);

  const fetchProgress = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('access_token');
      const data = await api.get(`/student/books/${bookId}/progress`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setProgress(data);
    } catch (error) {
      console.error('获取进度失败:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    );
  }

  if (!progress) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5">
        <div className="text-center">
          <span className="text-6xl mb-4 block">😕</span>
          <p className="text-gray-500">无法加载进度数据</p>
          <button
            onClick={() => navigate('/student/dashboard')}
            className="mt-4 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* 顶部导航 */}
      <div className="bg-white/95 border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <button
            onClick={() => navigate('/student/dashboard')}
            className="flex items-center gap-2 text-gray-600 hover:text-primary transition"
          >
            <span>←</span>
            <span>返回首页</span>
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 标题 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <p className="text-xs font-semibold text-slate-500 mb-2">学习进度</p>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-800 mb-2 flex items-center gap-3">
            <span className="text-2xl md:text-3xl">📊</span>
            {progress.book_name}
          </h1>
          <p className="text-slate-500">查看学习进度和单元详情，按单元继续学习</p>
        </motion.div>

        {/* 总体进度卡片 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-7 mb-8"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-6">总体进度</h2>

          {/* 进度环形图 */}
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="relative w-48 h-48">
              {/* 简化版进度环 */}
              <div className="absolute inset-0 rounded-full border-8 border-gray-200"></div>
              <div
                className="absolute inset-0 rounded-full border-8 border-primary"
                style={{
                  clipPath: `polygon(50% 50%, 50% 0%, ${
                    progress.progress_percentage >= 50
                      ? '100% 0%, 100% 100%, 50% 100%'
                      : `${50 + 50 * Math.sin((progress.progress_percentage / 50) * Math.PI)}% ${
                          50 - 50 * Math.cos((progress.progress_percentage / 50) * Math.PI)
                        }%`
                  }, 50% 50%)`,
                }}
              ></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl font-bold text-primary">
                    {progress.progress_percentage.toFixed(0)}%
                  </div>
                  <div className="text-sm text-gray-500 mt-1">完成度</div>
                </div>
              </div>
            </div>

            {/* 统计信息 */}
            <div className="flex-1 grid grid-cols-3 gap-2 sm:gap-4">
              <div className="text-center p-3 sm:p-4 bg-sky-50 rounded-xl border border-sky-100">
                <div className="text-2xl sm:text-3xl font-bold text-sky-600">{progress.word_count}</div>
                <div className="text-xs sm:text-sm text-slate-600 mt-1">总单词数</div>
              </div>
              <div className="text-center p-3 sm:p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <div className="text-2xl sm:text-3xl font-bold text-emerald-600">{progress.completed_words}</div>
                <div className="text-xs sm:text-sm text-slate-600 mt-1">已完成</div>
              </div>
              <div className="text-center p-3 sm:p-4 bg-amber-50 rounded-xl border border-amber-100">
                <div className="text-2xl sm:text-3xl font-bold text-amber-600">{progress.unit_count}</div>
                <div className="text-xs sm:text-sm text-slate-600 mt-1">单元数</div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* 单元详情列表 */}
        <div>
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>📚</span> 单元详情
          </h2>

          {progress.units.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center"
            >
              <span className="text-6xl mb-4 block">📭</span>
              <p className="text-gray-500">暂无单元数据</p>
            </motion.div>
          ) : (
            <div className="space-y-4">
              {progress.units.map((unit, index) => (
                <motion.div
                  key={unit.unit_id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 * index }}
                  className="bg-white rounded-xl border border-slate-200/80 p-5 sm:p-6 hover:border-sky-200 transition-colors"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* 单元信息 */}
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-slate-800 mb-2">
                        Unit {unit.unit_number}: {unit.unit_name}
                      </h3>
                      <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                        <span>📝 {unit.word_count} 个单词</span>
                        <span>✅ {unit.completed_words} 已完成</span>
                        {unit.has_progress && unit.learning_mode && (
                          <span>🎯 模式: {unit.learning_mode}</span>
                        )}
                      </div>
                      {unit.last_studied_at && (
                        <div className="text-xs text-slate-400 mt-2">
                          上次学习: {new Date(unit.last_studied_at).toLocaleString('zh-CN')}
                        </div>
                      )}
                    </div>

                    {/* 进度条和按钮 */}
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:w-1/2">
                      <div className="flex-1 w-full">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-slate-500">进度</span>
                          <span className="font-bold text-sky-600">
                            {unit.progress_percentage.toFixed(0)}%
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${unit.progress_percentage}%` }}
                            transition={{ duration: 0.8, delay: 0.2 + 0.1 * index }}
                            className="h-full bg-sky-500"
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => navigate(`/student/units/${unit.unit_id}/classify`)}
                        className={`w-full md:w-auto px-6 py-2.5 rounded-lg transition-colors font-medium whitespace-nowrap ${
                          unit.is_completed
                            ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                            : 'bg-sky-600 text-white hover:bg-sky-700'
                        }`}
                      >
                        {unit.is_completed ? '✓ 已完成' : unit.has_progress ? '继续学习' : '开始学习'}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookProgressDetail;
