import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, TrendingUp, Users, BookOpen, Target } from 'lucide-react';
import api from '../api/client';

interface ClassOverviewStats {
  total_students: number;
  active_students: number;
  total_learning_time: number;
  total_words_learned: number;
  average_accuracy: number;
  total_sessions: number;
}

interface StudentLearningStats {
  user_id: number;
  username: string;
  full_name: string;
  total_learning_time: number;
  words_learned: number;
  accuracy_rate: number;
  study_sessions: number;
  last_active: string | null;
  weak_words_count: number;
}

interface WordDifficultyStats {
  word: string;
  total_attempts: number;
  correct_attempts: number;
  accuracy_rate: number;
  average_time: number;
}

interface LearningModeStats {
  learning_mode: string;
  total_sessions: number;
  total_time: number;
  average_accuracy: number;
}

const TeacherAnalytics = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<ClassOverviewStats | null>(null);
  const [students, setStudents] = useState<StudentLearningStats[]>([]);
  const [difficultWords, setDifficultWords] = useState<WordDifficultyStats[]>([]);
  const [modeStats, setModeStats] = useState<LearningModeStats[]>([]);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('access_token');
      const headers = { Authorization: `Bearer ${token}` };

      const [overviewData, studentsData, wordsData, modesData] = await Promise.all([
        api.get('/teacher/analytics/class/overview', { headers }),
        api.get('/teacher/analytics/class/students', { headers }),
        api.get('/teacher/analytics/words/difficulty', { headers }),
        api.get('/teacher/analytics/modes/stats', { headers }),
      ]);

      setOverview(overviewData.data);
      setStudents(studentsData.data);
      setDifficultWords(wordsData.data.slice(0, 10)); // 显示前10个最难单词
      setModeStats(modesData.data);
    } catch (error) {
      console.error('获取数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}小时${mins}分钟` : `${mins}分钟`;
  };

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'classify': return '🧠';
      case 'quiz': return '📝';
      case 'spelling': return '✍️';
      case 'fillblank': return '📋';
      default: return '📚';
    }
  };

  const getModeName = (mode: string) => {
    switch (mode) {
      case 'classify': return '分类学习';
      case 'quiz': return '选择题';
      case 'spelling': return '拼写练习';
      case 'fillblank': return '填空练习';
      default: return mode;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-gray-500 mt-4">加载数据中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* 顶部导航 */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <button
            onClick={() => navigate('/teacher/dashboard')}
            className="flex items-center gap-2 text-gray-600 hover:text-primary transition"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>返回仪表盘</span>
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 页面标题 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-primary" />
            班级学习数据分析
          </h1>
          <p className="text-gray-600">全面了解学生学习情况和教学效果</p>
        </motion.div>

        {/* 班级概览统计 */}
        {overview && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 text-white shadow-lg"
            >
              <div className="flex items-center justify-between mb-4">
                <Users className="w-8 h-8" />
                <span className="text-sm bg-white/20 px-3 py-1 rounded-full">学生</span>
              </div>
              <div className="text-4xl font-bold mb-1">{overview.total_students}</div>
              <div className="text-blue-100">总学生数</div>
              <div className="mt-2 text-sm">活跃: {overview.active_students} 人</div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg"
            >
              <div className="flex items-center justify-between mb-4">
                <BookOpen className="w-8 h-8" />
                <span className="text-sm bg-white/20 px-3 py-1 rounded-full">单词</span>
              </div>
              <div className="text-4xl font-bold mb-1">{overview.total_words_learned}</div>
              <div className="text-purple-100">累计学习单词</div>
              <div className="mt-2 text-sm">平均每人 {Math.round(overview.total_words_learned / overview.total_students)} 个</div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 text-white shadow-lg"
            >
              <div className="flex items-center justify-between mb-4">
                <Target className="w-8 h-8" />
                <span className="text-sm bg-white/20 px-3 py-1 rounded-full">准确率</span>
              </div>
              <div className="text-4xl font-bold mb-1">{overview.average_accuracy.toFixed(1)}%</div>
              <div className="text-green-100">班级平均准确率</div>
              <div className="mt-2 text-sm">学习时长: {formatTime(overview.total_learning_time)}</div>
            </motion.div>
          </div>
        )}

        {/* 学习模式统计 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-lg mb-8"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            📊 学习模式统计
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {modeStats.map((mode, index) => (
              <motion.div
                key={mode.learning_mode}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 * index }}
                className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-4"
              >
                <div className="text-3xl mb-2">{getModeIcon(mode.learning_mode)}</div>
                <div className="font-bold text-gray-800">{getModeName(mode.learning_mode)}</div>
                <div className="text-sm text-gray-600 mt-2">
                  <div>使用次数: {mode.total_sessions}</div>
                  <div>时长: {formatTime(mode.total_time)}</div>
                  <div>准确率: {mode.average_accuracy.toFixed(1)}%</div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* 学生学习排名 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-lg mb-8"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            🏆 学生学习排名
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 px-4">排名</th>
                  <th className="text-left py-3 px-4">姓名</th>
                  <th className="text-center py-3 px-4">学习时长</th>
                  <th className="text-center py-3 px-4">已学单词</th>
                  <th className="text-center py-3 px-4">准确率</th>
                  <th className="text-center py-3 px-4">练习次数</th>
                  <th className="text-center py-3 px-4">薄弱单词</th>
                  <th className="text-center py-3 px-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student, index) => (
                  <motion.tr
                    key={student.user_id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * index }}
                    className="border-b border-gray-100 hover:bg-gray-50 transition"
                  >
                    <td className="py-3 px-4">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                        index === 0 ? 'bg-yellow-400 text-white' :
                        index === 1 ? 'bg-gray-300 text-white' :
                        index === 2 ? 'bg-orange-300 text-white' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {index + 1}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium">{student.full_name}</div>
                      <div className="text-sm text-gray-500">@{student.username}</div>
                    </td>
                    <td className="py-3 px-4 text-center">{formatTime(student.total_learning_time)}</td>
                    <td className="py-3 px-4 text-center font-bold text-primary">{student.words_learned}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-1 rounded-full text-sm font-medium ${
                        student.accuracy_rate >= 80 ? 'bg-green-100 text-green-700' :
                        student.accuracy_rate >= 60 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {student.accuracy_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">{student.study_sessions}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-sm">
                        {student.weak_words_count}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => navigate(`/teacher/students/${student.user_id}`)}
                        className="text-primary hover:text-primary/80 font-medium text-sm"
                      >
                        查看详情
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* 困难单词统计 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-lg"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            🔥 最具挑战的单词 (Top 10)
          </h2>
          <div className="space-y-3">
            {difficultWords.map((word, index) => (
              <motion.div
                key={word.word}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 * index }}
                className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition"
              >
                <div className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center font-bold text-sm">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-lg">{word.word}</div>
                  <div className="text-sm text-gray-600">
                    尝试次数: {word.total_attempts} | 正确: {word.correct_attempts || 0}
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                  word.accuracy_rate >= 50 ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {(word.accuracy_rate || 0).toFixed(1)}%
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default TeacherAnalytics;
