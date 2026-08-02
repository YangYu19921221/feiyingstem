import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Award, BookOpenText, Flame, Lock, RefreshCw, Trophy, Target } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { getMyAchievements, getMyStats, type Achievement, type UserStats } from '../api/achievements';
import { AchievementIcon } from '../components/AchievementIcon';
import StudentIdentityBadge from '../components/StudentIdentityBadge';
import { getErrorMessage } from '../utils/errorMessage';

const AchievementsPage = () => {
  const goBack = useGoBack('/student/dashboard');
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [totalUnlocked, setTotalUnlocked] = useState(0);
  const [totalPoints, setTotalPoints] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
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
      setError(getErrorMessage(error, '成就数据暂时没有加载出来'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper px-4 py-10" aria-busy="true" aria-label="正在加载成就">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="h-32 animate-pulse rounded-2xl bg-white" />
          <div className="h-28 animate-pulse rounded-2xl bg-white" />
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl bg-white" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="card-soft w-full max-w-md rounded-2xl p-7 text-center sm:p-9" role="alert">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
            <RefreshCw className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">成就册暂时没打开</h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{error}</p>
          <button
            type="button"
            onClick={() => void loadData()}
            className="mt-6 min-h-11 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            重新加载
          </button>
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
    <div className="min-h-screen bg-paper page-warm-glow">
      {/* 顶部导航 */}
      <nav className="bg-white/85 backdrop-blur-md shadow-sm sticky top-0 z-20 border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => goBack()}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-orange-50 hover:text-orange-600"
              aria-label="返回"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                <Trophy className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display text-xl font-bold text-slate-800">我的成就</h1>
                <p className="hidden text-xs text-slate-500 sm:block">记录每一次学习突破</p>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-7 sm:py-8">
        <section className="student-colorful-surface mb-6 overflow-hidden rounded-2xl border border-amber-100 p-5 shadow-md sm:p-6">
          <div className="flex items-center justify-between gap-6">
            <div>
              <h2 className="font-display text-2xl font-bold text-slate-800">你已经解锁 {totalUnlocked} 项成就</h2>
              <p className="mt-2 text-sm text-slate-600">继续学习，新的徽章和积分会在这里点亮。</p>
            </div>
            <div className="hidden h-28 w-40 items-center justify-center rounded-xl bg-orange-50 text-accent-warm sm:flex" aria-hidden="true">
              <Trophy className="h-12 w-12" />
            </div>
          </div>
        </section>

        {/* 学生身份：家长拍照时一眼知道是谁 */}
        <StudentIdentityBadge tone="paper" className="mb-6" />

        {/* 成长概览：合并为一个表面，手机端不会被四张大卡占满首屏。 */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8 grid grid-cols-2 overflow-hidden rounded-2xl bg-white md:grid-cols-4 md:divide-x md:divide-black/[0.06]"
          aria-label="成就概览"
        >
          {[
            { label: '已解锁', value: `${totalUnlocked}/${achievements.length}`, note: `${progressPercentage}% 完成`, icon: Trophy },
            { label: '总积分', value: totalPoints, note: '持续增长', icon: Award },
            { label: '掌握单词', value: stats?.total_words || 0, note: '熟练度达标', icon: BookOpenText },
            { label: '连续打卡', value: stats?.consecutive_days || 0, note: '天', icon: Flame },
          ].map((item, index) => (
            <div
              key={item.label}
              className={`p-4 sm:p-5 ${index < 2 ? 'border-b border-black/[0.06] md:border-b-0' : ''} ${index % 2 === 0 ? 'border-r border-black/[0.06] md:border-r-0' : ''}`}
            >
              <div className="flex items-center gap-2 text-xs text-ink-soft">
                <item.icon className="h-4 w-4 text-accent-warm" aria-hidden="true" />
                {item.label}
              </div>
              <p className="mt-2 font-numeric text-2xl font-semibold text-ink sm:text-3xl">{item.value}</p>
              <p className="mt-1 text-xs text-ink-mute">{item.note}</p>
            </div>
          ))}
        </motion.section>

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
                  className="card-soft rounded-2xl bg-orange-50/50 p-5 transition hover:bg-orange-50"
                >
                  <div className="flex items-start gap-4">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.12 + 0.05 * index, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <AchievementIcon icon={achievement.icon} size={72} />
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
                  className="card-soft border border-gray-200 rounded-2xl p-5 opacity-65 hover:opacity-90 transition"
                >
                  <div className="flex items-start gap-4">
                    <div className="grayscale opacity-70">
                      <AchievementIcon icon={achievement.icon} size={72} />
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
      // 后端判定口径是 word_mastery.mastery_level>=3(已掌握),不是"学过"
      return `掌握${value}个单词`;
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
