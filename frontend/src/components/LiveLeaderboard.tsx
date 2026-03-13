/**
 * 实时排行榜组件
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { competitionWS, type LeaderboardData } from '../services/websocket';

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

  useEffect(() => {
    // 连接WebSocket
    competitionWS.connect(token, seasonId);

    // 监听连接成功消息
    const handleConnected = (message: any) => {
      setIsConnected(true);
      if (message.leaderboard) {
        setLeaderboard(message.leaderboard);
        setLastUpdate(new Date());
      }
    };

    // 监听排行榜更新
    const handleLeaderboardUpdate = (message: any) => {
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

  // 获取排名徽章
  const getRankBadge = (rank: number) => {
    if (rank === 1) return '👑';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    if (rank <= 10) return '🏅';
    if (rank <= 50) return '⭐';
    return '🌟';
  };

  // 获取排名颜色
  const getRankColor = (rank: number) => {
    if (rank === 1) return 'from-yellow-400 to-yellow-600';
    if (rank === 2) return 'from-gray-300 to-gray-500';
    if (rank === 3) return 'from-orange-400 to-orange-600';
    return 'from-blue-400 to-blue-600';
  };

  // 计算分数条宽度
  const getScoreBarWidth = (score: number, maxScore: number) => {
    if (maxScore === 0) return 0;
    return Math.min((score / maxScore) * 100, 100);
  };

  if (!leaderboard) {
    return (
      <div className={`bg-white rounded-lg shadow-lg p-6 ${className}`}>
        <div className="text-center">
          <div className="animate-spin text-4xl mb-4">⚡</div>
          <p className="text-gray-600">正在加载排行榜...</p>
        </div>
      </div>
    );
  }

  const maxScore = leaderboard.rankings[0]?.score || 1;

  return (
    <div className={`bg-white rounded-lg shadow-lg overflow-hidden ${className}`}>
      {/* 头部 */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 p-4 text-white">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">🏆 实时排行榜</h2>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-sm">{isConnected ? '在线' : '离线'}</span>
          </div>
        </div>

        {/* 标签切换 */}
        <div className="flex gap-2">
          {(['daily', 'weekly', 'overall'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                activeTab === tab
                  ? 'bg-white text-orange-500'
                  : 'bg-orange-400 bg-opacity-30 text-white hover:bg-opacity-50'
              }`}
            >
              {tab === 'daily' && '今日榜 🔥'}
              {tab === 'weekly' && '本周榜 📊'}
              {tab === 'overall' && '总榜 👑'}
            </button>
          ))}
        </div>
      </div>

      {/* 我的排名 */}
      {leaderboard.my_rank && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 border-b-2 border-blue-200"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-3xl">{getRankBadge(leaderboard.my_rank)}</div>
              <div>
                <p className="text-sm text-gray-600">我的排名</p>
                <p className="text-2xl font-bold text-gray-800">#{leaderboard.my_rank}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">积分</p>
              <p className="text-2xl font-bold text-orange-500">{leaderboard.my_score}</p>
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
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className={`p-4 border-b hover:bg-gray-50 transition-colors ${
                item.is_me ? 'bg-blue-50 border-blue-200' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                {/* 排名 */}
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold bg-gradient-to-br ${getRankColor(item.rank)}`}>
                  {item.rank <= 3 ? getRankBadge(item.rank) : `#${item.rank}`}
                </div>

                {/* 用户信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {item.rank_tier_emoji && (
                      <span className="text-sm">{item.rank_tier_emoji}</span>
                    )}
                    <span className="font-semibold text-gray-800 truncate">
                      {item.nickname}
                    </span>
                    {item.is_me && (
                      <span className="px-2 py-0.5 bg-blue-500 text-white text-xs rounded-full">
                        我
                      </span>
                    )}
                  </div>

                  {/* 分数条 */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>{item.score}分</span>
                      <span>正确率 {item.accuracy_rate.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${getScoreBarWidth(item.score, maxScore)}%` }}
                        transition={{ duration: 0.5, delay: 0.1 }}
                        className={`h-full bg-gradient-to-r ${getRankColor(item.rank)}`}
                      />
                    </div>
                  </div>

                  {/* 连击数 */}
                  {item.max_combo > 0 && (
                    <div className="mt-1 text-xs text-gray-500">
                      🔥 最高连击: {item.max_combo}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 底部信息 */}
      <div className="bg-gray-50 p-3 text-xs text-gray-600 flex items-center justify-between">
        <span>👥 共{leaderboard.total_participants}人参与</span>
        <span>🟢 {leaderboard.online_users}人在线</span>
        <span>🕐 {Math.floor((new Date().getTime() - lastUpdate.getTime()) / 1000)}秒前更新</span>
      </div>
    </div>
  );
};

export default LiveLeaderboard;
