import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Phone, CheckCircle, Clock } from 'lucide-react';
import { toast } from '../components/Toast';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface Lead {
  id: number;
  session_id: string;
  grade_level: string;
  avg_score: number;
  grade_label: string;
  source: string | null;
  phone: string | null;
  phone_verified: boolean;
  converted: boolean;
  notes: string | null;
  created_at: string;
}

interface SourceStat {
  source: string | null;
  total: number;
  phone_count: number;
  converted_count: number;
}

// 渠道单一事实源: 复制按钮/标签映射都从这张表走,加渠道只改这里
// (捕获端与后端是自由字符串,未知渠道照样入库进战报,只是标签走兜底)
const CHANNELS = [
  { id: 'douyin', label: '🎵 抖音', btn: 'bg-gray-900' },
  { id: 'shipinhao', label: '📺 视频号', btn: 'bg-green-600' },
  { id: 'referral', label: '🤝 老带新', btn: 'bg-amber-500' },
] as const;
const SOURCE_LABELS: Record<string, string> = Object.fromEntries(CHANNELS.map(c => [c.id, c.label]));
const sourceLabel = (s: string | null) => (s ? SOURCE_LABELS[s] || `🔗 ${s}` : '🌱 自然流量');

const TeacherLeads = () => {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [phoneCount, setPhoneCount] = useState(0);
  const [convertedCount, setConvertedCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [todayOnly, setTodayOnly] = useState(false);
  // null=全部;'none'=自然流量;其余=渠道标识(直接存 API 的 wire 值,不再二次翻译)
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [sourceStats, setSourceStats] = useState<SourceStat[]>([]);
  const [orgCode, setOrgCode] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const reqSeq = useRef(0);  // 快速切换过滤时丢弃过期响应

  const token = localStorage.getItem('access_token');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadLeads(); }, [page, phoneOnly, todayOnly, sourceFilter]);

  const loadLeads = async () => {
    const seq = ++reqSeq.current;
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/assessment/leads`, {
        headers,
        params: { page, page_size: 20, phone_only: phoneOnly, today_only: todayOnly, source: sourceFilter ?? undefined },
      });
      if (seq !== reqSeq.current) return;  // 已有更新的请求,丢弃本次
      setLeads(res.data.leads);
      setTotal(res.data.total);
      setPhoneCount(res.data.phone_count ?? res.data.leads.filter((l: Lead) => l.phone_verified).length);
      setConvertedCount(res.data.converted_count ?? res.data.leads.filter((l: Lead) => l.converted).length);
      setSourceStats(res.data.source_stats ?? []);
      setOrgCode(res.data.org_code ?? null);
    } catch (error) {
      console.error('加载线索失败:', error);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  // 直播/推广专属测评链接(放小风车/私域,线索自动归渠道)。
  // 机构码来自 /leads 接口(登录教师的机构),不能从页面 URL 猜——
  // 机构教师复制的链接必须带 org,否则线索归直营且本机构看不到
  const copyChannelLink = (src: string, label: string) => {
    const url = `${window.location.origin}/assessment?src=${src}${orgCode ? `&org=${orgCode}` : ''}`;
    if (!navigator.clipboard) { window.prompt(`${label}链接(请手动复制):`, url); return; }
    navigator.clipboard.writeText(url)
      .then(() => toast.success(`${label}链接已复制`))
      .catch(() => window.prompt(`${label}链接(请手动复制):`, url));
  };

  const handleSaveNotes = async (id: number) => {
    try {
      await axios.put(`${API_BASE_URL}/assessment/leads/${id}/notes`, { notes: editNotes }, { headers });
      setEditingId(null);
      loadLeads();
    } catch (error) {
      toast.error('保存失败');
    }
  };

  const handleToggleConverted = async (lead: Lead) => {
    try {
      await axios.put(`${API_BASE_URL}/assessment/leads/${lead.id}/notes`, { converted: !lead.converted }, { headers });
      loadLeads();
    } catch (error) {
      toast.error('操作失败');
    }
  };

  const gradeColor = (label: string) => {
    if (label === '优秀') return 'bg-green-100 text-green-700';
    if (label === '良好') return 'bg-blue-100 text-blue-700';
    if (label === '需提升') return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/teacher/dashboard')} className="p-2 hover:bg-gray-100 rounded-lg">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h1 className="text-xl font-bold text-gray-800">测评线索管理</h1>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-orange-600">
              <input type="checkbox" checked={todayOnly} onChange={e => { setTodayOnly(e.target.checked); setPage(1); }} className="rounded" />
              只看今天(下播战报)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={phoneOnly} onChange={e => { setPhoneOnly(e.target.checked); setPage(1); }} className="rounded" />
              只看留号
            </label>
            <span className="text-sm text-gray-500">共 {total} 条</span>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 统计卡片 */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="bg-white rounded-xl p-4 shadow-sm text-center">
            <p className="text-3xl font-bold text-gray-800">{total}</p>
            <p className="text-sm text-gray-500">总测评数</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm text-center">
            <p className="text-3xl font-bold text-green-600">{phoneCount}</p>
            <p className="text-sm text-gray-500">已留号</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm text-center">
            <p className="text-3xl font-bold text-indigo-600">{convertedCount}</p>
            <p className="text-sm text-gray-500">已转化</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm text-center">
            <p className="text-3xl font-bold text-orange-600">
              {total > 0 ? Math.round(phoneCount / total * 100) : 0}%
            </p>
            <p className="text-sm text-gray-500">留号率</p>
          </div>
        </div>

        {/* 分渠道战报: 直播下播直接看哪个平台成交强;点卡片过滤列表 */}
        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-sm font-bold text-gray-700">
              📊 渠道战报{todayOnly ? '(今天)' : '(累计)'}
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-400">复制推广链接:</span>
              {CHANNELS.map(c => (
                <button key={c.id} onClick={() => copyChannelLink(c.id, c.label)}
                  className={`px-2.5 py-1 rounded-lg text-white hover:opacity-80 ${c.btn}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {sourceStats.length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-2">暂无数据——把渠道链接挂到直播间小风车,线索会自动分渠道</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setSourceFilter(null); setPage(1); }}
                className={`px-3 py-2 rounded-xl text-sm border transition ${
                  sourceFilter === null ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
              >
                全部渠道
              </button>
              {sourceStats.map(s => {
                const key = s.source ?? 'none';  // wire 值: 'none'=自然流量
                const active = sourceFilter === key;
                return (
                  <button
                    key={key}
                    onClick={() => { setSourceFilter(active ? null : key); setPage(1); }}
                    className={`px-3 py-2 rounded-xl text-sm border transition text-left ${
                      active ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-200'}`}
                  >
                    <span className={`font-semibold ${active ? 'text-indigo-700' : 'text-gray-700'}`}>{sourceLabel(s.source)}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      测评 <b className="text-gray-800">{s.total}</b>
                      <span className="mx-1">·</span>留号 <b className="text-green-600">{s.phone_count}</b>
                      <span className="mx-1">·</span>转化 <b className="text-indigo-600">{s.converted_count}</b>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 线索列表 */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="text-center py-12 text-gray-400">加载中...</div>
          ) : leads.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-gray-400">暂无测评线索</p>
              <p className="text-sm text-gray-300 mt-1">家长扫码测评后，线索将自动出现在这里</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">时间</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">渠道</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">年级</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">评分</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">评级</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">手机号</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">状态</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">备注</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">操作</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <motion.tr
                    key={lead.id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="border-b border-gray-100 hover:bg-indigo-50/30"
                  >
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {lead.created_at ? new Date(lead.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }) : '-'}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-600 whitespace-nowrap">{sourceLabel(lead.source)}</td>
                    <td className="py-3 px-4 text-sm">{lead.grade_level || '-'}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`font-bold ${lead.avg_score >= 80 ? 'text-green-600' : lead.avg_score >= 60 ? 'text-blue-600' : 'text-red-500'}`}>
                        {lead.avg_score?.toFixed(0) || '-'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {lead.grade_label ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${gradeColor(lead.grade_label)}`}>
                          {lead.grade_label}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {lead.phone ? (
                        <span className="flex items-center gap-1 text-green-600">
                          <Phone className="w-3 h-3" />
                          {lead.phone}
                        </span>
                      ) : (
                        <span className="text-gray-300">未留号</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {lead.converted ? (
                        <span className="flex items-center justify-center gap-1 text-green-600 text-xs"><CheckCircle className="w-3 h-3" />已转化</span>
                      ) : lead.phone_verified ? (
                        <span className="flex items-center justify-center gap-1 text-orange-500 text-xs"><Clock className="w-3 h-3" />待跟进</span>
                      ) : (
                        <span className="text-gray-300 text-xs">未留号</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {editingId === lead.id ? (
                        <div className="flex gap-1">
                          <input
                            value={editNotes} onChange={e => setEditNotes(e.target.value)}
                            className="flex-1 px-2 py-1 border rounded text-sm" placeholder="添加备注"
                          />
                          <button onClick={() => handleSaveNotes(lead.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs">保存</button>
                          <button onClick={() => setEditingId(null)} className="px-2 py-1 bg-gray-200 rounded text-xs">取消</button>
                        </div>
                      ) : (
                        <span
                          onClick={() => { setEditingId(lead.id); setEditNotes(lead.notes || ''); }}
                          className="text-sm text-gray-500 cursor-pointer hover:text-indigo-600"
                        >
                          {lead.notes || '点击添加'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {lead.phone_verified && (
                        <button
                          onClick={() => handleToggleConverted(lead)}
                          className={`px-3 py-1 rounded text-xs font-medium ${
                            lead.converted ? 'bg-gray-200 text-gray-600' : 'bg-green-500 text-white'
                          }`}
                        >
                          {lead.converted ? '取消转化' : '标记转化'}
                        </button>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 分页 */}
          {total > 20 && (
            <div className="flex justify-center gap-2 py-4">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-30">上一页</button>
              <span className="px-3 py-1 text-sm text-gray-500">{page} / {Math.ceil(total / 20)}</span>
              <button disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border rounded disabled:opacity-30">下一页</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeacherLeads;
