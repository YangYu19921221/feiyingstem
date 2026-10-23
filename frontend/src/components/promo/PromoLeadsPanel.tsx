/**
 * 体验卡线索列表 + 跟单抽屉。销售工作台(只看自己的)和机构管理端(看全机构、能改归属)共用这一份
 *
 * 跟单的核心是三件事: 现在到哪一步了(状态)、下次什么时候跟(到点没跟标红)、跟过什么(时间线)。
 * 时间线只能加不能改不能删 —— 谁答应了家长什么,出纠纷要有据。
 */
import { useCallback, useEffect, useState } from 'react';
import { Clock, LoaderCircle, Phone, Search, X } from 'lucide-react';
import {
  PROMO_STATUSES, addFollowUp, listFollowUps, listPromoLeads, updatePromoLead,
  type FollowUp, type PromoLead, type PromoLeadList, type PromoStatus,
} from '../../api/promo';
import { toast } from '../Toast';
import Pager from './Pager';

const errText = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

const STATUS_TONE: Record<PromoStatus, string> = {
  new: 'bg-orange-50 text-orange-700',
  contacted: 'bg-sky-50 text-sky-700',
  paid: 'bg-amber-50 text-amber-700',
  opened: 'bg-violet-50 text-violet-700',
  won: 'bg-emerald-50 text-emerald-700',
  lost: 'bg-slate-100 text-slate-500',
};

const fmt = (s: string | null) => (s ? s.replace('T', ' ').slice(5, 16) : '');

interface Props {
  manager: boolean;
  /** 管理端: 可选的销售(改归属、按人筛) */
  owners?: Array<{ id: number; name: string }>;
  /** 外部要求刷新(如管理端切回这个页签) */
  refreshKey?: number;
}

export default function PromoLeadsPanel({ manager, owners = [], refreshKey = 0 }: Props) {
  const [data, setData] = useState<PromoLeadList | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<PromoStatus | ''>('');
  const [overdue, setOverdue] = useState(false);
  const [owner, setOwner] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PromoLead | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await listPromoLeads({ status, overdue, owner: manager ? owner : null, search: query, page, size: PAGE_SIZE }));
    } catch (e) {
      toast(errText(e, '线索加载失败'), 'error');
    } finally {
      setLoading(false);
    }
  }, [status, overdue, owner, query, manager, page]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const onSaved = (lead: PromoLead) => {
    setOpen(lead);
    setData((d) => d && { ...d, items: d.items.map((x) => (x.id === lead.id ? lead : x)) });
  };

  const counts = data?.counts;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setStatus(''); setOverdue(false); setPage(1); }}
          className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${!status && !overdue ? 'bg-[#FF6B35] text-white' : 'bg-white text-slate-700 border border-slate-200'}`}>
          全部 {total}
        </button>
        {PROMO_STATUSES.map((s) => (
          <button key={s.key} type="button" onClick={() => { setStatus(s.key); setOverdue(false); setPage(1); }}
            className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${status === s.key ? 'bg-[#FF6B35] text-white' : 'bg-white text-slate-700 border border-slate-200'}`}>
            {s.label} {counts?.[s.key] ?? 0}
          </button>
        ))}
        <button type="button" onClick={() => { setOverdue((v) => !v); setStatus(''); setPage(1); }}
          className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-sm font-semibold ${overdue ? 'bg-red-500 text-white' : 'border border-red-200 bg-red-50 text-red-600'}`}>
          <Clock className="h-3.5 w-3.5" aria-hidden /> 该跟进了 {data?.overdue ?? 0}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); setPage(1); }}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜手机号 / 称呼"
            aria-label="搜手机号或称呼"
            className="min-h-9 w-56 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-[#FF6B35]" />
        </form>
        {manager && owners.length > 0 && (
          <select value={owner ?? ''} onChange={(e) => { setOwner(e.target.value ? Number(e.target.value) : null); setPage(1); }}
            aria-label="按销售筛选"
            className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
            <option value="">全部销售</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {loading && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" aria-label="加载中" />}
      </div>

      {data && data.items.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          {status || overdue || query ? '这个条件下没有线索' : '还没有家长扫码。卡发出去后,家长扫码留了电话就会出现在这里。'}
        </div>
      )}

      <ul className="space-y-2">
        {data?.items.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => setOpen(l)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-orange-300">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-800 tabular-nums">{l.parent_phone}</span>
                {l.parent_name && <span className="text-sm text-slate-600">{l.parent_name}</span>}
                {l.child_grade && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{l.child_grade}</span>}
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[l.status]}`}>{l.status_label}</span>
                {l.existing_account && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">老客户</span>}
                {l.overdue && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">该跟进了</span>}
                {l.studied_days != null && (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${l.studied_days >= 5 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    7 天学了 {l.studied_days} 天
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                <span>{fmt(l.created_at)} 扫码</span>
                {l.channel_name && <span>卡: {l.channel_name}</span>}
                {manager && <span>销售: {l.sales_name}</span>}
                {l.next_follow_at && <span className={l.overdue ? 'text-red-600' : ''}>下次跟进 {fmt(l.next_follow_at)}</span>}
                {l.note && <span className="max-w-xs truncate">备注: {l.note}</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {data && <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />}

      {open && (
        <LeadDrawer lead={open} manager={manager} owners={owners} onClose={() => setOpen(null)}
          onSaved={onSaved} onChanged={load} />
      )}
    </section>
  );
}

function LeadDrawer({ lead, manager, owners, onClose, onSaved, onChanged }: {
  lead: PromoLead; manager: boolean; owners: Array<{ id: number; name: string }>;
  onClose: () => void; onSaved: (l: PromoLead) => void; onChanged: () => void;
}) {
  const [logs, setLogs] = useState<FollowUp[] | null>(null);
  const [content, setContent] = useState('');
  const [nextStatus, setNextStatus] = useState<PromoStatus | ''>('');
  const [nextAt, setNextAt] = useState(lead.next_follow_at || '');
  const [note, setNote] = useState(lead.note);
  const [paid, setPaid] = useState(lead.paid_amount != null ? String(lead.paid_amount) : '');
  const [studentRef, setStudentRef] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listFollowUps(lead.id).then(setLogs).catch(() => setLogs([]));
  }, [lead.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (data: Parameters<typeof updatePromoLead>[1], okMsg = '已保存') => {
    setBusy(true);
    try {
      const l = await updatePromoLead(lead.id, data);
      onSaved(l);
      setLogs(await listFollowUps(lead.id));
      onChanged();
      toast(okMsg, 'success');
    } catch (e) {
      toast(errText(e, '没保存上'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    try {
      setLogs(await addFollowUp(lead.id, {
        content: content.trim(), status: nextStatus || undefined, next_follow_at: nextAt,
      }));
      setContent('');
      setNextStatus('');
      onChanged();
      toast('跟进记录已加上', 'success');
    } catch (err) {
      toast(errText(err, '没记上'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setStatusQuick = (s: PromoStatus) => {
    if (s === 'paid' && !paid) {
      const v = window.prompt('实收体验费多少元?', '99');
      if (v === null) return;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) { toast('金额不对', 'error'); return; }
      setPaid(String(n));
      save({ status: s, paid_amount: n }, `已标「已付体验费」${n} 元`);
      return;
    }
    save({ status: s }, `已改成「${PROMO_STATUSES.find((x) => x.key === s)?.label}」`);
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="跟进这条线索"
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-[#f7f8fa] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <a href={`tel:${lead.parent_phone}`} className="inline-flex items-center gap-1.5 text-lg font-bold text-slate-800 tabular-nums">
              <Phone className="h-4 w-4 text-[#FF6B35]" aria-hidden />{lead.parent_phone}
            </a>
            <p className="mt-0.5 text-xs text-slate-500">
              {[lead.parent_name, lead.child_grade, lead.channel_name && `卡: ${lead.channel_name}`, `${fmt(lead.created_at)} 扫码`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <section className="rounded-xl bg-white p-4">
            <h3 className="text-sm font-bold text-slate-700">现在到哪一步</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PROMO_STATUSES.map((s) => (
                <button key={s.key} type="button" disabled={busy || lead.status === s.key} onClick={() => setStatusQuick(s.key)}
                  className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${lead.status === s.key ? `${STATUS_TONE[s.key]} ring-2 ring-offset-1 ring-current` : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'} disabled:cursor-default`}>
                  {s.label}
                </button>
              ))}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
              {lead.contacted_at && <><dt>加微信</dt><dd>{fmt(lead.contacted_at)}</dd></>}
              {lead.paid_at && <><dt>付费</dt><dd>{fmt(lead.paid_at)}{lead.paid_amount != null ? ` · ${lead.paid_amount} 元` : ''}</dd></>}
              {lead.opened_at && <><dt>开通</dt><dd>{fmt(lead.opened_at)}</dd></>}
              {lead.won_at && <><dt>报正价</dt><dd>{fmt(lead.won_at)}</dd></>}
            </dl>
          </section>

          <section className="rounded-xl bg-white p-4">
            <h3 className="text-sm font-bold text-slate-700">学生账号</h3>
            {lead.student_id ? (
              <p className="mt-1 text-sm text-slate-700">
                已关联「{lead.student_name}」
                {lead.studied_days != null && <span className="ml-1 text-slate-500">· 开通后 7 天学了 {lead.studied_days} 天(学满 5 天才算数)</span>}
              </p>
            ) : (
              <p className="mt-1 text-xs leading-5 text-slate-500">开通后填孩子的学生号用户名或手机号,系统才能看他 7 天里学了几天。</p>
            )}
            <div className="mt-2 flex gap-2">
              <input value={studentRef} onChange={(e) => setStudentRef(e.target.value)} placeholder="学生用户名 / 手机号"
                aria-label="学生用户名或手机号"
                className="min-h-9 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#FF6B35]" />
              <button type="button" disabled={busy || !studentRef.trim()}
                onClick={() => save({ student_ref: studentRef.trim() }, '已关联学生号').then(() => setStudentRef(''))}
                className="min-h-9 rounded-lg bg-slate-800 px-3 text-sm font-semibold text-white disabled:opacity-40">
                关联
              </button>
            </div>
          </section>

          <section className="rounded-xl bg-white p-4">
            <h3 className="text-sm font-bold text-slate-700">备注 / 实收</h3>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000}
              placeholder="孩子的情况、家长的顾虑、答应过家长什么"
              aria-label="备注"
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#FF6B35]" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-500" htmlFor={`paid-${lead.id}`}>实收体验费</label>
              <input id={`paid-${lead.id}`} type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)}
                className="min-h-9 w-24 rounded-lg border border-slate-200 px-2 text-sm" />
              <span className="text-xs text-slate-500">元</span>
              <button type="button" disabled={busy}
                onClick={() => save({ note, paid_amount: paid === '' ? null : Number(paid) })}
                className="ml-auto min-h-9 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                保存
              </button>
            </div>
          </section>

          {manager && owners.length > 0 && (
            <section className="rounded-xl bg-white p-4">
              <h3 className="text-sm font-bold text-slate-700">归属销售</h3>
              <p className="mt-1 text-xs text-slate-500">现在是「{lead.sales_name}」。改了会记进跟进记录和操作记录。</p>
              <select defaultValue={lead.sales_user_id ?? ''} disabled={busy} aria-label="归属销售"
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  if (v === lead.sales_user_id) return;
                  if (!window.confirm('确定把这条线索改给另一个销售吗?')) { e.target.value = String(lead.sales_user_id ?? ''); return; }
                  save({ sales_user_id: v }, '归属已改');
                }}
                className="mt-2 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </section>
          )}

          <section className="rounded-xl bg-white p-4">
            <h3 className="text-sm font-bold text-slate-700">记一次跟进</h3>
            <form onSubmit={submitLog} className="mt-2 space-y-2">
              <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} maxLength={2000} required
                placeholder="如:加上微信了,家长想先看看孩子愿不愿意学"
                aria-label="跟进内容"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#FF6B35]" />
              <div className="flex flex-wrap items-center gap-2">
                <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value as PromoStatus | '')}
                  aria-label="顺便改状态"
                  className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                  <option value="">状态不变</option>
                  {PROMO_STATUSES.filter((s) => s.key !== lead.status).map((s) => <option key={s.key} value={s.key}>改成「{s.label}」</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  下次跟进
                  <input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)}
                    className="min-h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-700" />
                </label>
                <button type="submit" disabled={busy || !content.trim()}
                  className="ml-auto min-h-9 rounded-lg bg-[#FF6B35] px-4 text-sm font-bold text-white disabled:opacity-40">
                  记上
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-xl bg-white p-4">
            <h3 className="text-sm font-bold text-slate-700">跟进记录</h3>
            {logs === null ? (
              <LoaderCircle className="mt-2 h-4 w-4 animate-spin text-slate-400" aria-label="加载中" />
            ) : logs.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">还没有记录</p>
            ) : (
              <ol className="mt-2 space-y-2.5 border-l-2 border-slate-100 pl-3">
                {logs.map((f) => (
                  <li key={f.id} className="text-sm">
                    <p className="text-xs text-slate-400">
                      {fmt(f.created_at)} · {f.created_by_name}
                      {f.status_label && <span className={`ml-1 rounded px-1.5 py-0.5 ${STATUS_TONE[f.status_after as PromoStatus] || ''}`}>{f.status_label}</span>}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{f.content}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
