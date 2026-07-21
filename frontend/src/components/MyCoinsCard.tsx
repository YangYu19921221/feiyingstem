/**
 * 学生端-我的金币(金色横幅版,置于首页顶部醒目位置)
 * 显示总币数 + 今日单词王皇冠;点击展开明细弹窗(分页)。
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { getMyCoins, getMyWordKingStatus, type MyCoinTx } from '../api/coins';

const PAGE_SIZE = 20;

export default function MyCoinsCard() {
  const [balance, setBalance] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MyCoinTx[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isKing, setIsKing] = useState(false);  // 今天(实时)是不是单词王

  useEffect(() => {
    getMyCoins(1, 1).then((r) => setBalance(r.balance)).catch(() => {});
    getMyWordKingStatus().then((r) => setIsKing(r.is_word_king)).catch(() => {});
  }, []);

  const loadPage = useCallback((p: number) => {
    getMyCoins(p, PAGE_SIZE).then((r) => {
      setItems(r.items); setTotal(r.total); setBalance(r.balance); setPage(p);
    }).catch(() => {});
  }, []);

  const openDetail = () => { setOpen(true); loadPage(1); };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <motion.button
        onClick={openDetail}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.98 }}
        className="relative w-full rounded-3xl px-4 sm:px-6 py-5 text-left shadow-lg shadow-amber-500/20
                   bg-gradient-to-br from-amber-400 via-amber-400 to-yellow-300 border border-amber-300/50"
      >
        {/* 流光动效:单独裁剪层(不裁到探出的皇冠),斜向高光从左扫到右 */}
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
          <motion.span
            className="absolute inset-y-0 w-1/3 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/40 to-transparent"
            animate={{ left: ['-33%', '133%'] }}
            transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' }}
          />
        </span>

        <div className="relative flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            {/* 大金币 + 皇冠(shrink-0 不被压缩) */}
            <motion.div
              className="relative shrink-0 flex h-14 w-14 items-center justify-center rounded-full bg-white/30 backdrop-blur-sm text-3xl shadow-inner"
              animate={{ rotate: [0, -6, 6, 0] }}
              transition={{ duration: 3, repeat: Infinity, repeatDelay: 2 }}
            >
              🪙
              {isKing && (
                <span className="absolute -top-2 -right-1 text-lg drop-shadow z-10" title="今日单词王">👑</span>
              )}
            </motion.div>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-amber-900/80">
                <span className="whitespace-nowrap">我的金币</span>
                {isKing && (
                  <span className="whitespace-nowrap rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    👑 今日单词王
                  </span>
                )}
              </p>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="font-display font-numeric text-4xl font-bold leading-none text-white drop-shadow-sm">
                  {balance}
                </span>
                <span className="text-sm font-medium text-amber-900/70">枚</span>
              </div>
            </div>
          </div>

          {/* 右侧行动点:兑换奖励入口(shrink-0 + nowrap 防挤断) */}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="whitespace-nowrap rounded-full bg-white/90 px-3.5 py-2 text-sm font-bold text-amber-600 shadow-sm">
              🎁 兑换奖励
            </span>
            <span className="hidden sm:block whitespace-nowrap text-[11px] text-amber-900/60">完成作业+1 · 单词王+2</span>
          </div>
        </div>
      </motion.button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-1.5">
                🪙 我的金币:<span className="text-amber-500 font-numeric text-lg">{balance}</span> 枚
              </h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm">关闭</button>
            </div>

            <div className="space-y-1.5">
              {items.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2 border-b border-black/[0.04]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {t.source === 'word_king'
                        ? <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">👑 {t.king_label || '单词王'}</span>
                        : <span className="text-xs text-gray-500">{t.source_label}</span>}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                      {t.reason || ''} · {t.created_at.slice(5, 16).replace('T', ' ')}
                    </p>
                    {(t.source === 'task' || t.source === 'word_king') && (t.day_tasks_done != null || t.day_words != null) && (
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        当天完成 <span className="font-semibold text-orange-500">{t.day_tasks_done ?? 0}</span> 个任务 · 学了 <span className="font-semibold text-emerald-600">{t.day_words ?? 0}</span> 个单词
                      </p>
                    )}
                  </div>
                  <span className={`font-numeric font-bold text-sm shrink-0 ${t.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {t.amount >= 0 ? `+${t.amount}` : t.amount} 🪙
                  </span>
                </div>
              ))}
              {items.length === 0 && <p className="text-center text-xs text-gray-400 py-8">还没有金币记录,快去完成作业赚金币吧!</p>}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4 text-sm">
                <button disabled={page <= 1} onClick={() => loadPage(page - 1)}
                  className="px-3 py-1 rounded-lg border border-black/10 disabled:opacity-40">上一页</button>
                <span className="text-xs text-gray-500">{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => loadPage(page + 1)}
                  className="px-3 py-1 rounded-lg border border-black/10 disabled:opacity-40">下一页</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
