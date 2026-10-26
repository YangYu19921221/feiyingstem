/**
 * 平台给加盟机构的「学习助手次数池」加次数(2026-10-26,合同第三条第 10 款: 机构按次进货)。
 *
 * 机构老师给本机构学生加次数时从池里扣,池里不够就加不了(后端 409)。直营不走池子,这里不开。
 * 到账 = 正数;录错了可以扣回(负数),最多扣到已经分给学生的那部分。每一笔进操作记录(org.tutor_pool)。
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { creditTutorPool, getTutorPool, type TutorPoolDetail } from '../../api/tutor';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

const PRESETS = [1000, 3000, 5000];

export default function OrgTutorPoolDialog({ orgId, onClose }: { orgId: number; onClose: () => void }) {
  const [data, setData] = useState<TutorPoolDetail | null>(null);
  const [times, setTimes] = useState('1000');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getTutorPool(orgId).then(setData).catch((e) => { toast.error(getErrorMessage(e, '加载失败')); onClose(); });
  }, [orgId, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  if (!data) return null;
  const n = Math.trunc(Number(times) || 0);
  const amount = Math.round(n * data.price);

  const submit = async () => {
    if (busy) return;
    if (n === 0) { toast.warning('填要加的次数'); return; }
    const msg = n > 0
      ? `确认「${data.org_name}」购买学习助手 ${n} 次(¥${amount.toLocaleString()})已到账?` +
        (n < data.min_buy ? `\n\n注意: 合同写的是 ${data.min_buy} 次起订,这次少于起订量。` : '')
      : `确认从「${data.org_name}」扣回 ${-n} 次?`;
    if (!window.confirm(`${msg}\n\n确认后机构老师马上能用这些次数给学生加。`)) return;
    setBusy(true);
    try {
      setData(await creditTutorPool(orgId, n, note.trim() || undefined));
      toast.success(n > 0 ? `已加 ${n} 次` : `已扣回 ${-n} 次`);
      setNote('');
    } catch (e) {
      toast.error(getErrorMessage(e, '操作失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="学习助手次数"
           className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500">AI 学习助手「小鹰老师」· 机构次数池</p>
            <h2 className="text-lg font-bold text-slate-900">{data.org_name}</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[['还剩', data.left], ['一共', data.total], ['已加给学生', data.used]].map(([label, v]) => (
            <div key={label} className="rounded-xl bg-slate-50 px-2 py-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-0.5 text-xl font-bold text-slate-900">{v}</p>
            </div>
          ))}
        </div>

        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          合同价 ¥{data.price}/次,{data.min_buy} 次起订。机构老师给学生加次数从这里扣;
          学习卡自带的次数(兑换时自动加)不走这里。
        </p>

        <label className="mt-4 block text-sm font-semibold text-slate-700">
          这次到账几次(录错了填负数扣回)
          <input type="number" value={times} onChange={(e) => setTimes(e.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-[#3976a9]" />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setTimes(String(p))}
              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
              {p} 次 · ¥{Math.round(p * data.price).toLocaleString()}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-sm font-semibold text-slate-700">
          备注(选填,比如转账单号)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-[#3976a9]" />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-10 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200">关闭</button>
          <button type="button" onClick={() => { void submit(); }} disabled={busy || n === 0}
            className="min-h-10 rounded-xl bg-[#3976a9] px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {n >= 0 ? `确认到账${n > 0 ? ` ¥${amount.toLocaleString()}` : ''}` : `扣回 ${-n} 次`}
          </button>
        </div>

        {data.ledger.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-slate-500">到账记录</p>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
              {data.ledger.map((r) => (
                <li key={r.id} className="flex gap-2">
                  <span className="w-28 shrink-0 text-slate-400">{r.created_at ? new Date(r.created_at + 'Z').toLocaleString('zh-CN', { hour12: false }) : ''}</span>
                  <span className={r.times > 0 ? 'text-emerald-700' : 'text-rose-700'}>{r.times > 0 ? `+${r.times}` : r.times} 次</span>
                  {r.note && <span className="min-w-0 truncate text-slate-500">{r.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
