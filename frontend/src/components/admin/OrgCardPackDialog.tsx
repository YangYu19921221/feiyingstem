/** 平台确认机构卡包到账 / 补货(2026-10-08)。每一笔都进操作记录。 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cardPackApi, type CardKind, type PackCatalog, type PackLedgerRow, type PackStatus } from '../../api/cardPack';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

const SOURCE_LABEL = { installment: '分期到账', bonus: '结清赠送', restock: '补货' } as const;

export default function OrgCardPackDialog({ orgId, onClose }: { orgId: number; onClose: () => void }) {
  const [data, setData] = useState<{ org_name: string; catalog: PackCatalog; status: PackStatus; ledger: PackLedgerRow[] } | null>(null);
  const [restock, setRestock] = useState<Partial<Record<CardKind, number>>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => cardPackApi.orgPack(orgId)
    .then(r => setData(r as unknown as NonNullable<typeof data>))
    .catch(e => toast.error(getErrorMessage(e, '加载失败')));
  useEffect(() => { load(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  if (!data) return null;
  const { catalog, status } = data;
  const labelOf = Object.fromEntries(catalog.kinds.map(k => [k.kind, k.label])) as Record<CardKind, string>;
  const next = status.next_installment;
  const remaining = catalog.installments.filter(i => !status.paid_installments.includes(i.no));
  const settleBonus = status.paid_installments.length === 0 ? catalog.bonus_full_pay
    : remaining.length >= 2 ? catalog.bonus_early_settle : 0;
  const settleAmount = remaining.reduce((s, i) => s + i.value, 0);
  const restockAmount = catalog.kinds.reduce((s, k) => s + (restock[k.kind] || 0) * k.price, 0);

  const describe = (cards: Partial<Record<CardKind, number>>) =>
    Object.entries(cards).filter(([, n]) => n).map(([k, n]) => `${labelOf[k as CardKind]} ${n}`).join('、');

  const pay = async (action: 'installment' | 'settle' | 'restock') => {
    let msg = '';
    if (action === 'installment' && next) {
      const ins = catalog.installments.find(i => i.no === next)!;
      msg = `确认「${data.org_name}」第 ${next} 期 ¥${ins.value.toLocaleString()} 已到账?\n将开通: ${describe(ins.cards)}`;
    } else if (action === 'settle') {
      msg = `确认「${data.org_name}」一次结清剩余 ${remaining.length} 期,共 ¥${settleAmount.toLocaleString()} 已到账?` +
        (settleBonus ? `\n另送 ${labelOf.full} ${settleBonus} 张。` : '');
    } else {
      if (restockAmount === 0) { toast.warning('至少填一种卡的张数'); return; }
      msg = `确认「${data.org_name}」补货 ¥${restockAmount.toLocaleString()} 已到账?\n将开通: ${describe(restock)}`;
    }
    if (!window.confirm(msg + '\n\n确认后机构马上能发卡,不能撤回。')) return;
    setBusy(true);
    try {
      await cardPackApi.pay(orgId, { action, ...(action === 'restock' ? { restock } : {}), note: note || undefined });
      toast.success('已确认到账,额度已开通');
      setRestock({}); setNote('');
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '操作失败'));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="卡包到账"
           className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500">新政策卡包 · 标准包 ¥{catalog.pack_price.toLocaleString()}</p>
            <h2 className="text-lg font-bold text-slate-900">{data.org_name} · 卡包到账</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 grid grid-cols-5 gap-2 text-center text-xs">
          {status.kinds.map(k => (
            <div key={k.kind} className="rounded-lg bg-slate-50 px-2 py-2">
              <div className="text-slate-500">{k.label}</div>
              <div className="text-base font-bold text-slate-800">{k.left}</div>
              <div className="text-slate-400">已发 {k.used}/{k.quota}</div>
            </div>
          ))}
        </div>

        <section className="mt-5">
          <h3 className="text-sm font-bold text-slate-800">分期({status.paid_installments.length}/{catalog.installments.length} 期已到账)</h3>
          <ol className="mt-2 space-y-1 text-sm">
            {catalog.installments.map(i => {
              const paid = status.paid_installments.includes(i.no);
              return (
                <li key={i.no} className={`flex justify-between rounded-lg px-3 py-1.5 ${paid ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'}`}>
                  <span>{paid ? '✓ ' : ''}第 {i.no} 期 · ¥{i.value.toLocaleString()} · {i.due_month === 0 ? '签约时' : `第 ${i.due_month} 个月`}</span>
                  <span className="text-xs">{describe(i.cards)}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !next} onClick={() => pay('installment')}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
              {next ? `确认第 ${next} 期到账` : `${catalog.installments.length} 期已全部到账`}
            </button>
            {remaining.length > 1 && (
              <button type="button" disabled={busy} onClick={() => pay('settle')}
                      className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
                一次结清剩余 {remaining.length} 期 ¥{settleAmount.toLocaleString()}{settleBonus ? `(送 ${settleBonus} 张全通卡)` : ''}
              </button>
            )}
          </div>
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-bold text-slate-800">补货(按单价,每种 {catalog.restock_min} 张起)</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {catalog.kinds.map(k => (
              <label key={k.kind} className="text-xs text-slate-600">{k.label} ¥{k.price}
                <input type="number" min={0} value={restock[k.kind] ?? ''}
                       onChange={e => setRestock(r => ({ ...r, [k.kind]: Math.max(0, Number(e.target.value) || 0) }))}
                       className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
              </label>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="备注(如转账单号)"
                   className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
            <button type="button" disabled={busy || restockAmount === 0} onClick={() => pay('restock')}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40">
              确认补货 ¥{restockAmount.toLocaleString()}
            </button>
          </div>
        </section>

        {data.ledger.length > 0 && (
          <section className="mt-5">
            <h3 className="text-sm font-bold text-slate-800">到账记录</h3>
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-slate-600">
              {data.ledger.map(r => (
                <li key={r.id}>
                  {String(r.created_at).slice(0, 16).replace('T', ' ')} · {SOURCE_LABEL[r.source]}
                  {r.installment_no ? ` 第${r.installment_no}期` : ''} · {labelOf[r.card_kind]} +{r.count}
                  {r.note ? ` · ${r.note}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
