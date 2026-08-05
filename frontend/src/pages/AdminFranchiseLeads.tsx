/** 平台管理端 - 加盟意向线索管理
 *
 * 意向客户咨询加盟 → 录入 → 跟进流转(新咨询→联系→发资料→洽谈→考察→签约/流失)
 * → 一键导出 Excel。仅平台 admin 可见。
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  franchiseLeadApi, FranchiseLead, LeadFilters, LeadFormData,
  STATUS_LABELS, CHANNEL_LABELS, INTENT_LABELS, METHOD_LABELS,
  LeadStatus, LeadChannel, IntentLevel, FollowMethod,
} from '../api/franchiseLeads';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { toast } from '../components/Toast';
import {
  Handshake, Plus, Download, X, Phone, CalendarClock, UserRound,
  TrendingUp, BellRing, BadgeCheck, Search, MessageSquarePlus, Pencil, Trash2,
} from 'lucide-react';

const STATUS_BADGE: Record<LeadStatus, string> = {
  new: 'bg-sky-100 text-sky-700',
  contacted: 'bg-blue-100 text-blue-700',
  materials_sent: 'bg-indigo-100 text-indigo-700',
  negotiating: 'bg-amber-100 text-amber-700',
  visited: 'bg-violet-100 text-violet-700',
  signed: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-slate-200 text-slate-500',
};

const INTENT_BADGE: Record<IntentLevel, string> = {
  high: 'bg-red-100 text-red-600',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-500',
};

const EMPTY_FORM: LeadFormData = {
  name: '', phone: '', wechat: '', email: '', province: '', city: '',
  channel: '', intent_level: '', budget: '', background: '', has_location: null,
  expected_launch: '', status: 'new', owner_name: '', next_follow_at: null, notes: '',
};

/** 后端时间戳是 UTC naive ISO,显示前补 Z 再本地化 */
const fmtDateTime = (s?: string | null) => {
  if (!s) return '—';
  const iso = s.endsWith('Z') || s.includes('+') ? s : `${s}Z`;
  return new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const iso = s.endsWith('Z') || s.includes('+') ? s : `${s}Z`;
  return new Date(iso).toLocaleDateString('zh-CN');
};
const isOverdue = (s?: string | null) => {
  if (!s) return false;
  const iso = s.endsWith('Z') || s.includes('+') ? s : `${s}Z`;
  return new Date(iso).getTime() < Date.now();
};
/** UTC naive → datetime-local 输入框值(本地时区) */
const toLocalInput = (s?: string | null) => {
  if (!s) return '';
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : `${s}Z`);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** datetime-local 值 → 带时区的 ISO(后端统一转 UTC naive 入库) */
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

const errorText = (e: unknown, fallback: string) => {
  const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

export default function AdminFranchiseLeads() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<LeadFilters>({});
  const [keywordInput, setKeywordInput] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // 新增/编辑表单
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<LeadFormData>(EMPTY_FORM);
  // 详情 + 跟进
  const [detailId, setDetailId] = useState<number | null>(null);
  const [fuContent, setFuContent] = useState('');
  const [fuMethod, setFuMethod] = useState<string>('phone');
  const [fuStatus, setFuStatus] = useState<string>('');
  const [fuNext, setFuNext] = useState('');
  const [exporting, setExporting] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['franchise-lead-stats'],
    queryFn: franchiseLeadApi.stats,
  });
  const { data: list, isLoading } = useQuery({
    queryKey: ['franchise-leads', filters, page],
    queryFn: () => franchiseLeadApi.list(filters, page, pageSize),
  });
  const { data: detail } = useQuery({
    queryKey: ['franchise-lead-detail', detailId],
    queryFn: () => franchiseLeadApi.detail(detailId!),
    enabled: detailId !== null,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['franchise-leads'] });
    qc.invalidateQueries({ queryKey: ['franchise-lead-stats'] });
    if (detailId !== null) qc.invalidateQueries({ queryKey: ['franchise-lead-detail', detailId] });
  };

  const saveMut = useMutation({
    mutationFn: () => {
      // 空串一律不传(渠道/意向等枚举传空串会 422)
      const payload: LeadFormData = { ...form };
      (Object.keys(payload) as (keyof LeadFormData)[]).forEach((k) => {
        if (payload[k] === '' || payload[k] === undefined) delete payload[k];
      });
      if (payload.has_location === null) delete payload.has_location;
      if (editingId !== null && form.next_follow_at === null) {
        // 编辑时清空了下次跟进:显式告诉后端清(None 语义是"不动")
        delete payload.next_follow_at;
        payload.clear_next_follow = true;
      }
      return editingId === null
        ? franchiseLeadApi.create(payload)
        : franchiseLeadApi.update(editingId, payload);
    },
    onSuccess: () => {
      toast.success(editingId === null ? '线索已录入' : '已保存');
      setFormOpen(false);
      invalidate();
    },
    onError: (e: unknown) => toast.error(errorText(e, '保存失败')),
  });

  const followMut = useMutation({
    mutationFn: () => franchiseLeadApi.addFollowUp(detailId!, {
      content: fuContent.trim(),
      method: fuMethod || undefined,
      status: fuStatus || undefined,
      next_follow_at: fuNext ? fromLocalInput(fuNext)! : undefined,
    }),
    onSuccess: () => {
      toast.success('跟进已记录');
      setFuContent(''); setFuStatus(''); setFuNext('');
      invalidate();
    },
    onError: (e: unknown) => toast.error(errorText(e, '记录失败')),
  });

  const removeLead = async (lead: FranchiseLead) => {
    if (!window.confirm(`确定删除线索「${lead.name}」?跟进记录会一并删除,不可恢复`)) return;
    try {
      await franchiseLeadApi.remove(lead.id);
      toast.success('已删除');
      if (detailId === lead.id) setDetailId(null);
      invalidate();
    } catch (e: unknown) {
      toast.error(errorText(e, '删除失败'));
    }
  };

  const openCreate = () => { setEditingId(null); setForm(EMPTY_FORM); setFormOpen(true); };
  const openEdit = (l: FranchiseLead) => {
    setEditingId(l.id);
    setForm({
      name: l.name, phone: l.phone ?? '', wechat: l.wechat ?? '', email: l.email ?? '',
      province: l.province ?? '', city: l.city ?? '', channel: l.channel ?? '',
      intent_level: l.intent_level ?? '', budget: l.budget ?? '',
      background: l.background ?? '', has_location: l.has_location ?? null,
      expected_launch: l.expected_launch ?? '', status: l.status,
      lost_reason: l.lost_reason ?? '', owner_name: l.owner_name ?? '',
      next_follow_at: l.next_follow_at ?? null, notes: l.notes ?? '',
    });
    setFormOpen(true);
  };

  const applyFilter = (patch: Partial<LeadFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  /** 导出:按当前筛选取全量 → 中文表头 Excel */
  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await franchiseLeadApi.exportAll(filters);
      if (rows.length === 0) { toast.error('当前筛选没有可导出的线索'); return; }
      const data = rows.map((l) => ({
        '姓名': l.name,
        '手机号': l.phone ?? '',
        '微信': l.wechat ?? '',
        '邮箱': l.email ?? '',
        '意向省份': l.province ?? '',
        '意向城市': l.city ?? '',
        '来源渠道': l.channel ? CHANNEL_LABELS[l.channel] : '',
        '意向等级': l.intent_level ? INTENT_LABELS[l.intent_level] : '',
        '预算范围': l.budget ?? '',
        '从业背景': l.background ?? '',
        '是否有场地': l.has_location === true ? '有' : l.has_location === false ? '无' : '未知',
        '计划启动时间': l.expected_launch ?? '',
        '状态': STATUS_LABELS[l.status],
        '流失原因': l.lost_reason ?? '',
        '跟进人': l.owner_name ?? '',
        '跟进次数': l.follow_count,
        '最近跟进': l.last_follow ?? '',
        '下次跟进时间': fmtDateTime(l.next_follow_at) === '—' ? '' : fmtDateTime(l.next_follow_at),
        '签约时间': fmtDate(l.signed_at) === '—' ? '' : fmtDate(l.signed_at),
        '关联机构': l.org_name ?? '',
        '备注': l.notes ?? '',
        '录入时间': fmtDateTime(l.created_at),
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      // 合理列宽:窄列 10、中列 16、长文本 30
      ws['!cols'] = [
        { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 12 },
        { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 14 },
        { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 8 }, { wch: 30 }, { wch: 18 },
        { wch: 12 }, { wch: 16 }, { wch: 30 }, { wch: 18 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '加盟意向线索');
      XLSX.writeFile(wb, `加盟意向线索_${new Date().toLocaleDateString('zh-CN')}.xlsx`);
      toast.success(`已导出 ${rows.length} 条线索`);
    } catch (e: unknown) {
      toast.error(errorText(e, '导出失败'));
    } finally {
      setExporting(false);
    }
  };

  const totalPages = list ? Math.max(1, Math.ceil(list.total / pageSize)) : 1;

  const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#397b9b] focus:outline-none';
  const labelCls = 'block text-xs font-medium text-slate-500 mb-1';

  return (
    <div className="min-h-screen bg-[#f2f6f8]">
      <StaffWorkspaceHeader
        role="admin"
        title="加盟线索"
        subtitle="意向客户咨询登记、跟进流转与签约转化"
        icon={Handshake}
      />

      <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
        {/* 统计卡 */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: '全部线索', value: stats?.total, icon: UserRound, cls: 'bg-[#eaf5fa] text-[#397b9b]', onClick: () => { setFilters({}); setKeywordInput(''); setPage(1); } },
            { label: '本月新增', value: stats?.month_new, icon: TrendingUp, cls: 'bg-[#e8f6ef] text-[#32815f]', onClick: undefined },
            { label: '待跟进(含逾期)', value: stats?.pending_follow, icon: BellRing, cls: 'bg-[#fce9dc] text-[#c76333]', onClick: () => applyFilter({ follow: 'today', status: undefined }) },
            { label: '已签约', value: stats?.signed, icon: BadgeCheck, cls: 'bg-[#e8edf8] text-[#4f6ea7]', onClick: () => applyFilter({ status: 'signed', follow: undefined }) },
          ].map(({ label, value, icon: Icon, cls, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              disabled={!onClick}
              className={`admin-panel rounded-2xl p-4 text-left transition ${onClick ? 'hover:shadow-md cursor-pointer' : 'cursor-default'}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">{label}</p>
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${cls}`}><Icon className="h-4 w-4" /></span>
              </div>
              <p className="mt-2 text-2xl font-bold text-[#173047] font-numeric">{value ?? '—'}</p>
            </button>
          ))}
        </div>

        {/* 筛选 + 操作 */}
        <div className="admin-panel mb-4 rounded-2xl p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filters.status ?? ''}
              onChange={(e) => applyFilter({ status: e.target.value || undefined })}
              className="h-10 rounded-lg border border-slate-200 px-2 text-sm"
              aria-label="按状态筛选"
            >
              <option value="">全部状态</option>
              {(Object.keys(STATUS_LABELS) as LeadStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}{stats?.by_status?.[s] ? `(${stats.by_status[s]})` : ''}</option>
              ))}
            </select>
            <select
              value={filters.channel ?? ''}
              onChange={(e) => applyFilter({ channel: e.target.value || undefined })}
              className="h-10 rounded-lg border border-slate-200 px-2 text-sm"
              aria-label="按渠道筛选"
            >
              <option value="">全部渠道</option>
              {(Object.keys(CHANNEL_LABELS) as LeadChannel[]).map((ch) => (
                <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>
              ))}
            </select>
            <select
              value={filters.intent_level ?? ''}
              onChange={(e) => applyFilter({ intent_level: e.target.value || undefined })}
              className="h-10 rounded-lg border border-slate-200 px-2 text-sm"
              aria-label="按意向等级筛选"
            >
              <option value="">全部意向</option>
              {(Object.keys(INTENT_LABELS) as IntentLevel[]).map((lv) => (
                <option key={lv} value={lv}>{INTENT_LABELS[lv]}</option>
              ))}
            </select>
            <select
              value={filters.follow ?? ''}
              onChange={(e) => applyFilter({ follow: e.target.value || undefined })}
              className="h-10 rounded-lg border border-slate-200 px-2 text-sm"
              aria-label="按跟进时效筛选"
            >
              <option value="">跟进时效不限</option>
              <option value="today">今日待跟进(含逾期)</option>
              <option value="overdue">仅已逾期</option>
            </select>
            <input
              type="date"
              value={filters.date_from ?? ''}
              onChange={(e) => applyFilter({ date_from: e.target.value || undefined })}
              className="h-10 rounded-lg border border-slate-200 px-2 text-sm"
              aria-label="录入起始日期"
            />
            <span className="text-xs text-slate-400">至</span>
            <input
              type="date"
              value={filters.date_to ?? ''}
              onChange={(e) => applyFilter({ date_to: e.target.value || undefined })}
              className="h-10 rounded-lg border border-slate-200 px-2 text-sm"
              aria-label="录入截止日期"
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilter({ keyword: keywordInput.trim() || undefined })}
                onBlur={() => applyFilter({ keyword: keywordInput.trim() || undefined })}
                placeholder="姓名/手机/微信/城市"
                className="h-10 w-44 rounded-lg border border-slate-200 pl-8 pr-2 text-sm"
              />
            </div>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="admin-focus-ring inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-[#173047] transition hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {exporting ? '导出中…' : '导出 Excel'}
              </button>
              <button
                type="button"
                onClick={openCreate}
                className="admin-primary admin-focus-ring inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-sm font-bold transition"
              >
                <Plus className="h-4 w-4" />
                录入线索
              </button>
            </div>
          </div>
        </div>

        {/* 线索表格 */}
        <div className="admin-panel overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-[#f8fafb] text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">客户</th>
                  <th className="px-3 py-3 font-medium">意向地区</th>
                  <th className="px-3 py-3 font-medium">渠道</th>
                  <th className="px-3 py-3 font-medium">意向</th>
                  <th className="px-3 py-3 font-medium">预算</th>
                  <th className="px-3 py-3 font-medium">状态</th>
                  <th className="px-3 py-3 font-medium">跟进人</th>
                  <th className="px-3 py-3 font-medium">下次跟进</th>
                  <th className="px-3 py-3 font-medium">最近跟进</th>
                  <th className="px-3 py-3 font-medium">录入</th>
                  <th className="px-3 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {isLoading ? (
                  <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-400">加载中…</td></tr>
                ) : !list || list.items.length === 0 ? (
                  <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-400">
                    {Object.keys(filters).length > 0 ? '当前筛选没有线索,试试放宽条件' : '还没有线索,点右上角「录入线索」登记第一条'}
                  </td></tr>
                ) : list.items.map((l) => (
                  <tr key={l.id} className="transition hover:bg-[#f8fafb]">
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => setDetailId(l.id)} className="text-left">
                        <p className="font-semibold text-[#173047] hover:underline">{l.name}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                          {l.phone && <><Phone className="h-3 w-3" />{l.phone}</>}
                          {!l.phone && l.wechat && <>微信: {l.wechat}</>}
                        </p>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{[l.province, l.city].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-3 py-3 text-slate-600">{l.channel ? CHANNEL_LABELS[l.channel] : '—'}</td>
                    <td className="px-3 py-3">
                      {l.intent_level
                        ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${INTENT_BADGE[l.intent_level]}`}>{INTENT_LABELS[l.intent_level]}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{l.budget || '—'}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[l.status]}`}>{STATUS_LABELS[l.status]}</span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{l.owner_name || '—'}</td>
                    <td className="px-3 py-3">
                      {l.next_follow_at && l.status !== 'signed' && l.status !== 'lost' ? (
                        <span className={`inline-flex items-center gap-1 text-xs ${isOverdue(l.next_follow_at) ? 'font-semibold text-red-500' : 'text-slate-600'}`}>
                          <CalendarClock className="h-3.5 w-3.5" />
                          {fmtDateTime(l.next_follow_at)}
                          {isOverdue(l.next_follow_at) && ' 逾期'}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-3 text-xs text-slate-500" title={l.last_follow ?? ''}>
                      {l.last_follow || '—'}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400">{fmtDate(l.created_at)}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => setDetailId(l.id)} title="跟进记录"
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-[#eaf5fa] hover:text-[#397b9b]">
                          <MessageSquarePlus className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => openEdit(l)} title="编辑"
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-[#eaf5fa] hover:text-[#397b9b]">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => removeLead(l)} title="删除"
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 分页 */}
          {list && list.total > pageSize && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
              <span className="text-xs text-slate-500">共 {list.total} 条 · 第 {page}/{totalPages} 页</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40">上一页</button>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40">下一页</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#173047]">{editingId === null ? '录入加盟线索' : '编辑线索'}</h3>
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>姓名 / 称呼 *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="如 张先生" />
              </div>
              <div>
                <label className={labelCls}>手机号</label>
                <input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} placeholder="13800000000" />
              </div>
              <div>
                <label className={labelCls}>微信号</label>
                <input value={form.wechat ?? ''} onChange={(e) => setForm({ ...form, wechat: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>邮箱</label>
                <input value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>意向省份</label>
                <input value={form.province ?? ''} onChange={(e) => setForm({ ...form, province: e.target.value })} className={inputCls} placeholder="如 云南" />
              </div>
              <div>
                <label className={labelCls}>意向城市 / 区县</label>
                <input value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} placeholder="如 昆明" />
              </div>
              <div>
                <label className={labelCls}>来源渠道</label>
                <select value={form.channel ?? ''} onChange={(e) => setForm({ ...form, channel: e.target.value })} className={inputCls}>
                  <option value="">未知</option>
                  {(Object.keys(CHANNEL_LABELS) as LeadChannel[]).map((ch) => <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>意向等级</label>
                <select value={form.intent_level ?? ''} onChange={(e) => setForm({ ...form, intent_level: e.target.value })} className={inputCls}>
                  <option value="">未评估</option>
                  {(Object.keys(INTENT_LABELS) as IntentLevel[]).map((lv) => <option key={lv} value={lv}>{INTENT_LABELS[lv]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>预算范围</label>
                <input value={form.budget ?? ''} onChange={(e) => setForm({ ...form, budget: e.target.value })} className={inputCls} placeholder="如 10-20万" />
              </div>
              <div>
                <label className={labelCls}>是否已有场地</label>
                <select
                  value={form.has_location === true ? 'yes' : form.has_location === false ? 'no' : ''}
                  onChange={(e) => setForm({ ...form, has_location: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null })}
                  className={inputCls}
                >
                  <option value="">未知</option>
                  <option value="yes">有场地</option>
                  <option value="no">无场地</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>计划启动时间</label>
                <input value={form.expected_launch ?? ''} onChange={(e) => setForm({ ...form, expected_launch: e.target.value })} className={inputCls} placeholder="如 今年9月 / 明年春季" />
              </div>
              <div>
                <label className={labelCls}>跟进人</label>
                <input value={form.owner_name ?? ''} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} className={inputCls} placeholder="谁负责跟这条线索" />
              </div>
              <div>
                <label className={labelCls}>状态</label>
                <select value={form.status ?? 'new'} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                  {(Object.keys(STATUS_LABELS) as LeadStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>下次跟进时间</label>
                <input
                  type="datetime-local"
                  value={toLocalInput(form.next_follow_at)}
                  onChange={(e) => setForm({ ...form, next_follow_at: e.target.value ? fromLocalInput(e.target.value) : null })}
                  className={inputCls}
                />
              </div>
              {form.status === 'lost' && (
                <div className="sm:col-span-2">
                  <label className={labelCls}>流失原因</label>
                  <input value={form.lost_reason ?? ''} onChange={(e) => setForm({ ...form, lost_reason: e.target.value })} className={inputCls} placeholder="如 预算不足 / 选择了别家" />
                </div>
              )}
              <div className="sm:col-span-2">
                <label className={labelCls}>从业背景</label>
                <textarea value={form.background ?? ''} onChange={(e) => setForm({ ...form, background: e.target.value })} rows={2} className={inputCls} placeholder="是否做过教培、现有机构/生源、团队情况…" />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>备注</label>
                <textarea value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={inputCls} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">取消</button>
              <button
                type="button"
                onClick={() => { if (!form.name.trim()) { toast.error('姓名必填'); return; } saveMut.mutate(); }}
                disabled={saveMut.isPending}
                className="admin-primary rounded-lg px-5 py-2 text-sm font-bold disabled:opacity-50"
              >
                {saveMut.isPending ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 详情 + 跟进时间线 */}
      {detailId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetailId(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            {!detail ? (
              <p className="py-10 text-center text-slate-400">加载中…</p>
            ) : (
              <>
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-lg font-bold text-[#173047]">{detail.name}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[detail.status]}`}>{STATUS_LABELS[detail.status]}</span>
                    {detail.intent_level && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${INTENT_BADGE[detail.intent_level]}`}>{INTENT_LABELS[detail.intent_level]}</span>}
                  </div>
                  <button type="button" onClick={() => setDetailId(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-[#f8fafb] p-3.5 text-xs text-slate-600 sm:grid-cols-3">
                  <span>📱 {detail.phone || '—'}</span>
                  <span>💬 {detail.wechat || '—'}</span>
                  <span>📍 {[detail.province, detail.city].filter(Boolean).join(' ') || '—'}</span>
                  <span>渠道:{detail.channel ? CHANNEL_LABELS[detail.channel] : '—'}</span>
                  <span>预算:{detail.budget || '—'}</span>
                  <span>场地:{detail.has_location === true ? '有' : detail.has_location === false ? '无' : '未知'}</span>
                  <span>计划启动:{detail.expected_launch || '—'}</span>
                  <span>跟进人:{detail.owner_name || '—'}</span>
                  <span>录入:{fmtDate(detail.created_at)}</span>
                  {detail.signed_at && <span className="text-emerald-600 font-semibold">✅ 签约:{fmtDate(detail.signed_at)}</span>}
                  {detail.org_name && <span className="text-emerald-600">关联机构:{detail.org_name}</span>}
                  {detail.status === 'lost' && detail.lost_reason && <span className="col-span-2 text-slate-500 sm:col-span-3">流失原因:{detail.lost_reason}</span>}
                  {detail.background && <span className="col-span-2 sm:col-span-3">背景:{detail.background}</span>}
                  {detail.notes && <span className="col-span-2 sm:col-span-3">备注:{detail.notes}</span>}
                </div>

                {/* 快速加跟进 */}
                <div className="mb-4 rounded-xl border border-slate-100 p-3.5">
                  <p className="mb-2 text-sm font-semibold text-[#173047]">记一条跟进</p>
                  <textarea
                    value={fuContent}
                    onChange={(e) => setFuContent(e.target.value)}
                    rows={2}
                    placeholder="这次沟通聊了什么、客户的反馈、下一步动作…"
                    className={inputCls}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select value={fuMethod} onChange={(e) => setFuMethod(e.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 text-xs" aria-label="跟进方式">
                      {(Object.keys(METHOD_LABELS) as FollowMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                    </select>
                    <select value={fuStatus} onChange={(e) => setFuStatus(e.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 text-xs" aria-label="顺带流转状态">
                      <option value="">状态不变</option>
                      {(Object.keys(STATUS_LABELS) as LeadStatus[]).map((s) => <option key={s} value={s}>→ {STATUS_LABELS[s]}</option>)}
                    </select>
                    <input type="datetime-local" value={fuNext} onChange={(e) => setFuNext(e.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 text-xs" aria-label="约下次跟进时间" />
                    <button
                      type="button"
                      onClick={() => { if (!fuContent.trim()) { toast.error('先写跟进内容'); return; } followMut.mutate(); }}
                      disabled={followMut.isPending}
                      className="admin-primary ml-auto h-9 rounded-lg px-4 text-xs font-bold disabled:opacity-50"
                    >
                      {followMut.isPending ? '提交中…' : '记录跟进'}
                    </button>
                  </div>
                </div>

                {/* 时间线 */}
                <p className="mb-2 text-sm font-semibold text-[#173047]">跟进记录({detail.follow_ups.length})</p>
                {detail.follow_ups.length === 0 ? (
                  <p className="rounded-xl bg-[#f8fafb] py-6 text-center text-xs text-slate-400">还没有跟进记录</p>
                ) : (
                  <div className="space-y-2.5">
                    {detail.follow_ups.map((f) => (
                      <div key={f.id} className="rounded-xl border border-slate-100 p-3">
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                          <span>{fmtDateTime(f.created_at)}</span>
                          {f.method && <span className="rounded bg-slate-100 px-1.5 py-0.5">{METHOD_LABELS[f.method]}</span>}
                          {f.status_after && <span className={`rounded-full px-1.5 py-0.5 font-semibold ${STATUS_BADGE[f.status_after]}`}>{STATUS_LABELS[f.status_after]}</span>}
                          {f.created_by_name && <span>· {f.created_by_name}</span>}
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-slate-700">{f.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
