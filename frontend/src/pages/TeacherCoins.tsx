/**
 * 教师端-金币管理页
 * 左:班级学生余额;右:金币流水(增删改查 + 分页 + 搜索 + 来源筛选)。
 * 进入即对「今天」结算一次(幂等补发单词王/作业币)。仅本班老师+管理员可操作。
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { toast } from '../components/Toast';
import { beijingDate, beijingDayPrefix } from '../utils/beijingDate';
import {
  settleCoins, getCoinBalances, getCoinTransactions, adjustCoins,
  updateCoinTx, deleteCoinTx,
  getRewards, createReward, updateReward, deleteReward, redeemReward,
  getWordKingBanner,
  type CoinBalance, type CoinTx, type CoinReward, type WordKingBanner,
} from '../api/coins';

interface ClassItem { id: number; name: string; }

const SOURCE_FILTERS = [
  { key: '', label: '全部' },
  { key: 'task', label: '完成作业' },
  { key: 'word_king', label: '单词王' },
  { key: 'manual', label: '手动' },
  { key: 'redeem', label: '兑换' },
];
const PAGE_SIZE = 20;

export default function TeacherCoins() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState<number | null>(null);

  const [balances, setBalances] = useState<CoinBalance[]>([]);
  const [balanceQ, setBalanceQ] = useState('');

  const [txItems, setTxItems] = useState<CoinTx[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txPage, setTxPage] = useState(1);
  const [txSource, setTxSource] = useState('');
  const [txQ, setTxQ] = useState('');
  const [txDate, setTxDate] = useState('');  // YYYY-MM-DD,空=全部
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);  // 变更类操作(兑换/加减/改)进行中,防双击重复提交
  const [kingBanner, setKingBanner] = useState<WordKingBanner | null>(null);  // 昨天+今日单词王横幅

  // 加/减金币弹窗
  const [adjustFor, setAdjustFor] = useState<CoinBalance | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustMode, setAdjustMode] = useState<'grant' | 'redeem'>('grant');

  // 编辑流水弹窗
  const [editTx, setEditTx] = useState<CoinTx | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editReason, setEditReason] = useState('');

  // 商品 + 兑换
  const [rewards, setRewards] = useState<CoinReward[]>([]);
  const [redeemFor, setRedeemFor] = useState<CoinBalance | null>(null);  // 给谁兑换
  const [showRewardMgr, setShowRewardMgr] = useState(false);             // 商品管理弹窗
  const [rewardForm, setRewardForm] = useState({ name: '', cost: '', stock: '', note: '' });
  const [editReward, setEditReward] = useState<CoinReward | null>(null);

  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` });

  // 初始化:班级列表 + 结算今天
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/teacher/classes`, { headers: headers() });
        const list: ClassItem[] = res.data || [];
        setClasses(list);
        if (list.length) setClassId(list[0].id);
      } catch { toast.error('加载班级失败'); }
      // 进入页面幂等结算:今天(补作业币)+ 昨天(单词王当天结束才发,次日补上)。
      // 失败不影响浏览。
      try {
        await settleCoins();
        await settleCoins(beijingDate(-1));
      } catch { /* 静默 */ }
    })();
  }, []);

  const loadRewards = useCallback(async () => {
    try { setRewards(await getRewards(true)); } catch { /* 静默 */ }
  }, []);
  useEffect(() => { loadRewards(); }, [loadRewards]);

  // 单词王横幅(昨天已定 + 今日实时),随班级切换加载
  const loadKingBanner = useCallback(async () => {
    if (classId == null) { setKingBanner(null); return; }
    try { setKingBanner(await getWordKingBanner(classId)); } catch { setKingBanner(null); }
  }, [classId]);
  useEffect(() => { loadKingBanner(); }, [loadKingBanner]);

  const loadBalances = useCallback(async () => {
    if (classId == null) return;
    try {
      const r = await getCoinBalances(classId, balanceQ.trim() || undefined);
      setBalances(r.students);
    } catch { toast.error('加载余额失败'); }
  }, [classId, balanceQ]);

  const loadTx = useCallback(async () => {
    if (classId == null) return;
    setLoading(true);
    try {
      const r = await getCoinTransactions({
        class_id: classId,
        source: txSource || undefined,
        q: txQ.trim() || undefined,
        target_date: txDate || undefined,
        page: txPage,
        page_size: PAGE_SIZE,
      });
      setTxItems(r.items);
      setTxTotal(r.total);
    } catch { toast.error('加载流水失败'); }
    finally { setLoading(false); }
  }, [classId, txSource, txQ, txDate, txPage]);

  useEffect(() => { loadBalances(); }, [loadBalances]);
  useEffect(() => { loadTx(); }, [loadTx]);
  // 切换班级/来源/日期时回到第一页
  useEffect(() => { setTxPage(1); }, [classId, txSource, txDate]);

  const refreshAll = () => { loadBalances(); loadTx(); };

  // 每 60 秒自动刷新余额/流水(实时看到金币变动)。
  // 有弹窗打开时(兑换/加减/改/商品管理)跳过本轮,避免打断正在进行的操作;
  // 标签页切到后台也跳过,省请求。
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      if (adjustFor || editTx || redeemFor || showRewardMgr) return;
      loadBalances();
      loadTx();
      loadKingBanner();  // 今日实时单词王也每分钟刷新
    }, 60_000);
    return () => clearInterval(t);
  }, [loadBalances, loadTx, loadKingBanner, adjustFor, editTx, redeemFor, showRewardMgr]);

  const submitAdjust = async () => {
    if (!adjustFor || busy) return;  // busy 防双击重复扣/发
    const n = parseInt(adjustAmount, 10);
    if (!n || n <= 0) { toast.warning('请输入正整数'); return; }
    const amount = adjustMode === 'redeem' ? -n : n;
    setBusy(true);
    try {
      await adjustCoins({
        student_id: adjustFor.student_id, amount,
        reason: adjustReason.trim() || undefined,
        source: adjustMode === 'redeem' ? 'redeem' : 'manual',
      });
      toast.success(adjustMode === 'redeem' ? '已记兑换' : '已发放');
      setAdjustFor(null); setAdjustAmount(''); setAdjustReason('');
      refreshAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '操作失败');
    } finally { setBusy(false); }
  };

  const submitEdit = async () => {
    if (!editTx || busy) return;
    const body: { amount?: number; reason?: string } = { reason: editReason.trim() };
    if (editAmount.trim()) {
      const n = parseInt(editAmount, 10);
      if (!n || n === 0) { toast.warning('金额需为非零整数'); return; }
      body.amount = n;
    }
    setBusy(true);
    try {
      await updateCoinTx(editTx.id, body);
      toast.success('已修改'); setEditTx(null); refreshAll();
    } catch (e: any) { toast.error(e?.response?.data?.detail || '修改失败'); }
    finally { setBusy(false); }
  };

  const doDelete = async (tx: CoinTx) => {
    if (!confirm(`删除这条流水?会回滚 ${tx.student_name} 的 ${tx.amount} 金币`)) return;
    try {
      await deleteCoinTx(tx.id);
      toast.success('已删除'); refreshAll();
    } catch (e: any) { toast.error(e?.response?.data?.detail || '删除失败'); }
  };

  const doRedeem = async (reward: CoinReward) => {
    if (!redeemFor || busy) return;  // busy 防双击:兑换是最要紧的扣币路径
    if (redeemFor.balance < reward.cost) { toast.warning(`金币不足(当前 ${redeemFor.balance},需 ${reward.cost})`); return; }
    setBusy(true);
    try {
      await redeemReward(redeemFor.student_id, reward.id);
      toast.success(`已为 ${redeemFor.name} 兑换「${reward.name}」`);
      setRedeemFor(null); refreshAll(); loadRewards();
    } catch (e: any) { toast.error(e?.response?.data?.detail || '兑换失败'); }
    finally { setBusy(false); }
  };

  const submitReward = async () => {
    const cost = parseInt(rewardForm.cost, 10);
    if (!rewardForm.name.trim()) { toast.warning('请输入商品名'); return; }
    if (!cost || cost <= 0) { toast.warning('所需金币需为正整数'); return; }
    const stock = rewardForm.stock.trim() ? parseInt(rewardForm.stock, 10) : null;
    try {
      if (editReward) {
        await updateReward(editReward.id, { name: rewardForm.name.trim(), cost, stock, note: rewardForm.note.trim() });
        toast.success('已修改');
      } else {
        await createReward({ name: rewardForm.name.trim(), cost, stock: stock ?? undefined, note: rewardForm.note.trim() });
        toast.success('已添加');
      }
      setRewardForm({ name: '', cost: '', stock: '', note: '' }); setEditReward(null);
      loadRewards();
    } catch (e: any) { toast.error(e?.response?.data?.detail || '操作失败'); }
  };

  const toggleReward = async (r: CoinReward) => {
    try { await updateReward(r.id, { is_active: !r.is_active }); loadRewards(); }
    catch { toast.error('操作失败'); }
  };

  const removeReward = async (r: CoinReward) => {
    if (!confirm(`删除商品「${r.name}」?已兑换记录不受影响`)) return;
    try { await deleteReward(r.id); loadRewards(); toast.success('已删除'); }
    catch { toast.error('删除失败'); }
  };

  const isSystem = (s: string) => s === 'task' || s === 'word_king';
  const totalPages = Math.max(1, Math.ceil(txTotal / PAGE_SIZE));
  const activeRewards = rewards.filter((r) => r.is_active);

  return (
    <div className="min-h-screen bg-[#FFF8F0] p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/teacher/dashboard')} className="text-gray-400 hover:text-gray-600 text-sm">← 返回</button>
            <h1 className="text-xl font-bold text-gray-800">🪙 金币管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowRewardMgr(true); setEditReward(null); setRewardForm({ name: '', cost: '', stock: '', note: '' }); }}
              className="px-3 py-2 rounded-xl bg-amber-100 text-amber-700 text-sm hover:bg-amber-200"
            >🎁 商品管理</button>
            <select
              value={classId ?? ''}
              onChange={(e) => setClassId(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-black/10 bg-white text-sm"
            >
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-5 text-xs text-amber-700">
          💡 完成当天全部作业 +1 币,当日班级词量榜第一(单词王)+2 币,系统每日自动结算(打开本页即结算今天)。手动/兑换记录可增删改,系统发放的不可改。
        </div>

        {/* 单词王横幅:昨天(已定)+ 今日(实时,还没截止) */}
        {kingBanner && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-3">
              <p className="text-xs text-amber-600 font-medium mb-1">👑 昨日单词王 <span className="text-amber-400 font-normal">({kingBanner.yesterday.date.slice(5)} 已定)</span></p>
              {kingBanner.yesterday.kings.length ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {kingBanner.yesterday.kings.map((k) => (
                    <span key={k.student_id} className="text-sm text-amber-900 font-semibold">
                      {k.name} <span className="text-amber-500 font-numeric">{k.words}词</span>
                    </span>
                  ))}
                </div>
              ) : <p className="text-xs text-gray-400">昨天无人学习</p>}
            </div>
            <div className="rounded-xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-4 py-3">
              <p className="text-xs text-orange-600 font-medium mb-1">🔥 今日实时领先 <span className="text-orange-400 font-normal">({kingBanner.today.date.slice(5)} 未截止,24点后定王)</span></p>
              {kingBanner.today.kings.length ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {kingBanner.today.kings.map((k) => (
                    <span key={k.student_id} className="text-sm text-orange-900 font-semibold">
                      {k.name} <span className="text-orange-500 font-numeric">{k.words}词</span>
                    </span>
                  ))}
                </div>
              ) : <p className="text-xs text-gray-400">今天还没人学习</p>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* 左:余额榜 */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-black/[0.05] p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800 text-sm">学生余额</h2>
              <input
                value={balanceQ}
                onChange={(e) => setBalanceQ(e.target.value)}
                placeholder="搜姓名…"
                className="w-28 px-2.5 py-1.5 rounded-lg border border-black/10 text-xs"
              />
            </div>
            <div className="space-y-1 max-h-[560px] overflow-y-auto">
              {balances.map((s) => (
                <div key={s.student_id} className="flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-black/[0.02]">
                  <span className="text-sm text-gray-700 truncate">{s.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-numeric font-bold text-amber-600 text-sm">{s.balance} 🪙</span>
                    <button
                      onClick={() => setRedeemFor(s)}
                      className="px-2 py-1 rounded-lg bg-green-100 text-green-700 text-xs hover:bg-green-200"
                    >🎁 兑换</button>
                    <button
                      onClick={() => { setAdjustFor(s); setAdjustMode('grant'); setAdjustAmount(''); setAdjustReason(''); }}
                      className="px-2 py-1 rounded-lg bg-amber-100 text-amber-700 text-xs hover:bg-amber-200"
                    >加/减</button>
                  </div>
                </div>
              ))}
              {balances.length === 0 && <p className="text-center text-xs text-gray-400 py-8">暂无学生</p>}
            </div>
          </div>

          {/* 右:流水 */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-black/[0.05] p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h2 className="font-semibold text-gray-800 text-sm mr-auto">金币流水</h2>
              <input
                value={txQ}
                onChange={(e) => { setTxQ(e.target.value); setTxPage(1); }}
                placeholder="搜学生姓名…"
                className="w-32 px-2.5 py-1.5 rounded-lg border border-black/10 text-xs"
              />
              <select
                value={txSource}
                onChange={(e) => setTxSource(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-black/10 text-xs"
              >
                {SOURCE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-black/10 text-xs"
                title="只看某天"
              />
              {txDate && (
                <button onClick={() => setTxDate('')} className="text-xs text-gray-400 hover:text-gray-600">清除</button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-black/5">
                    <th className="py-2 pr-2">学生</th>
                    <th className="py-2 pr-2">变动</th>
                    <th className="py-2 pr-2">来源</th>
                    <th className="py-2 pr-2">事由</th>
                    <th className="py-2 pr-2">时间</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {txItems.map((t) => (
                    <tr key={t.id} className="border-b border-black/[0.03]">
                      <td className="py-2 pr-2 text-gray-700">{t.student_name}</td>
                      <td className={`py-2 pr-2 font-numeric font-semibold ${t.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {t.amount >= 0 ? `+${t.amount}` : t.amount}{t.source === 'word_king' ? ' 🪙' : ''}
                      </td>
                      <td className="py-2 pr-2">
                        {t.source === 'word_king' ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">👑 {beijingDayPrefix(t.reason)}单词王</span>
                        ) : (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-black/[0.04] text-gray-500">{t.source_label}</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-gray-500 text-xs max-w-[180px]">
                        <div className="truncate">{t.reason || '—'}</div>
                        {isSystem(t.source) && (t.day_tasks_done != null || t.day_words != null) && (
                          <div className="text-[10px] mt-0.5 text-gray-400">
                            当天完成 <span className="font-semibold text-orange-500">{t.day_tasks_done ?? 0}</span> 任务 · 学 <span className="font-semibold text-emerald-600">{t.day_words ?? 0}</span> 词
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-gray-400 text-xs">{t.created_at.slice(5, 16).replace('T', ' ')}</td>
                      <td className="py-2">
                        {isSystem(t.source) ? (
                          <span className="text-[10px] text-gray-300">系统</span>
                        ) : (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => { setEditTx(t); setEditAmount(String(t.amount)); setEditReason(t.reason || ''); }}
                              className="text-xs text-blue-500 hover:text-blue-700"
                            >改</button>
                            <button onClick={() => doDelete(t)} className="text-xs text-red-400 hover:text-red-600">删</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {txItems.length === 0 && !loading && (
                    <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-8">暂无流水</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4 text-sm">
                <button
                  disabled={txPage <= 1}
                  onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1 rounded-lg border border-black/10 disabled:opacity-40"
                >上一页</button>
                <span className="text-xs text-gray-500">{txPage} / {totalPages}(共 {txTotal} 条)</span>
                <button
                  disabled={txPage >= totalPages}
                  onClick={() => setTxPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1 rounded-lg border border-black/10 disabled:opacity-40"
                >下一页</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 加/减金币弹窗 */}
      {adjustFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setAdjustFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 mb-1">{adjustFor.name}</h3>
            <p className="text-xs text-gray-400 mb-4">当前余额 {adjustFor.balance} 🪙</p>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setAdjustMode('grant')}
                className={`flex-1 py-2 rounded-lg text-sm ${adjustMode === 'grant' ? 'bg-green-100 text-green-700 font-semibold' : 'bg-black/[0.03] text-gray-500'}`}
              >➕ 发放</button>
              <button
                onClick={() => setAdjustMode('redeem')}
                className={`flex-1 py-2 rounded-lg text-sm ${adjustMode === 'redeem' ? 'bg-red-100 text-red-600 font-semibold' : 'bg-black/[0.03] text-gray-500'}`}
              >➖ 兑换/扣减</button>
            </div>
            <input
              type="number" min="1"
              value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              placeholder="数量(正整数)"
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-2"
            />
            <input
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder={adjustMode === 'redeem' ? '兑换了什么(如:换铅笔)' : '事由(可选)'}
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => setAdjustFor(null)} className="flex-1 py-2 rounded-lg border border-black/10 text-sm text-gray-500">取消</button>
              <button onClick={submitAdjust} disabled={busy} className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium disabled:opacity-50">{busy ? '处理中…' : '确定'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑流水弹窗 */}
      {editTx && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditTx(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 mb-4">修改流水 · {editTx.student_name}</h3>
            <label className="block text-xs text-gray-400 mb-1">变动值(正=发放,负=扣减)</label>
            <input
              type="number"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-3"
            />
            <label className="block text-xs text-gray-400 mb-1">事由</label>
            <input
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => setEditTx(null)} className="flex-1 py-2 rounded-lg border border-black/10 text-sm text-gray-500">取消</button>
              <button onClick={submitEdit} disabled={busy} className="flex-1 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium disabled:opacity-50">{busy ? '处理中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 给学生兑换商品弹窗 */}
      {redeemFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setRedeemFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 mb-1">🎁 给 {redeemFor.name} 兑换</h3>
            <p className="text-xs text-gray-400 mb-4">当前余额 {redeemFor.balance} 🪙</p>
            {activeRewards.length === 0 ? (
              <p className="text-center text-xs text-gray-400 py-6">还没有上架的商品,先去「商品管理」添加</p>
            ) : (
              <div className="space-y-2">
                {activeRewards.map((r) => {
                  const afford = redeemFor.balance >= r.cost;
                  const outOfStock = r.stock !== null && r.stock <= 0;
                  return (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-black/[0.06]">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800 truncate">{r.name}</p>
                        <p className="text-[11px] text-gray-400">
                          {r.cost} 🪙{r.stock !== null ? ` · 剩 ${r.stock}` : ' · 不限量'}{r.note ? ` · ${r.note}` : ''}
                        </p>
                      </div>
                      <button
                        disabled={!afford || outOfStock || busy}
                        onClick={() => doRedeem(r)}
                        className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium disabled:opacity-40 shrink-0 ml-2"
                      >{busy ? '…' : outOfStock ? '缺货' : afford ? '兑换' : '币不足'}</button>
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={() => setRedeemFor(null)} className="w-full mt-4 py-2 rounded-lg border border-black/10 text-sm text-gray-500">关闭</button>
          </div>
        </div>
      )}

      {/* 商品管理弹窗 */}
      {showRewardMgr && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowRewardMgr(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">🎁 兑换商品管理</h3>
              <button onClick={() => setShowRewardMgr(false)} className="text-gray-400 hover:text-gray-600 text-sm">关闭</button>
            </div>

            {/* 新增/编辑表单 */}
            <div className="bg-black/[0.02] rounded-xl p-3 mb-4 space-y-2">
              <p className="text-xs font-medium text-gray-500">{editReward ? '编辑商品' : '新增商品'}</p>
              <div className="flex gap-2">
                <input value={rewardForm.name} onChange={(e) => setRewardForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="商品名(如 200人民币)" className="flex-1 px-2.5 py-1.5 rounded-lg border border-black/10 text-sm" />
                <input type="number" value={rewardForm.cost} onChange={(e) => setRewardForm((f) => ({ ...f, cost: e.target.value }))}
                  placeholder="金币" className="w-20 px-2.5 py-1.5 rounded-lg border border-black/10 text-sm" />
              </div>
              <div className="flex gap-2">
                <input type="number" value={rewardForm.stock} onChange={(e) => setRewardForm((f) => ({ ...f, stock: e.target.value }))}
                  placeholder="库存(空=不限)" className="w-32 px-2.5 py-1.5 rounded-lg border border-black/10 text-sm" />
                <input value={rewardForm.note} onChange={(e) => setRewardForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="备注(可选)" className="flex-1 px-2.5 py-1.5 rounded-lg border border-black/10 text-sm" />
              </div>
              <div className="flex gap-2">
                {editReward && (
                  <button onClick={() => { setEditReward(null); setRewardForm({ name: '', cost: '', stock: '', note: '' }); }}
                    className="px-3 py-1.5 rounded-lg border border-black/10 text-sm text-gray-500">取消编辑</button>
                )}
                <button onClick={submitReward} className="flex-1 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium">
                  {editReward ? '保存修改' : '＋ 添加商品'}
                </button>
              </div>
            </div>

            {/* 商品列表 */}
            <div className="space-y-1.5">
              {rewards.map((r) => (
                <div key={r.id} className={`flex items-center justify-between px-3 py-2 rounded-xl border ${r.is_active ? 'border-black/[0.06]' : 'border-black/[0.04] bg-black/[0.02] opacity-60'}`}>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">
                      {r.name} {!r.is_active && <span className="text-[10px] text-gray-400">(已下架)</span>}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {r.cost} 🪙{r.stock !== null ? ` · 剩 ${r.stock}` : ' · 不限量'}{r.note ? ` · ${r.note}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0 ml-2">
                    <button onClick={() => { setEditReward(r); setRewardForm({ name: r.name, cost: String(r.cost), stock: r.stock === null ? '' : String(r.stock), note: r.note || '' }); }}
                      className="text-xs text-blue-500 hover:text-blue-700">改</button>
                    <button onClick={() => toggleReward(r)} className="text-xs text-amber-600 hover:text-amber-800">{r.is_active ? '下架' : '上架'}</button>
                    <button onClick={() => removeReward(r)} className="text-xs text-red-400 hover:text-red-600">删</button>
                  </div>
                </div>
              ))}
              {rewards.length === 0 && <p className="text-center text-xs text-gray-400 py-6">还没有商品</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
