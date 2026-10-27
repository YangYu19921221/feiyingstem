import { useCallback, useEffect, useState } from 'react';
import { CloudOff, Server, Zap } from 'lucide-react';
import {
  getVideoCdn, setVideoCdn, setVideoCos, setVideoCosRoute, testVideoCdn, testVideoCos,
  type VideoCdnState, type VideoCosEvent,
} from '../../api/videoCdn';

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

  const load = useCallback(() => getVideoCdn()
    .then((s) => { setState(s); setLoadError(''); })
    .catch((e: unknown) => setLoadError(errorText(e))), []);

  useEffect(() => {
    getVideoCdn().then(setState).catch((e: unknown) => setLoadError(errorText(e)));
  }, []);

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
                  {cosOn ? (cos.route === 'smart' ? '腾讯云 COS 可以用(服务器忙时才走)' : '现在: 走腾讯云 COS') : '现在: 从服务器本机播放'}
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
                ? '现在没走 COS,CDN 开关不起作用。'
                : on ? '开着: 学生从离自己最近的 CDN 节点下载。' : '关着: 学生从 COS 直接下载。'}
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
