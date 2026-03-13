import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  getSubscriptionStats,
  generateCodes,
  listCodes,
  disableCode,
} from '../api/subscription';

interface Stats {
  total_codes: number;
  unused_codes: number;
  used_codes: number;
  expired_codes: number;
  disabled_codes: number;
  active_subscribers: number;
  expired_subscribers: number;
}

interface CodeItem {
  id: number;
  code: string;
  duration_days: number;
  status: string;
  created_at: string;
  code_expires_at: string;
  used_by: number | null;
  used_at: string | null;
  batch_note: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  unused: { label: '未使用', color: 'bg-green-100 text-green-700' },
  used: { label: '已使用', color: 'bg-blue-100 text-blue-700' },
  expired: { label: '已过期', color: 'bg-gray-100 text-gray-500' },
  disabled: { label: '已禁用', color: 'bg-red-100 text-red-600' },
};

const DURATION_OPTIONS = [
  { value: 30, label: '30天' },
  { value: 90, label: '90天' },
  { value: 180, label: '半年' },
  { value: 365, label: '一年' },
];

const AdminSubscriptions = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [genCount, setGenCount] = useState(10);
  const [genDuration, setGenDuration] = useState(30);
  const [genNote, setGenNote] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<CodeItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res: any = await getSubscriptionStats();
      setStats(res);
    } catch { /* ignore */ }
  }, []);

  const fetchCodes = useCallback(async () => {
    try {
      const params: any = { page, page_size: 20 };
      if (filterStatus) params.status = filterStatus;
      const res: any = await listCodes(params);
      setCodes(res.codes);
      setTotal(res.total);
    } catch { /* ignore */ }
  }, [page, filterStatus]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenResult([]);
    try {
      const res: any = await generateCodes({
        count: genCount,
        duration_days: genDuration,
        batch_note: genNote || undefined,
      });
      setGenResult(res);
      fetchStats();
      fetchCodes();
    } catch { /* ignore */ }
    setGenerating(false);
  };

  const handleDisable = async (codeId: number) => {
    if (!confirm('确定要禁用此兑换码吗？')) return;
    try {
      await disableCode(codeId);
      fetchCodes();
      fetchStats();
    } catch { /* ignore */ }
  };

  const copyAllCodes = () => {
    const text = genResult.map((c) => c.code).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copySingleCode = (code: string, id: number) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const exportCSV = () => {
    const header = '兑换码,时长(天),状态,创建时间,使用时间,备注';
    const rows = codes.map((c) =>
      [
        c.code,
        c.duration_days,
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
    <div className="min-h-screen bg-gradient-to-br from-[#FFF8F0] to-[#FFE8D6] p-6">
      <div className="max-w-6xl mx-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">🎫 订阅管理</h1>
            <p className="text-gray-500 text-sm mt-1">管理兑换码和订阅状态</p>
          </div>
          <button
            onClick={() => navigate('/admin/dashboard')}
            className="px-4 py-2 bg-white rounded-lg shadow text-gray-600 hover:bg-gray-50"
          >
            返回
          </button>
        </div>

        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: '未使用', value: stats.unused_codes, icon: '🎟️', bg: 'bg-green-50' },
              { label: '已使用', value: stats.used_codes, icon: '✅', bg: 'bg-blue-50' },
              { label: '活跃订阅', value: stats.active_subscribers, icon: '👥', bg: 'bg-orange-50' },
              { label: '过期订阅', value: stats.expired_subscribers, icon: '⏰', bg: 'bg-gray-50' },
            ].map((item) => (
              <div key={item.label} className={`${item.bg} rounded-xl p-4 border`}>
                <div className="text-2xl mb-1">{item.icon}</div>
                <div className="text-2xl font-bold text-gray-800">{item.value}</div>
                <div className="text-sm text-gray-500">{item.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* 生成兑换码 */}
        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">生成兑换码</h2>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm text-gray-600 mb-1">数量</label>
              <input
                type="number"
                min={1} max={100}
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value))}
                className="w-24 px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">时长</label>
              <select
                value={genDuration}
                onChange={(e) => setGenDuration(Number(e.target.value))}
                className="px-3 py-2 border rounded-lg"
              >
                {DURATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
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
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleGenerate}
              disabled={generating}
              className={`px-6 py-2 rounded-lg font-medium text-white ${
                generating ? 'bg-gray-400' : 'bg-[#FF6B35] hover:bg-[#e55a2b]'
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
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800">兑换码列表</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={exportCSV}
                disabled={codes.length === 0}
                className="px-3 py-1.5 bg-[#FF6B35] text-white rounded-lg text-sm hover:bg-[#e55a2b] disabled:opacity-40"
              >
                导出CSV
              </button>
              <select
                value={filterStatus}
                onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
                className="px-3 py-1.5 border rounded-lg text-sm"
              >
                <option value="">全部状态</option>
                <option value="unused">未使用</option>
                <option value="used">已使用</option>
                <option value="expired">已过期</option>
                <option value="disabled">已禁用</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-4">兑换码</th>
                  <th className="pb-2 pr-4">时长</th>
                  <th className="pb-2 pr-4">状态</th>
                  <th className="pb-2 pr-4">创建时间</th>
                  <th className="pb-2 pr-4">使用时间</th>
                  <th className="pb-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-mono text-xs">{c.code}</td>
                    <td className="py-2.5 pr-4">{c.duration_days}天</td>
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
                            className="text-red-500 hover:text-red-700 text-xs"
                          >
                            禁用
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
      </div>
    </div>
  );
};

export default AdminSubscriptions;
