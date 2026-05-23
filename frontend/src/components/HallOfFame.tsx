/**
 * 班级光荣榜（学生 Dashboard 顶部）
 *
 * 横向 3 张英雄卡片：满分王 / 速度之王 / 进步之星
 * 移动端纵向 stack
 *
 * - 学生未加班级 → 显示空状态引导
 * - 某项空缺 → 显示灰色占位卡片 + 鼓励文案
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getClassHallOfFame, type HallOfFameResponse, type ChampionItem } from '../api/hallOfFame';
import { getHeroById, pickEncourageHero } from '../utils/hero';

const TIER_THEME = {
  perfect_king: {
    title: '满分王',
    icon: '👑',
    gradient: 'from-yellow-400 via-orange-400 to-red-500',
    border: 'border-yellow-400',
  },
  speed_king: {
    title: '速度之王',
    icon: '⚡',
    gradient: 'from-cyan-400 via-blue-500 to-indigo-600',
    border: 'border-cyan-400',
  },
  progress_star: {
    title: '进步之星',
    icon: '📈',
    gradient: 'from-pink-400 via-purple-500 to-indigo-500',
    border: 'border-pink-400',
  },
} as const;

type ChampionKey = keyof typeof TIER_THEME;

function ChampionCard({ kind, champion }: { kind: ChampionKey; champion: ChampionItem | null }) {
  const theme = TIER_THEME[kind];
  const [imgError, setImgError] = useState(false);
  const encourageHero = pickEncourageHero();

  if (!champion) {
    return (
      <div className={`relative rounded-2xl bg-white border-2 border-dashed ${theme.border} p-4 flex flex-col items-center text-center min-h-[220px] justify-center`}>
        <div className="text-3xl mb-2 opacity-40">{theme.icon}</div>
        <div className="font-bold text-gray-500 mb-1">{theme.title}</div>
        <div className="text-xs text-gray-400 px-2">本月空缺<br/>加油成为第一人！</div>
        {!imgError && (
          <img
            src={encourageHero.imageUrl}
            alt=""
            aria-hidden
            onError={() => setImgError(true)}
            className="absolute bottom-2 right-2 w-12 h-12 rounded-full object-cover opacity-50"
          />
        )}
      </div>
    );
  }

  const hero = getHeroById(champion.hero_id);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      className={`relative rounded-2xl overflow-hidden shadow-lg border-2 ${theme.border} bg-white min-h-[220px]`}
    >
      <div className={`bg-gradient-to-r ${theme.gradient} px-3 py-2 text-white flex items-center gap-2`}>
        <span className="text-xl">{theme.icon}</span>
        <span className="font-bold text-sm">{theme.title}</span>
      </div>
      <div className="relative h-32 overflow-hidden bg-gray-100">
        {!imgError ? (
          <img
            src={hero.imageUrl}
            alt={hero.name}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-gray-200 to-gray-300">
            🏆
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      </div>
      <div className="p-3">
        <div className="font-bold text-gray-800 truncate">{champion.nickname}</div>
        <div className="text-xs text-gray-500 mt-1">{champion.metric_label}</div>
      </div>
    </motion.div>
  );
}


export default function HallOfFame() {
  const [data, setData] = useState<HallOfFameResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    getClassHallOfFame()
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl bg-white p-4 shadow animate-pulse h-[260px]" />
    );
  }
  if (error || !data) return null;

  if (!data.class_id) {
    return (
      <div className="rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-orange-200 p-4 text-center text-gray-600">
        <div className="text-3xl mb-1">🏫</div>
        <div className="font-medium">你还没有加入班级哦</div>
        <div className="text-xs text-gray-500 mt-1">联系老师把你加进班级，就能看到光荣榜</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-gray-800">
          🏆 {data.class_name} · 本月光荣榜
        </h3>
        <span className="text-xs text-gray-400">{data.period}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ChampionCard kind="perfect_king" champion={data.champions.perfect_king} />
        <ChampionCard kind="speed_king" champion={data.champions.speed_king} />
        <ChampionCard kind="progress_star" champion={data.champions.progress_star} />
      </div>
    </div>
  );
}
