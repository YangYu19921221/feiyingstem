import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  getSubscriptionStats,
  generateCodes,
  listCodes,
  disableCode,
  deleteCode,
} from '../api/subscription';
import { getTeacherWordBooks } from '../api/teacher';
import { Ban, Check, Clock3, Search, Ticket, Trash2, X } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

interface Stats {
  total_codes: number;
  unused_codes: number;
  used_codes: number;
  expired_codes: number;
  disabled_codes: number;
}

interface CodeItem {
  id: number;
  code: string;
  book_id: number;
  book_name?: string;
  status: string;
  created_by: number;
  created_at: string;
  code_expires_at: string;
  used_by: number | null;
  used_at: string | null;
  batch_note: string | null;
  created_by_name?: string | null;
  grant_type: string;
  grant_days?: number | null;
  grant_times?: number | null;
}

interface BookOption {
  id: number;
  name: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  unused: { label: '未使用', color: 'bg-green-100 text-green-700' },
  used: { label: '已使用', color: 'bg-blue-100 text-blue-700' },
  expired: { label: '已过期', color: 'bg-gray-100 text-gray-500' },
  disabled: { label: '已禁用', color: 'bg-red-100 text-red-600' },
};

const AdminSubscriptions = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  // 搜索:输入框即时回显 search,防抖后的 debouncedSearch 才触发请求
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [genCount, setGenCount] = useState(10);
  const [genBookId, setGenBookId] = useState<number>(0);
  const [genNote, setGenNote] = useState('');
  const [genGrantType, setGenGrantType] = useState('permanent'); // 卡种: permanent/period/times
  const [genGrantDays, setGenGrantDays] = useState(30);  // 包月默认 30 天
  const [genGrantTimes, setGenGrantTimes] = useState(7); // 次卡默认 7 天
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<CodeItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [books, setBooks] = useState<BookOption[]>([]);

  const fetchBooks = useCallback(async () => {
    try {
      const data = await getTeacherWordBooks();
      const bookList = data.map(b => ({ id: b.id, name: b.name }));
      setBooks(bookList);
      if (bookList.length > 0) {
        setGenBookId(prev => prev === 0 ? bookList[0].id : prev);
      }
    } catch { toast.error('单词本加载失败，请刷新重试'); }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res: any = await getSubscriptionStats();
      setStats(res);
    } catch { toast.error('兑换码统计加载失败'); }
  }, []);

  const fetchCodes = useCallback(async () => {
    try {
      const params: any = { page, page_size: 20 };
      if (filterStatus) params.status = filterStatus;
      if (debouncedSearch) params.search = debouncedSearch;
      const res: any = await listCodes(params);
      setCodes(res.codes);
      setTotal(res.total);
    } catch { toast.error('兑换码列表加载失败，请刷新重试'); }
  }, [page, filterStatus, debouncedSearch]);

  // 输入防抖 300ms,别每敲一个字符打一次接口
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // 换关键词/换筛选后回到第 1 页,否则停在第 3 页会显示空列表让人以为没搜到
  useEffect(() => { setPage(1); }, [debouncedSearch, filterStatus]);

  useEffect(() => { fetchBooks(); fetchStats(); }, [fetchBooks, fetchStats]);
  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const handleGenerate = async () => {
    if (!genBookId) { toast.warning('请先选择要绑定的单词本'); return; }
    if (genCount < 1 || genCount > 100) { toast.warning('生成数量需在 1～100 之间'); return; }
    setGenerating(true);
    setGenResult([]);
    try {
      const payload: any = {
        count: genCount,
        book_id: genBookId,
        batch_note: genNote || undefined,
        grant_type: genGrantType,
      };
      if (genGrantType === 'period') payload.grant_days = genGrantDays;
      if (genGrantType === 'times') payload.grant_times = genGrantTimes;
      const res: any = await generateCodes(payload);
      setGenResult(res);
      await Promise.all([fetchStats(), fetchCodes()]);
      toast.success(`已生成 ${res.length} 个兑换码`);
    } catch { toast.error('生成兑换码失败，请检查参数后重试'); }
    finally { setGenerating(false); }
  };

  const handleDisable = async (codeId: number) => {
    if (!confirm('确定要禁用此兑换码吗？')) return;
    try {
      await disableCode(codeId);
      fetchCodes();
      fetchStats();
    } catch { toast.error('禁用兑换码失败，请重试'); }
  };

  const handleDelete = async (item: CodeItem) => {
    // 删除不可恢复,确认文案里带上码本身,避免点错行删掉别的码
    if (!confirm(`确定删除兑换码 ${item.code} 吗？\n\n删除后该码从列表彻底消失，不可恢复。\n如果只是想让它失效并留个记录，请用「禁用」。`)) return;
    try {
      await deleteCode(item.id);
      toast.success('兑换码已删除');
      fetchCodes();
      fetchStats();
    } catch (error) { toast.error(getErrorMessage(error, '删除兑换码失败，请重试')); }
  };

  const copyAllCodes = async () => {
    const text = genResult.map((c) => c.code).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toast.warning('当前浏览器不允许复制，请手动选择兑换码'); }
  };

  const copySingleCode = async (code: string, id: number) => {
    try { await navigator.clipboard.writeText(code); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); }
    catch { toast.warning('当前浏览器不允许复制，请手动选择兑换码'); }
  };

  const getBookName = (bookId: number, bookName?: string) => {
    if (bookName) return bookName;
    const b = books.find((b) => b.id === bookId);
    return b?.name || `书#${bookId}`;
  };

  const formatGrantType = (c: CodeItem) => {
    if (!c.grant_type || c.grant_type === 'permanent') return '永久';
    if (c.grant_type === 'period') return `包月 ${c.grant_days || 0} 天`;
    if (c.grant_type === 'times') return `次卡 ${c.grant_times || 0} 天`;
    return c.grant_type;
  };

  const exportCSV = () => {
    const header = '兑换码,绑定书籍,卡种,创建人,状态,创建时间,使用时间,备注';
    const rows = codes.map((c) =>
      [
        c.code,
        getBookName(c.book_id, c.book_name),
        formatGrantType(c),
        c.created_by_name || `#${c.created_by}`,
        STATUS_MAP[c.status]?.label || c.status,
        new Date(c.created_at).toLocaleDateString('zh-CN'),
        c.used_at ? new Date(c.used_at).toLocaleDateString('zh-CN') : '',
        c.batch_note || '',
      ].join(',')
    );
    const csv = '\uFEFF' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `兑换码_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="admin-legacy-page min-h-screen">
      <StaffWorkspaceHeader role="admin" title="书籍兑换码管理" subtitle="生成兑换码，学生兑换后解锁对应单词本" icon={Ticket} />

      <main className="admin-workspace-main">

        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: '未使用', value: stats.unused_codes, icon: Ticket, tone: 'green' },
              { label: '已使用', value: stats.used_codes, icon: Check, tone: 'blue' },
              { label: '已过期', value: stats.expired_codes, icon: Clock3, tone: 'orange' },
              { label: '已禁用', value: stats.disabled_codes, icon: Ban, tone: 'violet' },
            ].map((item) => (
              <div key={item.label} className="admin-stat-strip rounded-2xl p-4">
                <item.icon className={`mb-3 h-5 w-5 admin-tool-icon admin-tool-icon-${item.tone} rounded-lg p-1`} />
                <div className="text-2xl font-bold text-gray-800">{item.value}</div>
                <div className="text-sm text-gray-500">{item.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* 生成兑换码 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 sm:p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">生成兑换码</h2>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 items-stretch sm:items-end">
            <div>
              <label className="block text-sm text-gray-600 mb-1">数量</label>
              <input
                type="number"
                min={1} max={100}
                value={genCount}
                onChange={(e) => setGenCount(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full sm:w-24 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
              />
            </div>
            <div className="min-w-[200px]">
              <label className="block text-sm text-gray-600 mb-1">绑定单词本</label>
              <select
                value={genBookId}
                onChange={(e) => setGenBookId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
              >
                {books.length === 0 && <option value={0}>暂无单词本</option>}
                {books.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm text-gray-600 mb-1">备注</label>
              <input
                type="text"
                value={genNote}
                onChange={(e) => setGenNote(e.target.value)}
                placeholder="可选备注"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
              />
            </div>
            <div className="min-w-[140px]">
              <label className="block text-sm text-gray-600 mb-1">卡种</label>
              <select
                value={genGrantType}
                onChange={(e) => setGenGrantType(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
              >
                <option value="permanent">永久</option>
                <option value="period">包月</option>
                <option value="times">次卡</option>
              </select>
            </div>
            {genGrantType === 'period' && (
              <div className="min-w-[110px]">
                <label className="block text-sm text-gray-600 mb-1">有效天数</label>
                <input
                  type="number"
                  min={1} max={3650}
                  value={genGrantDays}
                  onChange={(e) => setGenGrantDays(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                />
              </div>
            )}
            {genGrantType === 'times' && (
              <div className="min-w-[110px]">
                <label className="block text-sm text-gray-600 mb-1">可用天数</label>
                <input
                  type="number"
                  min={1} max={1000}
                  value={genGrantTimes}
                  onChange={(e) => setGenGrantTimes(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                />
              </div>
            )}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleGenerate}
              disabled={generating || !genBookId}
              className={`px-6 py-2 rounded-lg font-medium text-white ${
                generating || !genBookId ? 'bg-gray-400' : 'bg-[#3976a9] hover:bg-[#2e628f]'
              }`}
            >
              {generating ? '生成中...' : '生成'}
            </motion.button>
          </div>

          {/* 生成结果 */}
          {genResult.length > 0 && (
            <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-green-700 font-medium">
                  已生成 {genResult.length} 个兑换码
                </span>
                <button
                  onClick={copyAllCodes}
                  className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                >
                  {copied ? '已复制!' : '复制全部'}
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto font-mono text-sm space-y-1">
                {genResult.map((c) => (
                  <div key={c.id} className="text-green-800">{c.code}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 兑换码列表 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800">兑换码列表</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={exportCSV}
                disabled={codes.length === 0}
                className="px-3 py-1.5 bg-[#3976a9] text-white rounded-lg text-sm hover:bg-[#2e628f] disabled:opacity-40"
              >
                导出CSV
              </button>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜兑换码或批次备注"
                  aria-label="搜索兑换码或批次备注"
                  className="w-52 rounded-lg border border-slate-300 py-1.5 pl-8 pr-8 text-sm focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/15"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="清空搜索"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <select
                value={filterStatus}
                onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="">全部状态</option>
                <option value="unused">未使用</option>
                <option value="used">已使用</option>
                <option value="expired">已过期</option>
                <option value="disabled">已禁用</option>
              </select>
            </div>
          </div>

          {debouncedSearch && (
            <p className="mb-3 text-xs text-slate-500">
              搜索「{debouncedSearch}」匹配 {total} 个兑换码
            </p>
          )}

          <div className="overflow-x-auto">
            <div className="sm:hidden space-y-2 pb-3">
              {codes.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">暂无兑换码</div> : codes.map((c) => (
                <article key={c.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3"><code className="font-mono text-xs font-semibold text-slate-800">{c.code}</code><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_MAP[c.status]?.color || ''}`}>{STATUS_MAP[c.status]?.label || c.status}</span></div>
                  <div className="mt-2 text-xs text-slate-500">{getBookName(c.book_id, c.book_name)} · {formatGrantType(c)} · {c.created_by_name || `#${c.created_by}`} · 创建于 {new Date(c.created_at).toLocaleDateString('zh-CN')}</div>
                  <div className="mt-3 flex gap-3 border-t border-slate-100 pt-2 text-xs font-semibold"><button onClick={() => copySingleCode(c.code, c.id)} className="text-[#3976a9]">{copiedId === c.id ? '已复制' : '复制'}</button>{c.status === 'unused' && <button onClick={() => handleDisable(c.id)} className="text-orange-600">禁用</button>}{c.status !== 'used' && <button onClick={() => handleDelete(c)} className="text-red-600">删除</button>}</div>
                </article>
              ))}
            </div>
            <div className="hidden sm:block">
            <table className="w-full min-w-[760px] whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-4">兑换码</th>
                  <th className="pb-2 pr-4">绑定书籍</th>
                  <th className="pb-2 pr-4">卡种</th>
                  <th className="pb-2 pr-4">创建人</th>
                  <th className="pb-2 pr-4">状态</th>
                  <th className="pb-2 pr-4">创建时间</th>
                  <th className="pb-2 pr-4">使用时间</th>
                  <th className="pb-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                    <td className="py-2.5 pr-4 font-mono text-xs">{c.code}</td>
                    <td className="py-2.5 pr-4">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                        {getBookName(c.book_id, c.book_name)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600 text-xs">
                      {formatGrantType(c)}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600 text-xs">
                      {c.created_by_name || `#${c.created_by}`}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_MAP[c.status]?.color || ''}`}>
                        {STATUS_MAP[c.status]?.label || c.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-500">
                      {new Date(c.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-500">
                      {c.used_at ? new Date(c.used_at).toLocaleDateString('zh-CN') : '-'}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copySingleCode(c.code, c.id)}
                          className="text-[#00D9FF] hover:text-blue-600 text-xs"
                        >
                          {copiedId === c.id ? '已复制' : '复制'}
                        </button>
                        {c.status === 'unused' && (
                          <button
                            onClick={() => handleDisable(c.id)}
                            className="text-orange-600 hover:text-orange-700 text-xs"
                            title="禁用后码失效但仍留在列表里"
                          >
                            禁用
                          </button>
                        )}
                        {/* 已使用的码不给删按钮:它是学生兑换记录的凭证(后端也会拒) */}
                        {c.status !== 'used' && (
                          <button
                            onClick={() => handleDelete(c)}
                            className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                            title="彻底删除,不可恢复"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {codes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400">
                      暂无兑换码
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded border text-sm disabled:opacity-40"
              >
                上一页
              </button>
              <span className="text-sm text-gray-500">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded border text-sm disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminSubscriptions;
