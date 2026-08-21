/**
 * 金币规则说明弹窗 —— 学生端与教师端共用一份文案(单一真源)。
 *
 * 规则一旦在两端各写一份就会漂:这里按 audience 切换措辞(对孩子说"你",
 * 对老师说"学生"),但规则本身只有这一份。数值走后端返回的常量,不在前端硬编码。
 */
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export interface CoinRuleNumbers {
  task_reward: number;
  word_king_reward: number;
  daily_cap: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  audience: 'student' | 'teacher';
  /** 本机构是否自动发币;false=老师核实后手动加 */
  autoCoin: boolean;
  rules?: CoinRuleNumbers;
}

const DEFAULTS: CoinRuleNumbers = { task_reward: 1, word_king_reward: 1, daily_cap: 2 };

const Row = ({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) => (
  <div className="mb-4">
    <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-1.5">
      <span className="text-base">{icon}</span>
      {title}
    </h4>
    <div className="pl-7 space-y-1 text-[13px] leading-relaxed text-gray-600">{children}</div>
  </div>
);

export default function CoinRulesModal({ open, onClose, audience, autoCoin, rules }: Props) {
  const n = rules ?? DEFAULTS;
  const isStudent = audience === 'student';
  const you = isStudent ? '你' : '学生';

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
            className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              aria-label="关闭"
              className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="mb-1 text-lg font-bold text-gray-800">🪙 金币是怎么来的?</h3>
            <p className="mb-5 text-xs text-gray-400">
              {autoCoin
                ? `系统按下面的规则自动发放,一天最多 ${n.daily_cap} 枚。`
                : '本校目前设置为「老师手动加币」,系统不自动发放,下面是老师核实时参考的标准。'}
            </p>

            {!autoCoin && (
              <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
                ⚙️ 当前是<b>手动加币</b>模式:{isStudent
                  ? '完成任务后由老师核实情况给你加金币。'
                  : '系统不自动发,请在本页「加金币」逐个核实后发放。'}
              </div>
            )}

            <Row icon="✅" title={`完成当天全部任务 → +${n.task_reward} 枚`}>
              <p>
                老师当天布置的任务,{you}<b>全部完成</b>(每份都达到老师设的目标分)就得 {n.task_reward} 枚。
              </p>
              <p>· 一天只给 {n.task_reward} 枚。老师当天又追加布置了新任务,<b>做完也不会再多给</b>。</p>
              <p>
                · 老师<b>取消或关闭</b>的任务不算在内。比如布置了 5 份、{you}做不完,老师取消 2 份,
                {you}把剩下 3 份做完<b>照样得 {n.task_reward} 枚</b>。
              </p>
              <p>
                · 必须<b>当天做完</b>:当天布置的任务拖到第二天才补做,成绩照样记录,
                但这枚金币不发(补做的那天也不会发,发币只看{isStudent ? '你' : '学生'}当天的任务)。
              </p>
              <p>· 当天一份任务都没布置,就没有这枚金币(不是漏发)。</p>
            </Row>

            <Row icon="👑" title={`当上单词王 → 额外 +${n.word_king_reward} 枚`}>
              <p>
                每天班上<b>学的单词最多</b>的那个人是单词王,额外再加 {n.word_king_reward} 枚
                ——{isStudent ? '和上面的任务金币可以叠加' : '与任务金币叠加'},
                所以一天最多 {n.daily_cap} 枚。
              </p>
              <p>
                · <b>当天 24 点才结算</b>。白天排第一只是"暂列第一",
                {isStudent ? '别人随时可能超过你' : '随时可能被同学反超'},
                所以金币要到<b>第二天凌晨</b>才到账。
              </p>
              <p>· 学的词数一样多可以<b>并列</b>,并列的人都算单词王、都发金币。</p>
              <p>· 词数按<b>不重复</b>的单词算:同一个词今天练几遍都只算 1 个。翻卡片和分类不计入。</p>
              <p>
                · 要先<b>完成当天布置的任务</b>才参评 ——
                {isStudent
                  ? '作业没做完的话,词背得再多也不算单词王。'
                  : '作业未完成的学生不进候选,防止「不做作业光刷词量」拿币。'}
              </p>
              <p>
                · 当天<b>没布置任务</b>、或班上<b>只有一个人在学</b>时,那天不评单词王
                {isStudent ? '(不是漏发)' : '——一个人没有对手,不构成争夺'}。
              </p>
            </Row>

            <Row icon="🎁" title="老师额外奖励">
              <p>
                {isStudent
                  ? '除了系统自动发的,老师也可以根据课堂表现随时给你加金币,这部分不受上面的上限限制。'
                  : '「加金币」按钮可随时额外奖励(需金币密码),不受每日上限限制;流水里显示为「手动调整」。'}
              </p>
            </Row>

            <Row icon="🛒" title="金币能干什么">
              <p>
                {isStudent
                  ? '攒够了在「兑换奖励」里申请你想要的奖品,老师审核通过后金币才会扣掉。'
                  : '学生在学生端申请兑换,教师端「兑换申请」审批通过后才扣币。'}
              </p>
            </Row>

            {isStudent && (
              <p className="mt-5 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800">
                💪 想多拿金币:先把老师布置的任务全部做完(+{n.task_reward}),
                再多背一些单词冲单词王(+{n.word_king_reward})。
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
