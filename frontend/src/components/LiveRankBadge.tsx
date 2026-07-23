/**
 * 学习页实时排名浮标(重设计)
 * 右上角卡片:今日班级词量榜「前三名 + 词数」+ 我的名次/差距;60 秒轮询,超越时弹动画。
 * 定位是"激励"不打扰:可点标题收成小圆点(不彻底消失,再点恢复);无班级/接口失败静默隐藏。
 * 直播打码开启时(投屏场景),榜上同学真名 → "X同学",与光荣榜/大屏口径一致。
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getLeaderboard, type LeaderboardEntry } from '../api/leaderboard';
import { maskName, isLivePrivacyOn } from '../utils/livePrivacy';

const POLL_MS = 60_000;
const MEDALS = ['🥇', '🥈', '🥉'];

export default function LiveRankBadge() {
  const [top, setTop] = useState<LeaderboardEntry[]>([]);   // 前三名(名字 + 词数)
  const [rank, setRank] = useState<number | null>(null);    // 我的名次
  const [value, setValue] = useState(0);                    // 我今天的词数
  const [gap, setGap] = useState<number | null>(null);      // 距上一名差几个词
  const [behindGap, setBehindGap] = useState<number | null>(null); // 身后的人差几个词追上我
  const [className, setClassName] = useState<string | null>(null);
  const [climb, setClimb] = useState<number | null>(null);  // 上升动画:升了几名
  // 点标题 = 收成小圆点(不彻底消失,再点恢复)。手滑不会让排名彻底消失,家长也不误以为坏了
  const [collapsed, setCollapsed] = useState(false);
  const prevRankRef = useRef<number | null>(null);
  // 当前登录学生的名字(不在前三时那行"我(名字)"用;从本地登录信息取)
  const [myName, setMyName] = useState('');
  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      setMyName(u?.full_name || u?.username || '');
    } catch { /* ignore */ }
  }, []);

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
        setTop(r.top.slice(0, 3));
        setRank(r.my_rank);
        setValue(r.my_value);
        setClassName(r.class_name);
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

  const isTop = rank === 1;
  const inTop3 = rank <= 3;

  // 投屏打码时榜上真名掩码为"X同学"
  const displayName = (e: LeaderboardEntry) => {
    const name = e.full_name || e.username;
    return isLivePrivacyOn() ? maskName(name) : name;
  };
  // 自己显示为「我(名字)」:只写"我"孩子分不清是谁的号(共用设备/投屏时尤其)
  const myLabel = (e: LeaderboardEntry) => `我(${displayName(e)})`;

  // 收成小圆点
  if (collapsed) {
    return (
      <motion.button
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={() => setCollapsed(false)}
        title="展开今日班级排名"
        className="live-rank-badge fixed top-16 right-3 z-30 w-9 h-9 rounded-full bg-white/95 border-2 border-accent-warm/50 shadow-lg text-sm font-bold text-accent-warm flex items-center justify-center"
      >
        {isTop ? '👑' : `#${rank}`}
      </motion.button>
    );
  }

  // 底部激励话术:冲上一名 + 身后追兵(两条都可能出现)
  const hints: { text: string; hot: boolean }[] = [];
  if (gap !== null && gap > 0 && rank > 1) {
    hints.push({ text: `再学 ${gap} 词升第 ${rank - 1} 名 🚀`, hot: false });
  }
  // 身后有人就提示(不再只在≤3词时):贴身(≤3词)红色跳动催紧,拉开距离则平和地报领先量
  if (behindGap !== null && behindGap >= 0) {
    if (behindGap === 0) {
      hints.push({ text: '⚡ 已被追平,快冲下一组!', hot: true });
    } else if (behindGap <= 3) {
      hints.push({ text: `⚡ 身后只差 ${behindGap} 词,别停!`, hot: true });
    } else {
      hints.push({ text: `🛡️ 领先身后同学 ${behindGap} 词,继续保持!`, hot: false });
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.96 }}
        animate={isTop
          ? { opacity: 1, y: 0, scale: 1, boxShadow: ['0 4px 14px rgba(0,0,0,0.1)', '0 0 22px rgba(255,180,0,0.5)', '0 4px 14px rgba(0,0,0,0.1)'] }
          : { opacity: 1, y: 0, scale: 1 }}
        transition={isTop ? { boxShadow: { duration: 2.4, repeat: Infinity } } : { type: 'spring', stiffness: 300, damping: 24 }}
        className="live-rank-badge fixed top-16 right-3 z-30 w-56 rounded-2xl bg-white/95 backdrop-blur border-2 border-accent-warm/40 shadow-lg overflow-hidden"
      >
        {/* 标题:点击收成小圆点 */}
        <button
          onClick={() => setCollapsed(true)}
          title="今日班级排名(点击收起)"
          className={`w-full flex items-center justify-between px-3 py-2 text-left ${
            isTop ? 'bg-gradient-to-r from-amber-400 to-yellow-300' : 'bg-accent-warm/10'
          }`}
        >
          <div className="min-w-0">
            <p className={`text-xs font-bold ${isTop ? 'text-amber-900' : 'text-ink'}`}>
              🏆 今日班级词量榜
            </p>
            {className && (
              <p className={`text-[10px] truncate ${isTop ? 'text-amber-800/70' : 'text-ink-mute'}`}>
                {className}
              </p>
            )}
          </div>
          <span className={`text-base leading-none shrink-0 ml-2 ${isTop ? 'text-amber-800/70' : 'text-ink-mute'}`}>—</span>
        </button>

        {/* 前三名领奖台(名字 + 词数),我在其中则高亮 */}
        <div className="px-2 pt-1.5 pb-1 space-y-0.5">
          {top.map((e) => {
            const me = e.rank === rank;
            return (
              <div
                key={e.user_id}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${
                  me ? 'bg-accent-warm/15 ring-1 ring-accent-warm/40' : ''
                }`}
              >
                <span className="text-base w-5 text-center shrink-0">{MEDALS[e.rank - 1]}</span>
                <span className={`text-xs truncate flex-1 ${me ? 'font-bold text-accent-warm' : 'text-ink'}`}>
                  {me ? myLabel(e) : displayName(e)}
                </span>
                <span className={`text-xs font-numeric font-semibold shrink-0 ${me ? 'text-accent-warm' : 'text-ink-soft'}`}>
                  {e.value} 词
                </span>
              </div>
            );
          })}
        </div>

        {/* 我的名次(仅当不在前三):让中游/垫底的孩子也看到自己在哪 */}
        {!inTop3 && (
          <div className="border-t border-black/5 px-3 py-1.5 flex items-center justify-between">
            <span className="text-xs text-ink truncate">
              第 <span className="font-numeric text-accent-warm font-bold text-sm">{rank}</span> 名 · 我{myName && `(${isLivePrivacyOn() ? maskName(myName) : myName})`}
            </span>
            <span className="text-xs font-numeric font-semibold text-ink-soft">{value} 词</span>
          </div>
        )}

        {/* 激励话术条 */}
        {hints.length > 0 && (
          <div className="border-t border-black/5">
            {hints.map((h, i) => (
              <motion.p
                key={i}
                className={`px-3 py-1.5 text-[11px] font-medium ${
                  h.hot ? 'bg-red-50 text-red-500' : 'text-accent-warm'
                }`}
                animate={h.hot ? { opacity: [1, 0.55, 1] } : undefined}
                transition={h.hot ? { duration: 1.3, repeat: Infinity } : undefined}
              >
                {h.text}
              </motion.p>
            ))}
          </div>
        )}
      </motion.div>

      {/* 超越动画:升名瞬间轻弹 */}
      <AnimatePresence>
        {climb !== null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.6, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            className="live-rank-climb fixed top-3 right-3 z-40 pointer-events-none"
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
