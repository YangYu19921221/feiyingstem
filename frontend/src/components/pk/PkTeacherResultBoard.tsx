import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock3,
  Home,
  Swords,
  Target,
  Trophy,
  Users,
  XCircle,
} from 'lucide-react';
import type { PkFinalRankItem, PkTeamRankItem } from '../../api/pk';

interface Props {
  ranking: PkFinalRankItem[];
  teamRanking?: PkTeamRankItem[] | null;
  onExit: () => void;
}

const TEAM_TONE = [
  'bg-sky-500',
  'bg-rose-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-cyan-500',
];

const PLACE_TONE: Record<number, string> = {
  1: 'border-amber-300 bg-amber-50 text-amber-700',
  2: 'border-slate-300 bg-slate-100 text-slate-700',
  3: 'border-orange-300 bg-orange-50 text-orange-700',
};

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest}s`;
}

function TopStudent({ item }: { item: PkFinalRankItem }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: item.rank * 0.08 }}
      className={`rounded-lg border p-4 ${PLACE_TONE[item.rank] ?? 'border-slate-200 bg-white text-slate-700'}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-numeric text-2xl font-black">{item.rank}</span>
        {item.rank === 1 && <Trophy className="h-5 w-5" />}
      </div>
      <p className="mt-5 truncate text-base font-extrabold text-slate-900">{item.nickname ?? `学生${item.user_id}`}</p>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="font-numeric text-2xl font-black text-slate-900">{item.final_score}</span>
        <span className="text-xs text-slate-500">分</span>
      </div>
    </motion.div>
  );
}

export default function PkTeacherResultBoard({ ranking, teamRanking, onExit }: Props) {
  const topThree = ranking.filter((item) => item.rank <= 3).sort((a, b) => a.rank - b.rank);
  const champion = ranking.find((item) => item.rank === 1);
  const winningTeam = teamRanking?.find((team) => team.rank === 1);
  const isTeam = Boolean(teamRanking?.length);

  return (
    <div className="flex min-h-screen flex-col bg-[#f3f6fa] text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <Trophy className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-extrabold text-slate-900 sm:text-xl">比赛结束</h1>
              <p className="mt-0.5 text-xs text-slate-500">最终成绩已公布 · 共 {ranking.length} 名学生</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:px-4"
          >
            <Home className="h-4 w-4" />
            <span className="hidden sm:inline">返回教师主页</span>
            <span className="sm:hidden">返回</span>
          </button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1600px] flex-1 gap-6 p-4 sm:p-5 lg:grid-cols-[minmax(320px,0.8fr)_minmax(620px,1.45fr)] lg:p-6">
        <section className="space-y-5" aria-labelledby="honor-title">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-700">
              {isTeam ? <Users className="h-4 w-4" /> : <Swords className="h-4 w-4" />}
              {isTeam ? '获胜队伍' : '本场冠军'}
            </div>
            {isTeam && winningTeam ? (
              <div className="mt-5 flex items-center gap-4">
                <span className={`h-14 w-2 rounded-full ${TEAM_TONE[(winningTeam.team - 1) % TEAM_TONE.length]}`} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-black text-slate-900">第 {winningTeam.team} 队</h2>
                  <p className="mt-1 text-sm text-slate-500">{winningTeam.member_count} 名队员 · 总分 {winningTeam.points}</p>
                </div>
                <div className="text-right">
                  <p className="font-numeric text-3xl font-black text-amber-700">{winningTeam.avg_points}</p>
                  <p className="text-xs text-slate-500">人均分</p>
                </div>
              </div>
            ) : champion ? (
              <div className="mt-5">
                <h2 className="truncate text-2xl font-black text-slate-900">{champion.nickname ?? `学生${champion.user_id}`}</h2>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-slate-400">总分</p>
                    <p className="mt-1 font-numeric text-2xl font-black text-amber-700">{champion.final_score}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">正确率</p>
                    <p className="mt-1 font-numeric text-2xl font-black text-emerald-600">{champion.accuracy.toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">最高连击</p>
                    <p className="mt-1 font-numeric text-2xl font-black text-rose-600">{champion.best_streak ?? 0}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {isTeam && teamRanking && (
            <div>
              <h2 className="mb-2.5 flex items-center gap-2 text-sm font-extrabold text-slate-700">
                <Users className="h-4 w-4 text-sky-600" /> 队伍最终排名
              </h2>
              <div className="space-y-2">
                {teamRanking.map((team) => (
                  <div key={team.team} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <span className="font-numeric text-lg font-black text-slate-500">{team.rank}</span>
                    <span className={`h-8 w-1 rounded-full ${TEAM_TONE[(team.team - 1) % TEAM_TONE.length]}`} />
                    <span className="flex-1 font-bold text-slate-800">第 {team.team} 队</span>
                    <span className="text-xs text-slate-400">{team.member_count} 人</span>
                    <span className="font-numeric font-black text-slate-900">{team.avg_points} 分</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 id="honor-title" className="mb-2.5 flex items-center gap-2 text-sm font-extrabold text-slate-700">
              <Trophy className="h-4 w-4 text-amber-600" /> 学生荣誉榜
            </h2>
            <div className="grid grid-cols-3 gap-2.5">
              {topThree.map((item) => <TopStudent key={item.user_id} item={item} />)}
            </div>
          </div>
        </section>

        <section className="min-w-0" aria-labelledby="final-ranking-title">
          <div className="mb-2.5 flex items-end justify-between gap-3">
            <div>
              <h2 id="final-ranking-title" className="flex items-center gap-2 text-base font-extrabold text-slate-800">
                <Target className="h-4 w-4 text-orange-600" /> 学生最终排名
              </h2>
              <p className="mt-1 text-xs text-slate-400">本场完整成绩</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="hidden grid-cols-[64px_minmax(160px,1fr)_100px_100px_100px_90px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-500 md:grid">
              <span>名次</span>
              <span>学生</span>
              <span>得分</span>
              <span>正确 / 错误</span>
              <span>正确率</span>
              <span>用时</span>
            </div>
            <div className="divide-y divide-slate-100">
              {ranking.map((item, index) => (
                <motion.div
                  key={item.user_id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(index * 0.05, 0.5) }}
                  className={`grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:grid-cols-[64px_minmax(160px,1fr)_100px_100px_100px_90px] ${
                    item.rank === 1 ? 'bg-amber-50/60' : 'bg-white'
                  }`}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg font-numeric font-black ${
                    PLACE_TONE[item.rank] ?? 'bg-slate-100 text-slate-500'
                  }`}>
                    {item.rank}
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {item.team && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TEAM_TONE[(item.team - 1) % TEAM_TONE.length]}`} />}
                      <p className="truncate font-bold text-slate-900">{item.nickname ?? `学生${item.user_id}`}</p>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400 md:hidden">
                      <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" />{item.correct}</span>
                      <span className="inline-flex items-center gap-1"><XCircle className="h-3 w-3 text-rose-500" />{item.wrong}</span>
                      <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatTime(item.total_time_ms)}</span>
                    </div>
                  </div>
                  <div className="text-right md:text-left">
                    <p className="font-numeric text-lg font-black text-slate-900">{item.final_score}</p>
                    <p className="text-[11px] text-slate-400 md:hidden">{item.accuracy.toFixed(0)}%</p>
                  </div>
                  <span className="hidden font-numeric text-sm text-slate-600 md:block">
                    <span className="font-bold text-emerald-600">{item.correct}</span>
                    <span className="mx-1 text-slate-300">/</span>
                    <span className="font-bold text-rose-500">{item.wrong}</span>
                  </span>
                  <span className="hidden font-numeric text-sm font-bold text-sky-700 md:block">{item.accuracy.toFixed(0)}%</span>
                  <span className="hidden font-numeric text-sm text-slate-600 md:block">{formatTime(item.total_time_ms)}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
