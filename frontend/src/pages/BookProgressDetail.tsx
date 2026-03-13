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
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    );
  }

  if (!progress) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-pink-50 flex items-center justify-center">
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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-pink-50">
      {/* 顶部导航 */}
      <div className="bg-white shadow-sm">
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
          <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center gap-3">
            <span>📊</span>
            {progress.book_name}
          </h1>
          <p className="text-gray-600">查看学习进度和单元详情</p>
        </motion.div>

        {/* 总体进度卡片 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-8 shadow-lg mb-8"
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
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center p-4 bg-blue-50 rounded-xl">
                <div className="text-3xl font-bold text-blue-600">{progress.word_count}</div>
                <div className="text-sm text-gray-600 mt-1">总单词数</div>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-xl">
                <div className="text-3xl font-bold text-green-600">{progress.completed_words}</div>
                <div className="text-sm text-gray-600 mt-1">已完成</div>
              </div>
              <div className="text-center p-4 bg-purple-50 rounded-xl">
                <div className="text-3xl font-bold text-purple-600">{progress.unit_count}</div>
                <div className="text-sm text-gray-600 mt-1">单元数</div>
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
              className="bg-white rounded-2xl p-12 text-center shadow-md"
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
                  className="bg-white rounded-xl p-6 shadow-md hover:shadow-lg transition"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* 单元信息 */}
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-gray-800 mb-2">
                        Unit {unit.unit_number}: {unit.unit_name}
                      </h3>
                      <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                        <span>📝 {unit.word_count} 个单词</span>
                        <span>✅ {unit.completed_words} 已完成</span>
                        {unit.has_progress && unit.learning_mode && (
                          <span>🎯 模式: {unit.learning_mode}</span>
                        )}
                      </div>
                      {unit.last_studied_at && (
                        <div className="text-xs text-gray-500 mt-2">
                          上次学习: {new Date(unit.last_studied_at).toLocaleString('zh-CN')}
                        </div>
                      )}
                    </div>

                    {/* 进度条和按钮 */}
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:w-1/2">
                      <div className="flex-1 w-full">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-600">进度</span>
                          <span className="font-bold text-primary">
                            {unit.progress_percentage.toFixed(0)}%
                          </span>
                        </div>
                        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${unit.progress_percentage}%` }}
                            transition={{ duration: 0.8, delay: 0.2 + 0.1 * index }}
                            className="h-full bg-gradient-to-r from-green-400 to-blue-500"
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => navigate(`/student/units/${unit.unit_id}/flashcard`)}
                        className={`px-6 py-2 rounded-lg hover:shadow-md transition font-medium whitespace-nowrap ${
                          unit.is_completed
                            ? 'bg-green-500 text-white'
                            : 'bg-gradient-to-r from-primary to-secondary text-white'
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
