import type { PkPlayer } from '../../api/pk';

interface Props {
  players: PkPlayer[];
  totalQuestions: number;
  hostId: number;
  meId: number;
}

export default function PkPlayerList({ players, totalQuestions, hostId, meId }: Props) {
  return (
    <div className="space-y-2">
      {players.map((p) => {
        const pct = totalQuestions > 0
          ? Math.round((p.current_word_idx / totalQuestions) * 100)
          : 0;
        return (
          <div
            key={p.user_id}
            className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg"
          >
            <span className="font-medium">{p.nickname}</span>
            {p.user_id === hostId && (
              <span className="text-xs bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded">
                房主
              </span>
            )}
            {p.user_id === meId && (
              <span className="text-xs bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded">
                我
              </span>
            )}
            {!p.online && <span className="text-xs text-red-500">掉线</span>}
            <div className="flex-1 bg-gray-200 rounded h-2 overflow-hidden">
              <div
                className="bg-green-500 h-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-sm tabular-nums text-gray-600">
              {p.correct}/{p.correct + p.wrong}
            </span>
          </div>
        );
      })}
    </div>
  );
}
