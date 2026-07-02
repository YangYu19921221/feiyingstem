import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Swords, Clock, Trophy, TrendingUp } from 'lucide-react';
import {
  getMyBattles,
  getPendingInvites,
  getBattleStats,
  createBattle,
  acceptBattle,
  cancelBattle,
  type BattleListItem,
  type Battle,
  type BattleStats,
} from '../../api/petBattle';

export default function PetBattleHallPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'hall' | 'history' | 'stats'>('hall');
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [opponentId, setOpponentId] = useState('');

  // 查询数据
  const { data: invites = [] } = useQuery<Battle[]>({
    queryKey: ['petBattleInvites'],
    queryFn: getPendingInvites,
    refetchInterval: 5000, // 每5秒刷新
  });

  const { data: history = [] } = useQuery<BattleListItem[]>({
    queryKey: ['petBattleHistory'],
    queryFn: () => getMyBattles(undefined, 20),
  });

  const { data: stats } = useQuery<BattleStats>({
    queryKey: ['petBattleStats'],
    queryFn: getBattleStats,
  });

  // 创建对战
  const createMutation = useMutation({
    mutationFn: createBattle,
    onSuccess: (battle) => {
      queryClient.invalidateQueries({ queryKey: ['petBattleHistory'] });
      alert('对战邀请已发送！');
      setShowInviteDialog(false);
      setOpponentId('');
    },
    onError: (error: any) => {
      alert(error?.response?.data?.detail || '创建对战失败');
    },
  });

  // 接受对战
  const acceptMutation = useMutation({
    mutationFn: acceptBattle,
    onSuccess: (battle) => {
      queryClient.invalidateQueries({ queryKey: ['petBattleInvites'] });
      // 跳转到对战页面
      navigate(`/student/pet/battle/${battle.id}`);
    },
    onError: (error: any) => {
      alert(error?.response?.data?.detail || '接受对战失败');
    },
  });

  // 取消对战
  const cancelMutation = useMutation({
    mutationFn: cancelBattle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['petBattleHistory'] });
      alert('已取消对战');
    },
  });

  const handleCreateBattle = () => {
    if (!opponentId) {
      alert('请输入对手ID');
      return;
    }

    createMutation.mutate({
      opponent_id: Number(opponentId),
      mode: 'casual',
      max_rounds: 10,
    });
  };

  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      {/* 顶部导航 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate('/student/pet')}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-yellow-500">
            ⚔️ 对战大厅
          </h1>
          <div className="w-12" />
        </div>
      </nav>

      {/* Hero横幅 */}
      <div className="relative overflow-hidden" style={{ height: 140 }}>
        <div className="absolute inset-0 bg-gradient-to-r from-purple-600 via-pink-500 to-orange-500" />
        <div className="relative z-10 h-full flex items-center px-4 max-w-5xl mx-auto">
          <div className="text-white">
            <h2 className="text-3xl font-bold drop-shadow">⚔️ 对战大厅</h2>
            <p className="text-sm opacity-90 mt-1 drop-shadow">挑战好友，证明你的实力！</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* 标签页 */}
        <div className="flex gap-2 mb-6">
          {[
            { key: 'hall', label: '对战大厅', icon: <Swords className="w-4 h-4" /> },
            { key: 'history', label: '对战记录', icon: <Clock className="w-4 h-4" /> },
            { key: 'stats', label: '战绩统计', icon: <TrendingUp className="w-4 h-4" /> },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key as any)}
              className={`flex-1 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
                view === tab.key
                  ? 'bg-gradient-to-r from-orange-400 to-yellow-400 text-white shadow-md'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* 对战大厅 */}
        {view === 'hall' && (
          <div className="space-y-6">
            {/* 快速对战按钮 */}
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-3xl p-6 text-white shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold mb-2">🎮 发起对战</h3>
                  <p className="text-sm opacity-90">邀请好友一起对战</p>
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowInviteDialog(true)}
                  className="px-6 py-3 bg-white text-purple-600 rounded-xl font-bold shadow-lg"
                >
                  发起挑战
                </motion.button>
              </div>
            </div>

            {/* 待接受的邀请 */}
            {invites.length > 0 && (
              <div className="bg-white rounded-3xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-800 mb-4">📬 待接受的挑战</h3>
                <div className="space-y-3">
                  {invites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between p-4 bg-orange-50 rounded-xl border-2 border-orange-200"
                    >
                      <div>
                        <div className="font-bold text-gray-800">
                          {invite.player1_username} 的 {invite.player1_pet.name}
                        </div>
                        <div className="text-sm text-gray-600">
                          Lv.{invite.player1_pet.level} · {invite.max_rounds}回合 · {invite.mode === 'casual' ? '休闲' : '排位'}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => acceptMutation.mutate(invite.id)}
                          disabled={acceptMutation.isPending}
                          className="px-4 py-2 bg-green-500 text-white rounded-xl font-bold shadow-md disabled:opacity-50"
                        >
                          接受
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => cancelMutation.mutate(invite.id)}
                          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-xl font-bold"
                        >
                          拒绝
                        </motion.button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 简要统计 */}
            {stats && (
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
                  <div className="text-3xl font-bold text-blue-500">{stats.total_battles}</div>
                  <div className="text-sm text-gray-600">总对战</div>
                </div>
                <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
                  <div className="text-3xl font-bold text-green-500">{stats.win_rate}%</div>
                  <div className="text-sm text-gray-600">胜率</div>
                </div>
                <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
                  <div className="text-3xl font-bold text-orange-500">{stats.current_win_streak}</div>
                  <div className="text-sm text-gray-600">连胜</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 对战记录 */}
        {view === 'history' && (
          <div className="bg-white rounded-3xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-800 mb-4">📜 最近对战</h3>
            {history.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <div className="text-5xl mb-4">⚔️</div>
                <div>还没有对战记录</div>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((battle) => (
                  <div
                    key={battle.id}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all hover:shadow-md ${
                      battle.result === 'win'
                        ? 'bg-green-50 border-green-200'
                        : battle.result === 'lose'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                    onClick={() => {
                      if (battle.status === 'active') {
                        navigate(`/student/pet/battle/${battle.id}`);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-gray-800">
                          VS {battle.opponent_username} 的 {battle.opponent_pet_name}
                        </div>
                        <div className="text-sm text-gray-600">
                          {new Date(battle.created_at).toLocaleDateString()} ·{' '}
                          {battle.mode === 'casual' ? '休闲' : '排位'}
                        </div>
                      </div>
                      <div className="text-right">
                        {battle.status === 'finished' && battle.result && (
                          <div
                            className={`text-2xl font-bold ${
                              battle.result === 'win'
                                ? 'text-green-600'
                                : battle.result === 'lose'
                                ? 'text-red-600'
                                : 'text-gray-600'
                            }`}
                          >
                            {battle.result === 'win' ? '✅ 胜' : battle.result === 'lose' ? '❌ 负' : '🤝 平'}
                          </div>
                        )}
                        {battle.status === 'active' && (
                          <div className="text-sm text-blue-600 font-bold">进行中 →</div>
                        )}
                        {battle.status === 'pending' && (
                          <div className="text-sm text-orange-600 font-bold">等待中</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 战绩统计 */}
        {view === 'stats' && stats && (
          <div className="space-y-6">
            {/* 战绩概览 */}
            <div className="bg-white rounded-3xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-gray-800 mb-4">📊 战绩概览</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="总对战" value={stats.total_battles} color="blue" />
                <StatCard label="胜利" value={stats.wins} color="green" />
                <StatCard label="失败" value={stats.losses} color="red" />
                <StatCard label="平局" value={stats.draws} color="gray" />
              </div>
            </div>

            {/* 战斗数据 */}
            <div className="bg-white rounded-3xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-gray-800 mb-4">⚔️ 战斗数据</h3>
              <div className="space-y-3">
                <DataBar label="胜率" value={`${stats.win_rate}%`} percent={stats.win_rate} color="green" />
                <DataBar
                  label="正确率"
                  value={`${stats.accuracy}%`}
                  percent={stats.accuracy}
                  color="blue"
                />
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="text-center p-3 bg-orange-50 rounded-xl">
                    <div className="text-2xl font-bold text-orange-500">{stats.total_damage_dealt}</div>
                    <div className="text-sm text-gray-600">总伤害</div>
                  </div>
                  <div className="text-center p-3 bg-purple-50 rounded-xl">
                    <div className="text-2xl font-bold text-purple-500">{stats.ultimates_used}</div>
                    <div className="text-sm text-gray-600">必杀技</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 连胜记录 */}
            <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-3xl p-6 border-2 border-yellow-200">
              <h3 className="text-lg font-bold text-gray-800 mb-4">🔥 连胜记录</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-4xl font-bold text-orange-500">{stats.current_win_streak}</div>
                  <div className="text-sm text-gray-600">当前连胜</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-yellow-600">{stats.max_win_streak}</div>
                  <div className="text-sm text-gray-600">最高连胜</div>
                </div>
              </div>
            </div>

            {/* 特殊成就 */}
            <div className="bg-white rounded-3xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-gray-800 mb-4">🏆 特殊成就</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-blue-50 rounded-xl">
                  <div className="text-3xl mb-2">💯</div>
                  <div className="text-2xl font-bold text-blue-600">{stats.perfect_wins}</div>
                  <div className="text-sm text-gray-600">完美胜利</div>
                </div>
                <div className="text-center p-4 bg-red-50 rounded-xl">
                  <div className="text-3xl mb-2">🔥</div>
                  <div className="text-2xl font-bold text-red-600">{stats.comeback_wins}</div>
                  <div className="text-sm text-gray-600">逆风翻盘</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 邀请对话框 */}
      {showInviteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl"
          >
            <h3 className="text-2xl font-bold text-gray-800 mb-4">发起对战挑战</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">对手用户ID</label>
              <input
                type="number"
                value={opponentId}
                onChange={(e) => setOpponentId(e.target.value)}
                placeholder="输入对手的用户ID"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"
              />
              <div className="text-xs text-gray-500 mt-1">提示: 可以在学生列表或排行榜查看用户ID</div>
            </div>

            <div className="flex gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCreateBattle}
                disabled={createMutation.isPending}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-400 to-yellow-400 text-white font-bold shadow-md disabled:opacity-50"
              >
                {createMutation.isPending ? '发送中...' : '发送挑战'}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setShowInviteDialog(false);
                  setOpponentId('');
                }}
                className="px-6 py-3 rounded-xl bg-gray-200 text-gray-700 font-bold"
              >
                取消
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// 统计卡片组件
function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'blue' | 'green' | 'red' | 'gray';
}) {
  const colorClasses = {
    blue: 'text-blue-500 bg-blue-50',
    green: 'text-green-500 bg-green-50',
    red: 'text-red-500 bg-red-50',
    gray: 'text-gray-500 bg-gray-50',
  };

  return (
    <div className={`text-center p-4 rounded-xl ${colorClasses[color]}`}>
      <div className={`text-3xl font-bold ${colorClasses[color].split(' ')[0]}`}>{value}</div>
      <div className="text-sm text-gray-600">{label}</div>
    </div>
  );
}

// 数据条组件
function DataBar({
  label,
  value,
  percent,
  color,
}: {
  label: string;
  value: string;
  percent: number;
  color: 'green' | 'blue';
}) {
  const colorClasses = {
    green: 'bg-green-500',
    blue: 'bg-blue-500',
  };

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-bold text-gray-700">{value}</span>
      </div>
      <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${colorClasses[color]}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, percent)}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
