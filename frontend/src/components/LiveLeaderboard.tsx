/**
 * 实时排行榜组件
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Crown, Flame, Medal, Radio, Trophy } from 'lucide-react';
import { competitionWS, type LeaderboardData } from '../services/websocket';

interface LeaderboardMessage {
  leaderboard?: LeaderboardData;
  data?: LeaderboardData;
}

interface LiveLeaderboardProps {
  token: string;
  seasonId?: number;
  className?: string;
}

const LiveLeaderboard: React.FC<LiveLeaderboardProps> = ({
  token,
  seasonId = 1,
  className = ''
}) => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [activeTab, setActiveTab] = useState<'daily' | 'weekly' | 'overall'>('daily');
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // 连接WebSocket
    competitionWS.connect(token, seasonId);

    // 监听连接成功消息
    const handleConnected = (message: LeaderboardMessage) => {
      setIsConnected(true);
      if (message.leaderboard) {
        setLeaderboard(message.leaderboard);
        setLastUpdate(new Date());
      }
    };

    // 监听排行榜更新
    const handleLeaderboardUpdate = (message: LeaderboardMessage) => {
      if (message.data) {
        setLeaderboard(message.data);
        setLastUpdate(new Date());
      }
    };

    competitionWS.on('connected', handleConnected);
    competitionWS.on('leaderboard_update', handleLeaderboardUpdate);

    // 清理
    return () => {
      competitionWS.off('connected', handleConnected);
      competitionWS.off('leaderboard_update', handleLeaderboardUpdate);
    };
  }, [token, seasonId]);

  // 切换榜单类型
  const handleTabChange = (tab: 'daily' | 'weekly' | 'overall') => {
    setActiveTab(tab);
    competitionWS.requestLeaderboard(tab);
  };

  // 获取排名颜色
  const getRankColor = (rank: number) => {
    if (rank === 1) return 'bg-amber-100 text-amber-800';
    if (rank === 2) return 'bg-slate-200 text-slate-700';
    if (rank === 3) return 'bg-orange-100 text-orange-800';
    return 'bg-slate-100 text-ink-soft';
  };

  const getScoreColor = (rank: number) => {
    if (rank === 1) return 'bg-amber-500';
    if (rank === 2) return 'bg-slate-500';
    if (rank === 3) return 'bg-orange-500';
    return 'bg-accent-warm';
  };

  // 计算分数条宽度
  const getScoreBarWidth = (score: number, maxScore: number) => {
    if (maxScore === 0) return 0;
    return Math.min((score / maxScore) * 100, 100);
  };

  if (!leaderboard) {
    return (
      <div className={`rounded-2xl bg-white p-5 ${className}`} role="status">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-xl bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-28 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-40 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
        <p className="mt-4 text-sm text-ink-mute">正在加载排行榜...</p>
      </div>
    );
  }

  const maxScore = leaderboard.rankings[0]?.score || 1;

  return (
    <div className={`card-soft overflow-hidden rounded-2xl ${className}`}>
      {/* 头部 */}
      <div className="border-b border-black/[0.06] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <Trophy className="h-4 w-4 text-accent-warm" aria-hidden="true" />
            实时排行榜
          </h2>
          <div className={`flex items-center gap-1.5 text-xs font-medium ${isConnected ? 'text-emerald-700' : 'text-ink-mute'}`} role="status">
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isConnected ? '在线' : '连接中'}</span>
          </div>
        </div>

        {/* 标签切换 */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {(['daily', 'weekly', 'overall'] as const).map((tab) => (
            <button
              type="button"
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`min-h-11 rounded-lg px-2 text-xs font-semibold transition ${
                activeTab === tab
                  ? 'bg-white text-accent-warm shadow-sm'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {tab === 'daily' && '今日'}
              {tab === 'weekly' && '本周'}
              {tab === 'overall' && '总榜'}
            </button>
          ))}
        </div>
      </div>

      {/* 我的排名 */}
      {leaderboard.my_rank && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="border-b border-orange-100 bg-orange-50 p-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${getRankColor(leaderboard.my_rank)}`}>
                {leaderboard.my_rank === 1
                  ? <Crown className="h-5 w-5" aria-hidden="true" />
                  : leaderboard.my_rank <= 3
                    ? <Medal className="h-5 w-5" aria-hidden="true" />
                    : <span className="font-numeric text-sm font-bold">#{leaderboard.my_rank}</span>}
              </div>
              <div>
                <p className="text-sm text-ink-mute">我的排名</p>
                <p className="font-numeric text-2xl font-semibold text-ink">#{leaderboard.my_rank}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-ink-mute">积分</p>
              <p className="font-numeric text-2xl font-semibold text-accent-warm">{leaderboard.my_score}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* 排行榜列表 */}
      <div className="max-h-96 overflow-y-auto">
        <AnimatePresence>
          {leaderboard.rankings.map((item) => (
            <motion.div
              key={item.user_id}
              layout
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
              className={`border-b border-black/[0.05] p-4 transition-colors hover:bg-slate-50 ${
                item.is_me ? 'bg-orange-50/70' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                {/* 排名 */}
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl font-bold ${getRankColor(item.rank)}`}>
                  {item.rank === 1
                    ? <Crown className="h-5 w-5" aria-hidden="true" />
                    : item.rank <= 3
                      ? <Medal className="h-5 w-5" aria-hidden="true" />
                      : <span className="font-numeric text-sm">#{item.rank}</span>}
                </div>

                {/* 用户信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-ink">
                      {item.nickname}
                    </span>
                    {item.is_me && (
                      <span className="rounded-full bg-accent-warm px-2 py-0.5 text-xs text-white">
                        我
                      </span>
                    )}
                  </div>

                  {/* 分数条 */}
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between text-xs text-ink-mute">
                      <span>{item.score}分</span>
                      <span>正确率 {item.accuracy_rate.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <motion.div
                        initial={reduceMotion ? false : { scaleX: 0 }}
                        animate={{ scaleX: getScoreBarWidth(item.score, maxScore) / 100 }}
                        transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
                        style={{ transformOrigin: 'left center' }}
                        className={`h-full w-full rounded-full ${getScoreColor(item.rank)}`}
                      />
                    </div>
                  </div>

                  {/* 连击数 */}
                  {item.max_combo > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-ink-mute">
                      <Flame className="h-3 w-3 text-accent-warm" aria-hidden="true" />
                      最高连击 <span className="font-numeric">{item.max_combo}</span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {leaderboard.rankings.length === 0 && (
        <div className="px-5 py-10 text-center">
          <Trophy className="mx-auto h-6 w-6 text-ink-mute" aria-hidden="true" />
          <p className="mt-2 text-sm text-ink-soft">还没有同学上榜，答对第一题就会出现排名。</p>
        </div>
      )}

      {/* 底部信息 */}
      <div className="grid grid-cols-3 divide-x divide-black/[0.06] bg-slate-50 py-3 text-center text-xs text-ink-mute">
        <span>{leaderboard.total_participants} 人参与</span>
        <span>{leaderboard.online_users} 人在线</span>
        <span>{Math.floor((new Date().getTime() - lastUpdate.getTime()) / 1000)} 秒前更新</span>
      </div>
    </div>
  );
};

export default LiveLeaderboard;
