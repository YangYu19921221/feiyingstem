/** PK 终局结算:前三名领奖台 + 我的成绩卡 + 完整榜单。 */
import { motion } from 'framer-motion';

interface RankItem {
  user_id: number;
  nickname?: string;
  rank: number;
  correct: number;
  wrong: number;
  total_time_ms: number;
  accuracy: number;
  final_score: number;
  best_streak?: number;
}

interface Props {
  ranking: RankItem[];
  meId: number;
  onExit: () => void;
  onAgain?: () => void;
}

const RANK_EMOJI: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
// 领奖台顺序:亚军 冠军 季军
const PODIUM_LAYOUT = [
  { rank: 2, height: 72, delay: 0.15 },
  { rank: 1, height: 104, delay: 0 },
  { rank: 3, height: 52, delay: 0.3 },
];

export default function PkResultBoard({ ranking, meId, onExit, onAgain }: Props) {
  const me = ranking.find((r) => r.user_id === meId);
  const byRank = new Map(ranking.map((r) => [r.rank, r]));

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto p-5">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-display text-2xl font-bold text-center mb-1 text-ink"
        >
          🎉 PK 结束
        </motion.h1>
        <p className="text-center text-xs text-ink-mute mb-5">看看谁是本局单词王</p>

        {/* 前三名领奖台 */}
        <div className="flex items-end justify-center gap-3 mb-6 px-2">
          {PODIUM_LAYOUT.map(({ rank, height, delay }) => {
            const r = byRank.get(rank);
            if (!r) return <div key={rank} className="flex-1" />;
            const isMe = r.user_id === meId;
            return (
              <div key={rank} className="flex-1 flex flex-col items-center min-w-0">
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.7 }}
                  animate={{ opacity: 1, y: 0, scale: rank === 1 ? 1.15 : 1 }}
                  transition={{ delay: delay + 0.35, type: 'spring', stiffness: 260, damping: 18 }}
                  className="text-3xl mb-1"
                >
                  {RANK_EMOJI[rank]}
                </motion.div>
                <p className={`text-xs font-medium truncate max-w-full mb-0.5 ${isMe ? 'text-primary' : 'text-ink'}`}>
                  {r.nickname ?? `用户${r.user_id}`}
                  {isMe ? '(我)' : ''}
                </p>
                <p className="text-[11px] text-ink-mute font-numeric mb-1.5">{r.final_score} 分</p>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height }}
                  transition={{ delay, type: 'spring', stiffness: 160, damping: 20 }}
                  className={`w-full rounded-t-xl ${
                    rank === 1
                      ? 'bg-gradient-to-b from-secondary to-amber-300'
                      : rank === 2
                        ? 'bg-gradient-to-b from-gray-200 to-gray-300'
                        : 'bg-gradient-to-b from-orange-200 to-orange-300'
                  } flex items-start justify-center pt-1.5`}
                >
                  <span className="text-sm font-bold text-white/90 font-numeric">{rank}</span>
                </motion.div>
              </div>
            );
          })}
        </div>

        {/* 我的成绩卡 */}
        {me && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-gradient-to-br from-yellow-50 to-orange-50 border border-yellow-200 rounded-2xl p-4 mb-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-ink-soft">我的成绩</p>
              <p className="text-lg font-bold text-primary">
                {RANK_EMOJI[me.rank] ?? '🏅'} 第 {me.rank} 名
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <p className="text-[10px] text-ink-mute">得分</p>
                <p className="font-bold text-ink font-numeric">{me.final_score}</p>
              </div>
              <div>
                <p className="text-[10px] text-ink-mute">准确率</p>
                <p className="font-bold text-ink font-numeric">{me.accuracy.toFixed(0)}%</p>
              </div>
              <div>
                <p className="text-[10px] text-ink-mute">用时</p>
                <p className="font-bold text-ink font-numeric">{(me.total_time_ms / 1000).toFixed(1)}s</p>
              </div>
              <div>
                <p className="text-[10px] text-ink-mute">最高连击</p>
                <p className="font-bold text-ink font-numeric">🔥{me.best_streak ?? 0}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* 完整榜单 */}
        <div className="card-soft rounded-2xl overflow-hidden mb-5">
          <table className="w-full text-sm">
            <thead className="bg-orange-50/60">
              <tr>
                <th className="py-2 px-3 text-left font-medium text-ink-mute text-xs">名次</th>
                <th className="py-2 px-3 text-left font-medium text-ink-mute text-xs">玩家</th>
                <th className="py-2 px-3 text-right font-medium text-ink-mute text-xs">得分</th>
                <th className="py-2 px-3 text-right font-medium text-ink-mute text-xs">准确率</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <motion.tr
                  key={r.user_id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.55 + i * 0.05 }}
                  className={`border-t border-orange-100/70 ${
                    r.user_id === meId ? 'bg-orange-50' : ''
                  }`}
                >
                  <td className="py-2 px-3 font-medium">
                    {RANK_EMOJI[r.rank] ?? <span className="font-numeric text-ink-soft">{r.rank}</span>}
                  </td>
                  <td className="py-2 px-3 text-ink">
                    {r.nickname ?? `用户${r.user_id}`}
                    {r.user_id === meId && (
                      <span className="ml-1.5 text-[10px] bg-primary text-white px-1.5 py-0.5 rounded">
                        我
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right font-numeric font-semibold text-ink">
                    {r.final_score}
                  </td>
                  <td className="py-2 px-3 text-right font-numeric text-ink-soft">
                    {r.accuracy.toFixed(0)}%
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2.5">
          {onAgain && (
            <button
              onClick={onAgain}
              className="btn-glow flex-1 py-3 text-white rounded-xl font-semibold"
            >
              ⚔️ 再来一局
            </button>
          )}
          <button
            onClick={onExit}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-ink rounded-xl font-medium transition"
          >
            返回主页
          </button>
        </div>
      </div>
    </div>
  );
}
