/** 操作记录(追责)
 *
 * 起因(2026-09-27): 几位老师共用一个账号,作业布置错了查不出是谁。
 * 共用账号时「谁」只能靠「哪台设备 + 哪个 IP + 什么时间」区分,
 * 所以每条都把设备和 IP 摆在显眼处,点一下就能筛出这台设备做过的所有事。
 * 只读:日志没有改/删入口(改得动的日志不能拿来追责)。
 */
import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, History, Search, X } from 'lucide-react';
import { operationLogApi, OperationLogFilters, OperationLogItem } from '../api/operationLogs';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

const PAGE_SIZE = 50;

const ROLE_LABELS: Record<string, string> = {
  teacher: '老师', assistant: '助教', org_admin: '机构管理员', admin: '平台管理员',
};

// 动作大类配色:删除/扣减这类最常被追问的要一眼看得出
const toneOf = (action: string) => {
  if (action.endsWith('.delete') || action.endsWith('tx_delete') || action === 'book.unassign') return 'bg-red-100 text-red-700';
  if (action.startsWith('homework.')) return 'bg-orange-100 text-orange-700';
  if (action.startsWith('coin.')) return 'bg-amber-100 text-amber-700';
  if (action.startsWith('book.')) return 'bg-sky-100 text-sky-700';
  return 'bg-slate-100 text-slate-600';
};

/** 后端时间戳是 UTC(带 Z),按本地时区显示到秒 —— 追责时秒级先后顺序有用 */
const fmtTime = (s: string | null) =>
  s ? new Date(s).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) : '—';

const readRole = (): string | null => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')?.role ?? null;
  } catch {
    return null;
  }
};

function LogRow({ item, onPickIp, onPickActor }: {
  item: OperationLogItem;
  onPickIp: (ip: string) => void;
  onPickActor: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = item.detail !== null && item.detail !== undefined;
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <time className="font-mono text-slate-700">{fmtTime(item.created_at)}</time>
        <span className={`rounded-md px-2 py-0.5 font-semibold ${toneOf(item.action)}`}>{item.action_label}</span>
        {item.actor_id !== null ? (
          <button type="button" className="admin-focus-ring rounded font-semibold text-slate-700 hover:underline"
            onClick={() => onPickActor(item.actor_id as number)} title="只看这个账号">
            {item.actor_name || `账号#${item.actor_id}`}
          </button>
        ) : <span>未知账号</span>}
        {item.actor_role && <span>{ROLE_LABELS[item.actor_role] || item.actor_role}</span>}
      </div>

      <p className="mt-2 break-words text-sm text-slate-800">{item.summary}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-600" title={item.user_agent || undefined}>
          {item.device}
        </span>
        {item.ip && (
          <button type="button" className="admin-focus-ring rounded-md bg-slate-100 px-2 py-0.5 font-mono text-slate-600 hover:bg-slate-200"
            onClick={() => onPickIp(item.ip as string)} title="只看这个 IP 的操作">
            IP {item.ip}
          </button>
        )}
        {hasDetail && (
          <button type="button" aria-expanded={open}
            className="admin-focus-ring ml-auto inline-flex items-center gap-0.5 rounded px-1 text-slate-500 hover:text-slate-800"
            onClick={() => setOpen(v => !v)}>
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            详情
          </button>
        )}
      </div>

      {open && hasDetail && (
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          {typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail, null, 2)}
        </pre>
      )}
    </li>
  );
}

export default function AdminOperationLogs() {
  const role = readRole();
  const [filters, setFilters] = useState<OperationLogFilters>({});
  const [keywordInput, setKeywordInput] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['operation-logs', filters, page],
    queryFn: () => operationLogApi.list(filters, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });

  const patch = (p: Partial<OperationLogFilters>) => {
    setFilters(f => ({ ...f, ...p }));
    setPage(1);
  };
  const reset = () => { setFilters({}); setKeywordInput(''); setPage(1); };
  const hasFilter = Object.values(filters).some(v => v !== undefined && v !== '');
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const inputCls = 'min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30';

  return (
    <div className="min-h-screen px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
      <div className="mx-auto max-w-[1100px]">
        <StaffWorkspaceHeader
          role={role === 'org_admin' ? 'org' : 'admin'}
          title="操作记录"
          subtitle="谁在什么时间、用哪台设备做了什么 —— 共用账号时按设备和 IP 区分"
          icon={History}
          backTo={role === 'org_admin' ? '/org' : '/admin'}
        />

        <section className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="筛选">
          <label className="flex flex-col gap-1 text-xs text-slate-500 lg:col-span-1">
            操作账号
            <select className={inputCls} value={filters.actor_id ?? ''}
              onChange={e => patch({ actor_id: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">全部</option>
              {data?.actors.map(a => (
                <option key={a.id} value={a.id}>{a.name || `账号#${a.id}`}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            类型
            <select className={inputCls} value={filters.group ?? ''} onChange={e => patch({ group: e.target.value })}>
              <option value="">全部</option>
              {data && Object.entries(data.action_groups).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            开始日期
            <input type="date" className={inputCls} value={filters.date_from ?? ''}
              onChange={e => patch({ date_from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            结束日期
            <input type="date" className={inputCls} value={filters.date_to ?? ''}
              onChange={e => patch({ date_to: e.target.value })} />
          </label>
          <form className="flex flex-col gap-1 text-xs text-slate-500 sm:col-span-2"
            onSubmit={e => { e.preventDefault(); patch({ keyword: keywordInput.trim() }); }}>
            <label htmlFor="oplog-kw">搜索作业名 / 学生名</label>
            <div className="flex gap-2">
              <input id="oplog-kw" className={`${inputCls} min-w-0 flex-1`} value={keywordInput}
                placeholder="如:第一单元" onChange={e => setKeywordInput(e.target.value)} />
              <button type="submit" className="admin-focus-ring inline-flex min-h-10 items-center gap-1 rounded-lg bg-[#3976a9] px-3 text-sm font-semibold text-white">
                <Search className="h-4 w-4" />搜索
              </button>
            </div>
          </form>
          {hasFilter && (
            <div className="flex flex-wrap items-center gap-2 text-xs sm:col-span-2 lg:col-span-6">
              {filters.ip && <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-slate-600">IP {filters.ip}</span>}
              <button type="button" onClick={reset}
                className="admin-focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">
                <X className="h-3.5 w-3.5" />清空筛选
              </button>
            </div>
          )}
        </section>

        <div className="mb-2 flex items-center justify-between text-xs text-slate-500" aria-live="polite">
          <span>{data ? `共 ${data.total} 条` : ''}{isFetching && data ? ' · 更新中…' : ''}</span>
          <span>记录从 2026-09-27 开始,之前的操作没有留痕</span>
        </div>

        {isLoading ? (
          <p className="py-16 text-center text-sm text-slate-500">加载中…</p>
        ) : isError ? (
          <p className="py-16 text-center text-sm text-red-600">加载失败,请刷新重试</p>
        ) : !data || data.items.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">
            {hasFilter ? '当前筛选条件下没有记录,试试清空筛选' : '还没有操作记录'}
          </p>
        ) : (
          <ul className="space-y-2">
            {data.items.map(item => (
              <LogRow key={item.id} item={item}
                onPickIp={ip => patch({ ip })}
                onPickActor={id => patch({ actor_id: id })} />
            ))}
          </ul>
        )}

        {data && data.total > PAGE_SIZE && (
          <nav className="mt-4 flex items-center justify-center gap-3 text-sm" aria-label="分页">
            <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="admin-focus-ring min-h-10 rounded-lg border border-slate-300 bg-white px-3 disabled:opacity-40">上一页</button>
            <span className="text-slate-600">{page} / {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="admin-focus-ring min-h-10 rounded-lg border border-slate-300 bg-white px-3 disabled:opacity-40">下一页</button>
          </nav>
        )}
      </div>
    </div>
  );
}
