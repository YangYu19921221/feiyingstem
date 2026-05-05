import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, Star, ArrowLeft, Play } from 'lucide-react';
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
  const pct = parseInt(percentage);
  const isExcellent = pct >= 90;
  const isGood = pct >= 70;

  const formatTime = (seconds?: number) => {
    if (!seconds) return '未计时';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
  };

  const getStars = () => {
    if (pct >= 90) return 3;
    if (pct >= 70) return 2;
    if (pct >= 50) return 1;
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
    <div className="min-h-screen bg-paper relative">
      {/* 彩带 — 暖橙色，不再六色乱炖 */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {Array.from({ length: 40 }).map((_, i) => (
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
              className={`absolute w-2 h-6 rounded-sm ${
                ['bg-accent-warm', 'bg-amber-400', 'bg-accent-warm/60'][i % 3]
              }`}
            />
          ))}
        </div>
      )}

      {/* 顶部导航 */}
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-ink-soft hover:text-ink transition text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-5 pt-10 pb-12">
        {/* Hero：折纸鹰飞翔插图 + 大数字 */}
        <section className="text-center mb-12">
          <motion.img
            src="/hero-completion.jpeg"
            alt=""
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="w-44 h-44 md:w-56 md:h-56 mx-auto mb-6 rounded-2xl object-cover"
          />
          <p className="text-ink-mute text-sm mb-2">
            {data.modeName} 学习完成
            {data.unitName && <> · {data.unitName}</>}
          </p>
          <h1 className="font-display text-5xl md:text-6xl font-semibold text-ink leading-none tracking-tight mb-3 font-numeric">
            {percentage}<span className="text-3xl md:text-4xl text-ink-soft">%</span>
          </h1>
          <p className="text-ink-soft text-base">
            {isExcellent ? '表现非常出色' : isGood ? '不错的成绩' : '继续努力会进步'}
          </p>
        </section>

        {/* 统计 — 三栏数据条带 */}
        <div className="bg-white rounded-2xl border border-black/[0.05] divide-y divide-black/[0.05] mb-8">
          <div className="px-5 py-4 flex items-baseline justify-between">
            <span className="text-ink-soft text-sm">答对</span>
            <span className="font-display font-semibold text-2xl text-ink font-numeric">
              {data.score}<span className="text-base text-ink-soft"> / {data.total}</span>
            </span>
          </div>
          {data.timeSpent !== undefined && (
            <div className="px-5 py-4 flex items-baseline justify-between">
              <span className="text-ink-soft text-sm">用时</span>
              <div className="flex items-baseline gap-2">
                <span className="font-display font-semibold text-2xl text-ink font-numeric">
                  {formatTime(data.timeSpent)}
                </span>
                <span className="text-xs text-ink-mute font-numeric">
                  平均 {(data.timeSpent / data.total).toFixed(1)}s/题
                </span>
              </div>
            </div>
          )}
          <div className="px-5 py-4 flex items-baseline justify-between">
            <span className="text-ink-soft text-sm">星星</span>
            <div className="flex items-center gap-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.3 + i * 0.1, type: 'spring', stiffness: 200 }}
                >
                  <Star
                    className={`w-6 h-6 ${
                      i < stars
                        ? 'fill-accent-warm text-accent-warm'
                        : 'fill-black/[0.06] text-black/[0.06]'
                    }`}
                  />
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* 宠物粮 */}
        {foodResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-2xl border border-black/[0.05] p-5 mb-8"
          >
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-display text-base font-semibold text-ink">获得宠物粮</h3>
              <span className="font-display text-2xl font-semibold text-accent-warm font-numeric">
                +{foodResult.food_earned}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs text-ink-mute mb-4">
              <span>基础 +{foodResult.breakdown.base}</span>
              <span>·</span>
              <span>正确率 +{foodResult.breakdown.accuracy_bonus}</span>
              {foodResult.breakdown.mode_bonus > 0 && (
                <><span>·</span><span>模式 +{foodResult.breakdown.mode_bonus}</span></>
              )}
              {foodResult.is_first_today && (
                <><span>·</span><span>每日首练 +{foodResult.breakdown.daily_bonus}</span></>
              )}
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-black/[0.05]">
              <p className="text-sm text-ink-soft font-numeric">余额 {foodResult.food_balance}</p>
              {foodResult.food_balance >= 5 ? (
                <button
                  onClick={handleFeedPet}
                  disabled={feedingPet}
                  className="px-4 py-2 bg-accent-warm hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
                >
                  {feedingPet ? '喂食中…' : '喂食宠物（5）'}
                </button>
              ) : (
                <span className="text-xs text-ink-mute">粮食不足</span>
              )}
            </div>
            {feedMessage && (
              <p className="mt-3 text-center text-sm text-ink-soft">{feedMessage}</p>
            )}
          </motion.div>
        )}

        {/* 薄弱词汇 */}
        {data.weakWords && data.weakWords.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white rounded-2xl border border-black/[0.05] p-5 mb-8"
          >
            <h2 className="font-display text-base font-semibold text-ink mb-4">需要加强的单词</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.weakWords.map((word, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + index * 0.05 }}
                  className="flex items-center justify-between gap-3 p-3 border-l-2 border-accent-warm bg-black/[0.015] rounded-r-md"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-display font-semibold text-ink truncate">{word.word}</p>
                      <button
                        onClick={() => playAudio(word.word)}
                        className="text-ink-mute hover:text-accent-warm transition shrink-0"
                        title="播放发音"
                      >
                        🔊
                      </button>
                    </div>
                    <p className="text-xs text-ink-soft truncate">{word.meaning}</p>
                  </div>
                  <span className="text-xs text-accent-warm font-numeric font-medium shrink-0">
                    错 {word.attempts}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* 学习建议 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="bg-white rounded-2xl border border-black/[0.05] p-5 mb-8"
        >
          <h3 className="font-display text-base font-semibold text-ink mb-2">学习建议</h3>
          {pct >= 90 ? (
            <p className="text-ink-soft text-sm leading-relaxed">
              掌握得很好。可以挑战下一个单元，或用拼写模式做更高强度练习。
            </p>
          ) : pct >= 70 ? (
            <div className="text-ink-soft text-sm leading-relaxed">
              <p className="mb-3">建议用拼写模式巩固这些单词：</p>
              <div className="flex flex-wrap gap-1.5">
                {data.weakWords?.map((w, i) => (
                  <span key={i} className="px-2 py-0.5 border border-black/10 text-ink rounded text-xs font-medium">
                    {w.word}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-ink-soft text-sm leading-relaxed">
              建议回到分类模式重新学习这些单词，熟悉后再回来挑战。
            </p>
          )}
        </motion.div>

        {/* 操作按钮 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.weakWords && data.weakWords.length > 0 && (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              onClick={() => navigate(`/student/units/${data.unitId}/${data.mode}`, {
                state: { reviewWords: data.weakWords!.map(w => w.word) }
              })}
              className="flex items-center justify-center gap-2 py-3.5 border border-black/15 text-ink rounded-xl text-base font-medium hover:bg-black/5 transition"
            >
              <Play className="w-4 h-4" />
              复习薄弱词
            </motion.button>
          )}

          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            onClick={() => navigate(-1)}
            className={`flex items-center justify-center gap-2 py-3.5 bg-accent-warm hover:opacity-90 text-white rounded-xl text-base font-semibold transition ${
              !(data.weakWords && data.weakWords.length > 0) ? 'md:col-span-2' : ''
            }`}
          >
            <CheckCircle className="w-4 h-4" />
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
