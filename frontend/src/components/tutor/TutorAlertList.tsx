/**
 * 「需要关心的孩子」列表(2026-10-27,后端 services/tutor_safety)。老师页、管理端 / 机构管理端页共用。
 *
 * 孩子在问小鹰老师时说到想伤害自己(urgent,红)或被欺负、很难过(concern,橙),系统记一条。
 * 每条: 孩子、班级、什么时候、他说的那句话、小鹰老师判断的原因;「我处理好了」要写一句怎么处理的(可空),记谁处理的。
 * 文案不写「AI 判断」之类的术语,写给老师看的白话;urgent 的顶上写明先做什么。
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, HeartHandshake, LoaderCircle } from 'lucide-react';
import type { AlertCounts, AlertStatus, TutorAlert } from '../../api/tutor';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function TutorAlertList({ load, handle, showOrg = false, onCounts }: {
  load: (status: AlertStatus) => Promise<{ items: TutorAlert[]; counts: AlertCounts }>;
  handle: (id: number, note: string) => Promise<TutorAlert>;
  /** 平台管理员看全部机构时显示机构名 */
  showOrg?: boolean;
  onCounts?: (c: AlertCounts) => void;
}) {
  const [status, setStatus] = useState<AlertStatus>('open');
  const [items, setItems] = useState<TutorAlert[] | null>(null);
  const [counts, setCounts] = useState<AlertCounts>({ open: 0, urgent: 0 });
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback((s: AlertStatus) => {
    load(s).then((r) => {
      setItems(r.items); setCounts(r.counts); setError(''); onCounts?.(r.counts);
    }).catch((e: unknown) => setError(getErrorMessage(e, '读取失败')));
  }, [load, onCounts]);
  useEffect(() => {
    load(status).then((r) => {
      setItems(r.items); setCounts(r.counts); setError(''); onCounts?.(r.counts);
    }).catch((e: unknown) => setError(getErrorMessage(e, '读取失败')));
  }, [load, status, onCounts]);

  const submit = async (id: number) => {
    setBusy(true);
    try {
      await handle(id, note.trim());
      toast.success('已记下');
      setEditing(null); setNote('');
      refresh(status);
    } catch (e) {
      toast.error(getErrorMessage(e, '没保存上,再试一次'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {([['open', `没处理 ${counts.open}`], ['done', '处理过的'], ['all', '全部']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k}
            className={`min-h-9 rounded-lg px-3 text-sm ${status === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>
      {counts.urgent > 0 && status !== 'done' && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">
          <b>有 {counts.urgent} 个孩子说到了不想活或想伤害自己。</b>请今天就当面找孩子聊一聊,并告诉家长;
          如果孩子正处在危险中,马上联系家长并拨打 110。小鹰老师已经建议孩子告诉老师或家长,也给了 12355 青少年服务台的电话。
        </p>
      )}
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {items === null && !error && (
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取…</p>
      )}
      {items && items.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
          <HeartHandshake className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          {status === 'open' ? '现在没有需要处理的。' : '还没有记录。'}
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {items?.map((a) => (
          <li key={a.id} className={`rounded-xl border p-4 ${a.handled_at ? 'border-slate-200 bg-white' : a.level === 'urgent' ? 'border-rose-300 bg-rose-50/60' : 'border-orange-200 bg-orange-50/50'}`}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {a.level === 'urgent'
                ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white"><AlertTriangle className="h-3 w-3" aria-hidden="true" />要马上关心</span>
                : <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">需要关心</span>}
              <b className="text-slate-900">{a.student_name || `学生 ${a.student_id}`}</b>
              {a.class_name && <span className="text-slate-500">{a.class_name}</span>}
              {showOrg && a.org_name && <span className="text-slate-500">· {a.org_name}</span>}
              <span className="ml-auto text-xs text-slate-400">{when(a.created_at)}</span>
            </div>
            {a.excerpt && <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white/80 px-3 py-2 text-sm text-slate-800 ring-1 ring-black/5">孩子说: {a.excerpt}</p>}
            {a.reason && <p className="mt-1 text-xs text-slate-500">小鹰老师的判断: {a.reason}</p>}
            {a.handled_at ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {a.handled_by_name} {when(a.handled_at)} 处理了{a.handled_note ? `: ${a.handled_note}` : ''}
              </p>
            ) : editing === a.id ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} autoFocus
                  placeholder="怎么处理的(比如: 已当面聊过,告诉了家长)" aria-label="怎么处理的"
                  className="min-h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-orange-400" />
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void submit(a.id)}
                    className="min-h-10 rounded-lg bg-slate-800 px-4 text-sm font-semibold text-white disabled:opacity-60">记下</button>
                  <button type="button" onClick={() => { setEditing(null); setNote(''); }}
                    className="min-h-10 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">取消</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => { setEditing(a.id); setNote(''); }}
                className="mt-3 min-h-9 rounded-lg bg-white px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
                我处理好了
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
