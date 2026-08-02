import React, { useState, useEffect } from 'react';
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
  searchOpponents,
  type OpponentOption,
  type BattleListItem,
  type Battle,
  type BattleStats,
} from '../api/petBattle';
import { toast } from '../components/Toast';

export default function PetBattleHallPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'hall' | 'history' | 'stats'>('hall');
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  // 好友列表选人(替代原来手输用户ID):搜索关键词 + 选中的同学
  const [oppQuery, setOppQuery] = useState('');
  const [pickedOpp, setPickedOpp] = useState<OpponentOption | null>(null);

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

  // 可挑战的同学(同机构、已有出战宠物)。只在邀请弹窗打开时查,输入时防抖 300ms
  const [oppQueryDebounced, setOppQueryDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setOppQueryDebounced(oppQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [oppQuery]);
  const { data: opponents = [], isLoading: oppLoading } = useQuery<OpponentOption[]>({
    queryKey: ['petBattleOpponents', oppQueryDebounced],
    queryFn: () => searchOpponents(oppQueryDebounced, 30),
    enabled: showInviteDialog,
  });

  // 创建对战
  const createMutation = useMutation({
    mutationFn: createBattle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['petBattleHistory'] });
      toast.success('对战邀请已发送');
      setShowInviteDialog(false);
      setPickedOpp(null); setOppQuery('');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || '创建对战失败');
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
      toast.error(error?.response?.data?.detail || '接受对战失败');
    },
  });

  // 取消对战
  const cancelMutation = useMutation({
    mutationFn: cancelBattle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['petBattleHistory'] });
      toast.success('已取消对战');
    },
  });

  const handleCreateBattle = () => {
    if (!pickedOpp) {
      toast.info('请先选择要挑战的同学');
      return;
    }
    createMutation.mutate({
      opponent_id: pickedOpp.user_id,
      mode: 'casual',
      max_rounds: 10,
    });
  };

  return (
    <div className="min-h-screen bg-paper">
      {/* 顶部导航 */}
      <nav className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/student/pet')}
            className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-orange-50"
            aria-label="返回我的宠物"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-bold text-slate-800">
            ⚔️ 对战大厅
          </h1>
          <div className="w-12" />
        </div>
      </nav>

      {/* Hero横幅 */}
      <div className="relative overflow-hidden border-b border-orange-100" style={{ height: 132 }}>
        <div className="absolute inset-0 bg-[#4a2d22]" />
        <div className="relative z-10 h-full flex items-center px-4 max-w-5xl mx-auto">
          <div className="text-white">
            <h2 className="text-3xl font-bold drop-shadow">⚔️ 对战大厅</h2>
            <p className="mt-1 text-sm text-white/85 drop-shadow">和同学切磋，在答题中一起进步</p>
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
              className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-1 text-sm font-semibold transition-all sm:text-base ${
                view === tab.key
                  ? 'bg-accent-warm text-white'
                  : 'border border-orange-100 bg-white text-gray-600 hover:bg-orange-50'
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
            <div className="rounded-2xl bg-[#4a2d22] p-5 text-white sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold mb-2">🎮 发起对战</h3>
                  <p className="text-sm opacity-90">邀请好友一起对战</p>
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowInviteDialog(true)}
                  className="min-h-12 rounded-xl bg-white px-5 font-bold text-[#6d351f] shadow-lg"
                >
                  发起挑战
                </motion.button>
              </div>
            </div>

            {/* 待接受的邀请 */}
            {invites.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
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
                <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
                  <div className="text-3xl font-bold text-ink">{stats.total_battles}</div>
                  <div className="text-sm text-gray-600">总对战</div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
                  <div className="text-3xl font-bold text-green-500">{stats.win_rate}%</div>
                  <div className="text-sm text-gray-600">胜率</div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
                  <div className="text-3xl font-bold text-orange-500">{stats.current_win_streak}</div>
                  <div className="text-sm text-gray-600">连胜</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 对战记录 */}
        {view === 'history' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
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
                  <div className="rounded-xl bg-orange-50 p-3 text-center">
                    <div className="text-2xl font-bold text-accent-warm">{stats.ultimates_used}</div>
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

            {/* 好友列表选人:原来要手输用户ID,学生根本不知道别人的ID */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">选择要挑战的同学</label>
              <input
                type="text"
                value={oppQuery}
                onChange={(e) => setOppQuery(e.target.value)}
                placeholder="搜索同学姓名…"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none mb-2"
              />
              <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-50">
                {oppLoading && (
                  <div className="py-6 text-center text-sm text-gray-400">加载中…</div>
                )}
                {!oppLoading && opponents.length === 0 && (
                  <div className="py-6 text-center text-sm text-gray-400">
                    {oppQuery ? '没找到这位同学' : '暂时没有可挑战的同学(对手需要先领养宠物)'}
                  </div>
                )}
                {opponents.map((o) => {
                  const picked = pickedOpp?.user_id === o.user_id;
                  return (
                    <button
                      key={o.user_id}
                      onClick={() => setPickedOpp(o)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition ${
                        picked ? 'bg-orange-50 ring-2 ring-orange-300' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-2xl shrink-0">{picked ? '✅' : '🧑‍🎓'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-gray-800 truncate">
                          {o.full_name || o.username}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {o.pet_name} · Lv.{o.pet_level}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {pickedOpp && (
                <div className="text-xs text-orange-600 mt-2">
                  已选择:{pickedOpp.full_name || pickedOpp.username} 的 {pickedOpp.pet_name}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCreateBattle}
                disabled={createMutation.isPending}
                className="btn-glow min-h-12 flex-1 rounded-xl font-bold text-white disabled:opacity-50"
              >
                {createMutation.isPending ? '发送中...' : '发送挑战'}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setShowInviteDialog(false);
                  setPickedOpp(null); setOppQuery('');
                }}
                className="min-h-12 rounded-xl bg-gray-100 px-6 font-bold text-gray-700"
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
