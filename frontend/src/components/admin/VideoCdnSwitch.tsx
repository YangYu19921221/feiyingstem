import { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudOff, Globe, RefreshCw, Server, Zap, type LucideIcon } from 'lucide-react';
import {
  getVideoCdn, setVideoCdn, setVideoCos, setVideoCosRoute, testVideoCdn, testVideoCos,
  type VideoCdnState, type VideoCosEvent,
} from '../../api/videoCdn';

type Via = 'local' | 'cos' | 'cdn';

/**
 * 现在这一刻学生点开视频走哪条线(10-28 用户「要显示目前是走的本机播放还是 COS,CDN 开没有开」)。
 * 和后端 /stream 同口径: cos.now_route 是 cos_video.redirect_enabled 算的;走 COS 时,CDN 开关开着
 * 且配了域名和 Key 就给 CDN 地址(cos_video.signed_url → cdn_enabled)。还没传到 COS 的视频照旧本机放。
 */
function viaOf(s: VideoCdnState): Via {
  if (s.cos.now_route !== 'cos') return 'local';
  return s.enabled && s.cdn_configured ? 'cdn' : 'cos';
}

/** 为什么现在走这条: 一句话写清 */
function whyNow(s: VideoCdnState, via: Via): string {
  const c = s.cos;
  if (!s.cos_configured) return '服务器没连上腾讯云 COS(.env 里的 COS 配置),只能本机播放。';
  if (!c.enabled) {
    if (c.source === 'env') {
      return s.redirect_mode === 'some' ? '服务器配置里只让指定的几节走 COS,其余从本机播放。' : '服务器配置里没开 COS 跳转。';
    }
    if (c.auto) return `${fmtTime(c.updated_at)} ${c.reason || 'COS 取不到视频'},系统自动改回本机;充值后会自动切回 COS。`;
    return `${fmtTime(c.updated_at)}${c.updated_by ? ` ${c.updated_by}` : ''}手动改回本机,系统不会自动切回。`;
  }
  const load = c.load;
  if (via === 'local') {
    // COS 开着、线路是「忙才走」却在本机: 要么不忙,要么忙了但最近一次检查 COS 没通过
    if (!load || load.busy) {
      const busyText = load ? `服务器忙(出网 ${load.mbps} Mbps)` : '测不到服务器出网(按忙算)';
      return `${busyText},但最近一次自动检查 COS 没通过,先不切${c.last_check?.message ? `: ${c.last_check.message}` : ''}。`;
    }
    return `服务器不忙: 出网 ${load.mbps} Mbps,到 ${c.busy_mbps} Mbps 才走 COS(不忙时不花 COS 流量费)。`;
  }
  const why = c.route === 'always'
    ? '设成了一直走 COS'
    : load ? `服务器忙: 出网 ${load.mbps} Mbps,过了 ${c.busy_mbps} Mbps` : '测不到服务器出网,按忙算';
  const how = via === 'cdn'
    ? '再经 CDN 加速,学生从离自己最近的节点下载'
    : s.cdn_configured ? 'CDN 关着,学生直接从 COS 下载' : '学生直接从 COS 下载';
  return `${why};${how}。`;
}

const VIA_TEXT: Record<Via, string> = {
  local: '从服务器本机播放',
  cos: '走腾讯云 COS',
  cdn: '走 CDN 加速(经腾讯云 COS)',
};

const VIA_TONE: Record<Via, { text: string; dot: string; ring: string; line: string; pill: string }> = {
  local: { text: 'text-amber-800', dot: 'bg-amber-500', ring: 'ring-amber-200', line: 'bg-amber-400', pill: 'bg-amber-100 text-amber-900' },
  cos: { text: 'text-emerald-700', dot: 'bg-emerald-600', ring: 'ring-emerald-200', line: 'bg-emerald-500', pill: 'bg-emerald-100 text-emerald-800' },
  cdn: { text: 'text-[#22707a]', dot: 'bg-[#2f8791]', ring: 'ring-[#bfe3e6]', line: 'bg-[#2f8791]', pill: 'bg-[#e4f3f5] text-[#1d5f67]' },
};

type Station = { key: Via; name: string; Icon: LucideIcon; note: string; problem: boolean };

/** 卡片最上面: 学生现在走哪条线 + 为什么 + 本机 → COS → CDN 三站(各自开没开) */
function RouteNow({ state, checkedAt, stale, onRefresh, refreshing }: {
  state: VideoCdnState;
  checkedAt: Date | null;
  stale: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const c = state.cos;
  const via = viaOf(state);
  const tone = VIA_TONE[via];
  const cosNow = via !== 'local';
  const stations: Station[] = [
    { key: 'local', name: '服务器本机', Icon: Server, note: '走服务器 12M 带宽', problem: false },
    {
      key: 'cos', name: '腾讯云 COS', Icon: Cloud,
      note: !state.cos_configured ? '没连上'
        : !c.enabled ? (c.auto ? '系统自动关了' : '关着')
          : c.route === 'smart' ? '开着 · 忙时才走' : '开着 · 一直走',
      problem: !state.cos_configured || (!c.enabled && c.auto),
    },
    {
      key: 'cdn', name: 'CDN 加速', Icon: Globe,
      note: !state.cdn_configured ? '没配置'
        : state.enabled ? (cosNow ? '开着' : '开着 · 走 COS 时才用')
          : state.auto_off_reason ? '系统自动关了' : '关着',
      problem: !state.enabled && !!state.auto_off_reason,
    },
  ];
  const active = stations.findIndex((s) => s.key === via);

  return (
    <div className="mt-3 rounded-xl border border-[#d6e2eb] bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0" role="status" aria-live="polite">
          <p className="text-base font-bold text-[#173047]">
            学生现在看视频: <span className={tone.text}>{VIA_TEXT[via]}</span>
          </p>
          <p className="mt-0.5 text-sm leading-6 text-slate-600">{whyNow(state, via)}</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="刷新线路状态"
          className="admin-focus-ring inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-60">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span className={`font-numeric ${stale ? 'text-red-600' : ''}`}>
            {stale ? '刷新失败,' : ''}{checkedAt ? `${checkedAt.toLocaleTimeString('zh-CN', { hour12: false })} 的状态` : '刷新'}
          </span>
        </button>
      </div>

      <ol className="mt-4 grid grid-cols-3" aria-label="播放线路: 服务器本机、腾讯云 COS、CDN 加速">
        {stations.map((s, i) => {
          const on = i === active;
          return (
            <li key={s.key} className="relative flex min-w-0 flex-col items-center px-1 text-center">
              {i > 0 && <span aria-hidden="true" className={`absolute left-0 right-1/2 top-[15px] h-0.5 ${i <= active ? tone.line : 'bg-slate-200'}`} />}
              {i < stations.length - 1 && <span aria-hidden="true" className={`absolute left-1/2 right-0 top-[15px] h-0.5 ${i < active ? tone.line : 'bg-slate-200'}`} />}
              <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full ${
                on ? `${tone.dot} text-white ring-4 ${tone.ring}`
                  : `bg-white ring-1 ${s.problem ? 'text-red-500 ring-red-300' : 'text-slate-400 ring-slate-300'}`}`}>
                <s.Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className={`mt-2 text-[13px] font-semibold leading-5 ${on ? tone.text : 'text-slate-600'}`}>{s.name}</span>
              <span className={`text-xs leading-4 ${s.problem ? 'text-red-600' : 'text-slate-500'}`}>{s.note}</span>
              {on && <span className={`mt-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.pill}`}>学生正在走</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type Note = { ok: boolean; text: string } | null;

function errorText(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return e instanceof Error ? e.message : '操作失败,请稍后再试';
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 一次切换写成一句人话: 「10/27 16:15 腾讯云账号欠费,系统自动改回服务器本机播放」 */
function eventText(e: VideoCosEvent): string {
  const who = e.auto ? '系统自动' : (e.by || '管理员');
  if (e.enabled) return `${fmtTime(e.at)} ${who}切回腾讯云 COS`;
  if (e.auto && e.reason) return `${fmtTime(e.at)} ${e.reason},系统自动改回服务器本机播放`;
  return `${fmtTime(e.at)} ${who}改回服务器本机播放`;
}

/**
 * 管理端首页「音标视频播放线路」(2026-10-25 CDN 开关;10-27 加 COS 线路)。规则见后端 services/cos_video.py
 *
 * 上面一块是 COS 线路(用户 10-27「有钱了切回 COS 要有个开关,还要有个切回 COS 的文字显示」):
 * - 走 COS: 学生直接从腾讯云下载,不占服务器带宽;改回本机: 走服务器 12M 带宽,人多会卡
 * - 欠费(COS 回 451)时系统每 5 分钟检查,连续两次取不到就自动改回本机;**系统自动改回的**,充值后连续两次取到就自动切回 COS
 * - 状态用一句大字写清「现在走哪条线 + 为什么 + 几点切的」,下面列最近几次切换
 * 中间「什么时候走 COS」(10-27 用户「不卡的时候就不用 COS,卡的时候如果 COS 有余额就切到 COS,没余额就不切」):
 * - 服务器忙才走(默认): 出网 30 秒平均到阈值(默认 6 Mbps)就跳 COS,降到六成以下连续 3 分钟才回本机,进了忙至少 10 分钟;省 COS 流量费
 * - 一直走: 原来的做法
 * 阈值和现在的出网直接写在卡片上,让人看得出几点会切。
 * 下面一块是 CDN(只在走 COS 时起作用)。
 */
export default function VideoCdnSwitch() {
  const [state, setState] = useState<VideoCdnState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'' | 'toggle' | 'test' | 'cos' | 'cos-test'>('');
  const [note, setNote] = useState<Note>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    return getVideoCdn()
      .then((s) => { setState(s); setLoadError(''); setCheckedAt(new Date()); })
      .catch((e: unknown) => setLoadError(errorText(e)))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    void load();
    // 「现在走哪」跟着服务器忙闲变(忙才走 COS),卡片开着时每 30 秒问一次;页面在后台不问,切回来马上问
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  const toggle = async () => {
    if (!state || busy) return;
    const next = !state.enabled;
    setBusy('toggle');
    setNote(next ? { ok: true, text: '正在测试 CDN,测通了才会打开…' } : null);
    try {
      const s = await setVideoCdn(next);
      setState(s);
      setNote({ ok: true, text: next ? '已打开: 学生再点开视频就走 CDN 了' : '已关闭: 学生再点开视频就走 COS 了' });
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
      void load();
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy('test');
    setNote(null);
    try {
      const r = await testVideoCdn();
      setNote({ ok: r.ok, text: r.message });
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy('');
    }
  };

  const [mbpsDraft, setMbpsDraft] = useState('');
  const saveRoute = async (route: 'smart' | 'always', mbps?: number) => {
    if (!state || busy) return;
    const v = mbps ?? state.cos.busy_mbps;
    if (!(v >= 1 && v <= 1000)) { setNote({ ok: false, text: '阈值填 1 到 1000 之间的数' }); return; }
    setBusy('cos');
    try {
      const s = await setVideoCosRoute(route, v);
      setState(s);
      setMbpsDraft('');
      setNote({ ok: true, text: route === 'smart' ? `已保存: 服务器出网到 ${v} Mbps 才走 COS` : '已保存: 一直走 COS' });
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy('');
    }
  };

  const switchCos = async (next: boolean) => {
    if (!state || busy) return;
    if (!next && !window.confirm('改回服务器本机播放?视频会走服务器 12M 带宽,人多时会卡。\n\n手动改回的,系统不会自动切回 COS。')) return;
    setBusy('cos');
    setNote(next ? { ok: true, text: '正在测试 COS,测通了才会切过去…' } : null);
    try {
      const s = await setVideoCos(next);
      setState(s);
      setNote({ ok: true, text: next ? '已切回腾讯云 COS: 学生再点开视频就从 COS 下载了' : '已改回服务器本机播放' });
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
      void load();
    } finally {
      setBusy('');
    }
  };

  const testCos = async () => {
    if (busy) return;
    setBusy('cos-test');
    setNote(null);
    try {
      const r = await testVideoCos();
      setNote({ ok: r.ok, text: r.message });
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy('');
    }
  };

  const cos = state?.cos;
  const cosOn = !!cos?.enabled;
  const cosAutoOff = !!cos && !cosOn && cos.auto;
  const on = !!state?.enabled;
  const canTurnOn = !!state?.cdn_configured && !!state?.cos_configured && cosOn;
  const switchDisabled = !state || !!busy || (!on && !canTurnOn);

  return (
    <section className="admin-panel rounded-2xl p-5 sm:p-6" aria-labelledby="video-route-title">
      <h3 id="video-route-title" className="font-bold text-[#173047]">音标视频播放线路</h3>
      {!state && <p className="mt-1 text-sm text-slate-500">{loadError ? `读取失败: ${loadError}` : '读取中…'}</p>}

      {state && (
        <RouteNow state={state} checkedAt={checkedAt} stale={!!loadError} refreshing={refreshing} onRefresh={() => { void load(); }} />
      )}

      {/* ---- COS 线路: 一眼看清现在走哪条线、为什么 ---- */}
      {state && cos && (
        <div className={`mt-3 rounded-xl border p-4 ${cosOn ? 'border-emerald-200 bg-emerald-50/60' : cosAutoOff ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50/70'}`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cosOn ? 'bg-emerald-100 text-emerald-700' : cosAutoOff ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                {cosOn ? <Zap className="h-5 w-5" /> : cosAutoOff ? <CloudOff className="h-5 w-5" /> : <Server className="h-5 w-5" />}
              </span>
              <div className="min-w-0" role="status">
                <p className={`text-base font-bold ${cosOn ? 'text-emerald-800' : cosAutoOff ? 'text-red-700' : 'text-amber-900'}`}>
                  {/* 「现在走哪」写在最上面那块;这里只说 COS 这条线开没开,两处不打架 */}
                  {cosOn
                    ? (cos.route === 'smart' ? '腾讯云 COS 可以用(服务器忙时才走)' : '腾讯云 COS 开着(一直走)')
                    : cosAutoOff ? '腾讯云 COS 被系统自动关了' : '腾讯云 COS 关着'}
                </p>
                <p className="mt-0.5 text-sm leading-6 text-slate-700">
                  {cosOn
                    ? (cos.auto && cos.reason
                      ? <>{fmtTime(cos.updated_at)} {cos.reason}。{cos.route === 'smart' ? '服务器忙的时候学生直接从腾讯云下载。' : '学生直接从腾讯云下载,不占服务器带宽。'}</>
                      : <>{cos.route === 'smart' ? '服务器忙的时候学生直接从腾讯云下载' : '学生直接从腾讯云下载,不占服务器带宽'}{cos.updated_at ? <>(从 {fmtTime(cos.updated_at)} 起{cos.updated_by ? ` · ${cos.updated_by}` : ''})</> : null}。</>)
                    : cosAutoOff
                      ? <>{fmtTime(cos.updated_at)} {cos.reason || 'COS 取不到视频'},系统自动改回本机播放(视频能看,走服务器带宽,人多会卡)。
                        <b> 充值后系统会自动切回 COS</b>,不用手动操作;着急可以点「切回 COS」。</>
                      : cos.source === 'env'
                        ? <>服务器配置里没开 COS 跳转。视频走服务器 12M 带宽,人多会卡。</>
                        : <>{fmtTime(cos.updated_at)}{cos.updated_by ? ` ${cos.updated_by}` : ''}手动改回本机。视频走服务器带宽,人多会卡;系统不会自动切回。</>}
                </p>
                {cos.last_check && (
                  <p className="mt-1 text-xs text-slate-500">
                    最近一次自动检查 {fmtTime(cos.last_check.at)}: {cos.last_check.ok ? 'COS 正常' : cos.last_check.message}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" onClick={testCos} disabled={!state.cos_configured || !!busy}
                className="admin-secondary-light admin-focus-ring inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50">
                {busy === 'cos-test' ? '测试中…' : '测试 COS'}
              </button>
              {cosOn ? (
                <button type="button" onClick={() => { void switchCos(false); }} disabled={!!busy}
                  className="admin-focus-ring inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:opacity-50">
                  {busy === 'cos' ? '…' : '改回本机播放'}
                </button>
              ) : (
                <button type="button" onClick={() => { void switchCos(true); }} disabled={!state.cos_configured || !!busy}
                  className="admin-focus-ring inline-flex min-h-11 items-center justify-center rounded-xl bg-[#35658d] px-4 text-sm font-semibold text-white transition hover:bg-[#2b5576] disabled:opacity-50">
                  {busy === 'cos' ? '测试中…' : '切回 COS'}
                </button>
              )}
            </div>
          </div>
          {cosOn && (
            <div className="mt-3 rounded-lg bg-white/70 p-3 ring-1 ring-black/5">
              <p className="text-sm font-semibold text-[#173047]">什么时候走 COS</p>
              <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="什么时候走 COS">
                {([['smart', '服务器忙才走(省钱)'], ['always', '一直走 COS']] as const).map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={cos.route === v} disabled={!!busy}
                    onClick={() => { if (cos.route !== v) void saveRoute(v); }}
                    className={`min-h-9 rounded-lg px-3 text-xs font-semibold ring-1 transition disabled:opacity-50 ${
                      cos.route === v ? 'bg-[#35658d] text-white ring-[#35658d]' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {cos.route === 'smart' ? (
                <>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    服务器出网到 <b>{cos.busy_mbps} Mbps</b> 就把视频切到 COS(服务器带宽 12M,背单词、PK 留给它);
                    降到 {cos.calm_mbps} Mbps 以下、连续 {cos.calm_minutes} 分钟才切回本机,切过去至少走 {cos.min_busy_minutes} 分钟,不来回跳。
                    不忙时从本机放,不花 COS 流量费。COS 欠费时再忙也不切。
                  </p>
                  <p className={`mt-1 text-sm font-semibold ${cos.now_route === 'cos' ? 'text-emerald-700' : 'text-slate-700'}`} role="status">
                    {cos.load
                      ? <>服务器现在出网 {cos.load.mbps} Mbps · {cos.now_route === 'cos' ? '忙,学生看视频走 COS' : '不忙,学生看视频从本机放'}</>
                      : <>现在测不到服务器出网,按忙算 · 学生看视频走 COS</>}
                  </p>
                  {cos.load && cos.load.events.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                      {cos.load.events.map((e, i) => (
                        <li key={`${e.ts}-${i}`}>
                          {new Date(e.ts * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                          {e.busy ? ` 出网到 ${e.mbps} Mbps,切到 COS` : ` 出网降到 ${e.mbps} Mbps,切回本机`}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <label className="flex items-center gap-1.5">
                      忙的阈值
                      <input type="number" min={1} max={1000} step={0.5} inputMode="decimal"
                        value={mbpsDraft !== '' ? mbpsDraft : String(cos.busy_mbps)}
                        onChange={(e) => setMbpsDraft(e.target.value)}
                        className="h-9 w-20 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
                      Mbps
                    </label>
                    {mbpsDraft !== '' && Number(mbpsDraft) !== cos.busy_mbps && (
                      <button type="button" disabled={!!busy} onClick={() => { void saveRoute('smart', Number(mbpsDraft)); }}
                        className="min-h-9 rounded-lg bg-[#35658d] px-3 text-xs font-semibold text-white disabled:opacity-50">保存</button>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm leading-6 text-slate-700">学生看视频一直从 COS 下载,不占服务器带宽,但每看一次都花 COS 流量费。</p>
              )}
            </div>
          )}
          {cos.events.length > 0 && (
            <ul className="mt-3 space-y-0.5 border-t border-black/5 pt-2 text-xs text-slate-500">
              {cos.events.map((e, i) => <li key={`${e.at}-${i}`}>{eventText(e)}</li>)}
            </ul>
          )}
          {!state.cos_configured && (
            <p className="mt-2 text-xs text-amber-800">服务器没连上 COS(.env 里的 COS 配置),只能本机播放。</p>
          )}
        </div>
      )}

      {/* ---- CDN: 只在走 COS 时起作用 ---- */}
      {state && (
        <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#173047]">CDN 加速{state.cdn_domain ? <span className="font-normal text-slate-500">({state.cdn_domain})</span> : null}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {!cosOn
                ? 'COS 关着,CDN 开关不起作用。'
                : on ? '开着: 走 COS 时学生从离自己最近的 CDN 节点下载。' : '关着: 走 COS 时学生从 COS 直接下载。'}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              打开前会先自动测一次 CDN,测不通不会打开;开着时服务器每 5 分钟测一次,连续两次不通自动关掉、改回 COS。
            </p>
            {state.updated_at && (
              <p className="mt-1 text-xs text-slate-400">
                上次{on ? '打开' : '关闭'}: {fmtTime(state.updated_at)}{state.updated_by ? ` · ${state.updated_by}` : ''}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={test} disabled={!state.cdn_configured || !!busy}
              className="admin-secondary-light admin-focus-ring inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50">
              {busy === 'test' ? '测试中…' : '测试 CDN'}
            </button>
            <button type="button" role="switch" aria-checked={on} aria-label="CDN 加速" onClick={toggle} disabled={switchDisabled}
              className={`admin-focus-ring relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-[#35658d]' : 'bg-slate-300'}`}>
              <span className="sr-only">{on ? '已打开,点击关闭' : '已关闭,点击打开'}</span>
              <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
            <span className={`w-10 text-sm font-semibold ${on ? 'text-[#35658d]' : 'text-slate-500'}`}>
              {busy === 'toggle' ? '…' : on ? '开' : '关'}
            </span>
          </div>
        </div>
      )}

      {state && !on && state.auto_off_reason && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {fmtTime(state.updated_at)} CDN 连续测不通,系统已自动关闭,视频改回 COS: {state.auto_off_reason}。CDN 修好后点「测试 CDN」,通了再打开。
        </p>
      )}
      {state && !state.cdn_configured && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          服务器还没配 CDN 地址和鉴权 Key,CDN 打不开。
        </p>
      )}
      {note && (
        <p role={note.ok ? 'status' : 'alert'}
          className={`mt-4 rounded-xl border px-4 py-2.5 text-sm ${note.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {note.text}
        </p>
      )}
    </section>
  );
}
