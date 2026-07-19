/**
 * 学生端-我的金币卡片
 * 显示总币数;点击展开弹窗看获得/消费明细(分页)。单词王来源带 👑 标识。
 */
import { useState, useEffect, useCallback } from 'react';
import { getMyCoins, getMyWordKingStatus, type MyCoinTx } from '../api/coins';

const PAGE_SIZE = 20;

export default function MyCoinsCard() {
  const [balance, setBalance] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MyCoinTx[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [isKing, setIsKing] = useState(false);  // 今天(实时)是不是单词王

  // 只拉余额(轻量),明细等点开再拉
  useEffect(() => {
    getMyCoins(1, 1).then((r) => { setBalance(r.balance); setLoaded(true); }).catch(() => setLoaded(true));
    getMyWordKingStatus().then((r) => setIsKing(r.is_word_king)).catch(() => {});
  }, []);

  const loadPage = useCallback((p: number) => {
    getMyCoins(p, PAGE_SIZE).then((r) => {
      setItems(r.items); setTotal(r.total); setBalance(r.balance); setPage(p);
    }).catch(() => {});
  }, []);

  const openDetail = () => { setOpen(true); loadPage(1); };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 从没有任何金币记录时不显示卡片(避免空占位)
  if (loaded && balance === 0 && total === 0) {
    // 仍显示一个 0 币卡,给孩子"去赚币"的目标感
  }

  return (
    <>
      <button
        onClick={openDetail}
        className="w-full card-soft rounded-2xl px-5 py-4 flex items-center justify-between hover:bg-black/[0.02] transition"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl relative">
            🪙
            {isKing && <span className="absolute -top-2 -right-1 text-base" title="今日单词王">👑</span>}
          </span>
          <div className="text-left">
            <p className="text-ink font-semibold text-sm flex items-center gap-1.5">
              我的金币
              {isKing && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">👑 今日单词王</span>}
            </p>
            <p className="text-ink-mute text-xs">完成作业得 1 币 · 单词王得 2 币</p>
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display font-bold text-3xl text-amber-500 font-numeric">{balance}</span>
          <span className="text-xs text-ink-mute">明细 →</span>
        </div>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">🪙 我的金币:{balance}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm">关闭</button>
            </div>

            <div className="space-y-1.5">
              {items.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2 border-b border-black/[0.04]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {t.source === 'word_king'
                        ? <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">👑 单词王</span>
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
