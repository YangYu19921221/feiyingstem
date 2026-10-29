/**
 * 体验卡线索列表 + 跟单抽屉。销售工作台(只看自己的)和机构管理端(看全机构、能改归属)共用这一份
 *
 * 跟单的核心是三件事: 现在到哪一步了(状态)、下次什么时候跟(到点没跟标红)、跟过什么(时间线)。
 * 时间线只能加不能改不能删 —— 谁答应了家长什么,出纠纷要有据。
 * 整条线索只有机构管理员能删(清测试号、刷出来的假线索);销售遇到不想跟的标「无效」,
 * 删了等于把自己转化差的痕迹一起抹掉。
 *
 * 体验期 + 老带新(10-29): 抽屉里「开通体验」给关联的学生号开 7 天限期授权(到期自动锁);
 * 「邀请朋友」复制这家的邀请链接发给家长 —— 朋友用这个链接留电话并付了体验费(实收 > 0),这家的体验延 7 天,
 * 最多算机构设置的几家。奖励规则只在这里写给销售看,**家长那边的页面不写「转发得 7 天」**(微信判诱导分享会封域名),
 * 由销售私聊告诉家长。
 */
import { useCallback, useEffect, useState } from 'react';
import { Clock, Copy, Gift, LoaderCircle, Phone, Search, Trash2, X } from 'lucide-react';
import {
  PROMO_STATUSES, addFollowUp, batchDeletePromoLeads, deletePromoLead, getLeadShare, inviteUrl, listFollowUps,
  listPromoLeads, listTrialBooks, openTrial, shareProgressUrl, updatePromoLead,
  type FollowUp, type LeadShare, type PromoLead, type PromoLeadList, type PromoStatus, type TrialBook,
} from '../../api/promo';
import { toast } from '../Toast';
import Pager from './Pager';
import { formatPrice } from '../../utils/promoPrice';

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
  refunded: 'bg-rose-50 text-rose-600',
};

const fmt = (s: string | null) => (s ? s.replace('T', ' ').slice(5, 16) : '');
/** 2026-11-05 → 11-05 */
const md = (d: string) => d.slice(5);

/** 复制到剪贴板;没权限(老浏览器 / 非 https)退回 prompt 让人自己长按复制 */
async function copyText(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg, 'success');
  } catch {
    window.prompt('长按复制下面的链接', text);
  }
}

interface Props {
  manager: boolean;
  /** 管理端: 可选的销售(改归属、按人筛) */
  owners?: Array<{ id: number; name: string }>;
  /** 外部要求刷新(如管理端切回这个页签) */
  refreshKey?: number;
  /** 机构体验价,标「已付」时弹框默认填它 */
  trialPrice?: number;
}

export default function PromoLeadsPanel({ manager, owners = [], refreshKey = 0, trialPrice }: Props) {
  const [data, setData] = useState<PromoLeadList | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<PromoStatus | ''>('');
  const [overdue, setOverdue] = useState(false);
  const [owner, setOwner] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PromoLead | null>(null);
  const [page, setPage] = useState(1);
  // 管理端勾选批量删(只在本页内选,翻页/换筛选就清掉 —— 跨页勾选看不见勾了谁,容易误删)
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await listPromoLeads({ status, overdue, owner: manager ? owner : null, search: query, page, size: PAGE_SIZE }));
      setPicked(new Set());   // 列表换了(翻页 / 筛选 / 删完重新拉)就清空勾选
    } catch (e) {
      toast(errText(e, '线索加载失败'), 'error');
    } finally {
      setLoading(false);
    }
  }, [status, overdue, owner, query, manager, page]);

  useEffect(() => { load(); }, [load, refreshKey]);
  const togglePick = (id: number) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const pageIds = data?.items.map((l) => l.id) ?? [];
  const allPicked = pageIds.length > 0 && pageIds.every((id) => picked.has(id));

  // 删完这一页空了就退回上一页,不然停在一页空白上
  const afterDelete = (n: number) => {
    if (data && n >= data.items.length && page > 1) setPage(page - 1);
    else load();
  };

  const removePicked = async () => {
    const ids = pageIds.filter((id) => picked.has(id));
    if (!ids.length) return;
    if (!window.confirm(`删除选中的 ${ids.length} 条线索?\n跟进记录一起删,删了恢复不了;删了以后这些手机号能重新扫码登记。\n只是不想跟了的,点开改成「无效」就行。`)) return;
    setDeleting(true);
    try {
      const r = await batchDeletePromoLeads(ids);
      toast(`已删除 ${r.deleted} 条`, 'success');
      afterDelete(r.deleted);
    } catch (e) {
      toast(errText(e, '删除失败'), 'error');
    } finally {
      setDeleting(false);
    }
  };

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
        {manager && pageIds.length > 0 && (
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={allPicked} className="h-4 w-4 accent-[#FF6B35]"
                onChange={() => setPicked(allPicked ? new Set() : new Set(pageIds))} />
              全选本页
            </label>
            <button type="button" disabled={!picked.size || deleting} onClick={removePicked}
              className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 sm:ml-0">
              <Trash2 className="h-4 w-4" aria-hidden /> 删除{picked.size ? ` ${picked.size} 条` : ''}
            </button>
          </div>
        )}
      </div>

      {data && data.items.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          {status || overdue || query ? '这个条件下没有线索' : '还没有家长扫码。卡发出去后,家长扫码留了电话就会出现在这里。'}
        </div>
      )}

      <ul className="space-y-2">
        {data?.items.map((l) => (
          <li key={l.id} className="flex items-stretch gap-2">
            {manager && (
              <label className={`flex w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border bg-white ${picked.has(l.id) ? 'border-orange-300' : 'border-slate-200'}`}>
                <input type="checkbox" checked={picked.has(l.id)} onChange={() => togglePick(l.id)}
                  aria-label={`选中 ${l.parent_phone}`} className="h-4 w-4 accent-[#FF6B35]" />
              </label>
            )}
            <button type="button" onClick={() => setOpen(l)}
              className={`min-w-0 flex-1 rounded-xl border bg-white px-4 py-3 text-left hover:border-orange-300 ${picked.has(l.id) ? 'border-orange-300' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-800 tabular-nums">{l.parent_phone}</span>
                {l.parent_name && <span className="text-sm text-slate-600">{l.parent_name}</span>}
                {l.child_grade && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{l.child_grade}</span>}
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[l.status]}`}>{l.status_label}</span>
                {l.existing_account && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">老客户</span>}
                {l.referred && <span className="rounded-full bg-pink-50 px-2 py-0.5 text-xs text-pink-600">朋友推荐 {l.referred_by}</span>}
                {l.friends_total > 0 && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                    推荐了 {l.friends_total} 家{l.friends_counted ? `,${l.friends_counted} 家已付` : ''}
                  </span>
                )}
                {l.trial && (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${l.trial.active ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>
                    {l.trial.active ? `体验到 ${md(l.trial.last_day)}` : '体验已到期'}
                  </span>
                )}
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
        <LeadDrawer lead={open} manager={manager} owners={owners} trialPrice={trialPrice} onClose={() => setOpen(null)}
          onSaved={onSaved} onChanged={load}
          onDeleted={() => { setOpen(null); afterDelete(1); }} />
      )}
    </section>
  );
}

function LeadDrawer({ lead, manager, owners, trialPrice, onClose, onSaved, onChanged, onDeleted }: {
  lead: PromoLead; manager: boolean; owners: Array<{ id: number; name: string }>; trialPrice?: number;
  onClose: () => void; onSaved: (l: PromoLead) => void; onChanged: () => void; onDeleted: () => void;
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

  const remove = async () => {
    if (!window.confirm(`删除 ${lead.parent_phone} 这条线索?\n跟进记录一起删,删了恢复不了;删了以后这个手机号能重新扫码登记。\n只是不想跟了的,改成「无效」就行。`)) return;
    setBusy(true);
    try {
      await deletePromoLead(lead.id);
      toast('已删除', 'success');
      onDeleted();
    } catch (e) {
      toast(errText(e, '删除失败'), 'error');
      setBusy(false);
    }
  };

  const setStatusQuick = (s: PromoStatus) => {
    if (s === 'paid' && !paid) {
      const v = window.prompt('实收体验费多少元?', formatPrice(trialPrice ?? 99));
      if (v === null) return;
      const n = Number(v.trim());
      if (!v.trim() || !Number.isFinite(n) || n < 0 || n > 100000) { toast('金额不对,填 0 到 100000 元(可以带小数,如 9.9)', 'error'); return; }
      setPaid(String(n));
      save({ status: s, paid_amount: n }, `已标「已付体验费」${n} 元`);
      return;
    }
    if (s === 'refunded' && lead.referred && lead.referral_state === 'counted'
      && !window.confirm('标「已退款」后,这家不再算进推荐人,推荐人家孩子的体验会少 7 天(今天还在学的保底到今天结束)。\n退款只写不清,改回去也不再算。确定吗?')) return;
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
            {lead.referred && (
              <p className="mt-1 text-xs text-pink-600">
                朋友 {lead.referred_by} 推荐来的 · {lead.referral_label}
              </p>
            )}
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

          <TrialSection lead={lead} busy={busy} onSaved={(l) => { onSaved(l); listFollowUps(lead.id).then(setLogs).catch(() => {}); onChanged(); }} />

          <ShareSection lead={lead} />

          <section className="rounded-xl bg-white p-4">
            <h3 className="text-sm font-bold text-slate-700">备注 / 实收</h3>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000}
              placeholder="孩子的情况、家长的顾虑、答应过家长什么"
              aria-label="备注"
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#FF6B35]" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-500" htmlFor={`paid-${lead.id}`}>实收体验费</label>
              <input id={`paid-${lead.id}`} type="number" min={0} max={100000} step={0.01} inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)}
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

          {manager && (
            <section className="rounded-xl border border-red-100 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-700">删除这条线索</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                用来清测试号、刷出来的假线索。跟进记录一起删,恢复不了(操作记录里留着删前的内容)。真家长只是不想跟了,改成「无效」就行。
              </p>
              <button type="button" disabled={busy} onClick={remove}
                className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40">
                <Trash2 className="h-4 w-4" aria-hidden /> 删除
              </button>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}


/** 开通体验: 给关联的学生号开 7 天(+ 朋友延的)限期授权,到期自动锁 */
function TrialSection({ lead, busy, onSaved }: { lead: PromoLead; busy: boolean; onSaved: (l: PromoLead) => void }) {
  const [books, setBooks] = useState<TrialBook[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const t = lead.trial;

  const load = async () => {
    setOpen(true);
    if (books) return;
    try {
      setBooks((await listTrialBooks(lead.id)).items);
    } catch (e) {
      toast(errText(e, '书单加载失败'), 'error');
      setOpen(false);
    }
  };

  const submit = async () => {
    const ids = [...picked];
    if (!ids.length) return;
    setSaving(true);
    try {
      const l = await openTrial(lead.id, ids);
      onSaved(l);
      setPicked(new Set());
      setOpen(false);
      setBooks(null);
      toast(l.trial ? `已开通,孩子能学到 ${md(l.trial.last_day)}` : '已开通', 'success');
    } catch (e) {
      toast(errText(e, '没开通上'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const shown = (books ?? []).filter((b) => !filter.trim() || b.name.includes(filter.trim()));

  return (
    <section className="rounded-xl bg-white p-4">
      <h3 className="text-sm font-bold text-slate-700">体验期</h3>
      {t ? (
        <div className="mt-1 space-y-1 text-sm text-slate-700">
          <p>
            {t.active
              ? <>孩子能学到 <b>{md(t.last_day)}</b>(还剩 {t.days_left} 天)</>
              : <>体验 {md(t.last_day)} 已到期,书已经锁上</>}
          </p>
          {t.added_days > 0 && <p className="text-xs text-emerald-700">其中 {t.counted} 家朋友付了体验费,多了 {t.added_days} 天</p>}
          <p className="text-xs text-slate-500">
            {t.books.length ? `开的书: ${t.books.map((b) => b.name).join('、')}` : '开的书后来都改成了别的授权(兑换码 / 老师分配),体验不再管它们'}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {lead.student_id
            ? '选几本书给孩子开 7 天体验,到期自动锁,不用记着去关。孩子本来就有的书不动。'
            : '先在上面关联孩子的学生号,再开通体验。'}
        </p>
      )}
      {lead.student_id && (!t || t.active) && !open && (
        <button type="button" disabled={busy} onClick={load}
          className="mt-2 min-h-9 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white disabled:opacity-40">
          {t ? '再加几本书' : '开通 7 天体验'}
        </button>
      )}
      {open && (
        <div className="mt-2 space-y-2">
          {books === null ? (
            <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" aria-label="加载中" />
          ) : (
            <>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜书名" aria-label="搜书名"
                className="min-h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-violet-400" />
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-100 p-1">
                {shown.map((b) => (
                  <li key={b.id}>
                    <label className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm ${b.has ? 'text-slate-400' : 'text-slate-700 hover:bg-slate-50'}`}>
                      <input type="checkbox" disabled={b.has} checked={picked.has(b.id)} className="h-4 w-4 accent-violet-600"
                        onChange={() => setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                          return next;
                        })} />
                      <span className="min-w-0 flex-1 truncate">{b.name}</span>
                      {b.has && <span className="shrink-0 text-xs">孩子已有</span>}
                    </label>
                  </li>
                ))}
                {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-slate-400">没有能开体验的书</li>}
              </ul>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setOpen(false); setPicked(new Set()); }}
                  className="min-h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-600">取消</button>
                <button type="button" disabled={saving || !picked.size} onClick={submit}
                  className="ml-auto min-h-9 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-40">
                  {saving ? '开通中…' : `开通${picked.size ? ` ${picked.size} 本` : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** 邀请朋友: 复制这家的邀请链接 + 推荐来的朋友各算不算。奖励规则写给销售看,由销售私聊告诉家长 */
function ShareSection({ lead }: { lead: PromoLead }) {
  const [share, setShare] = useState<LeadShare | null>(null);
  // 「加载中」由请求参数和最后一次拿到结果的参数是否一致推出来,不在 effect 里同步 setState(同看板那段)
  const reqKey = `${lead.id}|${lead.friends_total}|${lead.friends_counted}`;
  const [doneKey, setDoneKey] = useState('');
  const loading = doneKey !== reqKey;

  useEffect(() => {
    let alive = true;
    getLeadShare(lead.id)
      .then((r) => { if (alive) setShare(r); })
      .catch(() => { if (alive) setShare(null); })
      .finally(() => { if (alive) setDoneKey(reqKey); });
    return () => { alive = false; };
  }, [lead.id, reqKey]);

  return (
    <section className="rounded-xl bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-700"><Gift className="h-4 w-4 text-pink-500" aria-hidden />邀请朋友</h3>
      {loading && !share && <LoaderCircle className="mt-2 h-4 w-4 animate-spin text-slate-400" aria-label="加载中" />}
      {share && !share.enabled && <p className="mt-1 text-xs text-slate-500">{share.reason}</p>}
      {share?.enabled && share.card_code && share.share_code && (
        <>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            规则(私聊告诉家长,别写进朋友圈文案): 朋友用这家的链接留电话、付了体验费,这家孩子的体验延 {share.days_each} 天,
            最多算 {share.cap} 家。只留电话、只加微信不算;朋友退了体验费就不算了。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => copyText(inviteUrl(share.card_code!, share.share_code!), '邀请链接已复制,发给家长转给朋友')}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-pink-500 px-3 text-sm font-semibold text-white">
              <Copy className="h-4 w-4" aria-hidden /> 复制邀请链接
            </button>
            {share.view_code && (
              <button type="button" onClick={() => copyText(shareProgressUrl(share.view_code!), '进度链接已复制,只发给这位家长')}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700">
                <Copy className="h-4 w-4" aria-hidden /> 复制看进度的链接
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">看进度的链接里有朋友的手机尾号,只发给这位家长,别让他转出去。</p>
          {share.friends.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {share.friends.map((f) => (
                <li key={f.lead_id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                  <span className="tabular-nums text-slate-700">{f.phone}</span>
                  <span className={`text-xs ${f.state === 'counted' ? 'font-semibold text-emerald-700' : 'text-slate-500'}`}>{f.label}</span>
                </li>
              ))}
            </ul>
          )}
          {share.friends.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">算数 {share.counted} / 最多 {share.cap} 家</p>
          )}
        </>
      )}
    </section>
  );
}
