/**
 * 作业批改(2026-10-30): 拍一页做完的英语作业 → 小鹰老师逐题批改 → 错题自己改。规则真源 backend/services/homework_check.py
 *
 * - 手机: 「拍照」走系统相机(input capture=environment);电脑 / 平板: 「打开摄像头」在网页里拍(CameraCapture),
 *   都能「选一张照片」。拍完先给孩子看一眼清不清楚,再点「交给小鹰老师批改」(扣 1 次)
 * - 批改在后台跑,页面每 3 秒问一次;关了页面再进来接着等(status.pending)
 * - 错题只给提示,孩子在框里写改好的答案;改对了看讲解,改了 2 次还不对才给答案。没写的题永远不给答案
 * - 「批错了?」只做记号给老师看
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Camera, Check, CircleHelp, Flag, ImagePlus, Lightbulb, Loader2, MessageCircle, RotateCcw, Video,
} from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { compressImage } from '../utils/compressImage';
import { getErrorMessage } from '../utils/errorMessage';
import { toast } from '../components/Toast';
import CameraCapture from '../components/homework/CameraCapture';
import { homeworkCheckApi, type CheckItem, type CheckStatus, type HomeworkCheck } from '../api/homeworkCheck';

const POLL_MS = 3000;

const fmt = (iso: string | null) =>
  iso ? new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }) : '';

/** 手机 / 平板上系统相机更好用;电脑上没有系统相机,只能在网页里开摄像头 */
const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

const RESULT_STYLE: Record<CheckItem['result'], { label: string; cls: string }> = {
  right: { label: '对', cls: 'bg-green-100 text-green-700' },
  wrong: { label: '错', cls: 'bg-rose-100 text-rose-700' },
  unclear: { label: '没看清', cls: 'bg-amber-100 text-amber-800' },
  blank: { label: '没写', cls: 'bg-slate-100 text-slate-600' },
};

function ItemCard({ checkId, item, onChange, revealAfter }: {
  checkId: number; item: CheckItem; onChange: (it: CheckItem, fixed?: number) => void; revealAfter: number;
}) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const done = item.result === 'right' || item.fixed;
  const style = item.fixed ? { label: '改对了', cls: 'bg-green-100 text-green-700' } : RESULT_STYLE[item.result];

  const submit = async () => {
    if (busy || !answer.trim()) return;
    setBusy(true);
    try {
      const r = await homeworkCheckApi.fix(checkId, item.idx, answer.trim());
      onChange(r.item, r.fixed);
      if (r.ok) {
        setMsg({ ok: true, text: '改对了!' });
      } else if (r.item.revealed) {
        setMsg({ ok: false, text: '还不对。下面是答案和讲解,照着在本子上改一遍' });
      } else {
        setMsg({ ok: false, text: r.item.tries_left > 0 ? `还不对,再想想提示(还能试 ${r.item.tries_left} 次)` : '还不对' });
      }
      setAnswer('');
    } catch (e) {
      setMsg({ ok: false, text: getErrorMessage(e, '没提交上,再试一次') });
    } finally {
      setBusy(false);
    }
  };

  const dispute = async () => {
    try {
      const r = await homeworkCheckApi.dispute(checkId, item.idx);
      onChange(r.item);
      toast.success('已经告诉老师了,老师会再看一下');
    } catch (e) {
      toast.error(getErrorMessage(e, '没提交上'));
    }
  };

  return (
    <li className={`rounded-2xl border bg-white p-4 shadow-sm sm:p-5 ${done ? 'border-green-200' : 'border-black/[0.08]'}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 font-numeric text-sm font-semibold text-ink-mute">{item.no}</span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-base leading-7 text-ink">{item.question}</p>
          <p className="mt-1 text-sm text-ink-soft">
            你写的:{' '}
            {item.answer
              ? <span className={item.result === 'right' ? 'font-semibold text-green-700' : 'font-semibold text-rose-700 line-through decoration-rose-300'}>{item.answer}</span>
              : <span className="text-ink-mute">(没写)</span>}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${style.cls}`}>{style.label}</span>
      </div>

      {!done && item.hint && (
        <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{item.checkable ? '提示: ' : '修改建议: '}{item.hint}</span>
        </p>
      )}

      {item.can_fix && (
        <div className="mt-3">
          <label className="mb-1 block text-xs text-ink-mute" htmlFor={`fix-${item.idx}`}>
            {item.result === 'blank' ? '先自己写一个答案' : '写下改好的答案'}
            {item.result !== 'blank' && item.tries === 0 && `(改 ${revealAfter} 次还不对,小鹰老师就告诉你答案)`}
          </label>
          <div className="flex gap-2">
            <input
              id={`fix-${item.idx}`}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
              maxLength={120}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 text-base text-ink focus:border-accent-warm focus:outline-none focus:ring-2 focus:ring-accent-warm/20"
              placeholder={item.question.includes('A.') ? '比如 A' : '在这里写'}
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || !answer.trim()}
              className="btn-glow inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? '在看…' : '看看对不对'}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`mt-2 text-sm font-medium ${msg.ok ? 'text-green-700' : 'text-rose-700'}`} role="status">{msg.text}</p>}
      {item.result === 'blank' && !item.can_fix && !item.fixed && (
        <p className="mt-2 text-sm text-ink-soft">这题试了好几次了,问问小鹰老师或者你的老师吧</p>
      )}

      {(item.correct.length > 0 || item.explain) && (
        <div className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-sm leading-6 text-green-900">
          {item.correct.length > 0 && (
            <p><span className="font-semibold">答案: </span>{item.correct.join(' / ')}</p>
          )}
          {item.explain && <p>{item.explain}</p>}
        </div>
      )}

      <div className="mt-2 flex justify-end">
        {item.disputed ? (
          <span className="text-xs text-ink-mute">已经告诉老师这题可能批错了</span>
        ) : (
          <button type="button" onClick={dispute} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-ink-mute hover:bg-black/5 hover:text-ink">
            <Flag className="h-3.5 w-3.5" aria-hidden="true" />
            批错了?
          </button>
        )}
      </div>
    </li>
  );
}

export default function StudentHomeworkCheck() {
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
  const [status, setStatus] = useState<CheckStatus | null>(null);
  const [history, setHistory] = useState<HomeworkCheck[]>([]);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const [sending, setSending] = useState(false);
  const [current, setCurrent] = useState<HomeworkCheck | null>(null);
  const [waitSec, setWaitSec] = useState(0);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);
  const touch = isTouch();

  const loadHistory = useCallback(() => {
    homeworkCheckApi.list().then(setHistory).catch(() => {});
  }, []);

  const stopPoll = () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    pollRef.current = null;
  };

  const open = useCallback(async (id: number) => {
    stopPoll();
    try {
      const c = await homeworkCheckApi.get(id);
      setCurrent(c);
      if (c.status === 'pending') {
        pollRef.current = window.setTimeout(() => { void open(id); }, POLL_MS);
      } else {
        loadHistory();
        homeworkCheckApi.status().then(setStatus).catch(() => {});
      }
    } catch (e) {
      toast.error(getErrorMessage(e, '打不开这一页'));
    }
  }, [loadHistory]);

  useEffect(() => {
    homeworkCheckApi.status().then((s) => {
      setStatus(s);
      if (s.pending) void open(s.pending);
    }).catch(() => setStatus({ enabled: false, reason: '现在打不开,稍后再试', left: 0, cost: 1, reveal_after: 2, pending: null }));
    loadHistory();
    return stopPoll;
  }, [open, loadHistory]);

  // 等批改时走秒(孩子知道没卡住)
  useEffect(() => {
    if (current?.status !== 'pending') { setWaitSec(0); return; }
    const t = window.setInterval(() => setWaitSec((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [current?.status, current?.id]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  // 预览照片时 Esc = 重拍(摄像头开着时它自己管 Esc)
  const previewing = !!photo && !current && !camera;
  useEffect(() => {
    if (!previewing) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') setPhoto(null); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [previewing]);

  const takePhoto = async (file: Blob | undefined) => {
    if (!file) return;
    try {
      // 手机原图十几 MB: 先在浏览器里压成长边 2000 的 JPEG(手写字够看清,HEIC 也转成 JPEG)
      const blob = await compressImage(file as File, 2000, 0.88);
      setPhoto((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
      setCurrent(null);
    } catch {
      toast.error('这张照片打不开,换一张试试');
    }
  };

  const send = async () => {
    if (!photo || sending) return;
    setSending(true);
    try {
      const { id } = await homeworkCheckApi.start(photo.blob);
      setPhoto(null);
      setStatus((s) => (s ? { ...s, left: Math.max(0, s.left - s.cost), pending: id } : s));
      await open(id);
    } catch (e) {
      toast.error(getErrorMessage(e, '没交上去,再试一次'));
    } finally {
      setSending(false);
    }
  };

  const onItem = (it: CheckItem, fixed?: number) => {
    setCurrent((c) => {
      if (!c?.items) return c;
      const items = c.items.map((x) => (x.idx === it.idx ? it : x));
      return { ...c, items, fixed: fixed ?? c.fixed };
    });
  };

  const reset = () => { stopPoll(); setCurrent(null); setPhoto(null); };

  const enabled = !!status?.enabled;
  const noTimes = enabled && (status?.left ?? 0) < (status?.cost ?? 1);
  const todo = current?.items?.filter((x) => x.can_fix).length ?? 0;

  return (
    <div className="min-h-screen bg-paper page-warm-glow pb-16">
      <nav className="sticky top-0 z-20 border-b border-black/[0.06] bg-paper/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3.5">
          <button type="button" onClick={() => goBack()} className="flex min-h-11 items-center gap-2 text-sm text-ink-soft hover:text-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> 返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">作业批改</h1>
          <span className={`font-numeric text-xs font-semibold ${noTimes ? 'text-accent-warm' : 'text-ink-mute'}`}>
            {enabled ? `还能批 ${Math.floor((status?.left ?? 0) / (status?.cost || 1))} 页` : ''}
          </span>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-5 py-6">
        {status && !enabled && (
          <div className="rounded-2xl border border-black/[0.08] bg-white p-6 text-center text-ink-soft">
            {status.reason || '作业批改现在用不了'}
          </div>
        )}

        {enabled && !current && !photo && (
          <section className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm">
            <img src="/tools/homework_check.jpg" alt="" className="h-28 w-full object-cover sm:h-36" />
            <div className="p-5 sm:p-6">
              <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">做完的英语作业,拍一页给小鹰老师批</h2>
              <p className="mt-2 text-sm leading-6 text-ink-soft">
                小鹰老师一题一题看你写的对不对。错的先给你提示,你自己改;改 {status?.reveal_after ?? 2} 次还不对再告诉你答案。
                没写的题不给答案,先自己做。批一页用 {status?.cost ?? 1} 次「问小鹰老师」的次数,照片看不清会退回。
              </p>
              <ul className="mt-3 space-y-1 text-sm text-ink-soft">
                <li>· 一次拍一页,整页放进画面,摆正、光线亮一点</li>
                <li>· 只批英语作业;照片批完不保存</li>
              </ul>
              {noTimes ? (
                <div className="mt-5 rounded-xl bg-orange-50 p-4 text-sm text-orange-900">
                  「问小鹰老师」的次数用完了。去小鹰老师那里点「请老师加次数」,老师加了再来批。
                  <button type="button" onClick={() => navigate('/student/tutor')} className="ml-1 font-semibold underline">去问小鹰老师</button>
                </div>
              ) : (
                <div className="mt-5 flex flex-wrap gap-2">
                  {touch && (
                    <button type="button" onClick={() => cameraInput.current?.click()} className="btn-glow inline-flex min-h-12 items-center gap-2 rounded-xl px-5 font-semibold text-white">
                      <Camera className="h-5 w-5" aria-hidden="true" /> 拍照
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setCamera(true)}
                    className={`inline-flex min-h-12 items-center gap-2 rounded-xl px-5 font-semibold ${touch ? 'border-2 border-accent-warm text-accent-warm hover:bg-orange-50' : 'btn-glow text-white'}`}
                  >
                    <Video className="h-5 w-5" aria-hidden="true" /> 打开摄像头
                  </button>
                  <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-black/10 bg-white px-5 font-semibold text-ink-soft hover:bg-black/[0.03]">
                    <ImagePlus className="h-5 w-5" aria-hidden="true" /> 选一张照片
                  </button>
                </div>
              )}
              <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { void takePhoto(e.target.files?.[0]); e.target.value = ''; }} />
              <input ref={fileInput} type="file" accept="image/*" className="hidden"
                onChange={(e) => { void takePhoto(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </section>
        )}

        {photo && !current && (
          <section className="rounded-2xl border border-black/[0.08] bg-white p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 font-display text-lg font-semibold text-ink">看一眼: 字都看得清吗?</h2>
            <img src={photo.url} alt="要批改的作业" className="mx-auto max-h-[60vh] w-auto rounded-xl border border-black/5 object-contain" />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setPhoto(null)} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-black/10 px-4 font-semibold text-ink-soft hover:bg-black/[0.03]">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> 重拍
              </button>
              <button type="button" onClick={send} disabled={sending} className="btn-glow inline-flex min-h-12 items-center gap-2 rounded-xl px-5 font-semibold text-white disabled:opacity-60">
                {sending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Check className="h-5 w-5" aria-hidden="true" />}
                {sending ? '在上传…' : `交给小鹰老师批改(用 ${status?.cost ?? 1} 次)`}
              </button>
            </div>
          </section>
        )}

        {current?.status === 'pending' && (
          <section className="rounded-2xl border border-sky-200 bg-white p-8 text-center shadow-sm" role="status">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-sky-500" aria-hidden="true" />
            <p className="mt-4 font-display text-lg font-semibold text-ink">小鹰老师在一题一题看…</p>
            <p className="mt-1 text-sm text-ink-soft">
              一般 15–30 秒 <span aria-hidden="true">· {waitSec} 秒</span>
              {waitSec >= 40 && <span className="block">这页题有点多,再等一会儿;关掉页面也会接着批完</span>}
            </p>
          </section>
        )}

        {current?.status === 'failed' && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
            <CircleHelp className="mx-auto h-9 w-9 text-amber-600" aria-hidden="true" />
            <p className="mt-3 text-base leading-7 text-amber-900">{current.reason || '这页没批出来,次数已经退回'}</p>
            <button type="button" onClick={reset} className="btn-glow mt-4 inline-flex min-h-11 items-center rounded-xl px-5 font-semibold text-white">再拍一页</button>
          </section>
        )}

        {current?.status === 'done' && (
          <section aria-labelledby="hw-result">
            <div className="mb-4 rounded-2xl border border-black/[0.08] bg-white p-5 shadow-sm">
              <h2 id="hw-result" className="font-display text-xl font-bold text-ink">这页批完了</h2>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                <span>一共 <b className="font-numeric text-ink">{current.total}</b> 题</span>
                <span className="text-green-700">对 <b className="font-numeric">{current.right}</b></span>
                {current.wrong > 0 && <span className="text-rose-700">错 <b className="font-numeric">{current.wrong}</b></span>}
                {current.blank > 0 && <span>没写 <b className="font-numeric">{current.blank}</b></span>}
                {current.fixed > 0 && <span className="text-green-700">改对了 <b className="font-numeric">{current.fixed}</b></span>}
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                {todo > 0 ? `还有 ${todo} 题等你改,看提示自己想一想` : current.right === current.total ? '全对,真棒!' : '能改的都改完了,记得在本子上也改过来'}
              </p>
              {current.reason && <p className="mt-1 text-xs text-ink-mute">{current.reason}</p>}
              <p className="mt-2 text-xs text-ink-mute">小鹰老师也可能看错,觉得哪题批错了点那题的「批错了?」,老师会再看。</p>
            </div>
            <ul className="space-y-3">
              {(current.items || []).map((it) => (
                <ItemCard key={it.idx} checkId={current.id} item={it} onChange={onItem} revealAfter={status?.reveal_after ?? 2} />
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={reset} className="btn-glow inline-flex min-h-12 items-center gap-2 rounded-xl px-5 font-semibold text-white">
                <Camera className="h-5 w-5" aria-hidden="true" /> 再批一页
              </button>
              <button type="button" onClick={() => navigate('/student/tutor', { state: { q: '我作业里有一题还是不会,能讲讲吗?' } })}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-black/10 bg-white px-5 font-semibold text-ink-soft hover:bg-black/[0.03]">
                <MessageCircle className="h-5 w-5" aria-hidden="true" /> 还有不会的,问小鹰老师
              </button>
            </div>
          </section>
        )}

        {history.length > 0 && !photo && current?.status !== 'pending' && (
          <section className="mt-8" aria-labelledby="hw-history">
            <h2 id="hw-history" className="mb-3 font-display text-lg font-semibold text-ink">批过的作业</h2>
            <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
              {history.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => { setPhoto(null); void open(h.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02] ${current?.id === h.id ? 'bg-orange-50/60' : ''}`}
                  >
                    <span className="min-w-0 flex-1 text-sm text-ink">
                      {fmt(h.created_at)}
                      <span className="ml-2 text-ink-soft">
                        {h.status === 'done' ? `${h.total} 题 · 对 ${h.right}${h.fixed ? ` · 改对 ${h.fixed}` : ''}`
                          : h.status === 'failed' ? '没批出来(次数已退回)' : '在批…'}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-mute">看 →</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {camera && (
        <CameraCapture
          onClose={() => setCamera(false)}
          onCapture={(blob) => { setCamera(false); void takePhoto(blob); }}
        />
      )}
    </div>
  );
}
