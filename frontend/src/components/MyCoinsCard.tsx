/**
 * 学生端-我的金币(金色横幅版,置于首页顶部醒目位置)
 * 显示总币数 + 今日单词王皇冠;点击展开明细弹窗(分页)。
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  getMyCoins, getMyWordKingStatus, getMyCoinsToday, getWordKingRace,
  type MyCoinTx, type MyCoinsToday, type WordKingRace,
} from '../api/coins';
import RedeemShopModal from './RedeemShopModal';
import CoinRulesModal from './CoinRulesModal';
import coinGold from '../assets/coin-gold.webp';

const PAGE_SIZE = 20;

export default function MyCoinsCard() {
  const [balance, setBalance] = useState(0);
  const [open, setOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);  // 兑换商城弹窗
  const [rulesOpen, setRulesOpen] = useState(false);
  const [items, setItems] = useState<MyCoinTx[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isKing, setIsKing] = useState(false);  // 今天(实时)是不是单词王
  const [today, setToday] = useState<MyCoinsToday | null>(null);
  const [race, setRace] = useState<WordKingRace | null>(null);

  useEffect(() => {
    getMyCoins(1, 1).then((r) => setBalance(r.balance)).catch(() => {});
    getMyWordKingStatus().then((r) => setIsKing(r.is_word_king)).catch(() => {});
    getMyCoinsToday().then(setToday).catch(() => {});
    getWordKingRace().then(setRace).catch(() => {});
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
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full overflow-hidden rounded-2xl border border-amber-300/50 bg-gradient-to-br from-amber-400 via-amber-400 to-yellow-300 px-3.5 py-3.5 text-left shadow-lg shadow-amber-500/20 sm:rounded-3xl sm:px-6 sm:py-5"
      >
        {/* 入场时只扫过一次，避免首页长期存在无意义的循环动效。 */}
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <motion.span
            className="absolute inset-y-0 w-1/3 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/40 to-transparent"
            initial={{ left: '-33%' }}
            animate={{ left: '133%' }}
            transition={{ duration: 1.35, delay: 0.3, ease: 'easeOut' }}
          />
        </span>

        <div className="relative flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={openDetail}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
            aria-label={`查看金币明细，当前 ${balance} 枚`}
          >
            {/* 大金币(AI 生成金色星币图)+ 皇冠(shrink-0 不被压缩) */}
            <motion.div
              className="relative h-12 w-12 shrink-0 sm:h-14 sm:w-14"
              whileHover={{ rotate: -4, scale: 1.04 }}
              transition={{ duration: 0.2 }}
            >
              <img
                src={coinGold}
                alt="金币"
                className="h-12 w-12 object-contain drop-shadow-[0_2px_6px_rgba(180,120,0,0.45)] sm:h-14 sm:w-14"
              />
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
                <span className="font-display font-numeric text-3xl font-bold leading-none text-white drop-shadow-sm sm:text-4xl">
                  {balance}
                </span>
                <span className="text-sm font-medium text-amber-900/70">枚</span>
              </div>
            </div>
          </button>

          {/* 右侧行动点使用独立 button，避免 button 内嵌 role=button。 */}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => setShopOpen(true)}
              className="min-h-11 whitespace-nowrap rounded-full bg-white/90 px-3 text-xs font-bold text-amber-700 shadow-sm transition hover:bg-white active:scale-95 sm:px-3.5 sm:text-sm"
            >
              🎁 兑换奖励
            </button>
            <button
              type="button"
              onClick={() => setRulesOpen(true)}
              className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-amber-900/70 underline-offset-2 transition hover:bg-white/40 hover:underline"
            >
              {today?.auto_coin === false
                ? '老师手动加币 · 看规则'
                : `完成任务+${today?.task_reward ?? 1} · 单词王+${today?.word_king_reward ?? 1} · 规则`}
            </button>
          </div>
        </div>

        {/* 今日进度条:任务几/几 + 单词王战况(一眼看到还差什么) */}
        {(today || race) && (
          <div className="relative mt-3 space-y-1.5 border-t border-white/30 pt-2.5">
            {today && today.tasks_total > 0 && (
              <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] font-medium text-amber-900/85">
                <span>
                  今日任务 <b className="font-numeric">{today.tasks_done}/{today.tasks_total}</b>
                </span>
                {today.task_coin_earned ? (
                  <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                    ✓ 金币已到手 +{today.task_reward}
                  </span>
                ) : today.tasks_all_done ? (
                  <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                    全部完成{today.auto_coin ? '' : ',等老师加币'}
                  </span>
                ) : (
                  <span className="text-amber-900/65">
                    · 还差 {today.tasks_total - today.tasks_done} 个就能拿 +{today.task_reward}
                  </span>
                )}
              </p>
            )}
            {/* 今天没布置任务:明说"没有任务币不是漏发",这是最常见的疑问之一 */}
            {today && today.tasks_total === 0 && (
              <p className="text-[12px] text-amber-900/65">
                今天老师还没布置任务,没有任务金币(不是漏发)
              </p>
            )}
            {/* 昨日没拿到任务币:说清是没做完(补做不算当天),孩子不用再来问 */}
            {today?.yesterday && today.yesterday.total > 0 && !today.yesterday.coined && (
              <p className="text-[12px] text-amber-900/65">
                昨日任务 <b className="font-numeric">{today.yesterday.done}/{today.yesterday.total}</b>
                {today.auto_coin
                  ? ' · 当天没做完,金币未发(隔天补做不算哦)'
                  : ' · 老师手动加币模式'}
              </p>
            )}
            {race?.tip && (
              <p className={`flex items-start gap-1 text-[12px] leading-snug ${
                race.level === 'chased' || race.level === 'tied'
                  ? 'font-semibold text-rose-800'
                  : 'text-amber-900/80'
              }`}>
                {/* 没资格参评的三种情况别挂 👑,不然文案说"不评单词王"却顶着王冠 */}
                <span aria-hidden>{
                  race.level === 'task_pending' ? '📝'
                    : race.level === 'no_task' || race.level === 'no_contest' ? 'ℹ️'
                    : race.level === 'behind' || race.level === 'idle' ? '📖'
                    : '👑'
                }</span>
                <span>{race.tip}</span>
              </p>
            )}
          </div>
        )}
      </motion.div>

      {shopOpen && <RedeemShopModal onClose={() => setShopOpen(false)} />}

      <CoinRulesModal
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        audience="student"
        autoCoin={today?.auto_coin ?? true}
        rules={today ? {
          task_reward: today.task_reward,
          word_king_reward: today.word_king_reward,
          daily_cap: today.daily_cap,
        } : undefined}
      />

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-1.5">
                🪙 我的金币:<span className="text-amber-500 font-numeric text-lg">{balance}</span> 枚
              </h3>
              <button onClick={() => setOpen(false)} className="min-h-11 rounded-lg px-3 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700">关闭</button>
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
                    {(t.source === 'task' || t.source === 'unit' || t.source === 'word_king') && (t.day_tasks_done != null || t.day_words != null || t.day_units_done != null) && (
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        当天完成 <span className="font-semibold text-orange-500">
                          {t.day_tasks_done ?? 0}{t.day_tasks_total ? `/${t.day_tasks_total}` : ''}
                        </span> 个任务 · <span className="font-semibold text-sky-500">{t.day_units_done ?? 0}</span> 个单元 · 学了 <span className="font-semibold text-emerald-600">{t.day_words ?? 0}</span> 个单词
                      </p>
                    )}
                  </div>
                  <span className={`font-numeric font-bold text-sm shrink-0 ${t.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {t.amount >= 0 ? `+${t.amount}` : t.amount} 🪙
                  </span>
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-center text-xs text-gray-400 py-8">
                  {today?.auto_coin === false
                    ? '还没有金币记录。认真完成学习任务,老师核实后会给你加金币!'
                    : '还没有金币记录。把老师布置的任务全部做完就能拿到第一枚金币!'}
                </p>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4 text-sm">
                <button disabled={page <= 1} onClick={() => loadPage(page - 1)}
                  className="min-h-11 rounded-lg border border-black/10 px-3 disabled:opacity-40">上一页</button>
                <span className="text-xs text-gray-500">{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => loadPage(page + 1)}
                  className="min-h-11 rounded-lg border border-black/10 px-3 disabled:opacity-40">下一页</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
