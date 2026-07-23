import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { admin } from '../api/admin';
import type { AdminCompetitionOverview, AdminLeaderboardItem } from '../api/admin';
import { toast } from '../components/Toast';

type Board = 'overall' | 'daily' | 'weekly' | 'monthly';
const BOARDS: { key: Board; label: string }[] = [
  { key: 'overall', label: '总榜' },
  { key: 'daily', label: '日榜' },
  { key: 'weekly', label: '周榜' },
  { key: 'monthly', label: '月榜' },
];

const AdminCompetition = () => {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<AdminCompetitionOverview | null>(null);
  const [board, setBoard] = useState<Board>('overall');
  const [items, setItems] = useState<AdminLeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    admin.competitionOverview()
      .then(setOverview)
      .catch(() => toast.error('加载竞赛概览失败'));
  }, []);

  useEffect(() => {
    setLoading(true);
    admin.competitionLeaderboard(board, 50)
      .then((r) => setItems(r.items))
      .catch(() => toast.error('加载排行榜失败'))
      .finally(() => setLoading(false));
  }, [board]);

  const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`);

  return (
    <div className="min-h-screen bg-paper">
      <nav className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <button onClick={() => navigate('/admin')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-slate-50">← 返回管理中心</button>
          <h1 className="text-xl font-bold text-gray-800">🏆 单词比赛</h1>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* 概览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-blue-600">{overview?.participants ?? '—'}</div>
            <div className="text-sm text-gray-500 mt-1">参与人数</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-orange-500">{overview?.total_answers ?? '—'}</div>
            <div className="text-sm text-gray-500 mt-1">总答题数</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-green-600">{overview ? `${overview.avg_accuracy}%` : '—'}</div>
            <div className="text-sm text-gray-500 mt-1">平均正确率</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-purple-600">{overview?.active_seasons ?? '—'}</div>
            <div className="text-sm text-gray-500 mt-1">活跃赛季</div>
          </div>
        </div>

        {/* 排行榜 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">排行榜</h2>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {BOARDS.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setBoard(b.key)}
                  className={`px-3 py-1 rounded-md text-sm transition ${
                    board === b.key ? 'bg-white shadow-sm text-[#3976a9] font-semibold' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="px-6 py-10 text-center text-gray-400">加载中…</div>
          ) : items.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-400">暂无排行数据</div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[700px] whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">排名</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">学生</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">积分</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">答题数</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">正确率</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">最高连击</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((it) => (
                  <tr key={it.user_id} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4 text-sm font-bold text-gray-700">{medal(it.rank)}</td>
                    <td className="px-6 py-4 text-sm">
                      <div className="font-medium text-gray-900">{it.full_name}</div>
                      <div className="text-xs text-gray-400">{it.username}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-semibold text-orange-600">{it.score}</td>
                    <td className="px-6 py-4 text-sm text-right text-gray-600">{it.questions_answered}</td>
                    <td className="px-6 py-4 text-sm text-right text-gray-600">{it.accuracy}%</td>
                    <td className="px-6 py-4 text-sm text-right text-gray-600">{it.max_combo}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminCompetition;
