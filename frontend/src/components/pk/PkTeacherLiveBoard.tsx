import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  CheckCircle2,
  CircleStop,
  Clock3,
  Flame,
  Maximize2,
  Minimize2,
  Swords,
  Target,
  Trophy,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import type { PkLiveRankItem, PkMode, PkTeamRankItem } from '../../api/pk';
import PkTeacherColumnChart, { TEAM_SERIES, type ColumnDatum } from './PkTeacherColumnChart';
import { teamLabel } from '../../utils/pkTeam';

/**
 * 学生行 → 柱状图数据。
 * 柱高画**得分**(规则:总分高者赢),掌握进度作辅助小字 ——
 * 画进度会让大屏第一名和最终赢家不是同一人。
 * needsAttention 走状态色,永远配图标+文字,不靠颜色单独表意。
 */
function toColumnDatum(item: PkLiveRankItem): ColumnDatum {
  const answered = item.correct + item.wrong;
  const accuracy = answered > 0 ? (item.correct / answered) * 100 : 100;
  return {
    key: item.user_id,
    label: item.nickname,
    value: item.points,
    progress: item.progress ?? 0,
    sublabel: `${Math.round((item.progress ?? 0) * 100)}% · ${STAGE_LABEL[item.stage ?? 'classify'] ?? '分类'}`,
    rank: item.rank,
    offline: !item.online,
    // 答过一定量且正确率偏低才提示,避免开局零星几题就报警
    needsAttention: answered >= 4 && accuracy < 50,
    done: item.finished,
  };
}

interface Props {
  items: PkLiveRankItem[];
  teams?: PkTeamRankItem[] | null;
  /** 组号 → 组名(房间快照下发);实时榜每行只带组号,组名在这里查 */
  teamNames?: Record<string, string>;
  mode: PkMode;
  deadlineAt: string | null;
  spectatorCount: number;
  error?: string;
  onFinish: () => void;
}

const STAGE_LABEL: Record<string, string> = {
  classify: '分类',
  dictation: '听写',
  exam: '过关',
  done: '完成',
};

/**
 * 队伍身份色:与柱状图共用 TEAM_SERIES(校验过 CVD 的那一组)。
 *
 * 原来这里是 tailwind 的 sky/rose/emerald/amber/violet/cyan-500,实测
 * emerald↔rose 在红绿色盲下 ΔE 只有 5.6(校验 FAIL)—— 第 2、3 队分不出来。
 * 而且同屏两套队伍色会让"第 3 队"在柱状图和名册里是两个颜色,
 * 违反「颜色跟实体」。统一到一处后,换色只改 TEAM_SERIES。
 */
const teamColor = (team: number) => TEAM_SERIES[(team - 1) % TEAM_SERIES.length];
/** 卡片底色:同色 8% 淡染 + 20% 描边,避免再引一套 tailwind 色阶 */
const teamSurfaceStyle = (team: number) => {
  const c = teamColor(team);
  return { borderColor: `${c}33`, background: `${c}14` };
};

function useCountdown(deadlineAt: string | null) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setNow(Date.now()));
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);

  if (!deadlineAt || now === 0) return { label: '--:--', urgent: false, ended: false };
  const seconds = Math.max(0, Math.floor((new Date(deadlineAt).getTime() - now) / 1000));
  return {
    label: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
    urgent: seconds <= 30,
    ended: seconds === 0,
  };
}

function RankMark({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
        <Trophy className="h-5 w-5" strokeWidth={2.2} />
      </span>
    );
  }

  const tone = rank === 2
    ? 'bg-slate-200 text-slate-700'
    : rank === 3
      ? 'bg-orange-100 text-orange-700'
      : 'bg-slate-100 text-slate-500';
  return (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg font-numeric text-base font-extrabold ${tone}`}>
      {rank}
    </span>
  );
}

function StudentRankRow({ item, teamName }: { item: PkLiveRankItem; teamName?: string }) {
  const answered = item.correct + item.wrong;
  const accuracy = answered > 0 ? Math.round((item.correct / answered) * 100) : 0;
  const progress = Math.min(100, Math.round((item.progress ?? 0) * 100));
  const isLeader = item.rank === 1 && (item.finished || progress > 0);
  const progressTone = item.rank === 1
    ? 'bg-amber-500'
    : item.rank === 2
      ? 'bg-slate-500'
      : item.rank === 3
        ? 'bg-orange-500'
        : 'bg-sky-500';

  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 360, damping: 32 }}
      className={`relative overflow-hidden rounded-lg border bg-white px-3 py-2.5 shadow-sm sm:px-4 ${
        isLeader ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200'
      } ${!item.online ? 'opacity-55' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <RankMark rank={item.rank} />

        <div className="min-w-0 w-36 sm:w-48 lg:w-56">
          <div className="flex min-w-0 items-center gap-2">
            {item.team && (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: teamColor(item.team) }} aria-hidden="true" />
            )}
            <p className="truncate text-base font-bold text-slate-900 sm:text-lg">{item.nickname}</p>
            {!item.online && <WifiOff className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            {/* 分组赛:名字下面直接标组名,老师不用靠颜色点反查是哪一组 */}
            {teamName && (
              <span className="max-w-[7rem] truncate" title={teamName}>{teamName}</span>
            )}
            <span className={item.finished ? 'font-semibold text-emerald-600' : ''}>
              {STAGE_LABEL[item.stage ?? 'classify'] ?? '分类'}
            </span>
            {!item.finished && (item.group_total ?? 0) > 1 && (
              <span>第 {(item.group_idx ?? 0) + 1}/{item.group_total} 组</span>
            )}
            {item.streak >= 2 && item.online && (
              <span className="inline-flex items-center gap-1 font-numeric font-semibold text-rose-600">
                <Flame className="h-3.5 w-3.5" /> {item.streak}
              </span>
            )}
          </div>
        </div>

        <div className="min-w-[120px] flex-1">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-500">掌握进度</span>
            <span className={`font-numeric font-extrabold ${item.finished ? 'text-emerald-600' : 'text-slate-800'}`}>
              {item.finished ? '已完成' : `${progress}%`}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <motion.div
              className={`h-full rounded-full ${item.finished ? 'bg-emerald-500' : progressTone}`}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            />
          </div>
        </div>

        <div className="hidden w-52 shrink-0 grid-cols-3 gap-3 border-l border-slate-200 pl-4 md:grid">
          <div>
            <p className="text-[11px] text-slate-400">得分</p>
            <p className="font-numeric text-base font-extrabold text-slate-900">{item.points}</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-400">正确</p>
            <p className="font-numeric text-base font-extrabold text-emerald-600">{item.correct}</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-400">正确率</p>
            <p className="font-numeric text-base font-extrabold text-sky-700">{accuracy}%</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function TeamStandings({ teams }: { teams: PkTeamRankItem[] }) {
  if (teams.length === 0) return null;
  return (
    <section aria-labelledby="team-live-title">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 id="team-live-title" className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Users className="h-4 w-4 text-sky-600" /> 队伍排名
        </h2>
        <span className="text-xs text-slate-400">按人均分</span>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {teams.map((team) => (
          <motion.div
            key={team.team}
            layout
            className="flex items-center gap-3 rounded-lg border px-3.5 py-3"
            style={teamSurfaceStyle(team.team)}
          >
            <span className="font-numeric text-xl font-black text-slate-700">{team.rank}</span>
            <span className="h-9 w-1 rounded-full"
                  style={{ background: teamColor(team.team) }} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold text-slate-800" title={team.team_name || undefined}>
                {teamLabel(team.team, undefined, team.team_name)}
              </p>
              <p className="text-xs text-slate-500">{team.online_count}/{team.member_count} 人在线</p>
            </div>
            <div className="text-right">
              <p className="font-numeric text-lg font-black text-slate-900">{team.avg_points}</p>
              <p className="text-[11px] text-slate-500">人均分</p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export default function PkTeacherLiveBoard({
  items,
  teams,
  teamNames,
  mode,
  deadlineAt,
  spectatorCount,
  error,
  onFinish,
}: Props) {
  const countdown = useCountdown(deadlineAt);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const onlineCount = items.filter((item) => item.online).length;

  useEffect(() => {
    const update = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const columns = useMemo(() => {
    if (items.length <= 10) return [items];
    const midpoint = Math.ceil(items.length / 2);
    return [items.slice(0, midpoint), items.slice(midpoint)];
  }, [items]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // 浏览器或投屏环境不允许全屏时，页面本身仍保持全视口布局。
    }
  };

  const confirmFinish = () => {
    setShowConfirm(false);
    onFinish();
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f3f6fa] text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[1fr_auto] items-center gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
              <Swords className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-extrabold text-slate-900 sm:text-xl">PK 实时排名</h1>
                <span className="inline-flex items-center gap-1.5 rounded bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-600">
                  <motion.span
                    className="h-1.5 w-1.5 rounded-full bg-rose-500"
                    animate={{ opacity: [1, 0.25, 1] }}
                    transition={{ repeat: Infinity, duration: 1.1 }}
                  />
                  LIVE
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {mode === 'team' ? '分组赛 · 学生自选组' : '个人赛'} · {onlineCount}/{items.length} 人在线
                {spectatorCount > 0 ? ` · ${spectatorCount} 人观战` : ''}
              </p>
            </div>
          </div>

          <div className="order-3 col-span-2 flex items-center justify-center gap-3 border-t border-slate-100 pt-3 lg:order-none lg:col-span-1 lg:border-0 lg:pt-0">
            <Clock3 className={`h-5 w-5 ${countdown.urgent ? 'text-rose-500' : 'text-sky-600'}`} />
            <div className="text-center">
              <p className={`font-numeric text-3xl font-black leading-none tabular-nums ${countdown.urgent ? 'text-rose-600' : 'text-slate-900'}`}>
                {countdown.ended ? '结算中' : countdown.label}
              </p>
              {!countdown.ended && <p className="mt-1 text-[10px] font-semibold text-slate-400">剩余时间</p>}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? '退出全屏' : '进入全屏'}
              aria-label={isFullscreen ? '退出全屏' : '进入全屏'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 sm:px-4"
            >
              <CircleStop className="h-4 w-4" />
              <span className="hidden sm:inline">结束并公布成绩</span>
              <span className="sm:hidden">结束</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 p-4 sm:p-5 lg:p-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        {/* 大屏主视图:立式柱状图。投影时最先被看到的应该是"谁在前面、谁掉队",
            柱高比一行行读数字快得多;明细榜单留在下方给老师逐个看。
            分组赛比队伍(一队一色,颜色跟队号不跟名次),个人赛比学生(单序列蓝+强调) */}
        {mode === 'team' ? (
          <PkTeacherColumnChart
            variant="team"
            title="队伍得分"
            caption="柱高 = 队内人均得分(人数不等也公平);答对得分、答得快加成、提前完成有奖励"
            items={(teams ?? []).map((t) => ({
              key: `team-${t.team}`,
              label: teamLabel(t.team, undefined, t.team_name),
              value: t.avg_points,
              progress: t.avg_progress ?? 0,
              sublabel: `${Math.round((t.avg_progress ?? 0) * 100)}% · ${t.online_count}/${t.member_count}人`,
              seriesIndex: t.team,
              rank: t.rank,
              done: (t.done_count ?? 0) > 0 && (t.done_count ?? 0) >= t.member_count,
            }))}
          />
        ) : (
          <PkTeacherColumnChart
            variant="solo"
            title="学生得分"
            caption="柱高 = 累计得分(总分高者赢);答对得分、答得快有加成、提前完成按剩余时间加奖励"
            items={items.map(toColumnDatum)}
          />
        )}

        {mode === 'team' && <TeamStandings teams={teams ?? []} />}

        <section className="min-h-0 flex-1" aria-labelledby="student-live-title">
          <div className="mb-2.5 flex items-end justify-between gap-3">
            <div>
              <h2 id="student-live-title" className="flex items-center gap-2 text-base font-extrabold text-slate-800">
                <Activity className="h-4 w-4 text-orange-600" /> 学生实时排名
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                共 {items.length} 名学生 · 题量全场统一,率先全部掌握者赢;时间到未完成则比掌握进度(得分仅展示)
              </p>
            </div>
            <div className="hidden items-center gap-4 text-xs text-slate-500 sm:flex">
              <span className="inline-flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-sky-600" />掌握进度</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />答题表现</span>
            </div>
          </div>

          <div className={`grid gap-3 ${columns.length > 1 ? 'xl:grid-cols-2' : ''}`}>
            {columns.map((column, columnIndex) => (
              <div key={columnIndex} className="space-y-2.5">
                {column.map((item) => (
                  <StudentRankRow
                    key={item.user_id}
                    item={item}
                    teamName={mode === 'team' ? teamLabel(item.team, teamNames) : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      </main>

      <AnimatePresence>
        {showConfirm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowConfirm(false);
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="finish-dialog-title"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                  <CircleStop className="h-5 w-5" />
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  aria-label="关闭"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <h2 id="finish-dialog-title" className="mt-4 text-lg font-extrabold text-slate-900">确定提前结束比赛？</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">系统会按当前进度立即结算，并向全体学生公布最终排名。</p>
              <div className="mt-5 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  继续比赛
                </button>
                <button
                  type="button"
                  onClick={confirmFinish}
                  className="flex-1 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700"
                >
                  结束并公布
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
