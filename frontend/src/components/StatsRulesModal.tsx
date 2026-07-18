/**
 * 数据统计规则说明弹窗(教师端)
 * 用非技术语言解释"学习时长/词数/新词/效率"是怎么算出来的,
 * 老师看得懂才能跟家长解释清楚"为什么在教室坐了2小时只有6分钟"。
 */
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const Section = ({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) => (
  <div className="mb-5">
    <h4 className="flex items-center gap-2 font-semibold text-gray-800 text-sm mb-2">
      <span className="text-lg">{icon}</span>
      {title}
    </h4>
    <div className="text-[13px] text-gray-600 leading-relaxed space-y-1.5 pl-7">{children}</div>
  </div>
);

const StatsRulesModal = ({ open, onClose }: Props) => {
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
          className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-gray-800 mb-1">📏 这些数字是怎么算的?</h3>
            <p className="text-xs text-gray-400 mb-5">
              给老师的白话说明,方便您跟家长解释。所有数据都来自孩子在平台上的真实操作记录。
            </p>

            <Section icon="⏱️" title="学习时长 = 真正在学的时间,不是开着页面的时间">
              <p>孩子答题、翻卡、听写、背句子时才计时(点鼠标、动键盘都算在学)。以下时间<b>不算</b>:</p>
              <p>· <b>发呆</b>:超过 1 分钟没有任何操作,系统弹出提醒并暂停计时,人回来才继续算;</p>
              <p>· <b>切走</b>:切到别的网页/APP、锁屏、合上平板,立即停止计时;</p>
              <p>· 页面开着但人不动,一律不算。</p>
              <p className="text-orange-600">
                所以「在教室坐了 2 小时,时长只有 6 分钟」不是系统错了——是孩子真正动手学习的时间只有 6 分钟。
                表格里的「发呆」「切屏」次数就是佐证。
              </p>
            </Section>

            <Section icon="📗" title="学习单词 = 今天碰过的不同单词个数">
              <p>今天学过的单词,去掉重复后的数量。同一个词今天学 10 遍也只算 1 个。</p>
              <p>复习旧词也算在内——它反映的是「今天的学习量」。</p>
            </Section>

            <Section icon="🌱" title="「新N」= 今天第一次学的生词数">
              <p>今天学的词里,孩子<b>入学以来第一次见</b>的有几个。</p>
              <p className="text-emerald-700">
                复习巩固日显示「新0」是正常的,不代表没学习——旧词的熟练度在提升(看「已掌握」数)。
                想让词汇量涨,就要学没见过的单元。
              </p>
            </Section>

            <Section icon="⚡" title="效率 = 平均每 10 分钟学几个词">
              <p>用「学习单词 ÷ 学习时长」算出来,时长不足 5 分钟不计算(几分钟的数据说明不了什么)。</p>
              <p>🚀高效 / ⚖️稳健 / 🐢沉浸 是和<b>本班当天的中间水平</b>比出来的档位,不是绝对好坏——
                🐢 的孩子往往是学得慢但时间投入多,同样值得肯定。</p>
            </Section>

            <Section icon="✅" title="准确率 = 答对的题 ÷ 计分的题">
              <p>只统计有对错的题(拼写、选择、填空、考试)。翻卡片、拖分类这类没有对错的操作不参与计算,不会拉低准确率。</p>
            </Section>

            <Section icon="🔍" title="想知道孩子具体哪段时间没在学?">
              <p>点学生那一行的「查看」,里面有<b>当天行为时间线</b>:几点签到、几点到几点在答题、
                哪一段是空白、作业什么时候交的,一目了然。可以翻看以前任何一天。</p>
            </Section>

            <div className="mt-2 pt-4 border-t text-[11px] text-gray-400">
              💡 发家长群的日报图只包含正面数据(词数、时长、效率、正确率),
              发呆/切屏/空窗等细节只有老师能看到,需要单独沟通时再截图给对应家长。
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default StatsRulesModal;
