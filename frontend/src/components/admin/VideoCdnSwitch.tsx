import { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { getVideoCdn, setVideoCdn, testVideoCdn, type VideoCdnState } from '../../api/videoCdn';

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

/** 管理端首页「音标视频加速」: 开 = 走 CDN,关 = 走 COS(原来的方式) */
export default function VideoCdnSwitch() {
  const [state, setState] = useState<VideoCdnState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'' | 'toggle' | 'test'>('');
  const [note, setNote] = useState<Note>(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setState(await getVideoCdn());
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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

  const on = !!state?.enabled;
  const canTurnOn = !!state?.cdn_configured && !!state?.cos_configured;
  const switchDisabled = !state || !!busy || (!on && !canTurnOn);

  return (
    <section className="admin-panel rounded-2xl p-5 sm:p-6" aria-labelledby="video-cdn-title">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf5fa] text-[#397b9b]">
            <Zap className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 id="video-cdn-title" className="font-bold text-[#173047]">音标视频加速(CDN)</h3>
            {state ? (
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {on
                  ? <>现在: 学生看视频走 CDN{state.cdn_domain ? <span className="text-slate-500">({state.cdn_domain})</span> : null},离学生最近的节点下载。</>
                  : <>现在: 学生看视频从腾讯云 COS 直接下载(原来的方式)。</>}
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-500">{loadError ? `读取失败: ${loadError}` : '读取中…'}</p>
            )}
            <p className="mt-1 text-xs leading-5 text-slate-500">
              打开前会先自动测一次 CDN,测不通不会打开。CDN 出问题时关掉,马上回到 COS。两种方式都不占服务器带宽。
            </p>
            {state?.updated_at && (
              <p className="mt-1 text-xs text-slate-400">
                上次{on ? '打开' : '关闭'}: {fmtTime(state.updated_at)}{state.updated_by ? ` · ${state.updated_by}` : ''}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={test}
            disabled={!state?.cdn_configured || !!busy}
            className="admin-secondary-light admin-focus-ring inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'test' ? '测试中…' : '测试 CDN'}
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="video-cdn-title"
            onClick={toggle}
            disabled={switchDisabled}
            className={`admin-focus-ring relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-[#35658d]' : 'bg-slate-300'}`}
          >
            <span className="sr-only">{on ? '已打开,点击关闭' : '已关闭,点击打开'}</span>
            <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
          <span className={`w-10 text-sm font-semibold ${on ? 'text-[#35658d]' : 'text-slate-500'}`}>
            {busy === 'toggle' ? '…' : on ? '开' : '关'}
          </span>
        </div>
      </div>

      {state && !state.cdn_configured && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          服务器还没配 CDN 地址和鉴权 Key,现在打不开。
        </p>
      )}
      {state && state.cdn_configured && !state.cos_configured && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          服务器没连上 COS,视频都从服务器本机放,这个开关现在不起作用。
        </p>
      )}
      {state && state.cos_configured && state.redirect_mode !== 'all' && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {state.redirect_mode === 'off'
            ? '服务器的 COS 跳转没开(.env 的 COS_REDIRECT),视频都从服务器本机放,这个开关现在不起作用。'
            : '服务器的 COS 跳转只开了几节(.env 的 COS_REDIRECT),这个开关只对那几节起作用。'}
        </p>
      )}
      {note && (
        <p
          role={note.ok ? 'status' : 'alert'}
          className={`mt-4 rounded-xl border px-4 py-2.5 text-sm ${note.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}
        >
          {note.text}
        </p>
      )}
    </section>
  );
}
