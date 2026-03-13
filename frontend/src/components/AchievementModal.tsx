import { motion, AnimatePresence } from 'framer-motion';
import { X, Award } from 'lucide-react';

interface UnlockedAchievement {
  id: number;
  name: string;
  description: string;
  icon: string;
  reward_points: number;
}

interface AchievementModalProps {
  achievements: UnlockedAchievement[];
  onClose: () => void;
}

const AchievementModal = ({ achievements, onClose }: AchievementModalProps) => {
  if (achievements.length === 0) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* 背景遮罩 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* 成就卡片 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 50 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 50 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
        >
          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-full transition z-10"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>

          {/* 标题区 */}
          <div className="bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 p-8 text-center">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="text-7xl mb-3"
            >
              🎉
            </motion.div>
            <h2 className="text-3xl font-bold text-white mb-2">
              恭喜解锁新成就!
            </h2>
            <p className="text-white/90 text-lg">
              获得 {achievements.reduce((sum, a) => sum + a.reward_points, 0)} 积分
            </p>
          </div>

          {/* 成就列表 */}
          <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
            {achievements.map((achievement, index) => (
              <motion.div
                key={achievement.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                className="bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-300 rounded-2xl p-5"
              >
                <div className="flex items-start gap-4">
                  {/* 图标 */}
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 0.4 + index * 0.1, type: 'spring' }}
                    className="text-5xl flex-shrink-0"
                  >
                    {achievement.icon}
                  </motion.div>

                  {/* 内容 */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-xl font-bold text-gray-800">
                        {achievement.name}
                      </h3>
                      <Award className="w-5 h-5 text-yellow-600" />
                    </div>
                    <p className="text-gray-600 mb-2">
                      {achievement.description}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 bg-yellow-500 text-white rounded-full text-sm font-bold">
                        +{achievement.reward_points} 积分
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* 底部按钮 */}
          <div className="p-6 bg-gray-50">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onClose}
              className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-xl font-bold text-lg shadow-lg"
            >
              太棒了! 🎊
            </motion.button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default AchievementModal;
