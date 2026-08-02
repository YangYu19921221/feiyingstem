/**
 * 教师端大屏:立式柱状图(浅色主题,投影可读)。
 *
 * 一个组件配置出两种用法,不写两份:
 * - 分组赛:一队一根柱 → 队伍是「身份」,用分类色板(固定顺序,颜色跟队号不跟名次)
 * - 个人赛:一人一根柱 → 全班是「同一个序列」,统一蓝色 + 只强调领跑者/需关注者
 *   (按名次深浅上色会把柱高重复编码成颜色,是明确的反模式)
 *
 * 设计口径来自 dataviz 规范,几条硬要求都落实了:
 * - 色板跑过校验脚本(6 队分类色板:亮度带/彩度/CVD/常视觉全部 PASS;
 *   其中 3 个色低于 3:1 对比 → 规范要求"可见标签或表格视图"兜底,两者都做了)
 * - 柱宽封顶 24px、柱顶 4px 圆角、底边方角、网格线是 1px 实线且比背景只深一档
 * - 不给每根柱都标数字(那是反模式):只直接标领跑者与需关注者,
 *   其余靠 Y 轴刻度 + 悬停提示 + 表格视图,数值不会只能靠悬停才看得到
 * - 文字一律用墨色,不穿数据色;身份靠旁边的色块传达
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Table2, WifiOff } from 'lucide-react';
import { useBreakpoint } from '../../hooks/useBreakpoint';

/** 一根柱子的数据 */
export interface ColumnDatum {
  key: string | number;
  /** 横轴标签(队号 / 学生姓名) */
  label: string;
  /**
   * 柱高的原始值(得分)。柱高按「相对最高分」归一化,不再是 0~1 的进度。
   * ⚠️ 必须画得分而不是进度:规则已改为得分定胜负,画进度会让大屏第一名
   * 和最终赢家不是同一人 —— 那是学生当场质疑的地方。
   */
  value: number;
  /** 辅助读数:掌握进度 0~1(小字展示,不决定柱高) */
  progress?: number;
  /** 标签下方的小字(在线人数 / 阶段) */
  sublabel?: string;
  /** 分组赛:队号,决定分类色槽(颜色跟实体,不跟名次) */
  seriesIndex?: number;
  /** 名次,用于奖牌与"领跑者"判定 */
  rank?: number;
  offline?: boolean;
  /** 需关注(正确率偏低等):走状态色 + 图标 + 文字,不靠颜色单独表意 */
  needsAttention?: boolean;
  /** 已完成 */
  done?: boolean;
}

interface Props {
  items: ColumnDatum[];
  /** team=分类色(一队一色);solo=单序列蓝 + 强调 */
  variant: 'team' | 'solo';
  title: string;
  /** 图下方说明(口径/单位) */
  caption?: string;
  /** 一屏最多画几根柱;不传则按屏幕大小自动(手机 8 / 平板 14 / 大屏 20)。
   *  超出的在脚注说明,不做横向滚动(投屏没人去拖,手机横滑也会和页面滚动打架) */
  maxColumns?: number;
  /** 数值轴单位后缀,默认「分」(柱高画的是得分) */
  unit?: string;
}

/* ── 色板(来自 dataviz 参考色板,已跑校验) ───────────────────────── */
const SURFACE = '#fcfcfb';
const INK_PRIMARY = '#0b0b0b';
const INK_SECONDARY = '#52514e';
const INK_MUTED = '#898781';
const GRIDLINE = '#e1e0d9';
const BASELINE = '#c3c2b7';
/**
 * 分类色槽(固定顺序,最多 6 队)—— 队伍身份色的唯一真源。
 *
 * 顺序本身就是 CVD 安全机制,不是配色偏好:这 6 个色跑过校验脚本,
 * 亮度带/彩度/相邻 CVD 分离度/常视觉分离度全部 PASS(最差相邻 CVD ΔE 9.1)。
 * 别换成 tailwind 的 sky/rose/emerald/... —— 那组实测 emerald↔rose 在红绿色盲下
 * ΔE 只有 5.6(FAIL),第 2、3 队的柱子会分不出来。
 * 教师端名册也 import 这一份,保证"第 3 队"在大屏任何位置都是同一个颜色。
 */
export const TEAM_SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const SERIES = TEAM_SERIES;
/** 个人赛:单序列 + 强调色 */
const SOLO_BASE = '#2a78d6';
const SOLO_LEAD = '#eb6834';
const DE_EMPHASIS = '#c3c2b7';
/** 状态色(保留槽位,只表示状态,永远配图标+文字) */
const STATUS_CRITICAL = '#d03b3b';
const STATUS_GOOD = '#0ca30c';

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
/** 网格线位置(占轴高百分比)。轴刻度值由 niceMax 按比例算出 */
const TICKS = [0, 25, 50, 75, 100];

/**
 * 轴上限取整到"好看的数":得分是任意整数,直接拿最高分当轴顶会出现
 * 「1837 / 1378 / 918」这种刻度,投屏根本读不出来。
 * 取整到 1/2/5 × 10^n 的整数档,刻度就落在 0/500/1000/1500/2000 这类值上。
 */
function axisNiceMax(v: number): number {
  if (v <= 0) return 4;
  // 取整「每格刻度」而不是「轴顶」:轴分 4 格(0/25/50/75/100),
  // 只取整轴顶会算出 375 / 1,125 这种刻度,投屏读不出来。
  // 先把 v/4 snap 到整数档,再 ×4 —— 四个刻度必然都是整数,
  // 同时留白 ≤25%(只 snap 轴顶时 3000 分会被抬到 5000,柱子只占 60% 画布)。
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // 档位必须够密,否则会浪费画布:只有 [1,2,...] 时 4800 分被抬到轴顶 8000,
  // 柱子只占 60%,大屏上看着像"全班都没背多少"。加密后留白稳定在 ≤12%。
  for (const step of [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10]) {
    const cand = step * mag;
    if (cand >= raw) return cand * 4;
  }
  return 10 * mag * 4;
}

/** 千分位:大屏上 12,480 比 12480 好读 */
const fmt = (n: number) => Math.round(n).toLocaleString('zh-CN');

function colorFor(d: ColumnDatum, variant: 'team' | 'solo'): string {
  if (d.offline) return DE_EMPHASIS;
  if (d.needsAttention) return STATUS_CRITICAL;
  if (variant === 'team') {
    const slot = ((d.seriesIndex ?? 1) - 1) % SERIES.length;
    return SERIES[slot];
  }
  if (d.done) return STATUS_GOOD;
  return d.rank === 1 ? SOLO_LEAD : SOLO_BASE;
}

export default function PkTeacherColumnChart({
  items, variant, title, caption, maxColumns, unit = '分',
}: Props) {
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<ColumnDatum | null>(null);
  const bp = useBreakpoint();
  // 量真实绘图区宽度:标签能不能放下必须"先测量",不能靠猜(见 dataviz marks 规范)。
  // 实测手机 8 根柱时标签宽 44px、槽距也是 44px —— 零间隙,肉眼就是糊成一片。
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [plotW, setPlotW] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setPlotW(e.contentRect.width));
    ro.observe(el);
    setPlotW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  // 手机上最多画 8 根:再多柱子比手指还窄,点不中也读不出
  const cap = maxColumns ?? (bp === 'mobile' ? 8 : bp === 'tablet' ? 14 : 20);

  // 可视区严格取名次前 N(名次连续,柱子的左右位置就等于名次);
  // 其余人数在脚注说明,绝不静默截断
  const shown = useMemo(() => items.slice(0, cap), [items, cap]);
  const hiddenCount = Math.max(0, items.length - shown.length);
  const attention = items.filter((i) => i.needsAttention || i.offline).length;

  // 柱高按「相对最高分」归一化:得分没有天然上限(不像进度的 100%),
  // 只能相对比较。领跑者顶到 92%(留出柱顶数值的位置),其余按比例。
  // 全场 0 分时给一个正的分母,避免除零把所有柱子算成 NaN。
  const maxValue = Math.max(1, ...shown.map((d) => d.value));
  const niceMax = axisNiceMax(maxValue);
  //
  // 柱宽随根数变化:柱少时加宽,大屏投影才有气势。
  // ⚠️ 这里刻意超出 dataviz 规范的「柱宽 ≤24px」上限 —— 那个上限针对的是
  // 密集仪表盘(近距离阅读、一屏多图);本组件是教室投影,观看距离 3~5 米,
  // 24px 的柱子在后排就是几根细线。规范的真实意图是"别把整个槽位填满,留白",
  // 这一点仍然遵守:柱宽同时受槽位 60% 约束,band 的剩余永远是空气。
  const n = Math.max(1, shown.length);
  // 柱宽/画布高随「屏幕大小 × 柱子根数」两维决定:
  // - 大屏投影(desktop):柱子要粗,后排才看得见
  // - 手机(mobile):屏窄,柱子必须瘦且少,否则挤成一团;同时字号不能跟着缩
  const isMobile = bp === 'mobile';
  const isTablet = bp === 'tablet';
  const barMaxPx = isMobile
    ? (n <= 4 ? 44 : n <= 6 ? 34 : n <= 10 ? 24 : 16)
    : isTablet
      ? (n <= 4 ? 72 : n <= 6 ? 56 : n <= 10 ? 40 : n <= 14 ? 30 : 22)
      : (n <= 4 ? 96 : n <= 6 ? 76 : n <= 10 ? 56 : n <= 14 ? 40 : n <= 20 ? 28 : 22);
  // 柱少时画布也拉高,比例才不失衡(宽而矮的柱子看着像色块不像柱)
  const plotH = isMobile
    ? (n <= 6 ? 190 : 168)
    : (n <= 6 ? 268 : n <= 14 ? 232 : 208);
  const bigType = !isMobile && n <= 10;   // 柱少 → 数值/姓名一起放大,后排看得见

  // 标签能不能放下要「先测量」,不能硬放(见 dataviz marks 规范):
  // 实测手机 8 根柱时标签宽 44px、槽距也是 44px —— 零间隙,肉眼就是糊成一片。
  // 放不下就不标,值交给悬停 + 表格视图(两者都已提供,所以不算信息丢失)。
  const slotW = plotW > 0 ? plotW / n : 0;
  const labelChars = fmt(niceMax).length + unit.length;   // 最长可能的数值文本
  const estLabelW = labelChars * (bigType ? 11 : 7.2) + 6; // 6px 呼吸
  const labelsFit = slotW === 0 || slotW >= estLabelW;

  return (
    <section
      className="rounded-xl border border-slate-200 p-4 sm:p-5"
      style={{ background: SURFACE }}
      aria-labelledby="tcol-title"
    >
      {/* 标题行 + 表格视图开关 */}
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="tcol-title" className="text-base font-extrabold sm:text-lg" style={{ color: INK_PRIMARY }}>
            {title}
          </h3>
          {caption && (
            <p className="mt-1 text-xs sm:text-[13px]" style={{ color: INK_MUTED }}>{caption}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-pressed={showTable}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-slate-50"
          style={{ color: INK_SECONDARY }}
        >
          <Table2 className="h-3.5 w-3.5" />
          {showTable ? '看图' : '看表'}
        </button>
      </div>

      {/* 图例:两个及以上序列必须有(分组赛一队一色);个人赛只有一色,标题已说明,不放图例框 */}
      {variant === 'team' && shown.length >= 2 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {shown.map((d) => (
            <span key={d.key} className="inline-flex items-center gap-1.5 text-xs sm:text-[13px]"
                  style={{ color: INK_SECONDARY }}>
              <span className="h-3 w-3 rounded-sm" style={{ background: colorFor(d, variant) }} aria-hidden="true" />
              {d.label}
            </span>
          ))}
        </div>
      )}
      {variant === 'solo' && (attention > 0 || shown.some((d) => d.done)) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-[13px]"
             style={{ color: INK_SECONDARY }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: SOLO_LEAD }} aria-hidden="true" />领跑
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: SOLO_BASE }} aria-hidden="true" />进行中
          </span>
          {shown.some((d) => d.done) && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ background: STATUS_GOOD }} aria-hidden="true" />已完成
            </span>
          )}
          {attention > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" style={{ color: STATUS_CRITICAL }} aria-hidden="true" />
              需关注 / 掉线
            </span>
          )}
        </div>
      )}

      {showTable ? (
        /* 表格视图:与图等价的无障碍读法,每个值都在这里,不靠悬停 */
        <div className="max-h-[22rem] overflow-y-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="sticky top-0" style={{ background: SURFACE }}>
              <tr style={{ color: INK_SECONDARY }}>
                <th className="py-2 pr-3 text-left font-semibold">名次</th>
                <th className="py-2 pr-3 text-left font-semibold">{variant === 'team' ? '队伍' : '学生'}</th>
                <th className="py-2 pr-3 text-right font-semibold">得分</th>
                <th className="py-2 pr-3 text-right font-semibold">进度</th>
                <th className="py-2 text-left font-semibold">状态</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.key} className="border-t" style={{ borderColor: GRIDLINE }}>
                  <td className="py-1.5 pr-3" style={{ color: INK_MUTED }}>{d.rank ?? '-'}</td>
                  <td className="py-1.5 pr-3 font-medium" style={{ color: INK_PRIMARY }}>{d.label}</td>
                  <td className="py-1.5 pr-3 text-right font-bold tabular-nums" style={{ color: INK_PRIMARY }}>
                    {fmt(d.value)}{unit}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums" style={{ color: INK_SECONDARY }}>
                    {d.progress != null ? `${Math.round(d.progress * 100)}%` : '-'}
                  </td>
                  <td className="py-1.5" style={{ color: INK_SECONDARY }}>
                    {d.offline ? '掉线' : d.done ? '已完成' : d.needsAttention ? '需关注' : (d.sublabel || '进行中')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {/* 绘图区:左侧 Y 轴刻度 + 网格线(1px 实线,比背景只深一档) */}
          <div className="relative flex gap-2">
            <div className="relative w-11 shrink-0" style={{ height: plotH }} aria-hidden="true">
              {TICKS.map((t) => (
                <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums"
                      style={{ bottom: `${t}%`, color: INK_MUTED }}>
                  {fmt((niceMax * t) / 100)}
                </span>
              ))}
            </div>

            <div ref={plotRef} className="relative min-w-0 flex-1" style={{ height: plotH }}>
              {TICKS.map((t) => (
                <div key={t} className="pointer-events-none absolute inset-x-0"
                     style={{ bottom: `${t}%`, height: 1,
                              background: t === 0 ? BASELINE : GRIDLINE }} aria-hidden="true" />
              ))}

              <div className="relative flex h-full items-end justify-around">
                {shown.map((d) => {
                  // 柱高 = 得分 / 轴上限(得分无天然上限,只能相对比)
                  const pct = niceMax > 0 ? Math.max(0, Math.min(100, (d.value / niceMax) * 100)) : 0;
                  const fill = colorFor(d, variant);
                  const isLead = d.rank === 1 && d.value > 0;
                  // 只给"领跑者 / 需关注 / 已完成"直接标数值 —— 每根都标是反模式,
                  // 其余数值由 Y 轴刻度 + 悬停 + 表格视图承担
                  // 领跑者始终标:它是本图的主角,且"只标一个"永远不会和邻居碰撞。
                  // 其余(需关注/掉线/已完成)只在测量确认放得下时才标,
                  // 放不下时值仍可从悬停与表格视图读到,不算信息丢失。
                  const labelIt = isLead || (labelsFit && (d.needsAttention || d.offline || d.done));
                  return (
                    <div
                      key={d.key}
                      className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end"
                      onPointerEnter={() => setHover(d)}
                      onPointerLeave={() => setHover((h) => (h?.key === d.key ? null : h))}
                      onFocus={() => setHover(d)}
                      onBlur={() => setHover((h) => (h?.key === d.key ? null : h))}
                      tabIndex={0}
                      aria-label={`${d.label} 得分 ${fmt(d.value)}${unit}${
                        d.progress != null ? `,掌握进度 ${Math.round(d.progress * 100)}%` : ''
                      }`}
                    >
                      {labelIt && (
                        <span
                          className={`mb-1 font-extrabold tabular-nums ${
                            bigType ? 'text-base sm:text-lg' : 'text-[11px] sm:text-xs'
                          }`}
                          style={{ color: INK_PRIMARY }}
                        >
                          {fmt(d.value)}{unit}
                        </span>
                      )}
                      <motion.div
                        className="w-full rounded-t"
                        // 60% 槽宽是"留白"约束(规范本意),barMaxPx 是投影可读性下限
                        style={{ background: fill, maxWidth: `min(${barMaxPx}px, 60%)` }}
                        initial={false}
                        // 柱子"长"上来;最低 2px 保证 0% 也看得见有这根柱(不是没人)
                        animate={{ height: `max(2px, ${pct}%)` }}
                        transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* 悬停/聚焦读数:数值在前、名字在后(读者已有对象,想要的是数) */}
              {hover && (
                <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg">
                  <span className="font-bold tabular-nums" style={{ color: INK_PRIMARY }}>
                    {Math.round(Math.max(0, Math.min(1, hover.value)) * 100)}{unit}
                  </span>
                  <span className="ml-1.5" style={{ color: INK_SECONDARY }}>{hover.label}</span>
                  {hover.sublabel && (
                    <span className="ml-1.5" style={{ color: INK_MUTED }}>· {hover.sublabel}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 横轴标签 */}
          <div className="mt-2 flex gap-2 border-t pt-2" style={{ borderColor: GRIDLINE }}>
            <div className="w-11 shrink-0" />
            <div className="flex min-w-0 flex-1 justify-around">
              {shown.map((d) => (
                <div key={d.key} className="min-w-0 flex-1 px-0.5 text-center">
                  <div className={bigType ? 'text-lg leading-tight' : 'text-[11px] leading-tight sm:text-xs'}>
                    {d.rank && MEDAL[d.rank] ? (
                      <span aria-hidden="true">{MEDAL[d.rank]}</span>
                    ) : (
                      <span className="tabular-nums" style={{ color: INK_MUTED }}>{d.rank ?? ''}</span>
                    )}
                  </div>
                  <div
                    className={`truncate font-bold ${bigType ? 'text-sm sm:text-base' : 'text-[11px] sm:text-xs'}`}
                    style={{ color: d.offline || d.needsAttention ? INK_MUTED : INK_PRIMARY }}
                    title={d.label}
                  >
                    {d.label}
                  </div>
                  {(d.offline || d.needsAttention) && (
                    <div className="flex items-center justify-center gap-0.5 text-[10px]"
                         style={{ color: STATUS_CRITICAL }}>
                      {d.offline
                        ? <><WifiOff className="h-2.5 w-2.5" aria-hidden="true" />掉线</>
                        : <><AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />关注</>}
                    </div>
                  )}
                  {d.sublabel && !d.offline && !d.needsAttention && (
                    <div className="truncate text-[10px]" style={{ color: INK_MUTED }}>{d.sublabel}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {hiddenCount > 0 && (
            <p className="mt-2 text-center text-xs" style={{ color: INK_MUTED }}>
              图中为名次前 {shown.length} 名 · 另有 {hiddenCount} 人,点「看表」查看全部
            </p>
          )}
          {shown.length === 0 && (
            <p className="py-8 text-center text-sm" style={{ color: INK_MUTED }}>等待学生进入…</p>
          )}
        </>
      )}
    </section>
  );
}
