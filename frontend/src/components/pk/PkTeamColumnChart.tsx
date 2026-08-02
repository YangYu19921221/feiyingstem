/**
 * 分组赛队伍立式柱状图 —— 一队一根柱,柱子从底往上长。
 *
 * 为什么分组用立式、个人用横式:
 * - 队伍只有 2~6 根柱,横轴放得下;标签是"第3队"这种短词,不像中文姓名会挤糊
 * - 立式的"长高"隐喻天然适合团队士气,一眼看出哪队冒头
 * - 个人赛可能 200 人,立式会压成竹签,所以那边保持横向条形
 *
 * 柱高 = 队内人均得分(与后端排名依据一致)。用人均而非总分,人多的队才不会自动赢;
 * 得分本身 = 掌握进度 × 词难度分之和,所以柱高同时反映了进度和词的难易。
 */
import { motion } from 'framer-motion';
import type { PkTeamRankItem } from '../../api/pk';
import { teamLabel } from '../../utils/pkTeam';

interface Props {
  items: PkTeamRankItem[];
  /** 我所在的队号,高亮显示 */
  myTeam?: number | null;
}

/** 队伍配色:与 PkArena/教师端队伍色板保持一致,老师换视图不用重新认色 */
// 渐变一律「底深顶亮」:深色背景上反过来会让柱顶糊掉
const TEAM_BAR = [
  'from-sky-600 via-sky-400 to-cyan-200',
  'from-rose-600 via-rose-400 to-pink-200',
  'from-emerald-600 via-emerald-400 to-teal-200',
  'from-amber-600 via-amber-400 to-yellow-200',
  'from-violet-600 via-violet-400 to-purple-200',
  'from-cyan-600 via-cyan-400 to-sky-200',
];
const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function PkTeamColumnChart({ items, myTeam }: Props) {
  // 归一化按「人均得分」:与排名口径一致(见 score.py),画进度会让柱序与名次不符
  const maxScore = Math.max(1, ...items.map((t) => t.avg_points ?? 0));
  const plotH = 176;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-3 shadow-2xl ring-1 ring-white/10 sm:p-4">
      <div className="pointer-events-none absolute -top-20 left-1/2 h-44 w-64 -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />

      <div className="relative mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🚩</span>
          <h3 className="font-display text-[15px] font-extrabold tracking-wide text-white">队伍战况</h3>
        </div>
        <span className="text-[10px] font-medium text-slate-400">柱高 = 人均得分</span>
      </div>

      {/* 绘图区:横向刻度网格 + 立柱 */}
      <div className="relative" style={{ height: plotH }}>
        {/* 25/50/75/100% 网格线,给"长了多高"一个参照 */}
        {[0, 25, 50, 75, 100].map((t) => (
          <div key={t} className="pointer-events-none absolute inset-x-0 flex items-center"
               style={{ bottom: `${t}%` }}>
            <div className={`h-px w-full ${t === 0 ? 'bg-white/20' : 'bg-white/[0.06]'}`} />
            <span className="absolute -left-0.5 -translate-y-2 text-[8px] text-slate-600">{t}</span>
          </div>
        ))}

        <div className="relative flex h-full items-end justify-around gap-2 px-2">
          {items.map((t) => {
            const score = Math.max(0, t.avg_points ?? 0);
            const prog = Math.max(0, Math.min(1, t.avg_progress ?? 0));
            // 相对最高队伍归一化,保证领先队顶到接近满格(视觉对比更强),同时保留真实百分比文字
            const hPct = (score / maxScore) * 92;
            const isLeader = t.rank === 1 && score > 0;
            const isMine = myTeam != null && t.team === myTeam;
            const tone = TEAM_BAR[(t.team - 1) % TEAM_BAR.length];

            return (
              <motion.div
                key={t.team}
                layout
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              >
                {/* 柱顶人均得分 */}
                <motion.span
                  key={Math.round(score)}
                  initial={{ scale: 1.25 }}
                  animate={{ scale: 1 }}
                  className={`mb-1 font-numeric text-xs font-extrabold ${
                    isLeader ? 'text-amber-300' : 'text-white'
                  }`}
                >
                  {Math.round(score).toLocaleString('zh-CN')}
                </motion.span>

                {/* 柱子:高度用弹簧动画长上来 */}
                <motion.div
                  className={`relative w-full max-w-[3.25rem] overflow-hidden rounded-t-lg bg-gradient-to-t ${tone} ${
                    isMine ? 'ring-2 ring-primary ring-offset-1 ring-offset-slate-900' : ''
                  }`}
                  // 最低 8%:落后队柱子太矮会缩成一条线、和横轴糊在一起,
                  // 看着像"这队没人"。留个可辨认的底座,真实数值靠柱顶百分比表达
                  animate={{ height: `${Math.max(hPct, 8)}%` }}
                  transition={{ type: 'spring', stiffness: 110, damping: 20 }}
                >
                  {/* 领先队流光(自下往上扫,呼应"往上冲") */}
                  {isLeader && (
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-t from-transparent via-white/30 to-transparent"
                      initial={{ y: '100%' }}
                      animate={{ y: '-100%' }}
                      transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                    />
                  )}
                  {/* 已完成人数徽标:柱子够高才放得进去 */}
                  {(t.done_count ?? 0) > 0 && hPct > 22 && (
                    <span className="absolute inset-x-0 top-1 text-center text-[9px] font-bold text-black/60">
                      👑{t.done_count}
                    </span>
                  )}
                </motion.div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* 横轴标签:队号 + 名次 + 在线人数 */}
      <div className="mt-2 flex items-start justify-around gap-2 border-t border-white/10 px-2 pt-2">
        {items.map((t) => {
          const isMine = myTeam != null && t.team === myTeam;
          return (
            <div key={t.team} className="min-w-0 flex-1 text-center">
              {/* 组名是老师起的,可能长(如"雷霆小组"):单行截断而非换行,
                  否则组名一长横轴高度就会跳,柱子跟着抖 */}
              <div className="flex items-center justify-center gap-0.5 overflow-hidden whitespace-nowrap">
                <span className="text-xs">{MEDAL[t.rank] ?? ''}</span>
                <span
                  title={teamLabel(t.team, undefined, t.team_name)}
                  className={`truncate text-[11px] font-bold ${
                    isMine
                      ? 'rounded bg-primary px-1 text-white'
                      : t.rank === 1 ? 'text-amber-200' : 'text-slate-300'
                  }`}
                >
                  {teamLabel(t.team, undefined, t.team_name)}
                </span>
              </div>
              <div className="font-numeric text-[9px] text-slate-500">
                {t.online_count}/{t.member_count}人
              </div>
            </div>
          );
        })}
      </div>

      {items.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-500">等待各班学生进场…</p>
      )}
    </div>
  );
}
