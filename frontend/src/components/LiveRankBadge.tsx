/**
 * 学习页实时排名浮标
 * 右上角小胶囊:今日班级排名 + 距上一名差几个词;60 秒轮询,超越时弹动画。
 * 定位是"激励",不打扰:紧凑、可点击收起,数据失败静默隐藏。
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getLeaderboard } from '../api/leaderboard';

const POLL_MS = 60_000;

export default function LiveRankBadge() {
  const [rank, setRank] = useState<number | null>(null);
  const [gap, setGap] = useState<number | null>(null);       // 距上一名差几个词
  const [behindGap, setBehindGap] = useState<number | null>(null); // 身后的人差几个词追上我
  const [value, setValue] = useState(0);                     // 我今天的词数
  const [climb, setClimb] = useState<number | null>(null);   // 上升动画:升了几名
  // 点击 = 收成小圆点(不彻底消失,再点恢复)。原来点一下整个没了,
  // 孩子手滑就再也看不到排名,家长还以为功能坏了
  const [collapsed, setCollapsed] = useState(false);
  const prevRankRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await getLeaderboard('vocabulary', 'today', 'class');
        if (cancelled || r.my_rank === null) return;
        // 超越动画:名次上升(数值变小)
        if (prevRankRef.current !== null && r.my_rank < prevRankRef.current) {
          setClimb(prevRankRef.current - r.my_rank);
          setTimeout(() => setClimb(null), 3500);
        }
        prevRankRef.current = r.my_rank;
        setRank(r.my_rank);
        setValue(r.my_value);
        // 上一名差距(从 neighbors 里找 rank = 我的-1)
        const ahead = r.neighbors.find(n => n.rank === r.my_rank! - 1);
        setGap(ahead ? Math.max(0, ahead.value - r.my_value) : null);
        // 身后差距:学习中也要有"有人在追"的紧迫感,不只组末战报有
        const behind = r.neighbors.find(n => n.rank === r.my_rank! + 1);
        setBehindGap(behind ? Math.max(0, r.my_value - behind.value) : null);
      } catch { /* 静默:没班级/接口失败都不显示 */ }
    };
    poll();
    const t = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (rank === null) return null;

  if (collapsed) {
    return (
      <motion.button
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={() => setCollapsed(false)}
        title="展开今日班级排名"
        className="fixed top-16 right-3 z-30 w-9 h-9 rounded-full bg-white/95 border-2 border-accent-warm/50 shadow-lg text-sm font-bold text-accent-warm flex items-center justify-center"
      >
        {rank === 1 ? '👑' : `#${rank}`}
      </motion.button>
    );
  }

  const isTop = rank === 1;

  return (
    <>
      <motion.button
        initial={{ opacity: 0, y: -8 }}
        animate={isTop
          ? { opacity: 1, y: 0, boxShadow: ['0 0 0px rgba(255,180,0,0.0)', '0 0 22px rgba(255,180,0,0.55)', '0 0 0px rgba(255,180,0,0.0)'] }
          : { opacity: 1, y: 0 }}
        transition={isTop ? { boxShadow: { duration: 2, repeat: Infinity } } : undefined}
        onClick={() => setCollapsed(true)}
        title="今日班级排名(点击收成小圆点)"
        className={`fixed top-16 right-3 z-30 flex items-center gap-2 px-4 py-2.5 rounded-2xl shadow-lg text-sm font-bold backdrop-blur border-2 ${
          isTop
            ? 'bg-gradient-to-r from-amber-400 to-yellow-300 border-amber-500 text-amber-900'
            : 'bg-white/95 border-accent-warm/50 text-ink'
        }`}
      >
        <motion.span
          className="text-xl"
          animate={isTop ? { y: [0, -3, 0], rotate: [0, -8, 8, 0] } : {}}
          transition={{ duration: 1.6, repeat: Infinity }}
        >
          {isTop ? '👑' : rank <= 3 ? '🏅' : '📊'}
        </motion.span>
        <span>
          {isTop ? '今日班级第一!' : <>班级第 <span className="font-numeric text-accent-warm text-lg">{rank}</span></>}
        </span>
        <span className={`font-semibold ${isTop ? 'text-amber-800/80' : 'text-ink-mute'}`}>· {value} 词</span>
        {!isTop && gap !== null && gap > 0 && (
          <motion.span
            className="text-accent-warm"
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          >
            · 差 {gap} 词升一名!
          </motion.span>
        )}
        {/* 身后追兵:第一名或普通名次都显示,学习中就有"别停"的紧迫感 */}
        {behindGap !== null && behindGap >= 0 && (
          <span className={`text-xs font-medium ${behindGap <= 2 ? 'text-red-500' : isTop ? 'text-amber-800/70' : 'text-ink-mute'}`}>
            · 身后差 {behindGap} 词{behindGap <= 2 ? ' 快被追上!' : ''}
          </span>
        )}
      </motion.button>

      {/* 超越动画:升名瞬间全屏轻弹 */}
      <AnimatePresence>
        {climb !== null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.6, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            className="fixed top-28 right-3 z-40 pointer-events-none"
          >
            <div className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-accent-warm to-amber-400 text-white font-bold text-sm shadow-lg">
              🚀 超越 {climb} 人!现在班级第 {rank}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
