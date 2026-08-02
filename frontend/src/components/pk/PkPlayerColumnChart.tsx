/**
 * 个人赛实时得分立式柱状图 —— 一人一根柱,柱子从底往上长。
 * 柱高画得分(规则:总分高者赢),不是进度 —— 画进度会让柱子顺序和名次对不上。
 *
 * 人多时的处理:不做横向滚动(投屏时没人去拖),而是
 * 1. 只画前 MAX_COLUMNS 根柱 + 保证自己那根一定在(自己被挤出前列时替换最后一根)
 * 2. 柱子随根数变窄、姓名竖排/截断
 * 剩下的人数在底部标出来,老师知道"没显示的还在场"。
 */
import { motion } from 'framer-motion';
import type { PkLiveRankItem } from '../../api/pk';

interface Props {
  items: PkLiveRankItem[];
  meId: number;
  /** 全场真实人数(服务端裁剪榜单时给出) */
  totalPlayers?: number;
  gains?: Record<string, number>;
  settleSeq?: number;
}

/**
 * 一屏最多画几根柱:再多柱子就细成竹签,读不出高度差。
 * 必须 ≤ 后端 RANKING_TOP_N(pk_websocket.py,当前 10)—— 大房间时后端只发前 N 名
 * (+ 自己),这里画得比 N 多的话,最后一格会落到后端追加的"自己"那条上,
 * 柱子位置就和名次对不上了。
 */
const MAX_COLUMNS = 10;

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/**
 * 柱色:前三名金银铜,自己橙,其余蓝青。只有"名次"和"是我"两种语义。
 * 深底上渐变必须「底深顶亮」——反过来柱顶会和深色背景糊在一起(实测金/银柱尤其明显)。
 */
function tone(rank: number, isMe: boolean): string {
  if (rank === 1) return 'from-amber-600 via-amber-400 to-yellow-200';
  if (rank === 2) return 'from-slate-500 via-slate-300 to-slate-100';
  if (rank === 3) return 'from-orange-700 via-orange-500 to-amber-300';
  if (isMe) return 'from-orange-600 via-primary to-orange-300';
  return 'from-sky-600 via-sky-400 to-cyan-200';
}

export default function PkPlayerColumnChart({
  items, meId, totalPlayers, gains, settleSeq = 0,
}: Props) {
  const total = totalPlayers ?? items.length;

  // 可视区严格是「名次连续的前 N 名」:柱子的左右位置 = 名次,不插队。
  // 只有当后面的人追上来、真的进了前 N,可视区里的柱子才换人/换位置。
  // (曾把"自己"硬塞到最后一格,导致名次不连续、还把真正的第 N 名挤掉 ——
  //  柱子位置和名次对不上,老师投屏时读不出谁是第几)
  const shown = items.slice(0, MAX_COLUMNS);
  // 自己没进前 N 时,单独用一条"我的位置"展示,不破坏上面的名次序列
  const me = items.find((i) => i.user_id === meId);
  const meOutside = me != null && !shown.some((i) => i.user_id === meId);
  const hidden = Math.max(0, total - shown.length);

  // 归一化按「得分」:规则是总分高者赢,画进度会让柱子顺序和名次对不上。
  // 得分没有天然上限(不像进度的 100%),只能相对最高分比
  const maxScore = Math.max(1, ...shown.map((i) => i.points ?? 0));
  const plotH = 190;
  const narrow = shown.length > 8;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-3 shadow-2xl ring-1 ring-white/10 sm:p-4">
      <div className="pointer-events-none absolute -top-20 left-1/2 h-44 w-64 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />

      {/* 标题 */}
      <div className="relative mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <h3 className="font-display text-[15px] font-extrabold tracking-wide text-white">实时得分</h3>
          <span className="font-numeric text-[11px] text-slate-400">{total} 人同场</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-1">
          <motion.span
            className="h-2 w-2 rounded-full bg-red-500"
            animate={{ opacity: [1, 0.3, 1], scale: [1, 0.8, 1] }}
            transition={{ repeat: Infinity, duration: 1.2 }}
          />
          <span className="text-[10px] font-bold tracking-widest text-red-300">LIVE</span>
        </div>
      </div>

      {/* 绘图区 */}
      <div className="relative" style={{ height: plotH }}>
        {/* 刻度网格 */}
        {[0, 25, 50, 75, 100].map((t) => (
          <div key={t} className="pointer-events-none absolute inset-x-0" style={{ bottom: `${t}%` }}>
            <div className={`h-px w-full ${t === 0 ? 'bg-white/20' : 'bg-white/[0.06]'}`} />
          </div>
        ))}

        <div className={`relative flex h-full items-end justify-around ${narrow ? 'gap-1' : 'gap-1.5'} px-1`}>
          {shown.map((it) => {
            const isMe = it.user_id === meId;
            const score = Math.max(0, it.points ?? 0);
            const prog = Math.max(0, Math.min(1, it.progress ?? 0));
            const hPct = (score / maxScore) * 90;
            const isLeader = it.rank === 1 && score > 0;
            const gain = gains?.[String(it.user_id)] ?? 0;

            return (
              <motion.div
                key={it.user_id}
                layout
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className={`relative flex h-full min-w-0 flex-1 flex-col items-center justify-end ${
                  !it.online ? 'opacity-40' : ''
                }`}
              >
                {/* +N 冒泡:单元素 + key 重播,不用 AnimatePresence(否则 DOM 里堆几百个透明节点) */}
                {gain > 0 && (
                  <motion.span
                    key={`g-${settleSeq}`}
                    initial={{ opacity: 0, y: 6, scale: 0.8 }}
                    animate={{ opacity: [0, 1, 1, 0], y: [6, -4, -10, -18], scale: [0.8, 1.2, 1.05, 1] }}
                    transition={{ duration: 1.4, times: [0, 0.15, 0.7, 1] }}
                    className="pointer-events-none absolute -top-1 z-10 font-numeric text-xs font-extrabold text-success drop-shadow-[0_0_6px_rgba(95,211,95,0.8)]"
                  >
                    +{gain}
                  </motion.span>
                )}

                {/* 柱顶得分(规则:总分高者赢),进度降为横轴小字 */}
                <motion.span
                  key={score}
                  initial={{ scale: 1.25 }}
                  animate={{ scale: 1 }}
                  className={`mb-0.5 font-numeric font-extrabold ${narrow ? 'text-[10px]' : 'text-xs'} ${
                    isLeader ? 'text-amber-300' : 'text-white'
                  }`}
                >
                  {it.finished ? '👑' : score.toLocaleString('zh-CN')}
                </motion.span>

                {/* 柱子 */}
                <motion.div
                  className={`relative w-full ${narrow ? 'max-w-[2rem]' : 'max-w-[2.75rem]'} overflow-hidden rounded-t-lg bg-gradient-to-t ${tone(it.rank, isMe)} ${
                    isMe ? 'ring-2 ring-primary ring-offset-1 ring-offset-slate-900' : ''
                  }`}
                  // 最低 8%:0% 的柱子不能缩成一条线,否则看着像这人不在场
                  animate={{ height: `${Math.max(hPct, 8)}%` }}
                  transition={{ type: 'spring', stiffness: 110, damping: 20 }}
                >
                  {isLeader && it.online && (
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-t from-transparent via-white/30 to-transparent"
                      initial={{ y: '100%' }}
                      animate={{ y: '-100%' }}
                      transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                    />
                  )}
                  {it.streak >= 2 && it.online && hPct > 20 && (
                    <span className="absolute inset-x-0 top-1 text-center text-[9px] font-bold text-black/60">
                      🔥{it.streak}
                    </span>
                  )}
                </motion.div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* 横轴:名次 + 姓名 */}
      <div className={`mt-2 flex items-start justify-around ${narrow ? 'gap-1' : 'gap-1.5'} border-t border-white/10 px-1 pt-2`}>
        {shown.map((it) => {
          const isMe = it.user_id === meId;
          return (
            <div key={it.user_id} className="min-w-0 flex-1 text-center">
              <div className="text-[10px] leading-none">{MEDAL[it.rank] ?? (
                <span className="font-numeric text-slate-500">{it.rank}</span>
              )}</div>
              <div
                className={`mt-0.5 truncate ${narrow ? 'text-[9px]' : 'text-[10px]'} font-bold ${
                  isMe
                    ? 'rounded bg-primary px-0.5 text-white'   // 实底而非橙字:柱子细时一眼找到自己
                    : it.rank <= 3 ? 'text-amber-200' : 'text-slate-400'
                }`}
                title={it.nickname}
              >
                {isMe ? '我' : it.nickname}
              </div>
            </div>
          );
        })}
      </div>

      {/* 自己没进可视区时:单独一行显示自己的名次和进度,
          让学生知道"我在第几、离前面差多少",而不用把柱子插进名次序列里 */}
      {meOutside && me && (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-primary/15 px-2.5 py-1.5 ring-1 ring-primary/40">
          <span className="rounded bg-primary px-1 text-[10px] font-bold text-white">我</span>
          <span className="font-numeric text-[11px] font-bold text-orange-200">第 {me.rank} 名</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/40">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-primary"
              animate={{ width: `${Math.max(2, Math.min(100, ((me.points ?? 0) / maxScore) * 100))}%` }}
              transition={{ type: 'spring', stiffness: 110, damping: 20 }}
            />
          </div>
          <span className="font-numeric text-[11px] font-extrabold text-white">
            {me.finished ? '👑' : (me.points ?? 0).toLocaleString('zh-CN')}
          </span>
        </div>
      )}

      {hidden > 0 && (
        <p className="mt-2 text-center text-[11px] text-slate-500">
          按名次显示前 {shown.length} 名 · 另有 {hidden} 人在场
        </p>
      )}
      {shown.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">等待选手上场…</p>
      )}
    </div>
  );
}
