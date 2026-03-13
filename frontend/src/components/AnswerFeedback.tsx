/**
 * 答题反馈动画组件
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface AnswerFeedbackProps {
  isCorrect: boolean;
  scoreBreakdown: {
    base_score: number;
    difficulty_bonus: number;
    speed_bonus: number;
    combo_bonus: number;
    first_time_bonus: number;
    total_score: number;
    multiplier: number;
  };
  rankChange?: {
    old_rank?: number;
    new_rank?: number;
    rank_change: number;
  };
  comboStatus: {
    current: number;
    max: number;
    multiplier: number;
    next_milestone: number;
  };
  onClose: () => void;
}

const AnswerFeedback: React.FC<AnswerFeedbackProps> = ({
  isCorrect,
  scoreBreakdown,
  rankChange,
  comboStatus,
  onClose
}) => {
  const getComboFire = (combo: number) => {
    if (combo >= 20) return '🔥🔥🔥🔥🔥';
    if (combo >= 10) return '🔥🔥🔥';
    if (combo >= 5) return '🔥🔥';
    if (combo >= 2) return '🔥';
    return '';
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', duration: 0.5 }}
          className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 正确/错误图标 */}
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="text-center mb-6"
          >
            {isCorrect ? (
              <div className="text-8xl">✅</div>
            ) : (
              <div className="text-8xl">❌</div>
            )}
          </motion.div>

          {isCorrect ? (
            <>
              {/* 得分详情 */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mb-6"
              >
                <h3 className="text-xl font-bold text-center mb-4 text-gray-800">
                  🎉 回答正确!
                </h3>

                <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">基础分</span>
                    <span className="font-semibold text-gray-800">+{scoreBreakdown.base_score}</span>
                  </div>

                  {scoreBreakdown.difficulty_bonus > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">难度加成</span>
                      <span className="font-semibold text-blue-600">+{scoreBreakdown.difficulty_bonus}</span>
                    </div>
                  )}

                  {scoreBreakdown.speed_bonus > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">⚡ 速度奖励</span>
                      <span className="font-semibold text-green-600">+{scoreBreakdown.speed_bonus}</span>
                    </div>
                  )}

                  {scoreBreakdown.combo_bonus > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">🔥 连击奖励</span>
                      <span className="font-semibold text-orange-600">+{scoreBreakdown.combo_bonus}</span>
                    </div>
                  )}

                  {scoreBreakdown.first_time_bonus > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">🌟 首次答对</span>
                      <span className="font-semibold text-purple-600">+{scoreBreakdown.first_time_bonus}</span>
                    </div>
                  )}

                  {scoreBreakdown.multiplier > 1 && (
                    <div className="flex justify-between text-sm font-bold">
                      <span className="text-orange-600">倍数加成</span>
                      <span className="text-orange-600">×{scoreBreakdown.multiplier}</span>
                    </div>
                  )}

                  <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="font-bold text-gray-800">总得分</span>
                      <motion.span
                        initial={{ scale: 1 }}
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 0.5 }}
                        className="font-bold text-2xl text-orange-600"
                      >
                        +{scoreBreakdown.total_score}
                      </motion.span>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* 排名变化 */}
              {rankChange && rankChange.new_rank && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="mb-6"
                >
                  <div className={`rounded-lg p-4 text-center ${
                    rankChange.rank_change > 0
                      ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200'
                      : 'bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-200'
                  }`}>
                    {rankChange.rank_change > 0 ? (
                      <>
                        <div className="text-3xl mb-2">🎉</div>
                        <div className="font-bold text-green-700">
                          排名上升 {rankChange.rank_change} 位!
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {rankChange.old_rank && `#${rankChange.old_rank}`} → <span className="font-bold text-green-600">#{rankChange.new_rank}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-semibold text-blue-700">
                          当前排名
                        </div>
                        <div className="text-3xl font-bold text-blue-600 mt-1">
                          #{rankChange.new_rank}
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}

              {/* 连击状态 */}
              {comboStatus.current > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="mb-6"
                >
                  <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg p-4 text-center border-2 border-orange-200">
                    <div className="text-4xl mb-2">
                      {getComboFire(comboStatus.current)}
                    </div>
                    <div className="font-bold text-2xl text-orange-600 mb-1">
                      {comboStatus.current} 连击!
                    </div>
                    {comboStatus.multiplier > 1 && (
                      <div className="text-sm text-orange-700 font-semibold">
                        积分 ×{comboStatus.multiplier} 倍
                      </div>
                    )}
                    {comboStatus.next_milestone > comboStatus.current && (
                      <div className="text-xs text-gray-600 mt-2">
                        再答对 {comboStatus.next_milestone - comboStatus.current} 题达成 {comboStatus.next_milestone} 连击!
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </>
          ) : (
            <>
              {/* 答错反馈 */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mb-6"
              >
                <h3 className="text-xl font-bold text-center mb-4 text-gray-800">
                  回答错误
                </h3>

                <div className="bg-red-50 rounded-lg p-4 text-center border-2 border-red-200">
                  <div className="text-red-600 font-semibold mb-2">
                    {scoreBreakdown.total_score} 分
                  </div>
                  <div className="text-sm text-gray-600">
                    连击已中断,继续加油!
                  </div>
                </div>
              </motion.div>
            </>
          )}

          {/* 关闭按钮 */}
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            onClick={onClose}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold py-3 px-6 rounded-lg hover:shadow-lg transition-shadow"
          >
            继续答题
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AnswerFeedback;
