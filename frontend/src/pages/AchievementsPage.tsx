import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Award, Lock, Trophy, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getMyAchievements, getMyStats, type Achievement, type UserStats } from '../api/achievements';

const AchievementsPage = () => {
  const navigate = useNavigate();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalUnlocked, setTotalUnlocked] = useState(0);
  const [totalPoints, setTotalPoints] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [achievementsData, statsData] = await Promise.all([
        getMyAchievements(),
        getMyStats()
      ]);

      setAchievements(achievementsData.achievements);
      setTotalUnlocked(achievementsData.total_unlocked);
      setTotalPoints(achievementsData.total_points);
      setStats(statsData);
    } catch (error) {
      console.error('加载成就数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    );
  }

  const unlockedAchievements = achievements.filter(a => a.unlocked);
  const lockedAchievements = achievements.filter(a => !a.unlocked);
  const progressPercentage = achievements.length > 0
    ? (totalUnlocked / achievements.length * 100).toFixed(0)
    : '0';

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50">
      {/* 顶部导航 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div className="flex items-center gap-3">
              <Trophy className="w-8 h-8 text-yellow-500" />
              <h1 className="text-2xl font-bold text-gray-800">我的成就</h1>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-2">
              <Trophy className="w-6 h-6 text-yellow-500" />
              <p className="text-gray-600">已解锁</p>
            </div>
            <p className="text-4xl font-bold text-gray-800">
              {totalUnlocked}<span className="text-2xl text-gray-500">/{achievements.length}</span>
            </p>
            <p className="text-sm text-gray-500 mt-1">{progressPercentage}% 完成</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-2">
              <Award className="w-6 h-6 text-purple-500" />
              <p className="text-gray-600">总积分</p>
            </div>
            <p className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              {totalPoints}
            </p>
            <p className="text-sm text-gray-500 mt-1">持续增长</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📚</span>
              <p className="text-gray-600">学习单词</p>
            </div>
            <p className="text-4xl font-bold text-gray-800">{stats?.total_words || 0}</p>
            <p className="text-sm text-gray-500 mt-1">已掌握</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🔥</span>
              <p className="text-gray-600">连续打卡</p>
            </div>
            <p className="text-4xl font-bold text-orange-500">{stats?.consecutive_days || 0}</p>
            <p className="text-sm text-gray-500 mt-1">天</p>
          </motion.div>
        </div>

        {/* 已解锁成就 */}
        {unlockedAchievements.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <Target className="w-6 h-6 text-green-500" />
              <h2 className="text-2xl font-bold text-gray-800">已解锁 ({unlockedAchievements.length})</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {unlockedAchievements.map((achievement, index) => (
                <motion.div
                  key={achievement.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 * index }}
                  className="bg-gradient-to-br from-yellow-50 to-orange-50 border-2 border-yellow-300 rounded-2xl p-6 shadow-md hover:shadow-xl transition"
                >
                  <div className="flex items-start gap-4">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 + 0.1 * index, type: 'spring' }}
                      className="text-5xl"
                    >
                      {achievement.icon || '🏆'}
                    </motion.div>
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-gray-800 mb-1">
                        {achievement.name}
                      </h3>
                      <p className="text-sm text-gray-600 mb-2">
                        {achievement.description}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-yellow-500 text-white rounded-full text-xs font-bold">
                          +{achievement.reward_points} 积分
                        </span>
                        {achievement.unlocked_at && (
                          <span className="text-xs text-gray-500">
                            {new Date(achievement.unlocked_at).toLocaleDateString('zh-CN')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* 未解锁成就 */}
        {lockedAchievements.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Lock className="w-6 h-6 text-gray-400" />
              <h2 className="text-2xl font-bold text-gray-800">待解锁 ({lockedAchievements.length})</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {lockedAchievements.map((achievement, index) => (
                <motion.div
                  key={achievement.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 * index }}
                  className="bg-white border-2 border-gray-200 rounded-2xl p-6 opacity-60 hover:opacity-80 transition"
                >
                  <div className="flex items-start gap-4">
                    <div className="text-5xl grayscale">
                      {achievement.icon || '🏆'}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold text-gray-800">
                          {achievement.name}
                        </h3>
                        <Lock className="w-4 h-4 text-gray-400" />
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        {achievement.description}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-gray-300 text-gray-600 rounded-full text-xs font-bold">
                          +{achievement.reward_points} 积分
                        </span>
                        {achievement.condition_type && achievement.condition_value && (
                          <span className="text-xs text-gray-500">
                            {getConditionText(achievement.condition_type, achievement.condition_value)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* 空状态 */}
        {achievements.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white rounded-2xl p-12 text-center shadow-md"
          >
            <Trophy className="w-20 h-20 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 mb-2">暂无成就数据</p>
            <p className="text-sm text-gray-400">开始学习,解锁你的第一个成就!</p>
          </motion.div>
        )}
      </div>
    </div>
  );
};

// 辅助函数:将条件类型转换为中文说明
const getConditionText = (type: string, value: number): string => {
  switch (type) {
    case 'total_words':
      return `学习${value}个单词`;
    case 'consecutive_days':
      return `连续打卡${value}天`;
    case 'accuracy_rate':
      return `准确率达${value}%`;
    case 'perfect_score':
      return `获得满分`;
    default:
      return '';
  }
};

export default AchievementsPage;
