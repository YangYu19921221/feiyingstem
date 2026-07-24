/** PK 终局结算:前三名领奖台 + 我的成绩卡 + 完整榜单。 */
import { motion } from 'framer-motion';
import type { PkFinalRankItem, PkTeamRankItem } from '../../api/pk';

interface Props {
  ranking: PkFinalRankItem[];
  meId: number;
  teamRanking?: PkTeamRankItem[] | null;
  onExit: () => void;
  onAgain?: () => void;
}

const TEAM_TONE = ['from-blue-400 to-blue-500', 'from-rose-400 to-rose-500', 'from-emerald-400 to-emerald-500', 'from-amber-400 to-amber-500'];

const RANK_EMOJI: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
// 领奖台顺序:亚军 冠军 季军
const PODIUM_LAYOUT = [
  { rank: 2, height: 72, delay: 0.15 },
  { rank: 1, height: 104, delay: 0 },
  { rank: 3, height: 52, delay: 0.3 },
];

export default function PkResultBoard({ ranking, meId, teamRanking, onExit, onAgain }: Props) {
  const me = ranking.find((r) => r.user_id === meId);
  const byRank = new Map(ranking.map((r) => [r.rank, r]));
  const isTeam = !!teamRanking && teamRanking.length > 0;
  const winningTeam = isTeam ? teamRanking!.find((t) => t.rank === 1) : null;

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
        <p className="text-center text-xs text-ink-mute mb-5">
          {isTeam ? '先看哪个队笑到最后,再看个人表现' : '看看谁是本局单词王'}
        </p>

        {/* 分组赛:胜队横幅 + 队伍榜(放在个人榜之前) */}
        {isTeam && (
          <>
            {winningTeam && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`rounded-2xl bg-gradient-to-r ${TEAM_TONE[(winningTeam.team - 1) % TEAM_TONE.length]} p-5 text-center shadow-lg mb-4`}
              >
                <div className="text-4xl mb-1">🏆</div>
                <p className="text-white font-bold text-lg">第 {winningTeam.team} 队获胜</p>
                <p className="text-white/85 text-sm mt-0.5">人均 {winningTeam.avg_points} 分 · 全队共 {winningTeam.points} 分</p>
              </motion.div>
            )}
            <div className="card-soft rounded-2xl p-3 mb-5">
              <h3 className="font-display font-semibold text-ink mb-2 px-1 flex items-center gap-1.5">
                <span>👥</span> 队伍榜
              </h3>
              <div className="space-y-1.5">
                {teamRanking!.map((t) => (
                  <div key={t.team} className="flex items-center gap-2 rounded-xl px-2.5 py-2 bg-gray-50">
                    <span className="w-7 text-center shrink-0">
                      {RANK_EMOJI[t.rank] ?? <span className="text-sm font-semibold text-ink-mute font-numeric">{t.rank}</span>}
                    </span>
                    <span className={`inline-block w-2.5 h-2.5 rounded-full bg-gradient-to-br ${TEAM_TONE[(t.team - 1) % TEAM_TONE.length]}`} />
                    <span className="flex-1 truncate text-sm font-medium text-ink">第 {t.team} 队</span>
                    <span className="text-[11px] text-ink-mute">{t.member_count} 人</span>
                    <span className="text-right w-16">
                      <span className="text-base font-bold text-ink font-numeric block leading-none">人均{t.avg_points}</span>
                      <span className="text-[10px] text-ink-mute font-numeric">总 {t.points}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 个人赛:冠军「单词王」横幅(与分组赛胜队横幅对称,一眼看到谁是冠军) */}
        {!isTeam && byRank.get(1) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="rounded-2xl bg-gradient-to-r from-secondary to-amber-300 p-5 text-center shadow-lg mb-5"
          >
            <div className="text-4xl mb-1">👑</div>
            <p className="text-white font-bold text-lg">
              本局单词王 · {byRank.get(1)!.nickname ?? `用户${byRank.get(1)!.user_id}`}
              {byRank.get(1)!.user_id === meId ? '(我)' : ''}
            </p>
            <p className="text-white/85 text-sm mt-0.5">
              {byRank.get(1)!.final_score} 分 · 正确率 {byRank.get(1)!.accuracy.toFixed(0)}%
            </p>
          </motion.div>
        )}

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
