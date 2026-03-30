import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, Star, Trophy, Clock, Target, TrendingUp, ArrowLeft, Play } from 'lucide-react';
import { checkAchievements, type UnlockedAchievement } from '../api/achievements';
import { earnFood, feedPet, type EarnFoodResponse } from '../api/pet';
import AchievementModal from '../components/AchievementModal';
import { useAudio } from '../hooks/useAudio';

interface CompletionData {
  mode: string;
  modeName: string;
  score: number;
  total: number;
  timeSpent?: number;
  weakWords?: Array<{
    word: string;
    meaning: string;
    attempts: number;
  }>;
  unitId: number;
  unitName?: string;
  totalUnitWords?: number;
}

const CompletionScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const data = location.state as CompletionData;

  const { playAudio } = useAudio();
  const [showConfetti, setShowConfetti] = useState(true);
  const [unlockedAchievements, setUnlockedAchievements] = useState<UnlockedAchievement[]>([]);
  const [showAchievementModal, setShowAchievementModal] = useState(false);
  const [foodResult, setFoodResult] = useState<EarnFoodResponse | null>(null);
  const [feedingPet, setFeedingPet] = useState(false);
  const [feedMessage, setFeedMessage] = useState('');

  useEffect(() => {
    // 5秒后停止彩带动画以节省性能
    const timer = setTimeout(() => {
      setShowConfetti(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // 检查成就
    if (data) {
      checkNewAchievements();
      // 完成练习后赚取宠物粮
      earnFood({
        score: data.score,
        total: data.total,
        mode: data.mode as 'classify' | 'quiz' | 'fillblank' | 'spelling',
      }).then(res => setFoodResult(res)).catch(() => {});
    }
  }, []);

  const checkNewAchievements = async () => {
    try {
      const achievements = await checkAchievements({
        mode: data.mode,
        score: data.score,
        total: data.total,
        time_spent: data.timeSpent
      });

      if (achievements.length > 0) {
        setUnlockedAchievements(achievements);
        // 延迟显示成就弹窗,让完成页面先展示
        setTimeout(() => {
          setShowAchievementModal(true);
        }, 2000);
      }
    } catch (error) {
      console.error('检查成就失败:', error);
    }
  };

  if (!data) {
    navigate(-1);
    return null;
  }

  const percentage = (data.score / data.total * 100).toFixed(0);
  const isExcellent = parseInt(percentage) >= 90;
  const isGood = parseInt(percentage) >= 70;

  const formatTime = (seconds?: number) => {
    if (!seconds) return '未计时';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
  };

  // 根据模式返回不同的颜色主题
  const getThemeColors = () => {
    switch (data.mode) {
      case 'classify':
        return {
          gradient: 'from-teal-500 via-emerald-500 to-green-500',
          bg: 'from-teal-50 via-emerald-50 to-green-50',
          icon: '🧠'
        };
      case 'spelling':
        return {
          gradient: 'from-purple-500 via-pink-500 to-blue-500',
          bg: 'from-purple-50 via-pink-50 to-blue-50',
          icon: '✏️'
        };
      case 'fillblank':
        return {
          gradient: 'from-orange-500 via-pink-500 to-red-500',
          bg: 'from-orange-50 via-yellow-50 to-pink-50',
          icon: '📝'
        };
      case 'quiz':
        return {
          gradient: 'from-green-500 via-emerald-500 to-teal-500',
          bg: 'from-green-50 via-emerald-50 to-teal-50',
          icon: '✅'
        };
      default:
        return {
          gradient: 'from-blue-500 to-purple-500',
          bg: 'from-blue-50 to-purple-50',
          icon: '🎯'
        };
    }
  };

  const theme = getThemeColors();

  // 计算获得的星星数
  const getStars = () => {
    const percent = parseInt(percentage);
    if (percent >= 90) return 3;
    if (percent >= 70) return 2;
    if (percent >= 50) return 1;
    return 0;
  };

  const stars = getStars();

  const handleFeedPet = async () => {
    setFeedingPet(true);
    try {
      const res = await feedPet();
      setFeedMessage(res.message);
      if (foodResult) {
        setFoodResult({ ...foodResult, food_balance: res.pet.food_balance });
      }
    } catch (err: any) {
      setFeedMessage(err?.response?.data?.detail || '喂食失败');
    } finally {
      setFeedingPet(false);
    }
  };

  return (
    <div className={`min-h-screen bg-gradient-to-br ${theme.bg} relative overflow-hidden`}>
      {/* 简易彩带效果 (使用CSS动画) */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {Array.from({ length: 50 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{
                x: Math.random() * window.innerWidth,
                y: -20,
                rotate: Math.random() * 360
              }}
              animate={{
                y: window.innerHeight + 20,
                rotate: Math.random() * 360 + 720
              }}
              transition={{
                duration: Math.random() * 2 + 3,
                delay: Math.random() * 0.5,
                ease: 'linear'
              }}
              className={`absolute w-3 h-8 ${
                ['bg-red-500', 'bg-blue-500', 'bg-yellow-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500'][i % 6]
              } rounded-sm`}
            />
          ))}
        </div>
      )}

      {/* 顶部导航 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 px-4 py-2 hover:bg-white rounded-xl transition-all hover:shadow-md"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
            <span className="text-gray-600 font-medium">返回</span>
          </button>
        </div>
      </nav>

      {/* 主内容区 */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* 标题区 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="text-8xl mb-6"
          >
            {isExcellent ? '🎉' : isGood ? '👏' : '💪'}
          </motion.div>

          <h1 className="text-4xl font-bold text-gray-800 mb-3">
            {isExcellent ? '太棒了!' : isGood ? '做得不错!' : '继续加油!'}
          </h1>
          <p className="text-xl text-gray-600">
            你已完成 <span className={`font-bold bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent`}>
              {data.modeName}
            </span> 学习
          </p>

          {/* 单元上下文 */}
          {data.unitName && (
            <p className="mt-3 text-sm text-gray-500 bg-white/60 inline-block px-4 py-1.5 rounded-full">
              📖 {data.unitName}
              {data.totalUnitWords ? ` · 本次练习 ${data.total}/${data.totalUnitWords} 个单词` : ''}
            </p>
          )}
        </motion.div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {/* 得分卡片 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-3 bg-gradient-to-r ${theme.gradient} rounded-xl`}>
                <Target className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-lg font-bold text-gray-700">正确率</h3>
            </div>
            <div className="text-center">
              <p className={`text-5xl font-bold bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent mb-2`}>
                {percentage}%
              </p>
              <p className="text-gray-500">
                {data.score} / {data.total} 题正确
              </p>
            </div>
          </motion.div>

          {/* 用时卡片 */}
          {data.timeSpent !== undefined && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white rounded-2xl p-6 shadow-lg"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-3 bg-gradient-to-r ${theme.gradient} rounded-xl`}>
                  <Clock className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-gray-700">用时</h3>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-gray-800 mb-2">
                  {formatTime(data.timeSpent)}
                </p>
                <p className="text-gray-500">
                  平均 {(data.timeSpent / data.total).toFixed(1)} 秒/题
                </p>
              </div>
            </motion.div>
          )}

          {/* 星星卡片 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-3 bg-gradient-to-r ${theme.gradient} rounded-xl`}>
                <Trophy className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-lg font-bold text-gray-700">获得星星</h3>
            </div>
            <div className="text-center">
              <div className="flex justify-center gap-2 mb-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{
                      delay: 0.6 + i * 0.1,
                      type: 'spring',
                      stiffness: 200
                    }}
                  >
                    <Star
                      className={`w-10 h-10 ${
                        i < stars
                          ? 'fill-yellow-400 text-yellow-400'
                          : 'fill-gray-200 text-gray-200'
                      }`}
                    />
                  </motion.div>
                ))}
              </div>
              <p className="text-gray-500">
                {stars === 3 ? '完美!' : stars === 2 ? '优秀!' : stars === 1 ? '良好!' : '继续努力!'}
              </p>
            </div>
          </motion.div>
        </div>

        {/* 宠物粮奖励卡片 */}
        {foodResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            className="bg-white rounded-2xl p-6 shadow-lg mb-8"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🦴</span>
                <h3 className="text-lg font-bold text-gray-700">获得宠物粮</h3>
              </div>
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.7, type: 'spring', stiffness: 300 }}
                className="text-3xl font-bold text-orange-500"
              >
                +{foodResult.food_earned}
              </motion.div>
            </div>
            <div className="flex flex-wrap gap-2 text-sm text-gray-500 mb-4">
              <span className="bg-gray-100 px-2 py-1 rounded-lg">基础 +{foodResult.breakdown.base}</span>
              <span className="bg-blue-50 px-2 py-1 rounded-lg">正确率 +{foodResult.breakdown.accuracy_bonus}</span>
              {foodResult.breakdown.mode_bonus > 0 && (
                <span className="bg-purple-50 px-2 py-1 rounded-lg">模式 +{foodResult.breakdown.mode_bonus}</span>
              )}
              {foodResult.is_first_today && (
                <span className="bg-yellow-50 px-2 py-1 rounded-lg">每日首练 +{foodResult.breakdown.daily_bonus}</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-gray-500">当前余额: 🦴 {foodResult.food_balance}</p>
              {foodResult.food_balance >= 5 ? (
                <button
                  onClick={handleFeedPet}
                  disabled={feedingPet}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white rounded-xl font-medium transition-colors"
                >
                  {feedingPet ? '喂食中...' : '🦴 5 喂食宠物'}
                </button>
              ) : (
                <span className="text-sm text-gray-400">粮食不足，继续练习吧</span>
              )}
            </div>
            {feedMessage && (
              <p className="mt-3 text-center text-green-600 font-medium">{feedMessage}</p>
            )}
          </motion.div>
        )}

        {/* 薄弱词汇列表 */}
        {data.weakWords && data.weakWords.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white rounded-2xl p-8 shadow-lg mb-8"
          >
            <div className="flex items-center gap-3 mb-6">
              <TrendingUp className="w-7 h-7 text-orange-500" />
              <h2 className="text-2xl font-bold text-gray-800">需要加强的单词</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.weakWords.map((word, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.7 + index * 0.1 }}
                  className="bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-200 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xl font-bold text-gray-800">{word.word}</p>
                        <button
                          onClick={() => playAudio(word.word)}
                          className="text-gray-400 hover:text-orange-500 transition-colors"
                          title="播放发音"
                        >
                          🔊
                        </button>
                      </div>
                      <p className="text-gray-600">{word.meaning}</p>
                    </div>
                    <div className="bg-orange-500 text-white px-3 py-1 rounded-full text-sm font-bold">
                      错 {word.attempts} 次
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* 学习建议 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          className="bg-white rounded-2xl p-6 shadow-lg mb-8"
        >
          <h3 className="text-lg font-bold text-gray-800 mb-3">💡 学习建议</h3>
          {parseInt(percentage) >= 90 ? (
            <p className="text-gray-600">
              掌握得很好！可以尝试下一个单元，或者用拼写模式挑战自己。
            </p>
          ) : parseInt(percentage) >= 70 ? (
            <div className="text-gray-600">
              <p className="mb-2">建议用拼写模式巩固这些单词：</p>
              <div className="flex flex-wrap gap-2">
                {data.weakWords?.map((w, i) => (
                  <span key={i} className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">
                    {w.word}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-gray-600">
              建议回到卡片模式重新学习这些单词，熟悉后再来练习。
            </p>
          )}
        </motion.div>

        {/* 激励语 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className={`bg-gradient-to-r ${theme.gradient} rounded-2xl p-8 text-white text-center shadow-2xl mb-8`}
        >
          <CheckCircle className="w-16 h-16 mx-auto mb-4" />
          <p className="text-2xl font-bold mb-2">
            {isExcellent
              ? '你的表现非常出色!保持这个状态!'
              : isGood
                ? '很不错的成绩!再接再厉!'
                : '不要气馁,多练习就会进步!'}
          </p>
          <p className="text-lg opacity-90">
            坚持每天学习,你会越来越棒! 💪
          </p>
        </motion.div>

        {/* 操作按钮 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.weakWords && data.weakWords.length > 0 && (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate(`/student/units/${data.unitId}/${data.mode}`, {
                state: { reviewWords: data.weakWords.map(w => w.word) }
              })}
              className="flex items-center justify-center gap-2 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-lg shadow-lg transition"
            >
              <Play className="w-5 h-5" />
              复习薄弱词汇
            </motion.button>
          )}

          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate(-1)}
            className={`flex items-center justify-center gap-2 py-4 bg-gradient-to-r ${theme.gradient} text-white rounded-xl font-bold text-lg shadow-lg`}
          >
            <CheckCircle className="w-5 h-5" />
            返回单元列表
          </motion.button>
        </div>
      </div>

      {/* 成就解锁弹窗 */}
      {showAchievementModal && (
        <AchievementModal
          achievements={unlockedAchievements}
          onClose={() => setShowAchievementModal(false)}
        />
      )}
    </div>
  );
};

export default CompletionScreen;
