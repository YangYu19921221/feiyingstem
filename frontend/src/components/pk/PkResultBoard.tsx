interface RankItem {
  user_id: number;
  nickname?: string;
  rank: number;
  correct: number;
  wrong: number;
  total_time_ms: number;
  accuracy: number;
  final_score: number;
}

interface Props {
  ranking: RankItem[];
  meId: number;
  onExit: () => void;
}

const RANK_EMOJI: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function PkResultBoard({ ranking, meId, onExit }: Props) {
  const me = ranking.find((r) => r.user_id === meId);

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold text-center mb-4">PK 结束</h1>

      {me && (
        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 border border-yellow-200 rounded-2xl p-5 mb-6 text-center shadow-sm">
          <p className="text-sm text-gray-500 mb-1">你的成绩</p>
          <p className="text-5xl font-bold text-orange-500 mb-1">
            {RANK_EMOJI[me.rank] ?? `#${me.rank}`}
          </p>
          <p className="text-lg font-semibold mb-2">第 {me.rank} 名</p>
          <div className="flex justify-around text-sm text-gray-600 mt-3">
            <div>
              <p className="text-xs text-gray-400">得分</p>
              <p className="font-semibold tabular-nums">{me.final_score}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">准确率</p>
              <p className="font-semibold tabular-nums">{me.accuracy.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">用时</p>
              <p className="font-semibold tabular-nums">
                {(me.total_time_ms / 1000).toFixed(1)}s
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="py-2 px-3 text-left font-medium text-gray-500">名次</th>
              <th className="py-2 px-3 text-left font-medium text-gray-500">玩家</th>
              <th className="py-2 px-3 text-right font-medium text-gray-500">得分</th>
              <th className="py-2 px-3 text-right font-medium text-gray-500">准确率</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((r) => (
              <tr
                key={r.user_id}
                className={`border-t border-gray-100 ${
                  r.user_id === meId ? 'bg-blue-50' : ''
                }`}
              >
                <td className="py-2 px-3 font-medium">
                  {RANK_EMOJI[r.rank] ?? r.rank}
                </td>
                <td className="py-2 px-3">
                  {r.nickname ?? `用户${r.user_id}`}
                  {r.user_id === meId && (
                    <span className="ml-2 text-xs bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded">
                      我
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-right tabular-nums font-medium">
                  {r.final_score}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                  {r.accuracy.toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={onExit}
        className="mt-6 w-full py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium transition"
      >
        退出
      </button>
    </div>
  );
}
