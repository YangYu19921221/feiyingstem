/**
 * 地推体验卡管理 /admin/promo —— 机构管理员(和平台管理员管直营)用
 *
 * 五个页签: 看板(按销售看转化)/ 线索(全机构跟单)/ 销售(增删改查)/ 卡码(每个销售一版卡,选模板出印刷文件)/ 设置(体验价)。
 * 多个销售的关键设计: 一版卡 = 一个卡码挂一个销售;家长扫哪版卡,线索就归哪个销售;
 * 同一个手机号只认第一张卡(销售之间不抢单);销售离职把卡码「转交」或删除时选接手人,印出去的卡照样能用。
 * 几十套卡面模板(data/promoTemplates.ts)+ 卡上印老师名字电话: 新开的卡自动分一套本机构还没用过的,不同销售的卡拿在手里分得清。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft, KeyRound, LoaderCircle, Megaphone, Pencil, Plus, Power, Printer, QrCode, Search, Trash2, UserPlus, X,
} from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { InitialPasswordModal } from '../components/OrgWidgets';
import Pager from '../components/promo/Pager';
import PromoCardPrint from '../components/promo/PromoCardPrint';
import PromoLeadsPanel from '../components/promo/PromoLeadsPanel';
import {
  createChannel, createSales, deleteSales, getPromoBoard, getPromoSettings, listActiveSales, listChannels, listSales,
  resetSalesPassword, savePromoSettings, updateChannel, updateSales,
  type Paged, type PromoBoard, type PromoChannel, type PromoSettings, type SalesAccount,
} from '../api/promo';
import { PROMO_TEMPLATES, templateImg, templateOf } from '../data/promoTemplates';
import { toast } from '../components/Toast';

const errText = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && typeof (d as { message?: unknown }).message === 'string') return (d as { message: string }).message;
  return fallback;
};

type Tab = 'board' | 'leads' | 'sales' | 'channels' | 'settings';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'board', label: '看板' },
  { key: 'leads', label: '线索' },
  { key: 'sales', label: '销售' },
  { key: 'channels', label: '卡码' },
  { key: 'settings', label: '设置' },
];
const PAGE_SIZE = 20;

function currentUser(): { id?: number; role?: string; full_name?: string } {
  try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

type Owner = { id: number; name: string };

export default function AdminPromo() {
  const me = currentUser();
  const [tab, setTab] = useState<Tab>('board');
  const [activeSales, setActiveSales] = useState<SalesAccount[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // 下拉框(挂卡码 / 转交 / 改归属 / 删销售选接手人)用在用的全部销售,不分页
  const loadOwners = useCallback(
    () => listActiveSales().then((r) => setActiveSales(r.items)).catch((e) => toast(errText(e, '销售加载失败'), 'error')),
    [],
  );
  useEffect(() => { loadOwners(); }, [loadOwners]);

  // 能挂卡码的人: 在用的销售 + 自己(管理员自己也可以发卡)
  const owners = useMemo<Owner[]>(() => {
    const list = activeSales.map((s) => ({ id: s.id, name: s.full_name || s.username }));
    if (me.id && !list.some((o) => o.id === me.id)) list.push({ id: me.id, name: `${me.full_name || '我'}(自己)` });
    return list;
  }, [activeSales, me.id, me.full_name]);

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader
        role={me.role === 'org_admin' ? 'org' : 'admin'}
        title="地推体验卡"
        subtitle="每个销售一版卡,扫码留电话自动记到发卡人名下"
        icon={Megaphone}
      />
      <main className="teacher-workspace-main space-y-5">
        <section className="rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm leading-6 text-orange-900">
          <b>怎么用:</b>① 「销售」里给每个销售开账号 → ② 「卡码」里给每个销售开一版卡,选模板、填卡上印的名字电话,下载印刷文件去印
          → ③ 销售登录后传自己的微信二维码 → ④ 家长扫卡留电话,线索自动记到发卡的销售名下,同时看到他的二维码
          → ⑤ 销售在「销售工作台」跟单,你在「看板」看每个人的转化。
          <span className="text-orange-700">同一个手机号只认第一张卡,销售之间不会抢单。</span>
        </section>

        <div className="flex flex-wrap gap-2" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
              onClick={() => { setTab(t.key); setRefreshKey((k) => k + 1); }}
              className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${tab === t.key ? 'bg-[#FF6B35] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>
              {t.label}
            </button>
          ))}
          <a href="/sales" className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <QrCode className="h-4 w-4" aria-hidden /> 我自己也发卡:传我的二维码
          </a>
        </div>

        {tab === 'board' && <BoardTab refreshKey={refreshKey} />}
        {tab === 'leads' && <PromoLeadsPanel manager owners={owners} refreshKey={refreshKey} />}
        {tab === 'sales' && <SalesTab owners={owners} onChanged={loadOwners} />}
        {tab === 'channels' && <ChannelsTab owners={owners} />}
        {tab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
}

// ---------------- 看板 ----------------

function BoardTab({ refreshKey }: { refreshKey: number }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [data, setData] = useState<PromoBoard | null>(null);
  // 「加载中」由请求参数和最后一次拿到结果的参数是否一致推出来,不在 effect 里同步 setState
  const reqKey = `${start}|${end}|${refreshKey}`;
  const [doneKey, setDoneKey] = useState('');
  const loading = doneKey !== reqKey;

  useEffect(() => {
    let alive = true;
    getPromoBoard({ start: start || undefined, end: end || undefined })
      .then((r) => { if (alive) setData(r); })
      .catch((e) => toast(errText(e, '看板加载失败'), 'error'))
      .finally(() => { if (alive) setDoneKey(reqKey); });
    return () => { alive = false; };
  }, [start, end, refreshKey, reqKey]);

  const cols: Array<{ k: keyof PromoBoard['total']; label: string }> = [
    { k: 'leads', label: '留电话' }, { k: 'contacted', label: '加微信' }, { k: 'paid', label: '付体验费' },
    { k: 'opened', label: '开通' }, { k: 'studied', label: '学满 5 天' }, { k: 'won', label: '报正价' },
  ];
  const rows = data ? [...data.items, data.total] : [];

  return (
    <section className="space-y-3">
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
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">销售</th>
              <th className="px-3 py-2 text-right font-semibold">卡 / 扫开</th>
              {cols.map((c) => <th key={c.k} className="px-3 py-2 text-right font-semibold">{c.label}</th>)}
              <th className="px-3 py-2 text-right font-semibold">实收</th>
              <th className="px-3 py-2 text-right font-semibold">该跟进</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isTotal = i === rows.length - 1;
              return (
                <tr key={`${r.sales_user_id ?? 'x'}-${i}`} className={`border-t border-slate-100 ${isTotal ? 'bg-slate-50 font-semibold' : ''}`}>
                  <td className="px-3 py-2">{r.name}{!r.is_active && !isTotal && <span className="ml-1 text-xs text-slate-400">(已停用)</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.channels} / {r.views}</td>
                  {cols.map((c, ci) => {
                    const v = r[c.k] as number;
                    const prev = ci === 0 ? r.views : (r[cols[ci - 1].k] as number);
                    return (
                      <td key={c.k} className="px-3 py-2 text-right tabular-nums">
                        <span className="block">{v}</span>
                        <span className="block text-[11px] font-normal text-slate-400">{pct(v, prev)}</span>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums">¥{r.revenue}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.overdue > 0 ? 'text-red-600' : ''}`}>{r.overdue}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-5 text-slate-500">
        每格后面的灰色百分比 = 比上一步留下了多少。按「留电话的日期」选一批线索,看它们后来走到了哪一步(标了无效的也算它走到过的那步)。
        「学满 5 天」看孩子开通后 7 天里真实的学习记录,不看销售标的状态 —— 提成建议按它和「报正价」算,不按发了多少张卡。
        「扫开」是落地页打开次数(累计,不随日期变)。
      </p>
    </section>
  );
}

// ---------------- 销售 ----------------

function SalesTab({ owners, onChanged }: { owners: Owner[]; onChanged: () => void }) {
  const [form, setForm] = useState({ username: '', full_name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [pwd, setPwd] = useState<{ title: string; username: string; password: string } | null>(null);
  const [data, setData] = useState<Paged<SalesAccount> | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<SalesAccount | null>(null);
  const [deleting, setDeleting] = useState<SalesAccount | null>(null);

  const load = useCallback(() => {
    listSales({ page, size: PAGE_SIZE, search: query, status })
      .then(setData).catch((e) => toast(errText(e, '销售加载失败'), 'error'));
  }, [page, query, status]);
  useEffect(() => { load(); }, [load]);
  const reload = () => { load(); onChanged(); };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username.trim() || !form.full_name.trim()) return;
    setBusy(true);
    try {
      const r = await createSales({ username: form.username.trim(), full_name: form.full_name.trim(), phone: form.phone.trim() || undefined });
      setPwd({ title: `已开通销售「${r.full_name}」`, username: r.username, password: r.initial_password });
      setForm({ username: '', full_name: '', phone: '' });
      setPage(1);
      reload();
    } catch (err) {
      toast(errText(err, '开通失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: SalesAccount) => {
    if (s.is_active && !window.confirm(`停用「${s.full_name}」后他登录不了,扫他的卡的家长也看不到他的二维码。已有的线索还在。确定停用?`)) return;
    try { await updateSales(s.id, { is_active: !s.is_active }); reload(); } catch (e) { toast(errText(e, '操作失败'), 'error'); }
  };

  const reset = async (s: SalesAccount) => {
    if (!window.confirm(`给「${s.full_name}」重置密码?`)) return;
    try {
      const r = await resetSalesPassword(s.id);
      setPwd({ title: `「${s.full_name}」的新密码`, username: r.username, password: r.password });
    } catch (e) { toast(errText(e, '重置失败'), 'error'); }
  };

  const items = data?.items ?? [];
  return (
    <section className="space-y-4">
      <form onSubmit={create} className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="flex items-center gap-1.5 font-bold"><UserPlus className="h-4 w-4 text-[#FF6B35]" aria-hidden />开一个销售账号</h3>
        <p className="mt-1 text-xs text-slate-500">销售登录后只能看到自己的卡和线索,看不到学生学习数据,也改不了别人的线索。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="姓名(家长看到的,如 王老师)" required maxLength={50}
            aria-label="销售姓名" className="min-h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm" />
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="登录用户名" required minLength={3} maxLength={50}
            aria-label="登录用户名" className="min-h-10 w-44 rounded-lg border border-slate-200 px-3 text-sm" />
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="手机号(选填,默认印在卡上)" maxLength={20}
            aria-label="手机号" className="min-h-10 w-52 rounded-lg border border-slate-200 px-3 text-sm" />
          <button type="submit" disabled={busy} className="min-h-10 rounded-lg bg-[#FF6B35] px-4 text-sm font-bold text-white disabled:opacity-50">
            开通
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); setPage(1); }}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜姓名 / 用户名 / 手机号" aria-label="搜索销售"
            className="min-h-9 w-60 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-[#FF6B35]" />
        </form>
        {(['', 'active', 'inactive'] as const).map((k) => (
          <button key={k || 'all'} type="button" onClick={() => { setStatus(k); setPage(1); }}
            className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${status === k ? 'bg-slate-800 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>
            {k === '' ? '全部' : k === 'active' ? '在用' : '已停用'}
          </button>
        ))}
        {data && <span className="ml-auto text-sm text-slate-500">共 {data.total} 个</span>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">销售</th>
              <th className="px-3 py-2 font-semibold">手机号</th>
              <th className="px-3 py-2 font-semibold">二维码</th>
              <th className="px-3 py-2 text-right font-semibold">卡 / 线索</th>
              <th className="px-3 py-2 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {data && items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">{query || status ? '这个条件下没有销售' : '还没有销售账号'}</td></tr>
            )}
            {items.map((s) => (
              <tr key={s.id} className={`border-t border-slate-100 ${s.is_active ? '' : 'text-slate-400'}`}>
                <td className="px-3 py-2">
                  <p className="font-semibold">{s.full_name}{!s.is_active && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">已停用</span>}</p>
                  <p className="text-xs text-slate-500">{s.username}</p>
                </td>
                <td className="px-3 py-2 tabular-nums">{s.phone || '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {s.profile.qr_image_url ? (s.profile.qr_kind === 'group' ? '群码' : '个人微信码') : <span className="text-amber-600">还没传</span>}
                  {s.profile.qr_stale && <span className="ml-1 text-amber-600">· 快过期</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.channels} / {s.leads}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setEditing(s)}
                      className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> 编辑
                    </button>
                    <button type="button" onClick={() => reset(s)}
                      className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      <KeyRound className="h-3.5 w-3.5" aria-hidden /> 重置密码
                    </button>
                    <button type="button" onClick={() => toggle(s)}
                      className={`inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold ${s.is_active ? 'border border-slate-200 text-slate-700 hover:bg-slate-50' : 'bg-emerald-500 text-white'}`}>
                      <Power className="h-3.5 w-3.5" aria-hidden /> {s.is_active ? '停用' : '启用'}
                    </button>
                    <button type="button" onClick={() => setDeleting(s)}
                      className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-red-200 px-2.5 text-xs font-semibold text-red-600 hover:bg-red-50">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> 删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />}

      {editing && <EditSalesDialog sales={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {deleting && (
        <DeleteSalesDialog sales={deleting} owners={owners.filter((o) => o.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); if (items.length === 1 && page > 1) setPage(page - 1); reload(); }} />
      )}
      {pwd && (
        <InitialPasswordModal title={pwd.title} subtitle="只显示这一次,复制发给销售。他登录后可以自己改密码。"
          username={pwd.username} password={pwd.password} onClose={() => setPwd(null)} />
      )}
    </section>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditSalesDialog({ sales, onClose, onSaved }: { sales: SalesAccount; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ full_name: sales.full_name, username: sales.username, phone: sales.phone });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.full_name.trim() || f.username.trim().length < 3) { toast('姓名不能空,用户名至少 3 个字', 'error'); return; }
    setBusy(true);
    try {
      // 手机号清空也要传(空串 = 清掉),所以三个字段都带上
      await updateSales(sales.id, { full_name: f.full_name.trim(), username: f.username.trim(), phone: f.phone.trim() });
      toast('已保存', 'success');
      onSaved();
    } catch (err) {
      toast(errText(err, '没保存上'), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`编辑销售 · ${sales.full_name}`} onClose={onClose}>
      <form onSubmit={submit} className="mt-4 space-y-3">
        {([['full_name', '姓名(家长看到的)'], ['username', '登录用户名'], ['phone', '手机号(留空 = 不填)']] as const).map(([k, label]) => (
          <label key={k} className="block">
            <span className="text-sm font-medium text-slate-700">{label}</span>
            <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={k === 'phone' ? 20 : 50}
              className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#FF6B35]" />
          </label>
        ))}
        <p className="text-xs leading-5 text-slate-500">改了用户名,销售要用新用户名登录。卡上印的名字电话在「卡码 → 卡面与印刷」里单独改。</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700">取消</button>
          <button type="submit" disabled={busy} className="min-h-10 rounded-lg bg-[#FF6B35] px-5 text-sm font-bold text-white disabled:opacity-50">保存</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteSalesDialog({ sales, owners, onClose, onDeleted }: {
  sales: SalesAccount; owners: Owner[]; onClose: () => void; onDeleted: () => void;
}) {
  const needTransfer = sales.channels > 0 || sales.leads > 0;
  const [to, setTo] = useState<number | ''>('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = (!needTransfer || to !== '') && confirmText.trim() === sales.full_name.trim();
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      const r = await deleteSales(sales.id, to === '' ? null : Number(to));
      toast(needTransfer ? `已删除,${r.moved_channels} 版卡、${r.moved_leads} 条线索转给了接手人` : '已删除', 'success');
      onDeleted();
    } catch (err) {
      toast(errText(err, '删除失败'), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`删除销售 · ${sales.full_name}`} onClose={onClose}>
      <div className="mt-3 space-y-3 text-sm text-slate-700">
        <p className="rounded-lg bg-red-50 px-3 py-2 leading-6 text-red-700">
          删除后这个账号登录不了,也恢复不了。只是暂时不干了的,用「停用」就行,随时能启用回来。
        </p>
        {needTransfer ? (
          <label className="block">
            <span className="font-medium">他名下有 {sales.channels} 版卡、{sales.leads} 条线索,转给谁接手?</span>
            <select value={to} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : '')}
              className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2">
              <option value="">选接手的人…</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">卡和线索一起转过去,印出去的卡照样能用,扫码后显示接手人的二维码;每条线索会记一笔「转交」。</span>
          </label>
        ) : (
          <p className="text-slate-500">他名下没有卡也没有线索,可以直接删。</p>
        )}
        <label className="block">
          <span className="font-medium">输入他的姓名「{sales.full_name}」确认删除</span>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-red-400" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700">取消</button>
          <button type="button" disabled={!ok || busy} onClick={submit}
            className="min-h-10 rounded-lg bg-red-600 px-5 text-sm font-bold text-white disabled:opacity-40">
            {needTransfer ? '转交并删除' : '删除'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- 卡码 ----------------

function ChannelsTab({ owners }: { owners: Owner[] }) {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState<number | ''>('');
  const [tpl, setTpl] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<PromoChannel | null>(null);
  const [data, setData] = useState<Paged<PromoChannel> | null>(null);
  const [page, setPage] = useState(1);
  const [filterOwner, setFilterOwner] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    listChannels({ page, size: PAGE_SIZE, owner: filterOwner, search: query })
      .then(setData).catch((e) => toast(errText(e, '卡码加载失败'), 'error'));
  }, [page, filterOwner, query]);
  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!owner) { toast('先选这版卡给哪个销售', 'error'); return; }
    setBusy(true);
    try {
      const c = await createChannel({ name: name.trim() || undefined, sales_user_id: Number(owner), template_id: tpl || undefined });
      setName('');
      setTpl('');
      setPage(1);
      load();
      setPrinting(c);
    } catch (err) {
      toast(errText(err, '开卡码失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const transfer = async (c: PromoChannel, to: number) => {
    const target = owners.find((o) => o.id === to);
    if (!target || !window.confirm(`把「${c.name}」转给 ${target.name}?\n已经留了电话的线索还归原来的人,之后扫这版卡的才归 ${target.name}。\n卡上印的名字电话不会自动改,转交后记得在「卡面与印刷」里改了再补印。`)) return;
    try { await updateChannel(c.id, { sales_user_id: to }); load(); toast('已转交', 'success'); } catch (e) { toast(errText(e, '转交失败'), 'error'); }
  };

  const toggle = async (c: PromoChannel) => {
    if (c.is_active && !window.confirm(`停用后扫这版卡的家长会看到「这张卡已经停用」。确定停用「${c.name}」?`)) return;
    try { await updateChannel(c.id, { is_active: !c.is_active }); load(); } catch (e) { toast(errText(e, '操作失败'), 'error'); }
  };

  const items = data?.items ?? [];
  return (
    <section className="space-y-4">
      <form onSubmit={create} className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="flex items-center gap-1.5 font-bold"><Plus className="h-4 w-4 text-[#FF6B35]" aria-hidden />开一版卡</h3>
        <p className="mt-1 text-xs text-slate-500">一版卡一个二维码,挂在一个销售名下。同一个销售在不同学校门口发,可以各开一版,看哪个点出线索。模板不选就自动分一套本机构还没用过的。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={owner} onChange={(e) => setOwner(e.target.value ? Number(e.target.value) : '')} aria-label="给哪个销售"
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm">
            <option value="">给哪个销售…</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="卡面模板"
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm">
            <option value="">模板:自动分一套</option>
            {PROMO_TEMPLATES.map((t, i) => <option key={t.id} value={t.id}>{i + 1}. {t.name}</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="卡的名字(如 王老师 · 实验小学门口)" maxLength={60}
            aria-label="卡的名字" className="min-h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm" />
          <button type="submit" disabled={busy} className="min-h-10 rounded-lg bg-[#FF6B35] px-4 text-sm font-bold text-white disabled:opacity-50">
            开卡码并设计卡面
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); setPage(1); }}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜卡名 / 卡码" aria-label="搜索卡码"
            className="min-h-9 w-52 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-[#FF6B35]" />
        </form>
        <select value={filterOwner ?? ''} onChange={(e) => { setFilterOwner(e.target.value ? Number(e.target.value) : null); setPage(1); }}
          aria-label="按销售筛选" className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
          <option value="">全部销售</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {data && <span className="ml-auto text-sm text-slate-500">共 {data.total} 版</span>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">卡面</th>
              <th className="px-3 py-2 font-semibold">卡</th>
              <th className="px-3 py-2 font-semibold">销售</th>
              <th className="px-3 py-2 text-right font-semibold">扫开 / 留电话</th>
              <th className="px-3 py-2 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {data && items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">{query || filterOwner ? '这个条件下没有卡码' : '还没开卡码'}</td></tr>
            )}
            {items.map((c) => (
              <tr key={c.id} className={`border-t border-slate-100 ${c.is_active ? '' : 'text-slate-400'}`}>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => setPrinting(c)} className="block" aria-label={`${c.name} 的卡面`}>
                    <img src={templateImg(c.design.template_id, 'thumb')} alt="" className={`h-12 w-[72px] rounded-md object-cover ${c.is_active ? '' : 'opacity-40'}`} />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-slate-500">
                    {templateOf(c.design.template_id).name} · 卡上印 {[c.design.display_name, c.design.display_phone].filter(Boolean).join(' ') || '(没印)'}
                  </p>
                  <p className="text-xs text-slate-400">卡码 {c.code}{!c.is_active && ' · 已停用'}</p>
                </td>
                <td className="px-3 py-2">
                  <label className="inline-flex items-center gap-1">
                    <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    <select value={c.sales_user_id ?? ''} onChange={(e) => e.target.value && transfer(c, Number(e.target.value))}
                      aria-label={`${c.name} 转交给`} className="min-h-8 rounded border border-slate-200 bg-white px-1 text-sm">
                      {!owners.some((o) => o.id === c.sales_user_id) && <option value={c.sales_user_id ?? ''}>{c.sales_name}</option>}
                      {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.view_count} / {c.leads ?? 0}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setPrinting(c)} disabled={!c.is_active}
                      className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-slate-800 px-2.5 text-xs font-semibold text-white disabled:opacity-40">
                      <Printer className="h-3.5 w-3.5" aria-hidden /> 卡面与印刷
                    </button>
                    <button type="button" onClick={() => toggle(c)}
                      className="min-h-8 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      {c.is_active ? '停用' : '启用'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />}
      {printing && (
        <PromoCardPrint channel={printing} onClose={() => setPrinting(null)}
          onSaved={(c) => setData((d) => d && { ...d, items: d.items.map((x) => (x.id === c.id ? c : x)) })} />
      )}
    </section>
  );
}

// ---------------- 设置 ----------------

function SettingsTab() {
  const [s, setS] = useState<PromoSettings | null>(null);
  const [price, setPrice] = useState('');
  const [offer, setOffer] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPromoSettings().then((r) => { setS(r); setPrice(String(r.trial_price)); setOffer(r.offer_text); })
      .catch((e) => toast(errText(e, '设置加载失败'), 'error'));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(price);
    if (!Number.isInteger(n) || n < 0) { toast('体验价要填整数元', 'error'); return; }
    setBusy(true);
    try {
      const r = await savePromoSettings({ trial_price: n, offer_text: offer });
      setS(r);
      toast('已保存,家长扫卡看到的页面立刻生效', 'success');
    } catch (err) {
      toast(errText(err, '没保存上'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <LoaderCircle className="h-5 w-5 animate-spin text-slate-400" aria-label="加载中" />;
  return (
    <form onSubmit={save} className="max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <label className="block">
        <span className="text-sm font-semibold text-slate-700">7 天体验价(元)</span>
        <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)}
          className="mt-1 min-h-10 w-32 rounded-lg border border-slate-200 px-3 text-sm" />
        <span className="mt-1 block text-xs text-slate-500">落地页上显示的价格。卡面上印的是 ¥99,改了价格要换卡面。</span>
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-slate-700">「体验包含」那段话</span>
        <textarea value={offer} onChange={(e) => setOffer(e.target.value)} rows={3} maxLength={200}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <span className="mt-1 block text-xs text-slate-500">清空保存 = 恢复默认。不写「保证提分」「名师」这类承诺(广告法)。</span>
      </label>
      <button type="submit" disabled={busy} className="min-h-10 rounded-lg bg-[#FF6B35] px-5 text-sm font-bold text-white disabled:opacity-50">保存</button>
    </form>
  );
}
