/**
 * 追赶战报条 - 组末总结页的游戏化钩子
 * 组末记录落库后拉今日班级词量榜,告诉学生"身后的人还差几个词追上你":
 * 有人在追 → 不敢停;垫底 → 给向上目标;第一名 → 守擂话术。
 * 拉不到榜/不在班级/未上榜 → 静默不渲染,绝不打断学习流程。
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getLeaderboard } from '../../api/leaderboard';
import { maskName, isLivePrivacyOn } from '../../utils/livePrivacy';

interface ChaseInfo {
  emoji: string;
  text: string;
  hot: boolean;  // 差距≤2词的贴身肉搏,红色+跳动
}

const ChaseBanner = () => {
  const [info, setInfo] = useState<ChaseInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 组末记录是异步提交的,稍等再拉榜,词数才包含刚学完的这一组
    const t = setTimeout(async () => {
      try {
        const d = await getLeaderboard('vocabulary', 'today', 'class');
        const myRank = d.my_rank;
        if (cancelled || !d.has_class || myRank == null) return;
        // 投屏设备开了直播打码时,追赶文案里的名字一并掩码
        const dn = (full: string | null, user: string) => {
          const name = full || user;
          return isLivePrivacyOn() ? maskName(name) : name;
        };
        const behind = d.neighbors.find(n => n.rank === myRank + 1);
        const ahead = d.neighbors.find(n => n.rank === myRank - 1);
        if (behind) {
          const gap = d.my_value - behind.value;
          const name = dn(behind.full_name, behind.username);
          if (gap <= 0) {
            setInfo({ emoji: '😱', text: `${name} 已经追平你!下一组直接反超`, hot: true });
          } else if (myRank === 1) {
            setInfo({ emoji: '👑', text: `今日第一!${name} 只差 ${gap} 个词就追上你,守住王座`, hot: gap <= 2 });
          } else {
            setInfo({ emoji: '⚡', text: `身后的 ${name} 只差 ${gap} 个词就追上你了,别停!`, hot: gap <= 2 });
          }
        } else if (ahead) {
          // 没人在身后(今日垫底)→ 掉转方向给向上的目标,不打击孩子
          const gap = ahead.value - d.my_value;
          const name = dn(ahead.full_name, ahead.username);
          setInfo(gap > 0
            ? { emoji: '🎯', text: `再学 ${gap} 个词就追上 ${name},冲一组!`, hot: false }
            : { emoji: '🎯', text: `你和 ${name} 并驾齐驱,再来一组反超`, hot: false });
        }
      } catch { /* 榜挂了就不展示 */ }
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  if (!info) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className={`w-full max-w-md mx-auto mb-4 rounded-2xl px-5 py-3.5 flex items-center gap-3 shadow-sm border ${
        info.hot
          ? 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
          : 'bg-gradient-to-r from-orange-50 to-yellow-50 border-orange-200'
      }`}
    >
      <motion.span
        className="text-2xl shrink-0"
        animate={info.hot ? { scale: [1, 1.3, 1] } : { rotate: [0, -8, 8, 0] }}
        transition={{ duration: info.hot ? 0.8 : 2.2, repeat: Infinity, repeatDelay: info.hot ? 0 : 1.5 }}
      >
        {info.emoji}
      </motion.span>
      <p className={`text-sm font-bold ${info.hot ? 'text-red-600' : 'text-orange-700'}`}>
        {info.text}
      </p>
    </motion.div>
  );
};

export default ChaseBanner;
