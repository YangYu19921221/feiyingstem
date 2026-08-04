import { motion, useReducedMotion } from 'framer-motion';
import { Crown, Flame, Home, Medal, RotateCcw, Trophy, Users } from 'lucide-react';
import type { PkFinalRankItem, PkTeamRankItem } from '../../api/pk';
import { teamLabel, topMembersByTeam } from '../../utils/pkTeam';

interface Props {
  ranking: PkFinalRankItem[];
  meId: number;
  teamRanking?: PkTeamRankItem[] | null;
  onExit: () => void;
  onAgain?: () => void;
}

const TEAM_DOT = ['bg-sky-500', 'bg-rose-500', 'bg-emerald-500', 'bg-amber-500', 'bg-cyan-500', 'bg-orange-500'];

function RankMark({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="h-5 w-5" aria-label="第 1 名" />;
  if (rank <= 3) return <Medal className="h-5 w-5" aria-label={`第 ${rank} 名`} />;
  return <span className="font-numeric text-sm font-bold">#{rank}</span>;
}

function rankTone(rank: number) {
  if (rank === 1) return 'bg-amber-100 text-amber-800';
  if (rank === 2) return 'bg-slate-200 text-slate-700';
  if (rank === 3) return 'bg-orange-100 text-orange-800';
  return 'bg-slate-100 text-ink-soft';
}

export default function PkResultBoard({ ranking, meId, teamRanking, onExit, onAgain }: Props) {
  const reduceMotion = useReducedMotion();
  const me = ranking.find((item) => item.user_id === meId);
  const champion = ranking.find((item) => item.rank === 1);
  const isTeam = !!teamRanking?.length;
  const winningTeam = teamRanking?.find((team) => team.rank === 1);
  const topByTeam = topMembersByTeam(ranking);

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        <motion.header
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mb-5 text-center"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <Trophy className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">PK 成绩</h1>
          <p className="mt-2 text-sm text-ink-soft">认真完成比名次更重要，看看这一局掌握了多少。</p>
        </motion.header>

        {(winningTeam || champion) && (
          <motion.section
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : 0.08, duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="student-colorful-surface mb-5 rounded-2xl border border-amber-200 p-5 text-center sm:p-6"
            aria-label="本局冠军"
          >
            <Crown className="mx-auto h-8 w-8 text-amber-700" aria-hidden="true" />
            <p className="mt-3 text-xs font-semibold text-amber-800">{isTeam ? '本局优胜队伍' : '本局领先选手'}</p>
            <h2 className="mt-1 truncate font-display text-xl font-semibold text-ink sm:text-2xl">
              {winningTeam
                ? teamLabel(winningTeam.team, undefined, winningTeam.team_name)
                : champion?.nickname ?? (champion ? `用户${champion.user_id}` : '')}
              {!winningTeam && champion?.user_id === meId ? '（我）' : ''}
            </h2>
            <p className="mt-2 font-numeric text-sm text-ink-soft">
              {winningTeam
                ? `人均 ${winningTeam.avg_points} 分 · 全队 ${winningTeam.points} 分`
                : `${champion?.final_score ?? 0} 分 · 正确率 ${champion?.accuracy.toFixed(0) ?? 0}%`}
            </p>
          </motion.section>
        )}

        {isTeam && teamRanking && (
          <section className="card-soft mb-5 overflow-hidden rounded-2xl" aria-labelledby="pk-team-result-title">
            <div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-3.5">
              <Users className="h-4 w-4 text-accent-warm" aria-hidden="true" />
              <h2 id="pk-team-result-title" className="font-display text-base font-semibold text-ink">队伍成绩</h2>
            </div>
            <div className="divide-y divide-black/[0.05]">
              {teamRanking.map((team) => {
                const top = topByTeam.get(team.team) ?? [];
                return (
                  <div key={team.team} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${rankTone(team.rank)}`}>
                        <RankMark rank={team.rank} />
                      </span>
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TEAM_DOT[(team.team - 1) % TEAM_DOT.length]}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{teamLabel(team.team, undefined, team.team_name)}</p>
                        <p className="mt-0.5 text-xs text-ink-mute">{team.member_count} 人 · 总分 {team.points}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-numeric text-base font-semibold text-ink">{team.avg_points}</p>
                        <p className="text-[10px] text-ink-mute">人均分</p>
                      </div>
                    </div>
                    {top.length > 0 && (
                      <ol
                        className="mt-2 space-y-1 pl-12"
                        aria-label={`${teamLabel(team.team, undefined, team.team_name)}前三名`}
                      >
                        {top.map((m, i) => (
                          <li key={m.user_id} className="flex items-center gap-2 text-xs">
                            <span className={`font-numeric w-4 shrink-0 text-center font-bold ${i === 0 ? 'text-amber-700' : 'text-ink-mute'}`}>
                              {i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-ink-soft">
                              {m.nickname ?? `用户${m.user_id}`}
                              {m.user_id === meId && (
                                <span className="ml-1.5 rounded bg-accent-warm px-1 py-px text-[10px] font-semibold text-white">我</span>
                              )}
                            </span>
                            <span className="font-numeric shrink-0 font-semibold text-ink">{m.final_score} 分</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {me && (
          <section className="card-soft mb-5 rounded-2xl p-4 sm:p-5" aria-labelledby="my-pk-result-title">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-ink-mute">我的成绩</p>
                <h2 id="my-pk-result-title" className="mt-1 font-display text-xl font-semibold text-ink">第 {me.rank} 名</h2>
              </div>
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${rankTone(me.rank)}`}>
                <RankMark rank={me.rank} />
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-black/[0.06] sm:grid-cols-4">
              {[
                { label: '总分', value: me.final_score },
                { label: '正确率', value: `${me.accuracy.toFixed(0)}%` },
                { label: '用时', value: `${(me.total_time_ms / 1000).toFixed(1)}s` },
                { label: '最高连击', value: me.best_streak ?? 0, flame: true },
              ].map((item) => (
                <div key={item.label} className="bg-slate-50 px-2 py-3 text-center">
                  <p className="font-numeric inline-flex items-center justify-center gap-1 text-base font-semibold text-ink">
                    {item.flame && <Flame className="h-3.5 w-3.5 text-accent-warm" aria-hidden="true" />}
                    {item.value}
                  </p>
                  <p className="mt-1 text-[10px] text-ink-mute">{item.label}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="card-soft mb-5 overflow-hidden rounded-2xl" aria-labelledby="pk-full-ranking-title">
          <div className="border-b border-black/[0.06] px-4 py-3.5">
            <h2 id="pk-full-ranking-title" className="font-display text-base font-semibold text-ink">完整排名</h2>
          </div>
          <div className="divide-y divide-black/[0.05]">
            {ranking.map((item) => {
              const isMe = item.user_id === meId;
              return (
                <div key={item.user_id} className={`flex items-center gap-3 px-4 py-3 ${isMe ? 'bg-orange-50/70' : 'bg-white'}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${rankTone(item.rank)}`}>
                    <RankMark rank={item.rank} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {item.nickname ?? `用户${item.user_id}`}
                      {isMe && <span className="ml-1.5 rounded bg-accent-warm px-1.5 py-0.5 text-[10px] text-white">我</span>}
                    </p>
                    <p className="mt-0.5 font-numeric text-xs text-ink-mute">正确率 {item.accuracy.toFixed(0)}%</p>
                  </div>
                  <p className="font-numeric text-base font-semibold text-ink">{item.final_score}<span className="ml-1 text-xs font-normal text-ink-mute">分</span></p>
                </div>
              );
            })}
          </div>
          {ranking.length === 0 && <p className="px-5 py-10 text-center text-sm text-ink-mute">成绩正在生成，请稍候。</p>}
        </section>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {onAgain && (
            <button onClick={onAgain} className="btn-glow inline-flex min-h-12 items-center justify-center gap-2 rounded-xl font-semibold text-white">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              再来一局
            </button>
          )}
          <button onClick={onExit} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white font-semibold text-ink transition hover:bg-black/[0.04]">
            <Home className="h-4 w-4" aria-hidden="true" />
            返回主页
          </button>
        </div>
      </main>
    </div>
  );
}
