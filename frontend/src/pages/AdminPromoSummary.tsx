/**
 * 体验卡各校区汇总 /admin/promo-summary —— 只给平台管理员(10-24 用户「加一个汇总页」)
 *
 * 每个校区一行: 体验价 / 销售几个 / 卡几版 / 扫开 / 留电话 → 加微信 → 付体验费 → 开通 → 学满 5 天 → 报正价 / 实收 / 该跟进。
 * 口径与各校区自己的「看板」同一套(后端 services/promo.org_summary 和 board 同一批判据),点开一个校区看到的按销售明细
 * 就是那家机构自己看到的那份数。只读: 卡码、销售、设置还是各校区自己在「地推体验卡」里管。
 * **没开始做的校区也列出来**(灰色、写「还没开始」),一眼看出谁还没动 —— 只列有数据的会把这些校区藏掉。
 */
import { useEffect, useState } from 'react';
import { ChevronRight, LoaderCircle, Megaphone, X } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import {
  getOrgPromoBoard, getPromoSummary,
  type OrgSummary, type OrgSummaryRow, type PromoBoard,
} from '../api/promo';
import { formatPrice } from '../utils/promoPrice';
import { toast } from '../components/Toast';

const errText = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

/** 漏斗几步: 每格后面的百分比 = 比上一步留下多少(第一步比扫开) */
const STEPS: Array<{ k: 'leads' | 'contacted' | 'paid' | 'opened' | 'studied' | 'won'; label: string }> = [
  { k: 'leads', label: '留电话' }, { k: 'contacted', label: '加微信' }, { k: 'paid', label: '付体验费' },
  { k: 'opened', label: '开通' }, { k: 'studied', label: '学满 5 天' }, { k: 'won', label: '报正价' },
];

const fmtTime = (s: string | null) => (s ? s.replace('T', ' ').slice(5, 16) : '');

/** 没开过卡、也没有线索 = 还没开始做 */
const notStarted = (r: OrgSummaryRow) => r.channels === 0 && r.leads === 0;

export default function AdminPromoSummary() {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [data, setData] = useState<OrgSummary | null>(null);
  const [open, setOpen] = useState<OrgSummaryRow | null>(null);
  // 「加载中」由请求参数和最后一次拿到结果的参数是否一致推出来,不在 effect 里同步 setState
  const reqKey = `${start}|${end}`;
  const [doneKey, setDoneKey] = useState('');
  const loading = doneKey !== reqKey;

  useEffect(() => {
    let alive = true;
    getPromoSummary({ start: start || undefined, end: end || undefined })
      .then((r) => { if (alive) setData(r); })
      .catch((e) => toast(errText(e, '汇总加载失败'), 'error'))
      .finally(() => { if (alive) setDoneKey(reqKey); });
    return () => { alive = false; };
  }, [start, end, reqKey]);

  const items = data?.items ?? [];
  const total = data?.total;
  const started = items.filter((r) => !notStarted(r)).length;

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="admin" title="体验卡各校区汇总" subtitle="每个校区发了多少卡、来了多少家长、转化到哪一步" icon={Megaphone} backTo="/admin" />
      <main className="mx-auto w-full max-w-[1440px] space-y-4 px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
        <section className="rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm leading-6 text-orange-900">
          只读汇总: 卡码、销售、体验价还是各校区自己在「地推体验卡」里管。点开一个校区看它按销售的明细,
          和那家机构自己看到的看板是同一份数。<span className="text-orange-700">直营自己的发卡在「地推体验卡」页里管。</span>
        </section>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">留电话日期</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="开始日期"
            className="min-h-9 rounded-lg border border-slate-200 bg-white px-2" />
          <span className="text-slate-400">到</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="结束日期"
            className="min-h-9 rounded-lg border border-slate-200 bg-white px-2" />
          {(start || end) && <button type="button" onClick={() => { setStart(''); setEnd(''); }} className="text-[#FF6B35] underline">看全部</button>}
          {loading && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" aria-label="加载中" />}
        </div>

        {total && (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: '开始做的校区', value: `${started} / ${items.length}` },
              { label: '留电话', value: String(total.leads) },
              { label: '报正价', value: String(total.won) },
              { label: '实收体验费', value: `¥${formatPrice(total.revenue)}` },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <dt className="text-xs text-slate-500">{c.label}</dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums">{c.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* 手机 / 平板: 一个校区一张卡片(表格 15 列,窄屏要横滑好几屏) */}
        <ul className="space-y-2 lg:hidden">
          {items.map((r) => (
            <li key={r.org_id ?? 'x'}>
              <button type="button" onClick={() => setOpen(r)}
                className={`w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-orange-300 ${notStarted(r) ? 'opacity-60' : ''}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 font-semibold">
                    {r.name}
                    {notStarted(r) && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">还没开始</span>}
                    {r.status && r.status !== 'active' && <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-xs font-normal text-red-600">机构已停用</span>}
                  </p>
                  <p className="flex shrink-0 items-center text-sm tabular-nums">实收 <b className="ml-1">¥{formatPrice(r.revenue)}</b><ChevronRight className="h-4 w-4 text-slate-400" aria-hidden /></p>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  体验价 ¥{formatPrice(r.trial_price ?? 0)} · {r.sales} 个销售 · {r.active_channels}/{r.channels} 版卡在用 · 扫开 {r.views} 次
                  {r.referred > 0 && <span className="ml-1 text-pink-600">· 朋友推荐来 {r.referred},付费 {r.referred_paid}</span>}
                  {r.overdue > 0 && <span className="ml-1 font-semibold text-red-600">· {r.overdue} 条该跟进</span>}
                </p>
                {!notStarted(r) && (
                  <dl className="mt-2 grid grid-cols-3 gap-1.5">
                    {STEPS.map((c, ci) => {
                      const v = r[c.k];
                      const prev = ci === 0 ? r.views : r[STEPS[ci - 1].k];
                      return (
                        <div key={c.k} className="rounded-lg bg-slate-50 px-2 py-1.5">
                          <dt className="text-[11px] text-slate-500">{c.label}</dt>
                          <dd className="tabular-nums"><b className="text-base">{v}</b> <span className="text-[11px] text-slate-400">{pct(v, prev)}</span></dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
              </button>
            </li>
          ))}
          {total && (
            <li className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 text-sm">
              <b>合计</b> · {total.sales} 个销售 · {total.channels} 版卡 · 留电话 {total.leads} · 付费 {total.paid} · 报正价 {total.won} · 实收 ¥{formatPrice(total.revenue)}
            </li>
          )}
        </ul>

        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white lg:block">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">校区</th>
                <th className="px-3 py-2 text-right font-semibold">体验价</th>
                <th className="px-3 py-2 text-right font-semibold">销售</th>
                <th className="px-3 py-2 text-right font-semibold">卡 在用/全部</th>
                <th className="px-3 py-2 text-right font-semibold">扫开</th>
                {STEPS.map((c) => <th key={c.k} className="px-3 py-2 text-right font-semibold">{c.label}</th>)}
                <th className="px-3 py-2 text-right font-semibold">推荐来的</th>
                <th className="px-3 py-2 text-right font-semibold">推荐后付费</th>
                <th className="px-3 py-2 text-right font-semibold">实收</th>
                <th className="px-3 py-2 text-right font-semibold">该跟进</th>
                <th className="px-3 py-2 font-semibold">最近留电话</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.org_id ?? 'x'} onClick={() => setOpen(r)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-orange-50/40 ${notStarted(r) ? 'text-slate-400' : ''}`}>
                  <td className="px-3 py-2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(r); }} className="font-semibold text-slate-800 hover:text-[#FF6B35]">
                      {r.name}
                    </button>
                    {notStarted(r) && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">还没开始</span>}
                    {r.status && r.status !== 'active' && <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600">机构已停用</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">¥{formatPrice(r.trial_price ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.sales}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.active_channels} / {r.channels}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.views}</td>
                  {STEPS.map((c, ci) => {
                    const v = r[c.k];
                    const prev = ci === 0 ? r.views : r[STEPS[ci - 1].k];
                    return (
                      <td key={c.k} className="px-3 py-2 text-right tabular-nums">
                        <span className="block">{v}</span>
                        <span className="block text-[11px] text-slate-400">{pct(v, prev)}</span>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums">{r.referred}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.referred_paid}</td>
                  <td className="px-3 py-2 text-right tabular-nums">¥{formatPrice(r.revenue)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.overdue > 0 ? 'font-semibold text-red-600' : ''}`}>{r.overdue}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{fmtTime(r.last_lead_at) || '—'}</td>
                </tr>
              ))}
              {total && (
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-3 py-2">合计</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">{total.sales}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{total.active_channels} / {total.channels}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{total.views}</td>
                  {STEPS.map((c, ci) => {
                    const v = total[c.k];
                    const prev = ci === 0 ? total.views : total[STEPS[ci - 1].k];
                    return (
                      <td key={c.k} className="px-3 py-2 text-right tabular-nums">
                        <span className="block">{v}</span>
                        <span className="block text-[11px] font-normal text-slate-400">{pct(v, prev)}</span>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums">{total.referred}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{total.referred_paid}</td>
                  <td className="px-3 py-2 text-right tabular-nums">¥{formatPrice(total.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{total.overdue}</td>
                  <td className="px-3 py-2" />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs leading-5 text-slate-500">
          按「留电话的日期」选一批线索,看它们后来走到了哪一步;灰色百分比 = 比上一步留下了多少。
          「学满 {data?.study_days_target ?? 5} 天」看孩子开通后 7 天里真实的学习记录,不看销售标的状态。
          「扫开」是落地页打开次数(累计,不随日期变)。体验价是各校区自己在「设置」里填的。
        </p>
      </main>

      {open && open.org_id != null && (
        <OrgDetail org={open} start={start} end={end} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

/** 点开一个校区: 按销售看(那家机构自己看板上的同一份数) */
function OrgDetail({ org, start, end, onClose }: { org: OrgSummaryRow; start: string; end: string; onClose: () => void }) {
  const [data, setData] = useState<(PromoBoard & { org_name: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getOrgPromoBoard(org.org_id as number, { start: start || undefined, end: end || undefined })
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setErr(errText(e, '明细加载失败')); });
    return () => { alive = false; };
  }, [org.org_id, start, end]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = data ? [...data.items, data.total] : [];
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${org.name} 按销售明细`}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold">{org.name} · 按销售</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              体验价 ¥{formatPrice(org.trial_price ?? 0)} · {start || end ? `留电话 ${start || '…'} 到 ${end || '今天'}` : '全部日期'} · 和这家机构自己看到的看板同一份数
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 sm:p-5">
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
          {!data && !err && <LoaderCircle className="h-5 w-5 animate-spin text-slate-400" aria-label="加载中" />}
          {data && data.items.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              这家还没开销售账号、也没开卡码。机构管理员登录后在首页「地推体验卡」里开始。
            </p>
          )}
          {data && data.items.length > 0 && (
            <ul className="space-y-2">
              {rows.map((r, i) => {
                const isTotal = i === rows.length - 1;
                return (
                  <li key={`${r.sales_user_id ?? 'x'}-${i}`}
                    className={`rounded-xl border p-3 ${isTotal ? 'border-orange-200 bg-orange-50/60' : 'border-slate-200'}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-semibold">{r.name}{!r.is_active && !isTotal && <span className="ml-1 text-xs font-normal text-slate-400">(已停用)</span>}</p>
                      <p className="shrink-0 text-sm tabular-nums">实收 <b>¥{formatPrice(r.revenue)}</b></p>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {r.channels} 版卡 · 扫开 {r.views} 次
                      {r.referred > 0 && <span className="ml-1 text-pink-600">· 朋友推荐来 {r.referred},付费 {r.referred_paid}</span>}
                      {r.overdue > 0 && <span className="ml-1 font-semibold text-red-600">· {r.overdue} 条该跟进</span>}
                    </p>
                    <dl className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                      {STEPS.map((c, ci) => {
                        const v = r[c.k] as number;
                        const prev = ci === 0 ? r.views : (r[STEPS[ci - 1].k] as number);
                        return (
                          <div key={c.k} className="rounded-lg bg-slate-50 px-2 py-1.5">
                            <dt className="text-[11px] text-slate-500">{c.label}</dt>
                            <dd className="tabular-nums"><b className="text-base">{v}</b> <span className="text-[11px] text-slate-400">{pct(v, prev)}</span></dd>
                          </div>
                        );
                      })}
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
