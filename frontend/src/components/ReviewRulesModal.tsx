import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export type ReviewRulesAudience = 'student' | 'teacher' | 'parent';

interface Props {
  open: boolean;
  onClose: () => void;
  audience?: ReviewRulesAudience;
}

const STAGES = [
  { label: '5 分钟', color: '#ef4444' },
  { label: '30 分钟', color: '#f97316' },
  { label: '12 小时', color: '#f59e0b' },
  { label: '1 天', color: '#eab308' },
  { label: '2 天', color: '#84cc16' },
  { label: '4 天', color: '#22c55e' },
  { label: '7 天', color: '#14b8a6' },
  { label: '15 天', color: '#06b6d4' },
  { label: '30 天', color: '#3b82f6' },
  { label: '已毕业 🏆', color: '#5FD35F' },
];

const StageLadder = () => (
  <div className="flex items-center gap-1 overflow-x-auto pb-2">
    {STAGES.map((s, i) => (
      <div key={i} className="flex items-center gap-1 shrink-0">
        <div
          className="px-2.5 py-1 rounded-md text-white text-[11px] font-medium whitespace-nowrap"
          style={{ backgroundColor: s.color }}
        >
          {s.label}
        </div>
        {i < STAGES.length - 1 && <span className="text-gray-300 text-xs">→</span>}
      </div>
    ))}
  </div>
);

const RuleRow = ({ icon, title, desc }: { icon: string; title: string; desc: string }) => (
  <div className="flex items-start gap-3 py-2">
    <span className="text-xl shrink-0 leading-6">{icon}</span>
    <div className="min-w-0">
      <p className="font-medium text-gray-800 text-sm">{title}</p>
      <p className="text-gray-500 text-xs mt-0.5">{desc}</p>
    </div>
  </div>
);

const ReviewRulesModal = ({ open, onClose, audience = 'student' }: Props) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-800">复习是怎么安排的</h2>
                <p className="text-xs text-gray-400 mt-0.5">基于艾宾浩斯遗忘曲线</p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition"
                aria-label="关闭"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-5">
              {/* 通用：9 阶段楼梯 */}
              <section>
                <p className="text-xs text-gray-500 mb-2">单词的 9 个阶段（每答对一次进下一档）</p>
                <StageLadder />
              </section>

              {/* 学生视角 */}
              {audience === 'student' && (
                <>
                  <section className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="divide-y divide-amber-200/60">
                      <RuleRow
                        icon="✅"
                        title="答对 → 进下一台阶"
                        desc="间隔翻倍，越熟越少打扰你"
                      />
                      <RuleRow
                        icon="❌"
                        title="答错 → 退 2 台阶"
                        desc="不会清零，避免一次失误惩罚太重"
                      />
                      <RuleRow
                        icon="🏆"
                        title="走完 9 阶 = 已毕业"
                        desc="但仍每 30 天回温一次，确认没忘"
                      />
                    </div>
                  </section>

                  <section>
                    <p className="font-medium text-gray-800 text-sm mb-2">今天的复习清单</p>
                    <ul className="text-sm text-gray-600 space-y-1.5 list-disc list-inside">
                      <li>"今日待复习" = <span className="font-medium text-orange-600">到点该回顾的词</span></li>
                      <li>背一个减一个，<span className="font-medium">全部清零就是今日完成</span> 🎉</li>
                      <li>没做完，明天会和明天到期的合并显示</li>
                    </ul>
                  </section>
                </>
              )}

              {/* 教师视角 */}
              {audience === 'teacher' && (
                <>
                  <section className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                    <div className="divide-y divide-indigo-200/60">
                      <RuleRow icon="✅" title="答对 → 进下一阶段，间隔翻倍" desc="间隔最长可达 30 天" />
                      <RuleRow icon="❌" title="答错 → 回退 2 个阶段（不归零）" desc="一次失误不会清零进度" />
                      <RuleRow icon="🏆" title="毕业 = 已掌握，每 30 天回温" desc="作为长期记忆维持" />
                    </div>
                  </section>

                  <section>
                    <p className="font-medium text-gray-800 text-sm mb-2">每日学习数据表的 3 个复习列</p>
                    <div className="rounded-xl border border-gray-200 overflow-hidden text-sm">
                      <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-200">
                        <div className="px-3 py-2 font-medium text-gray-700">列</div>
                        <div className="px-3 py-2 font-medium text-gray-700">含义</div>
                        <div className="px-3 py-2 font-medium text-gray-700">看哪里</div>
                      </div>
                      <div className="grid grid-cols-3 border-b border-gray-100">
                        <div className="px-3 py-2 text-orange-600 font-medium">复习待</div>
                        <div className="px-3 py-2 text-gray-600">到期未做的累积</div>
                        <div className="px-3 py-2 text-gray-500 text-xs">数字偏大 → 学生几天没回顾</div>
                      </div>
                      <div className="grid grid-cols-3 border-b border-gray-100">
                        <div className="px-3 py-2 text-gray-700 font-medium">复习已</div>
                        <div className="px-3 py-2 text-gray-600">今日已完成的去重词数</div>
                        <div className="px-3 py-2 text-gray-500 text-xs">学生今日努力度</div>
                      </div>
                      <div className="grid grid-cols-3">
                        <div className="px-3 py-2 text-green-600 font-medium">已毕业</div>
                        <div className="px-3 py-2 text-gray-600">累计成熟词数</div>
                        <div className="px-3 py-2 text-gray-500 text-xs">长期效果，单调递增</div>
                      </div>
                    </div>
                  </section>

                  <section className="bg-gray-50 rounded-xl p-4">
                    <p className="font-medium text-gray-800 text-sm mb-2">常见家长问题怎么答</p>
                    <ul className="text-xs text-gray-600 space-y-2">
                      <li>
                        <span className="font-medium text-gray-700">Q：孩子有 80 个待复习？</span><br />
                        前几天到期没做累积下来；不补会按曲线遗忘，越拖越多。
                      </li>
                      <li>
                        <span className="font-medium text-gray-700">Q：已毕业是不是不用学了？</span><br />
                        不是。每 30 天还会冒一次，确认没忘，才算长期记忆。
                      </li>
                      <li>
                        <span className="font-medium text-gray-700">Q：为什么有些词每天都见？</span><br />
                        刚学的词处在 5 分/30 分/12 时阶段，本来就该高频出现，3 天后间隔就会拉长。
                      </li>
                    </ul>
                  </section>
                </>
              )}

              {/* 家长视角 */}
              {audience === 'parent' && (
                <>
                  <section className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                    <div className="divide-y divide-rose-200/60">
                      <RuleRow icon="📈" title="系统按遗忘规律安排复习" desc="刚学的词高频出现，熟了才会推远" />
                      <RuleRow icon="✅" title="连续答对推到下一档" desc="间隔最长 30 天" />
                      <RuleRow icon="🏆" title="毕业不等于不学" desc="每 30 天仍会回温一次，确认没忘" />
                    </div>
                  </section>

                  <section>
                    <p className="font-medium text-gray-800 text-sm mb-2">看孩子复习的 3 个数字</p>
                    <ul className="text-sm text-gray-600 space-y-1.5">
                      <li>
                        <span className="font-medium text-orange-600">今日待复习</span>：今天到期还没回顾的，正常 10–30 个；
                        长期 80+ 说明孩子最近几天没坚持
                      </li>
                      <li>
                        <span className="font-medium text-gray-700">今日已复习</span>：当天做完的数量
                      </li>
                      <li>
                        <span className="font-medium text-green-600">已毕业</span>：累计真正记住的单词数，单调增长
                      </li>
                    </ul>
                  </section>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-3 text-right">
              <button
                onClick={onClose}
                className="px-5 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition"
              >
                知道了
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ReviewRulesModal;
