/**
 * 教师端 - 签到记录
 * 独立列表页:按班级/日期查(含历史),已签到表格分页展示,未签到红色名单
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface CheckedRow { user_id: number; student_name: string; class_name?: string; checkin_time: string | null; rank: number }
interface ClassSummary { class_id: number; class_name: string; total: number; checked: number }
interface CheckinData {
  class_id: number;
  class_name: string;
  date: string;
  total_students: number;
  checked_count: number;
  checked: CheckedRow[];
  unchecked: { user_id: number; student_name: string; class_name?: string }[];
  by_class?: ClassSummary[];
}
interface ClassOption { id: number; name: string; student_count: number }

const PAGE_SIZE = 20;
// classId 用 0 表示「全部班级」汇总视图
const ALL_CLASSES = 0;

const todayStr = () => new Date().toISOString().split('T')[0];

const TeacherCheckins = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // 返回目标:从实时课堂来的回实时课堂,否则回工作台
  const backTo = (location.state as any)?.from === 'live' ? '/teacher/live' : '/teacher/dashboard';
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState<number | null>(null);
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<CheckinData | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` });

  useEffect(() => {
    axios.get(`${API_BASE_URL}/teacher/classes`, { headers: authHeaders() })
      .then(r => {
        const list: ClassOption[] = Array.isArray(r.data) ? r.data : (r.data?.items ?? []);
        setClasses(list);
        // 默认进「全部班级」总览;没有班级时也能看到空态
        setClassId(ALL_CLASSES);
        if (list.length === 0) setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const load = useCallback(async (cid: number, d: string) => {
    setLoading(true);
    try {
      // cid=0 → 全部班级汇总端点;否则单班级
      const url = cid === ALL_CLASSES
        ? `${API_BASE_URL}/teacher/checkins`
        : `${API_BASE_URL}/teacher/classes/${cid}/checkins`;
      const r = await axios.get(url, {
        headers: authHeaders(),
        params: { target_date: d },
      });
      setData(r.data);
    } catch (e) {
      console.error('加载签到记录失败:', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (classId !== null) load(classId, date);
  }, [classId, date, load]);

  const shiftDate = (delta: number) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const next = d.toISOString().split('T')[0];
    if (next > todayStr()) return;
    setDate(next);
  };

  // 搜索过滤(已签 + 未签都过滤)
  const kw = query.trim().toLowerCase();
  const filteredChecked = useMemo(
    () => (data?.checked ?? []).filter(c => !kw || c.student_name.toLowerCase().includes(kw)),
    [data, kw]
  );
  const filteredUnchecked = useMemo(
    () => (data?.unchecked ?? []).filter(s => !kw || s.student_name.toLowerCase().includes(kw)),
    [data, kw]
  );
  const totalPages = Math.max(1, Math.ceil(filteredChecked.length / PAGE_SIZE));
  const paged = filteredChecked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, date, classId]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);

  const isToday = date === todayStr();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(backTo)} className="p-2 -ml-2 hover:bg-gray-100 rounded-lg transition">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2 flex-1">
            <span>📍</span> 签到记录
          </h1>
          {classes.length > 0 && (
            <select
              value={classId ?? ALL_CLASSES}
              onChange={e => setClassId(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value={ALL_CLASSES}>📋 全部班级</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* 日期 + 搜索工具栏 */}
        <div className="bg-white rounded-2xl p-4 shadow-md flex flex-col sm:flex-row gap-3 items-center">
          <div className="flex items-center gap-1.5">
            <button onClick={() => shiftDate(-1)} className="px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 transition">
              ← {isToday ? '昨天' : '前一天'}
            </button>
            <input
              type="date"
              value={date}
              max={todayStr()}
              onChange={e => e.target.value && setDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
            />
            <button
              onClick={() => shiftDate(1)}
              disabled={isToday}
              className="px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              后一天 →
            </button>
            {!isToday && (
              <button onClick={() => setDate(todayStr())} className="px-3 py-2 rounded-lg text-sm text-blue-600 hover:bg-blue-50 transition">
                回到今天
              </button>
            )}
          </div>
          <div className="relative flex-1 w-full">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索学生姓名"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
          </div>
        </div>

        {/* 汇总条:单班级视图时带「返回全部班级」按钮 */}
        {data && (
          <div className="flex items-center gap-3 px-1 flex-wrap">
            {classId !== ALL_CLASSES && (
              <button
                onClick={() => setClassId(ALL_CLASSES)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 transition font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                返回全部班级
              </button>
            )}
            <span className="text-sm text-gray-600">
              {isToday ? '今天' : data.date} · {data.class_name} · 已签到{' '}
              <span className={`font-bold font-mono ${data.checked_count === data.total_students ? 'text-green-600' : 'text-orange-500'}`}>
                {data.checked_count}/{data.total_students}
              </span>
            </span>
            {data.checked_count === data.total_students && data.total_students > 0 && (
              <span className="text-sm text-green-600">🎉 全员签到</span>
            )}
          </div>
        )}

        {/* 全部班级视图:各班签到率小卡(签到率低的排前面,点击跳到该班) */}
        {data && classId === ALL_CLASSES && (data.by_class?.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {data.by_class!.map(c => {
              const pct = c.total > 0 ? Math.round((c.checked / c.total) * 100) : 0;
              const full = c.checked === c.total && c.total > 0;
              return (
                <button
                  key={c.class_id}
                  onClick={() => setClassId(c.class_id)}
                  className={`text-left bg-white rounded-xl p-3 shadow-sm border transition hover:shadow-md ${
                    full ? 'border-green-200' : pct < 50 ? 'border-red-200' : 'border-gray-100'
                  }`}
                  title={`查看 ${c.class_name} 明细`}
                >
                  <p className="text-xs text-gray-500 truncate mb-1">{c.class_name}</p>
                  <p className="flex items-baseline gap-1.5">
                    <span className={`text-lg font-bold font-mono ${full ? 'text-green-600' : pct < 50 ? 'text-red-500' : 'text-orange-500'}`}>
                      {c.checked}/{c.total}
                    </span>
                    <span className="text-xs text-gray-400">{full ? '✅ 全签' : `${pct}%`}</span>
                  </p>
                  <div className="h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${full ? 'bg-green-400' : pct < 50 ? 'bg-red-400' : 'bg-orange-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-gray-500">加载中...</div>
        ) : !data ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-md text-gray-500">
            {classes.length === 0 ? '你还没有班级' : '加载失败'}
          </div>
        ) : (
          <>
            {/* 已签到表格 */}
            <div className="bg-white rounded-2xl shadow-md overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-100 text-left text-sm text-gray-500">
                    <th className="py-3 px-4 font-medium w-16 text-center">名次</th>
                    <th className="py-3 px-4 font-medium">学生</th>
                    {classId === ALL_CLASSES && <th className="py-3 px-4 font-medium hidden sm:table-cell">班级</th>}
                    <th className="py-3 px-4 font-medium text-right">签到时间</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {paged.map(c => (
                      <motion.tr
                        key={c.user_id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="border-b border-gray-50 hover:bg-blue-50/30 transition"
                      >
                        <td className="py-2.5 px-4 text-center">
                          {c.rank <= 3
                            ? <span className="text-lg">{['🥇', '🥈', '🥉'][c.rank - 1]}</span>
                            : <span className="text-sm font-mono text-gray-400">{c.rank}</span>}
                        </td>
                        <td className="py-2.5 px-4 text-sm font-medium text-gray-800">
                          {c.student_name}
                          {classId === ALL_CLASSES && c.class_name && (
                            <span className="sm:hidden text-xs text-gray-400 ml-1.5">· {c.class_name}</span>
                          )}
                        </td>
                        {classId === ALL_CLASSES && (
                          <td className="py-2.5 px-4 text-sm text-gray-500 hidden sm:table-cell">{c.class_name || '—'}</td>
                        )}
                        <td className="py-2.5 px-4 text-sm font-mono text-gray-500 text-right">{c.checkin_time || '—'}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {filteredChecked.length === 0 && (
                <div className="text-center py-10 text-sm text-gray-400">
                  {kw ? `没有匹配「${query.trim()}」的签到记录` : '这一天还没有人签到'}
                </div>
              )}
              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                  <span className="text-xs text-gray-400">第 {page}/{totalPages} 页 · 共 {filteredChecked.length} 人</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition"
                    >
                      ← 上一页
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition"
                    >
                      下一页 →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 未签到名单 */}
            {filteredUnchecked.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md p-4">
                <p className="text-sm font-semibold text-red-500 mb-2.5">
                  ❌ 未签到({filteredUnchecked.length} 人)
                </p>
                <div className="flex flex-wrap gap-2">
                  {filteredUnchecked.map(s => (
                    <span key={s.user_id} className="px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">
                      {s.student_name}
                      {classId === ALL_CLASSES && s.class_name && (
                        <span className="text-red-400 text-xs ml-1">· {s.class_name}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TeacherCheckins;
