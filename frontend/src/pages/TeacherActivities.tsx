import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface RecentActivity {
  type: 'homework' | 'unit';
  student_name: string;
  title: string;
  score: number | null;
  time: string; // 北京时间 MM-DD HH:MM,后端已格式化
}

const DAY_OPTIONS = [
  { value: 1, label: '今天' },
  { value: 3, label: '近3天' },
  { value: 7, label: '近7天' },
  { value: 30, label: '近30天' },
];

/**
 * 教师端 - 学生动态列表
 * 从仪表板「今日动态」卡片点进来,完整列表 + 按学生/作业/单元搜索
 */
const TeacherActivities = () => {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(3);
  const [query, setQuery] = useState('');
  // 防抖:停止输入 300ms 后才发请求
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const loadActivities = useCallback(async (d: number, q: string) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/teacher/recent-activities`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { days: d, limit: 200, q: q.trim() },
      });
      setActivities(response.data.activities || []);
    } catch (error) {
      console.error('加载动态失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActivities(days, query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const handleSearchChange = (v: string) => {
    setQuery(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadActivities(days, v), 300);
  };

  // 按日期分组展示(time 格式 "MM-DD HH:MM")
  const grouped = activities.reduce<Record<string, RecentActivity[]>>((acc, a) => {
    const day = a.time.slice(0, 5);
    (acc[day] = acc[day] || []).push(a);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/teacher/dashboard')}
            className="p-2 -ml-2 hover:bg-gray-100 rounded-lg transition"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2 flex-1">
            <span>🔔</span> 学生动态
          </h1>
          <button
            onClick={() => navigate('/teacher/homework')}
            className="text-sm px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition whitespace-nowrap"
          >
            📘 作业管理 →
          </button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* 搜索 + 时间范围 */}
        <div className="bg-white rounded-2xl p-4 shadow-md mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
              <input
                type="text"
                value={query}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="搜索学生姓名 / 作业标题 / 书名 / 单元名"
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
              />
            </div>
            <div className="flex gap-1.5">
              {DAY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDays(opt.value)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap ${
                    days === opt.value
                      ? 'bg-blue-500 text-white shadow'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 动态列表(按日分组) */}
        {loading ? (
          <div className="text-center text-gray-500 py-16">加载中...</div>
        ) : activities.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-md">
            <div className="text-5xl mb-3">🌱</div>
            <p className="text-gray-600">
              {query.trim() ? '没有匹配的动态,换个关键词试试' : '这段时间还没有学生完成作业或单元'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([day, items]) => (
              <div key={day}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-sm font-bold text-gray-500">{day}</span>
                  <span className="text-xs text-gray-400">{items.length} 条</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                <div className="bg-white rounded-2xl shadow-md divide-y divide-gray-50 overflow-hidden">
                  {items.map((act, index) => (
                    <div key={index} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition">
                      <span className="text-lg shrink-0">{act.type === 'homework' ? '📘' : '✅'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800">
                          <span className="font-semibold">{act.student_name}</span>
                          {act.type === 'homework' ? ' 完成了作业 ' : ' 学完了 '}
                          <span className="font-medium">{act.title}</span>
                        </p>
                      </div>
                      {act.score !== null && (
                        <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-full ${
                          act.score >= 80
                            ? 'bg-green-100 text-green-700'
                            : act.score >= 60
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-600'
                        }`}>
                          {act.score}分
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-gray-400 font-mono">{act.time.slice(6)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {activities.length >= 200 && (
              <p className="text-center text-xs text-gray-400">最多显示 200 条,可用搜索缩小范围</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherActivities;
