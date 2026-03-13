import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getTeacherPassages, deletePassage } from '../api/reading';
import type { ReadingPassage } from '../api/reading';

const TeacherReadingList = () => {
  const navigate = useNavigate();
  const [passages, setPassages] = useState<ReadingPassage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    topic: '',
    difficulty: 0,
  });

  useEffect(() => {
    loadPassages();
  }, [filter]);

  const loadPassages = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (filter.topic) params.topic = filter.topic;
      if (filter.difficulty) params.difficulty = filter.difficulty;

      const data = await getTeacherPassages(params);
      setPassages(data);
    } catch (error) {
      console.error('加载文章失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (passageId: number) => {
    if (!window.confirm('确定要删除这篇文章吗？删除后将无法恢复。')) {
      return;
    }

    try {
      await deletePassage(passageId);
      setPassages(passages.filter((p) => p.id !== passageId));
      alert('删除成功！');
    } catch (error: any) {
      console.error('删除失败:', error);
      alert(error.response?.data?.detail || '删除失败');
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
      'from-blue-400 to-cyan-500',
      'from-yellow-400 to-orange-500',
      'from-orange-500 to-red-500',
      'from-red-500 to-pink-600',
    ];
    return colors[difficulty] || colors[3];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm mb-6">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-gray-600 hover:text-gray-800 transition"
            >
              ← 返回
            </button>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <span>📖</span> 阅读理解管理
            </h1>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/teacher/reading/create')}
            className="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-lg font-medium shadow-lg hover:shadow-xl transition"
          >
            + 创建新文章
          </motion.button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 pb-12">
        {/* 筛选栏 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-sm p-6 mb-6"
        >
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">📚 主题:</span>
              <select
                value={filter.topic}
                onChange={(e) => setFilter({ ...filter, topic: e.target.value })}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary outline-none"
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
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary outline-none"
              >
                <option value={0}>全部</option>
                <option value={1}>简单</option>
                <option value={2}>一般</option>
                <option value={3}>中等</option>
                <option value={4}>困难</option>
                <option value={5}>挑战</option>
              </select>
            </div>

            <div className="ml-auto text-sm text-gray-600">
              共 {passages.length} 篇文章
            </div>
          </div>
        </motion.div>

        {/* 文章列表 */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="mt-4 text-gray-600">加载中...</p>
          </div>
        ) : passages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white rounded-2xl p-12 text-center shadow-md"
          >
            <span className="text-6xl mb-4 block">📭</span>
            <p className="text-gray-500 mb-4">还没有阅读文章</p>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/teacher/reading/create')}
              className="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-lg font-medium shadow-lg"
            >
              + 创建第一篇文章
            </motion.button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {passages.map((passage, index) => (
              <motion.div
                key={passage.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden group"
              >
                {/* 封面 */}
                <div
                  className={`h-32 bg-gradient-to-br ${getDifficultyColor(passage.difficulty)} relative overflow-hidden`}
                >
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-black/5 transition"></div>
                  <div className="absolute top-3 right-3">
                    {passage.is_public ? (
                      <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                        🌐 公开
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                        🔒 私有
                      </span>
                    )}
                  </div>
                  <div className="absolute bottom-3 left-3 text-white font-bold text-2xl drop-shadow-lg">
                    📖
                  </div>
                </div>

                {/* 内容 */}
                <div className="p-5">
                  <h3 className="text-lg font-bold text-gray-800 mb-2 line-clamp-2 group-hover:text-primary transition">
                    {passage.title}
                  </h3>

                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {passage.topic && (
                      <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs">
                        {passage.topic}
                      </span>
                    )}
                    <span className="px-2 py-1 bg-purple-50 text-purple-600 rounded text-xs">
                      {getDifficultyLabel(passage.difficulty)}
                    </span>
                    {passage.grade_level && (
                      <span className="px-2 py-1 bg-green-50 text-green-600 rounded text-xs">
                        {passage.grade_level}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
                    <span>📝 {passage.word_count} 词</span>
                    <span>👁️ {passage.view_count} 阅读</span>
                    <span>✅ {passage.completion_count} 完成</span>
                  </div>

                  {/* 统计信息 */}
                  {passage.avg_score > 0 && (
                    <div className="pt-3 border-t border-gray-100 mb-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">平均分:</span>
                        <span className="font-medium text-primary">{passage.avg_score.toFixed(1)} 分</span>
                      </div>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex gap-2">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => navigate(`/teacher/reading/${passage.id}/edit`)}
                      className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition text-sm"
                    >
                      ✏️ 编辑
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => navigate(`/teacher/reading/${passage.id}/assign`)}
                      className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition text-sm"
                    >
                      📌 布置
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleDelete(passage.id)}
                      className="px-3 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition text-sm"
                    >
                      🗑️
                    </motion.button>
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

export default TeacherReadingList;
