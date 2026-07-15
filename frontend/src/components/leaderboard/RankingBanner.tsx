import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import PictureFallback from '../PictureFallback';
import {
  getLeaderboard, type LeaderboardResponse,
} from '../../api/leaderboard';
import { TIER_THEME, RANK_TIER, encourage, type Tier } from './shared';

const EASE = [0.16, 1, 0.3, 1] as const;

const myUserId = (): number => {
  try { return JSON.parse(localStorage.getItem('user') || '{}').id ?? -1; }
  catch { return -1; }
};

/**
 * 首页顶部排名横幅：把「上榜」这件事的钩子放到学生一进首页就能看到的位置。
 * 默认看本周班级「词汇王」榜。自己拉数据、出错或无人时安静地不渲染，绝不拖垮首页。
 */
export default function RankingBanner() {
  const navigate = useNavigate();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const uid = myUserId();

  useEffect(() => {
    let cancelled = false;
    getLeaderboard('vocabulary', 'this_week', 'class')
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed) return null;

  // 骨架：保留高度，避免首页跳动
  if (!data) {
    return <div className="mb-10 h-[104px] rounded-2xl card-soft animate-pulse opacity-60" />;
  }
  // 数据结构异常或无人上榜时安静不渲染，绝不让首页崩（top 缺失会导致 .find 崩溃）
  const top = Array.isArray(data.top) ? data.top : [];
  if (!data.total_participants || top.length === 0) return null;

  const enc = encourage(data);
  const top3 = [1, 2, 3].map(r => top.find(e => e.rank === r));
  const scopeLabel = data.scope === 'class' ? (data.class_name || '本班') : '全机构';

  return (
    <motion.button
      onClick={() => navigate('/student/leaderboard')}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="group mb-10 w-full text-left rounded-2xl overflow-hidden relative bg-white"
      style={{
        border: '1px solid oklch(0.68 0.185 40 / 0.14)',
        boxShadow: '0 10px 30px -16px oklch(0.6 0.16 60 / 0.4)',
      }}
    >
      {/* 庆祝暖光 + 金色右侧渐隐 */}
      <div className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 50% 130% at 100% 0%, oklch(0.9 0.13 78 / 0.22), transparent 60%)' }} />

      <div className="relative flex items-center gap-4 md:gap-6 px-5 md:px-6 py-4">
        {/* 文案区 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-base">🏆</span>
            <span className="text-xs font-semibold text-ink-soft">本周{scopeLabel}光荣榜</span>
          </div>
          <p className="font-display text-lg md:text-xl font-semibold text-ink leading-snug truncate">
            {enc.headline}
          </p>
          <p className="text-xs md:text-sm text-accent-warm font-medium mt-1 truncate">
            {enc.hook ? `🎯 ${enc.hook}` : '点开看看谁在榜上 →'}
          </p>
        </div>

        {/* 迷你前三 */}
        <div className="hidden sm:flex items-end gap-1.5 shrink-0">
          {([2, 1, 3] as const).map(rank => {
            const e = top3[rank - 1];
            const tier: Tier = RANK_TIER[rank];
            const theme = TIER_THEME[tier];
            const isGold = rank === 1;
            return (
              <div key={rank} className="flex flex-col items-center"
                   style={{ width: isGold ? 56 : 44 }}>
                <div className="relative"
                  style={{ filter: `drop-shadow(0 3px 6px ${theme.glow})` }}>
                  {e ? (
                    <PictureFallback
                      src={`/champions/vocabulary-${tier}.webp`}
                      alt=""
                      className={`${isGold ? 'w-14 h-14' : 'w-11 h-11'} rounded-full object-cover select-none`}
                      style={{ border: `2px solid ${theme.frame}` }}
                      draggable={false}
                      onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                    />
                  ) : (
                    <div className={`${isGold ? 'w-14 h-14' : 'w-11 h-11'} rounded-full grid place-items-center text-ink-mute opacity-40`}
                         style={{ border: `2px dashed ${theme.frame}` }}>
                      <span className="text-xs">空</span>
                    </div>
                  )}
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[11px]">
                    {theme.crown}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <span className="text-ink-mute group-hover:text-accent-warm transition shrink-0 text-lg">→</span>
      </div>
    </motion.button>
  );
}
