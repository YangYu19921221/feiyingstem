import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, Clock, Cpu,
  Gauge, HardDrive, MemoryStick, Pause, Pencil, Play, Server, Table2, Users, Wifi,
} from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import {
  fetchServerMetrics, updateCapacityConfig,
  type CapacityInfo, type MonitorSample, type ServerMetrics,
} from '../api/serverMonitor';

// 数据色经 dataviz 校验(白底):蓝橙 CVD ΔE 24.7 / 普通视觉 33.6,均通过
const PAL = {
  s1: '#2a78d6',        // 系列1 蓝(下行/读/单系列)
  s2: '#eb6834',        // 系列2 橙(上行/写)
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  warning: '#fab219',
  critical: '#d03b3b',
};

// ===== 格式化 =====
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) n = 0;
  let v = n, i = 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${UNITS[i]}`;
}
const fmtRate = (n: number) => `${fmtBytes(n)}/s`;
function fmtDuration(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  return `${m}分${Math.floor(sec % 60)}秒`;
}
const fmtClock = (t: number) => new Date(t * 1000).toLocaleTimeString('zh-CN', { hour12: false });

// 字节速率的"整洁"轴上限(1024 进制),空闲网络给 10KB/s 底座避免坐标轴抖动
function niceByteMax(v: number): number {
  v = Math.max(v, 10 * 1024);
  let unit = 1;
  while (v >= 1024 * unit) unit *= 1024;
  const m = v / unit;
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1024].find((s) => s >= m) ?? 1024;
  return step * unit;
}

// 整数计数轴的"整洁"上限(1-2-5 步进),至少 10 避免小样本时坐标轴抖动
function niceCountMax(v: number): number {
  v = Math.max(v, 10);
  let unit = 1;
  while (v >= 10 * unit) unit *= 10;
  const m = v / unit;
  const step = [1, 2, 5, 10].find((s) => s >= m) ?? 10;
  return step * unit;
}

function useMeasure<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// 3s 轮询;出错保留上一帧数据(图表不闪),暂停即停表
function useServerMetrics(paused: boolean) {
  const [data, setData] = useState<ServerMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (paused) return;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const d = await fetchServerMetrics();
        if (!alive) return;
        setData(d);
        setError(null);
      } catch (e) {
        if (!alive) return;
        const status = (e as { response?: { status?: number } })?.response?.status;
        setError(status === 503
          ? '服务器还未安装 psutil 依赖,请在服务器执行 pip install -r requirements.txt 后重启服务'
          : '获取监控数据失败,正在自动重试…');
      }
      timer = window.setTimeout(tick, 3000);
    };
    tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [paused]);
  return { data, error };
}

// ===== 迷你走势(stat tile 内,去强调灰 + 末点强调色) =====
function Sparkline({ values, color = PAL.s1 }: { values: number[]; color?: string }) {
  const W = 92, H = 28, P = 3;
  if (values.length < 2) return <svg width={W} height={H} aria-hidden />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    P + (i / (values.length - 1)) * (W - P * 2),
    H - P - ((v - min) / span) * (H - P * 2),
  ]);
  const last = pts[pts.length - 1];
  return (
    <svg width={W} height={H} aria-hidden className="shrink-0">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={PAL.axis} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

// ===== 时间序列图(1-2 系列;单系列画面积洗版,双系列画双线;十字线 + 全系列 tooltip) =====
interface ChartSeries { name: string; color: string; values: number[] }
function TimeChart({ times, series, unit, height = 156 }: {
  times: number[]; series: ChartSeries[]; unit: 'percent' | 'rate' | 'count'; height?: number;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const M = { top: 10, right: 14, bottom: 22, left: unit === 'rate' ? 56 : 38 };
  const iw = Math.max(10, width - M.left - M.right);
  const ih = height - M.top - M.bottom;
  const n = times.length;

  const dataMax = Math.max(...series.map((s) => Math.max(0, ...s.values)));
  const yMax = unit === 'percent' ? 100 : unit === 'count' ? niceCountMax(dataMax) : niceByteMax(dataMax);
  const ticks = unit === 'percent' ? [0, 25, 50, 75, 100] : [0, yMax / 2, yMax];
  const fmtTick = (v: number) => (unit === 'rate' ? fmtRate(v) : `${v}`);
  const fmtVal = (v: number) => (
    unit === 'percent' ? `${v.toFixed(1)}%` : unit === 'count' ? `${Math.round(v)} 人` : fmtRate(v)
  );

  if (n < 2 || width === 0) {
    return (
      <div ref={ref} style={{ height }} className="flex items-center justify-center text-xs text-slate-400">
        正在采集数据…
      </div>
    );
  }

  const t0 = times[0], t1 = times[n - 1];
  const x = (t: number) => M.left + ((t - t0) / (t1 - t0 || 1)) * iw;
  const y = (v: number) => M.top + ih - (Math.min(v, yMax) / yMax) * ih;
  const linePath = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const xTickIdx = [0, Math.floor((n - 1) / 3), Math.floor(((n - 1) * 2) / 3), n - 1];
  const onMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (n - 1)));
  };

  const hx = hover != null ? x(times[hover]) : 0;
  const tooltipLeft = hover != null ? Math.min(Math.max(hx + 10, 4), width - 168) : 0;

  return (
    <div ref={ref} className="relative" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join('、') + '走势图'}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={M.left} x2={M.left + iw} y1={y(tk)} y2={y(tk)} stroke={tk === 0 ? PAL.axis : PAL.grid} strokeWidth={1} />
            <text x={M.left - 6} y={y(tk) + 3} textAnchor="end" fontSize={10} fill={PAL.muted}>{fmtTick(tk)}</text>
          </g>
        ))}
        {xTickIdx.map((i, k) => (
          <text key={k} x={x(times[i])} y={height - 6} textAnchor={k === 0 ? 'start' : k === 3 ? 'end' : 'middle'} fontSize={10} fill={PAL.muted}>
            {fmtClock(times[i])}
          </text>
        ))}
        {series.length === 1 && (
          <path d={`${linePath(series[0].values)}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`} fill={series[0].color} fillOpacity={0.1} />
        )}
        {series.map((s) => (
          <path key={s.name} d={linePath(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover != null && (
          <g>
            <line x1={hx} x2={hx} y1={M.top} y2={M.top + ih} stroke={PAL.axis} strokeWidth={1} />
            {series.map((s) => (
              <circle key={s.name} cx={hx} cy={y(s.values[hover])} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
          </g>
        )}
        <rect
          x={M.left} y={M.top} width={iw} height={ih} fill="transparent"
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-2 z-10 w-40 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-md" style={{ left: tooltipLeft }}>
          <p className="mb-1 text-[11px] text-slate-400">{fmtClock(times[hover])}</p>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2 py-0.5">
              <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: s.color }} />
              <span className="text-xs font-bold text-slate-800">{fmtVal(s.values[hover])}</span>
              <span className="ml-auto text-[11px] text-slate-400">{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 图表卡:标题 + 图例(带实时值,即选择性直接标注) + 图
function ChartCard({ title, sub, series, times, unit, live }: {
  title: string; sub: string; series: ChartSeries[]; times: number[]; unit: 'percent' | 'rate' | 'count';
  live: { name: string; color: string; value: string }[];
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
        </div>
        <div className="flex items-center gap-4">
          {live.map((l) => (
            <div key={l.name} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 rounded" style={{ background: l.color }} />
              <span className="text-[11px] text-slate-400">{l.name}</span>
              <span className="text-sm font-bold text-slate-800">{l.value}</span>
            </div>
          ))}
        </div>
      </div>
      <TimeChart times={times} series={series} unit={unit} />
    </div>
  );
}

// ===== KPI stat tile =====
function StatTile({ icon: Icon, tone, label, value, note, spark, sparkColor }: {
  icon: typeof Cpu; tone: string; label: string; value: string; note: string;
  spark: number[]; sparkColor?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div>
        <Sparkline values={spark} color={sparkColor} />
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-slate-800">{value}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className="text-[11px] text-slate-400">{note}</span>
      </div>
    </div>
  );
}

// ===== 水位条:蓝→警告→危险,轨道用同 ramp 的浅一档 =====
function severity(p: number) {
  if (p >= 90) return { fill: PAL.critical, track: '#f8d9d9', alert: 'critical' as const };
  if (p >= 70) return { fill: PAL.warning, track: '#fdeecb', alert: 'warning' as const };
  return { fill: PAL.s1, track: '#cde2fb', alert: null };
}
function Meter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  const sev = severity(percent);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          {label}
          {sev.alert && (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color: sev.fill }}>
              <AlertTriangle className="h-3 w-3" />{sev.alert === 'critical' ? '告急' : '偏高'}
            </span>
          )}
        </span>
        <span className="text-sm font-bold text-slate-800">{percent.toFixed(1)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: sev.track }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, percent)}%`, background: sev.fill }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{detail}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-slate-400">{label}</span>
      <span className="truncate text-xs font-semibold text-slate-700" title={value}>{value}</span>
    </div>
  );
}

// ===== 并发容量评估 =====
const ROLE_LABELS: Record<string, string> = {
  student: '学生', teacher: '教师', admin: '管理员', org_admin: '机构管理', parent: '家长', display: '大屏',
};
const BOTTLENECK_LABELS: Record<CapacityInfo['estimate']['bottleneck'], string> = {
  bandwidth: '公网带宽', cpu: 'CPU(单核)', memory: '内存',
};

function CapacitySection({ cap, coresLogical }: { cap: CapacityInfo; coresLogical: number }) {
  const [editing, setEditing] = useState(false);
  const [mbpsInput, setMbpsInput] = useState('');
  const [saving, setSaving] = useState(false);

  const { estimate: est, usage: u, online: on } = cap;
  const levelPct = est.max_users > 0 ? Math.min(100, (on.active_5m / est.max_users) * 100) : 0;
  const roleText = Object.entries(on.roles)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${ROLE_LABELS[r] ?? r} ${n}`)
    .join(' · ');

  const saveMbps = async () => {
    const v = parseFloat(mbpsInput);
    if (!Number.isFinite(v) || v <= 0 || v > 10000) return;
    setSaving(true);
    try {
      await updateCapacityConfig(v);
      setEditing(false); // 下一轮 3s 轮询自然带回新估算,不做本地乐观更新
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Users className="h-4 w-4 text-slate-400" />并发容量评估
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {est.confidence === 'measured'
              ? `按最近 5 分钟实测外推:人均出网 ${fmtRate(u.per_user_bw)} · 人均 CPU ${u.per_user_cpu}%`
              : '当前活跃用户不足 5 人,按压测参考基准估算;人多起来后自动切换为实测外推'}
          </p>
        </div>
        {/* 带宽上限:云厂商限速 psutil 看不到,按购买值手填 */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Wifi className="h-3.5 w-3.5 text-slate-400" />
          {editing ? (
            <>
              <input
                type="number" min={1} max={10000} value={mbpsInput}
                onChange={(e) => setMbpsInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveMbps()}
                className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 focus:border-slate-500 focus:outline-none"
                autoFocus
              />
              <span>Mbps</span>
              <button type="button" onClick={saveMbps} disabled={saving} aria-label="保存带宽上限"
                className="rounded-md bg-slate-800 p-1.5 text-white transition hover:bg-slate-700 disabled:opacity-50">
                <Check className="h-3 w-3" />
              </button>
            </>
          ) : (
            <>
              <span>公网带宽上限 <b className="text-slate-700">{cap.config.bandwidth_mbps} Mbps</b></span>
              <button
                type="button" aria-label="修改带宽上限"
                onClick={() => { setMbpsInput(String(cap.config.bandwidth_mbps)); setEditing(true); }}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr] lg:gap-8">
        {/* 主结论:最大可支撑人数 + 当前水位 */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-4xl font-bold tracking-tight text-slate-800">
              ≈{est.max_users}<span className="ml-1 text-base font-semibold text-slate-400">人</span>
            </p>
            <p className="mt-1 text-xs font-medium text-slate-500">
              预计最大同时在线 · 瓶颈:<b className="text-slate-700">{BOTTLENECK_LABELS[est.bottleneck]}</b>
            </p>
          </div>
          <div className="flex gap-6">
            <div>
              <p className="text-2xl font-bold text-slate-800">{on.active_5m}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">当前在线(5分钟窗)</p>
              {roleText && <p className="mt-0.5 max-w-44 text-[11px] text-slate-400">{roleText}</p>}
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{on.peak_today}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">今日峰值</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{u.req_per_s} 请求/秒</p>
            </div>
          </div>
        </div>

        {/* 分路资源:各自能撑多少人,谁最小谁是瓶颈 */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Meter
            label={`带宽${est.bottleneck === 'bandwidth' ? ' · 瓶颈' : ''}`}
            percent={u.bw_percent}
            detail={`≈可撑 ${est.by_resource.bandwidth} 人 · 全机上行 ${fmtRate(u.bw_machine_up)}`}
          />
          <Meter
            label={`CPU 单核${est.bottleneck === 'cpu' ? ' · 瓶颈' : ''}`}
            percent={Math.min(100, u.proc_cpu_percent)}
            detail={`≈可撑 ${est.by_resource.cpu} 人 · 后端单进程,只能用满 1 核(全机 ${coresLogical} 核)`}
          />
          <Meter
            label={`容量水位${est.bottleneck === 'memory' ? '(内存瓶颈)' : ''}`}
            percent={levelPct}
            detail={`在线 ${on.active_5m} / 容量 ${est.max_users} · 内存路≈${est.by_resource.memory} 人`}
          />
        </div>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
        <p>
          PK 对战是消耗最陡的场景(实时榜广播随房间人数平方增长):按 {cap.pk_reference.tested_at_mbps}M 带宽压测折算,
          当前带宽约支持 <b className="text-slate-600">8人房 ≈{cap.pk_reference.room8_users} 人</b> 或
          <b className="text-slate-600"> 20人房 ≈{cap.pk_reference.room20_users} 人</b> 同时对战。
        </p>
        <p>
          扩容优先级:<b className="text-slate-600">升带宽</b>见效最直接(改上限即可看到新估算);
          后端是单进程部署,只能用满 1 核,加 worker 用多核需先把 PK 房间/限流等进程内状态迁到共享存储,
          且当前瓶颈多为带宽时提升有限。
        </p>
        <p>估算已预留 15% 余量;在线口径=5分钟内有请求的账号(含PK的WebSocket心跳);今日峰值重启后重新统计。</p>
      </div>
    </section>
  );
}

// ===== 页面 =====
const AdminServerMonitor = () => {
  const [paused, setPaused] = useState(false);
  const [windowSec, setWindowSec] = useState(300);
  const [showTable, setShowTable] = useState(false);
  const { data, error } = useServerMetrics(paused);

  const view = useMemo(() => {
    const history = data?.history ?? [];
    const latestT = history.length ? history[history.length - 1].t : 0;
    const sliced = history.filter((s) => s.t >= latestT - windowSec);
    return {
      sliced,
      times: sliced.map((s) => s.t),
      pick: (key: keyof MonitorSample) => sliced.map((s) => s[key] as number),
    };
  }, [data, windowSec]);

  const now = data?.now;
  const spark = (key: keyof MonitorSample) => view.sliced.slice(-30).map((s) => s[key] as number);

  return (
    <div className="admin-legacy-page min-h-screen text-slate-800">
      <StaffWorkspaceHeader role="admin" title="服务器监控" subtitle={data?.static.hostname || '实时服务状态'} icon={Gauge} action={<div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${paused ? 'bg-slate-100 text-[#536170]' : 'bg-emerald-50 text-emerald-700'}`}><span className={`h-2 w-2 rounded-full ${paused ? 'bg-slate-400' : 'animate-pulse bg-emerald-500'}`} />{paused ? '已暂停' : '实时 · 3s'}</div>} />

      <main className="admin-workspace-main space-y-5">
        {/* 控制行:窗口 + 暂停 + 表格视图 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white text-xs font-semibold shadow-sm">
            {[{ v: 300, t: '最近 5 分钟' }, { v: 600, t: '最近 10 分钟' }].map(({ v, t }) => (
              <button
                key={v} type="button" onClick={() => setWindowSec(v)}
                className={`px-3 py-2 transition ${windowSec === v ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >{t}</button>
            ))}
          </div>
          <button
            type="button" onClick={() => setPaused((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? '继续刷新' : '暂停刷新'}
          </button>
          <button
            type="button" onClick={() => setShowTable((s) => !s)}
            className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm transition ${showTable ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            <Table2 className="h-3.5 w-3.5" />数据明细
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}

        {!data && !error && (
          <div className="rounded-xl border border-slate-200/80 bg-white py-16 text-center text-sm text-slate-400 shadow-sm">正在连接服务器…</div>
        )}

        {data && now && (
          <>
            {/* 并发容量评估(核心结论区;后端未更新时跳过渲染) */}
            {data.capacity && <CapacitySection cap={data.capacity} coresLogical={data.static.cores_logical} />}

            {data.capacity && (
              <ChartCard
                title="在线人数" sub="5 分钟窗内有请求的账号数(含 PK WebSocket 心跳)" unit="count" times={view.times}
                series={[{ name: '在线', color: PAL.s1, values: view.sliced.map((s) => s.online ?? 0) }]}
                live={[{ name: '当前', color: PAL.s1, value: `${data.capacity.online.active_5m} 人` }]}
              />
            )}

            {/* KPI 行 */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              <StatTile icon={Cpu} tone="bg-blue-50 text-blue-600" label="CPU 使用率" value={`${now.cpu.toFixed(1)}%`}
                note={now.load_avg ? `负载 ${now.load_avg[0]}` : `${data.static.cores_logical} 线程`} spark={spark('cpu')} />
              <StatTile icon={MemoryStick} tone="bg-violet-50 text-violet-600" label="内存使用率" value={`${now.mem.percent.toFixed(1)}%`}
                note={`${fmtBytes(now.mem.used)} / ${fmtBytes(now.mem.total)}`} spark={spark('mem')} />
              <StatTile icon={ArrowDown} tone="bg-sky-50 text-sky-600" label="网络下行" value={fmtRate(now.net_down)}
                note={now.net_total ? `累计 ${fmtBytes(now.net_total.recv)}` : ''} spark={spark('net_down')} />
              <StatTile icon={ArrowUp} tone="bg-orange-50 text-orange-600" label="网络上行" value={fmtRate(now.net_up)}
                note={now.net_total ? `累计 ${fmtBytes(now.net_total.sent)}` : ''} spark={spark('net_up')} sparkColor={PAL.s2} />
            </section>

            {/* 走势图 */}
            <section className="grid gap-3 md:gap-4 lg:grid-cols-2">
              <ChartCard title="CPU 使用率" sub="全核平均 · 采样间隔 2s" unit="percent" times={view.times}
                series={[{ name: 'CPU', color: PAL.s1, values: view.pick('cpu') }]}
                live={[{ name: '当前', color: PAL.s1, value: `${now.cpu.toFixed(1)}%` }]} />
              <ChartCard title="内存使用率" sub={`物理内存 ${fmtBytes(now.mem.total)}`} unit="percent" times={view.times}
                series={[{ name: '内存', color: PAL.s1, values: view.pick('mem') }]}
                live={[{ name: '当前', color: PAL.s1, value: `${now.mem.percent.toFixed(1)}%` }]} />
              <ChartCard title="网络吞吐" sub="上下行速率" unit="rate" times={view.times}
                series={[
                  { name: '下行', color: PAL.s1, values: view.pick('net_down') },
                  { name: '上行', color: PAL.s2, values: view.pick('net_up') },
                ]}
                live={[
                  { name: '下行', color: PAL.s1, value: fmtRate(now.net_down) },
                  { name: '上行', color: PAL.s2, value: fmtRate(now.net_up) },
                ]} />
              <ChartCard title="磁盘 I/O" sub="读写速率" unit="rate" times={view.times}
                series={[
                  { name: '读取', color: PAL.s1, values: view.pick('disk_read') },
                  { name: '写入', color: PAL.s2, values: view.pick('disk_write') },
                ]}
                live={[
                  { name: '读取', color: PAL.s1, value: fmtRate(now.disk_read) },
                  { name: '写入', color: PAL.s2, value: fmtRate(now.disk_write) },
                ]} />
            </section>

            {/* 水位 / 核心 / 系统信息 */}
            <section className="grid gap-3 md:gap-4 lg:grid-cols-3">
              <div className="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800"><HardDrive className="h-4 w-4 text-slate-400" />资源水位</h3>
                <Meter label="内存" percent={now.mem.percent} detail={`已用 ${fmtBytes(now.mem.used)} · 可用 ${fmtBytes(now.mem.available)}`} />
                {now.swap && now.swap.total > 0 && (
                  <Meter label="交换分区" percent={now.swap.percent} detail={`已用 ${fmtBytes(now.swap.used)} / ${fmtBytes(now.swap.total)}`} />
                )}
                <Meter label="磁盘空间" percent={now.disk.percent} detail={`已用 ${fmtBytes(now.disk.used)} · 剩余 ${fmtBytes(now.disk.free)}`} />
              </div>

              <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800"><Cpu className="h-4 w-4 text-slate-400" />CPU 核心</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {now.per_core.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-[11px] text-slate-400">{i}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, p)}%`, background: PAL.s1 }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-600">{p.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                  <span>{data.static.cores_physical} 核 {data.static.cores_logical} 线程</span>
                  {now.cpu_freq_mhz && <span>{(now.cpu_freq_mhz / 1000).toFixed(1)} GHz</span>}
                  {now.load_avg && <span>负载 {now.load_avg.join(' / ')}</span>}
                  {now.temperature != null && <span>温度 {now.temperature}°C</span>}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800"><Server className="h-4 w-4 text-slate-400" />系统信息</h3>
                <div className="divide-y divide-slate-50">
                  <InfoRow label="主机" value={`${data.static.hostname} · ${data.static.os} ${data.static.arch}`} />
                  <InfoRow label="开机时长" value={fmtDuration(now.uptime_seconds)} />
                  <InfoRow label="进程数" value={`${now.process_count}`} />
                  <InfoRow label="TCP 连接" value={now.connections ? `${now.connections.established} 活跃 / ${now.connections.listen} 监听 / 共 ${now.connections.total}` : '—'} />
                  <InfoRow label="后端服务" value={`内存 ${fmtBytes(now.service.rss)} · CPU ${now.service.cpu.toFixed(1)}% · ${now.service.threads} 线程${now.service.fds != null ? ` · ${now.service.fds} FD` : ''}`} />
                  <InfoRow label="服务运行" value={`${fmtDuration(now.service.uptime_seconds)} · Python ${data.static.python}`} />
                  {now.db && <InfoRow label="数据库" value={`主库 ${fmtBytes(now.db.main_bytes)} · WAL ${fmtBytes(now.db.wal_bytes)}`} />}
                </div>
              </div>
            </section>

            {/* 表格视图(图表的无障碍等价物) */}
            {showTable && (
              <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
                  <h3 className="text-sm font-bold text-slate-800">采样明细</h3>
                  <span className="text-[11px] text-slate-400">最近 30 条 · 新在前</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-slate-400">
                        {['时间', '在线', 'CPU', '内存', '下行', '上行', '磁盘读', '磁盘写'].map((h) => (
                          <th key={h} className="px-4 py-2 font-medium sm:px-5">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...view.sliced].reverse().slice(0, 30).map((s) => (
                        <tr key={s.t} className="border-b border-slate-50 text-slate-600">
                          <td className="px-4 py-1.5 sm:px-5">{fmtClock(s.t)}</td>
                          <td className="px-4 py-1.5 sm:px-5">{s.online ?? '—'}</td>
                          <td className="px-4 py-1.5 sm:px-5">{s.cpu.toFixed(1)}%</td>
                          <td className="px-4 py-1.5 sm:px-5">{s.mem.toFixed(1)}%</td>
                          <td className="px-4 py-1.5 sm:px-5">{fmtRate(s.net_down)}</td>
                          <td className="px-4 py-1.5 sm:px-5">{fmtRate(s.net_up)}</td>
                          <td className="px-4 py-1.5 sm:px-5">{fmtRate(s.disk_read)}</td>
                          <td className="px-4 py-1.5 sm:px-5">{fmtRate(s.disk_write)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Clock className="h-3 w-3" />服务端每 2 秒采样,保留最近 10 分钟;页面每 3 秒刷新,离开页面 10 分钟后采样自动休眠
            </p>
          </>
        )}
      </main>
    </div>
  );
};

export default AdminServerMonitor;
