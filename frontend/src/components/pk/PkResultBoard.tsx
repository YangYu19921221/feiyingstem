// Stub — replaced in T15.

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

export default function PkResultBoard({ ranking, meId, onExit }: Props) {
  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold text-center mb-4">PK 结束</h1>
      <ol className="space-y-2">
        {ranking.map((r) => (
          <li
            key={r.user_id}
            className={`flex justify-between p-3 rounded ${
              r.user_id === meId ? 'bg-blue-50' : 'bg-gray-50'
            }`}
          >
            <span>
              #{r.rank} {r.nickname ?? `用户${r.user_id}`}
            </span>
            <span className="tabular-nums">{r.final_score} 分</span>
          </li>
        ))}
      </ol>
      <button
        onClick={onExit}
        className="mt-6 w-full py-2 bg-blue-500 text-white rounded-lg font-medium"
      >
        退出
      </button>
    </div>
  );
}
