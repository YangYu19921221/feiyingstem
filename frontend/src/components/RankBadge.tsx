import { motion } from 'framer-motion';

interface RankInfo {
  tier: string;
  tier_label: string;
  tier_emoji: string;
  rank_points: number;
  next_tier?: {
    name: string;
    label: string;
    min_points: number;
  } | null;
  progress_to_next: number;
  total_score: number;
}

const TIER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  bronze: { bg: 'bg-amber-900/20', border: 'border-amber-700', text: 'text-amber-700' },
  silver: { bg: 'bg-gray-200/40', border: 'border-gray-400', text: 'text-gray-500' },
  gold: { bg: 'bg-yellow-100', border: 'border-yellow-500', text: 'text-yellow-600' },
  platinum: { bg: 'bg-cyan-50', border: 'border-cyan-400', text: 'text-cyan-600' },
  diamond: { bg: 'bg-blue-50', border: 'border-blue-400', text: 'text-blue-500' },
  king: { bg: 'bg-purple-50', border: 'border-purple-500', text: 'text-purple-600' },
};

interface RankBadgeProps {
  rank: RankInfo;
  size?: 'sm' | 'md' | 'lg';
  showProgress?: boolean;
}

export default function RankBadge({ rank, size = 'md', showProgress = false }: RankBadgeProps) {
  const colors = TIER_COLORS[rank.tier] || TIER_COLORS.bronze;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-3 py-1 text-sm gap-1.5',
    lg: 'px-4 py-1.5 text-base gap-2',
  };

  return (
    <div className="inline-flex flex-col items-center">
      <motion.div
        className={`inline-flex items-center rounded-full border-2 ${colors.bg} ${colors.border} ${sizeClasses[size]}`}
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.05 }}
      >
        <span>{rank.tier_emoji}</span>
        <span className={`font-bold ${colors.text}`}>{rank.tier_label}</span>
      </motion.div>

      {showProgress && rank.next_tier && (
        <div className="mt-2 w-full max-w-[160px]">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{rank.rank_points}分</span>
            <span>{rank.next_tier.label} {rank.next_tier.min_points}分</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${colors.border.replace('border', 'bg')}`}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(rank.progress_to_next * 100, 100)}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export type { RankInfo };
