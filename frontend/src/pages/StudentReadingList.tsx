import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getStudentPassages } from '../api/reading';
import type { StudentPassageListItem } from '../api/reading';

const StudentReadingList = () => {
  const navigate = useNavigate();
  const [passages, setPassages] = useState<StudentPassageListItem[]>([]);
  const [loading, setLoading] = useState(true);
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
      const params: any = {};
      if (filter.topic) params.topic = filter.topic;
      if (filter.difficulty) params.difficulty = filter.difficulty;
      if (filter.only_assigned) params.only_assigned = true;

      const data = await getStudentPassages(params);
      setPassages(data);
    } catch (error) {
      console.error('加载阅读文章失败:', error);
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
      'from-blue-400 to-cyan-500',
      'from-yellow-400 to-orange-500',
      'from-orange-500 to-red-500',
      'from-red-500 to-pink-600',
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
        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
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
              <span>📖</span> 阅读理解
            </h1>
          </div>
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

            <label className="flex items-center gap-2 cursor-pointer">
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
        ) : passages.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">暂无阅读文章</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {passages.map((passage, index) => (
              <motion.div
                key={passage.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => navigate(`/student/reading/${passage.id}`)}
                className="bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 cursor-pointer overflow-hidden group"
              >
                {/* 封面图 */}
                <div
                  className={`h-32 bg-gradient-to-br ${getDifficultyColor(passage.difficulty)} relative overflow-hidden`}
                >
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-black/5 transition"></div>
                  <div className="absolute top-3 left-3">{getStatusBadge(passage)}</div>
                  {passage.deadline && (
                    <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-medium text-gray-700">
                      ⏰ {new Date(passage.deadline).toLocaleDateString()}
                    </div>
                  )}
                  <div className="absolute bottom-3 left-3 text-white font-bold text-2xl drop-shadow-lg">
                    📖
                  </div>
                </div>

                {/* 内容 */}
                <div className="p-5">
                  <h3 className="text-lg font-bold text-gray-800 mb-2 line-clamp-2 group-hover:text-primary transition">
                    {passage.title}
                  </h3>

                  <div className="flex items-center gap-2 mb-3">
                    {passage.topic && (
                      <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs">
                        {passage.topic}
                      </span>
                    )}
                    <span className="px-2 py-1 bg-purple-50 text-purple-600 rounded text-xs">
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
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`w-full mt-4 py-2.5 rounded-lg font-medium text-white transition ${
                      passage.is_completed
                        ? 'bg-green-500 hover:bg-green-600'
                        : 'bg-gradient-to-r from-primary to-secondary hover:shadow-lg'
                    }`}
                  >
                    {passage.is_completed
                      ? '🎉 查看成绩'
                      : passage.is_started
                      ? '📝 继续答题'
                      : '🚀 开始阅读'}
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentReadingList;
