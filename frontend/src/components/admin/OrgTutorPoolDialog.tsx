/**
 * 平台给机构的「学习助手次数池」发次数(2026-10-26,合同第三条第 10 款: 机构按次进货;
 * 10-27 用户「总管理端可以给别的机构发学习助手次数」加了「平台赠送」)。
 *
 * 两种发法分开记(到账记录和操作记录里看得出来):
 * - 进货到账: 机构付了钱,按 ¥0.3/次 记金额,合同 1,000 次起
 * - 平台赠送: 不收费、不受起订量(试用、补偿、活动)
 * 发过次数的机构自动开通小鹰老师(不受「只开直营」限制);老政策机构的学生不送免费次数,全靠老师从池里分。
 * 机构老师给学生加次数从池里扣,池里不够就加不了(后端 409)。直营不走池子,这里不开。
 * 录错了可以扣回(负数),最多扣到已经分给学生的那部分。每一笔进操作记录(org.tutor_pool)。
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { creditTutorPool, getTutorPool, type TutorPoolDetail } from '../../api/tutor';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

type Kind = 'purchase' | 'gift' | 'adjust';
const PRESETS: Record<Kind, number[]> = { purchase: [1000, 3000, 5000], gift: [100, 300, 1000], adjust: [] };
const KIND_LABEL: Record<Kind, string> = { purchase: '进货到账(收了钱)', gift: '平台赠送(不收费)', adjust: '扣回' };
const SOURCE_TAG: Record<string, { text: string; cls: string }> = {
  purchase: { text: '进货', cls: 'bg-emerald-50 text-emerald-700' },
  gift: { text: '赠送', cls: 'bg-sky-50 text-sky-700' },
  adjust: { text: '扣回', cls: 'bg-rose-50 text-rose-700' },
};

export default function OrgTutorPoolDialog({ orgId, onClose, onChanged }: {
  orgId: number; onClose: () => void; onChanged?: () => void;
}) {
  const [data, setData] = useState<TutorPoolDetail | null>(null);
  const [kind, setKind] = useState<Kind>('purchase');
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
  const n = Math.max(0, Math.trunc(Number(times) || 0));
  const amount = Math.round(n * data.price);

  const pickKind = (k: Kind) => {
    setKind(k);
    setTimes(k === 'adjust' ? '' : String(PRESETS[k][0]));
  };

  const submit = async () => {
    if (busy) return;
    if (n === 0) { toast.warning('填要加的次数'); return; }
    let msg: string;
    if (kind === 'purchase') {
      msg = `确认「${data.org_name}」购买学习助手 ${n} 次(¥${amount.toLocaleString()})已到账?` +
        (n < data.min_buy ? `\n\n注意: 合同写的是 ${data.min_buy} 次起订,这次少于起订量。` : '');
    } else if (kind === 'gift') {
      msg = `确认平台赠送「${data.org_name}」学习助手 ${n} 次?不收费,平台承担模型费用(约 ¥${(n * 0.1).toFixed(0)})。`;
    } else {
      msg = `确认从「${data.org_name}」扣回 ${n} 次?`;
    }
    if (kind !== 'adjust' && data.total === 0) msg += '\n\n这是第一次给这个机构发次数: 发完它的学生就能用小鹰老师了(老师先给学生分次数)。';
    if (!window.confirm(`${msg}\n\n确认后机构老师马上能用这些次数给学生加。`)) return;
    setBusy(true);
    try {
      const t = kind === 'adjust' ? -n : n;
      setData(await creditTutorPool(orgId, t, note.trim() || undefined, kind === 'gift' ? 'gift' : 'purchase'));
      toast.success(kind === 'adjust' ? `已扣回 ${n} 次` : kind === 'gift' ? `已赠送 ${n} 次` : `已到账 ${n} 次`);
      setNote('');
      onChanged?.();
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
          {[['还剩', data.left], ['一共', data.total], ['已分给学生', data.used]].map(([label, v]) => (
            <div key={label} className="rounded-xl bg-slate-50 px-2 py-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-0.5 text-xl font-bold text-slate-900">{v}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-slate-500">
          其中进货 {data.purchased ?? 0} 次 · 平台赠送 {data.gifted ?? 0} 次
          {!!data.teacher_used && ` · 已分出去的里有 ${data.teacher_used} 次是老师自己问小鹰老师用的`}
        </p>

        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          发过次数的机构自动开通小鹰老师。合同价 ¥{data.price}/次,{data.min_buy} 次起订。
          机构老师在「学习助手次数」页把次数分给学生,从这里扣;学习卡自带的次数(兑换时自动加)不走这里。
          老政策机构的学生不送免费次数,能问几次全看老师分的。
        </p>

        <div className="mt-4 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="这次是">
          {(['purchase', 'gift', 'adjust'] as Kind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => pickKind(k)}
              className={`min-h-10 rounded-xl px-2 text-xs font-semibold ring-1 transition ${
                kind === k ? 'bg-[#3976a9] text-white ring-[#3976a9]' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-sm font-semibold text-slate-700">
          {kind === 'adjust' ? `扣回几次(最多 ${data.left} 次)` : kind === 'gift' ? '赠送几次' : '这次到账几次'}
          <input type="number" min={1} value={times} onChange={(e) => setTimes(e.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-[#3976a9]" />
        </label>
        {PRESETS[kind].length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {PRESETS[kind].map((p) => (
              <button key={p} type="button" onClick={() => setTimes(String(p))}
                className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                {p} 次{kind === 'purchase' ? ` · ¥${Math.round(p * data.price).toLocaleString()}` : ''}
              </button>
            ))}
          </div>
        )}
        <label className="mt-3 block text-sm font-semibold text-slate-700">
          备注(选填,{kind === 'purchase' ? '比如转账单号' : kind === 'gift' ? '比如为什么送' : '比如录错了'})
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-[#3976a9]" />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-10 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200">关闭</button>
          <button type="button" onClick={() => { void submit(); }} disabled={busy || n === 0}
            className={`min-h-10 rounded-xl px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 ${kind === 'adjust' ? 'bg-rose-600' : 'bg-[#3976a9]'}`}>
            {kind === 'purchase' ? `确认到账${n > 0 ? ` ¥${amount.toLocaleString()}` : ''}` : kind === 'gift' ? `赠送 ${n || ''} 次` : `扣回 ${n || ''} 次`}
          </button>
        </div>

        {data.ledger.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-slate-500">到账记录</p>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
              {data.ledger.map((r) => {
                const tag = SOURCE_TAG[r.source] ?? SOURCE_TAG.purchase;
                return (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-slate-400">{r.created_at ? new Date(r.created_at + 'Z').toLocaleString('zh-CN', { hour12: false }) : ''}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tag.cls}`}>{tag.text}</span>
                    <span className={r.times > 0 ? 'text-emerald-700' : 'text-rose-700'}>{r.times > 0 ? `+${r.times}` : r.times} 次</span>
                    {r.note && <span className="min-w-0 truncate text-slate-500">{r.note}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
