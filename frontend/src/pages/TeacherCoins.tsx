/**
 * 教师端-金币管理页
 * 左:班级学生余额;右:金币流水(增删改查 + 分页 + 搜索 + 来源筛选)。
 * 发放方式有开关(机构级): auto=系统按规则自动发(默认) | manual=只能老师手动加。
 * 仅本班老师+管理员可操作;切换开关仅管理员/机构管理员。
 */
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { toast } from '../components/Toast';
import {
  getCoinBalances, getCoinTransactions, adjustCoins,
  getCoinPinStatus, setCoinPin,
  updateCoinTx, deleteCoinTx,
  getRewards, createReward, updateReward, deleteReward, redeemReward,
  getWordKingBanner, uploadRewardImage,
  getRedeemRequests, approveRedeem, rejectRedeem,
  getCoinMode, setCoinMode, settleCoins,
  type CoinBalance, type CoinTx, type CoinReward, type WordKingBanner,
  type RedeemRequestItem, type CoinModeResp, type TaskCoinDayStatus,
} from '../api/coins';
import { CircleDollarSign } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import CoinRulesModal from '../components/CoinRulesModal';

interface ClassItem { id: number; name: string; }

const SOURCE_FILTERS = [
  { key: '', label: '全部' },
  { key: 'task', label: '完成任务' },
  { key: 'unit', label: '完成单元' },
  { key: 'word_king', label: '单词王' },
  { key: 'manual', label: '手动' },
  { key: 'redeem', label: '兑换' },
];
const PAGE_SIZE = 20;

/** 余额行的「今/昨」任务币状态小标签:一眼回答「他为什么没币」。
 *  绿✓=已发币;红=当天没做完(含隔天补做,发币口径不算);灰=没布置任务。
 *  pendingOk: 今天还在进行中,没做完显示中性琥珀色而不是红(还没到结算盖棺)。 */
function DayStatusChip({ label, st, pendingOk }: {
  label: string; st?: TaskCoinDayStatus | null; pendingOk?: boolean;
}) {
  if (!st) return null;
  if (st.total === 0) {
    return (
      <span className="rounded bg-gray-100 px-1 py-0.5 text-gray-400" title={`${label}日未布置任务,无任务币(不是漏发)`}>
        {label} 无任务
      </span>
    );
  }
  if (st.coined) {
    return (
      <span className="rounded bg-emerald-50 px-1 py-0.5 font-semibold text-emerald-600" title={`${label}日任务全部当天完成,任务币已发`}>
        {label} {st.done}/{st.total} ✓
      </span>
    );
  }
  if (st.done === st.total) {
    // 全做完但没发币:手动加币模式(auto 模式下全做完必然已发)
    return (
      <span className="rounded bg-amber-50 px-1 py-0.5 text-amber-600" title={`${label}日任务全部当天完成;本校为手动加币模式,由老师核实后加`}>
        {label} {st.done}/{st.total} 全完成
      </span>
    );
  }
  const cls = pendingOk
    ? 'rounded bg-amber-50 px-1 py-0.5 text-amber-600'
    : 'rounded bg-rose-50 px-1 py-0.5 font-semibold text-rose-500';
  const tip = pendingOk
    ? `今天完成 ${st.done}/${st.total},全部完成自动发任务币`
    : `${label}日完成 ${st.done}/${st.total}(只数当天完成的,隔天补做不计),没做完所以金币未发`;
  return <span className={cls} title={tip}>{label} {st.done}/{st.total}</span>;
}

export default function TeacherCoins() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState<number | null>(null);
  // 金币发放模式(自动/手动)+ 规则常量
  const [coinMode, setCoinModeState] = useState<CoinModeResp | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settling, setSettling] = useState(false);

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
  const [requests, setRequests] = useState<RedeemRequestItem[]>([]);  // 待审批兑换申请
  const [pendingCount, setPendingCount] = useState(0);                // 待审批数(红点)

  // 加/减金币弹窗
  const [adjustFor, setAdjustFor] = useState<CoinBalance | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustMode, setAdjustMode] = useState<'grant' | 'redeem'>('grant');
  const [adjustPin, setAdjustPin] = useState('');            // 加币时输入的 PIN
  const [hasPin, setHasPin] = useState<boolean | null>(null); // 老师是否已设加币 PIN
  const [showSetPin, setShowSetPin] = useState(false);        // 设置/修改 PIN 弹窗
  const [pinOld, setPinOld] = useState('');
  const [pinNew, setPinNew] = useState('');

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
  const [formImageFile, setFormImageFile] = useState<File | null>(null);        // 新增商品时可选的图
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null); // 本地预览 URL

  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` });


  // 初始化:只加载班级列表(结算已改为教师手动点按钮触发,不再进页面自动发币)
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/teacher/classes`, { headers: headers() });
        const list: ClassItem[] = res.data || [];
        setClasses(list);
        if (list.length) setClassId(list[0].id);
      } catch { toast.error('加载班级失败'); }
    })();
  }, []);

  const loadRewards = useCallback(async () => {
    try { setRewards(await getRewards(true)); } catch { /* 静默 */ }
  }, []);
  useEffect(() => { loadRewards(); }, [loadRewards]);

  // 加币 PIN 是否已设(决定加币时弹「输 PIN」还是「先去设置」)
  useEffect(() => {
    getCoinPinStatus().then((r) => setHasPin(r.has_pin)).catch(() => setHasPin(null));
  }, []);

  // 金币发放模式(自动/手动)
  useEffect(() => {
    getCoinMode().then(setCoinModeState).catch(() => setCoinModeState(null));
  }, []);

  const handleToggleCoinMode = async () => {
    if (!coinMode) return;
    const next = coinMode.mode === 'manual' ? 'auto' : 'manual';
    const msg = next === 'manual'
      ? '改为「教师手动加币」?\n\n此后系统不再自动发币,需要您核实后逐个加。已经发出去的金币不会收回。'
      : '改为「系统自动发币」?\n\n此后学生完成当天全部任务自动 +1,当日单词王额外 +1(次日 0 点后到账)。';
    if (!confirm(msg)) return;
    setModeSaving(true);
    try {
      await setCoinMode(next);
      setCoinModeState({ ...coinMode, mode: next });
      toast.success(next === 'manual' ? '已改为教师手动加币' : '已改为系统自动发币');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '切换失败');
    } finally {
      setModeSaving(false);
    }
  };

  const handleSettle = async () => {
    setSettling(true);
    try {
      const r = await settleCoins();
      const n = (r.task || 0) + (r.word_king || 0) + (r.unit || 0);
      toast.success(n > 0
        ? `已补算 ${r.date}:单词王 ${r.word_king} 人、任务币 ${r.task} 人`
        : `${r.date} 没有需要补发的(已全部结算过)`);
      loadTx(); loadBalances();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '结算失败');
    } finally {
      setSettling(false);
    }
  };

  const submitSetPin = async () => {
    if (pinNew.trim().length < 4) { toast.warning('新密码至少 4 位'); return; }
    try {
      await setCoinPin(pinNew.trim(), pinOld.trim() || undefined);
      toast.success(hasPin ? '金币密码已修改' : '金币密码已设置');
      setHasPin(true); setShowSetPin(false); setPinOld(''); setPinNew('');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '设置失败');
    }
  };

  // 单词王横幅(昨天已定 + 今日实时),随班级切换加载
  const loadKingBanner = useCallback(async () => {
    if (classId == null) { setKingBanner(null); return; }
    try { setKingBanner(await getWordKingBanner(classId)); } catch { setKingBanner(null); }
  }, [classId]);
  useEffect(() => { loadKingBanner(); }, [loadKingBanner]);

  // 待审批兑换申请(红点 + 列表),不分班级(老师看本班全部)
  const loadRequests = useCallback(async () => {
    try {
      const r = await getRedeemRequests('pending');
      setRequests(r.items); setPendingCount(r.pending_count);
    } catch { /* 静默 */ }
  }, []);
  useEffect(() => { loadRequests(); }, [loadRequests]);

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

  const refreshAll = () => { loadBalances(); loadTx(); loadRequests(); };

  const doApprove = async (req: RedeemRequestItem) => {
    if (busy) return;
    setBusy(true);
    try {
      await approveRedeem(req.id);
      toast.success(`已通过 ${req.student_name} 兑换「${req.reward_name}」`);
      refreshAll();
    } catch (e: any) { toast.error(e?.response?.data?.detail || '操作失败'); }
    finally { setBusy(false); }
  };
  const doReject = async (req: RedeemRequestItem) => {
    if (busy) return;
    if (!confirm(`拒绝 ${req.student_name} 兑换「${req.reward_name}」?`)) return;
    setBusy(true);
    try {
      await rejectRedeem(req.id);
      toast.success('已拒绝'); refreshAll();
    } catch (e: any) { toast.error(e?.response?.data?.detail || '操作失败'); }
    finally { setBusy(false); }
  };

  // 每 60 秒自动刷新余额/流水/申请(实时看到金币变动、新申请)。
  // 有弹窗打开时(兑换/加减/改/商品管理)跳过本轮,避免打断正在进行的操作;
  // 标签页切到后台也跳过,省请求。
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      if (adjustFor || editTx || redeemFor || showRewardMgr) return;
      loadBalances();
      loadTx();
      loadKingBanner();  // 今日实时单词王也每分钟刷新
      loadRequests();    // 新的兑换申请红点
    }, 60_000);
    return () => clearInterval(t);
  }, [loadBalances, loadTx, loadKingBanner, loadRequests, adjustFor, editTx, redeemFor, showRewardMgr]);

  const submitAdjust = async () => {
    if (!adjustFor || busy) return;  // busy 防双击重复扣/发
    const n = parseInt(adjustAmount, 10);
    if (!n || n <= 0) { toast.warning('请输入正整数'); return; }
    const amount = adjustMode === 'redeem' ? -n : n;
    // 加币和减币都必须输 PIN:后端 /coins/adjust 对两种都校验,
    // 原先只在 grant 时要求并只传 grant 的 pin,减币必然 403「加币密码不正确」
    if (hasPin === false) {
      toast.warning('请先设置金币密码');
      setAdjustFor(null); setShowSetPin(true);
      return;
    }
    if (!adjustPin.trim()) { toast.warning('请输入金币密码'); return; }
    setBusy(true);
    try {
      await adjustCoins({
        student_id: adjustFor.student_id, amount,
        reason: adjustReason.trim() || undefined,
        source: adjustMode === 'redeem' ? 'redeem' : 'manual',
        pin: adjustPin.trim(),
      });
      toast.success(adjustMode === 'redeem' ? '已记兑换' : '已发放');
      setAdjustFor(null); setAdjustAmount(''); setAdjustReason(''); setAdjustPin('');
      refreshAll();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (detail === 'PIN_NOT_SET') {
        toast.warning('请先设置金币密码');
        setAdjustFor(null); setShowSetPin(true);
        setHasPin(false);
      } else {
        toast.error(detail || '操作失败');
      }
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
        // 编辑时若选了新图,一并上传
        if (formImageFile) await uploadRewardImage(editReward.id, formImageFile);
        toast.success('已修改');
      } else {
        const created = await createReward({ name: rewardForm.name.trim(), cost, stock: stock ?? undefined, note: rewardForm.note.trim() });
        // 添加时选了图 → 拿到新 id 后上传(不选则跳过)
        if (formImageFile && created?.id) await uploadRewardImage(created.id, formImageFile);
        toast.success('已添加');
      }
      setRewardForm({ name: '', cost: '', stock: '', note: '' }); setEditReward(null);
      setFormImageFile(null);
      setFormImagePreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      loadRewards();
    } catch (e: any) { toast.error(e?.response?.data?.detail || '操作失败'); }
  };

  // 表单选图(本地预览,提交时才真正上传)
  const pickFormImage = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { toast.warning('仅支持 png/jpg/webp'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.warning('图片不能超过 2MB'); return; }
    setFormImageFile(file);
    setFormImagePreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
  };

  const onUploadImage = async (rewardId: number, file: File | undefined) => {
    if (!file) return;
    try {
      await uploadRewardImage(rewardId, file);
      toast.success('图片已上传'); loadRewards();
    } catch (e: any) { toast.error(e?.response?.data?.detail || '上传失败'); }
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

  const isSystem = (s: string) => s === 'task' || s === 'unit' || s === 'word_king';
  const totalPages = Math.max(1, Math.ceil(txTotal / PAGE_SIZE));
  const activeRewards = rewards.filter((r) => r.is_active);

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader
        role="teacher"
        title="金币管理"
        subtitle="管理班级金币、商品与兑换申请"
        icon={CircleDollarSign}
        action={<div className="flex items-center gap-2"><button onClick={() => { setShowRewardMgr(true); setEditReward(null); setRewardForm({ name: '', cost: '', stock: '', note: '' }); }} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-200">🎁 商品管理</button><button onClick={() => { setShowSetPin(true); setPinOld(''); setPinNew(''); }} title="设置或修改金币密码" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200">🔒 {hasPin ? '修改密码' : '设置密码'}</button><select aria-label="选择班级" value={classId ?? ''} onChange={(e) => setClassId(Number(e.target.value))} className="min-h-10 max-w-32 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
      />

      <main className="teacher-workspace-main">

        {/* 发放模式开关 + 规则速览 */}
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-amber-800">
              {coinMode?.mode === 'manual' ? (
                <>
                  ⚙️ 当前:<b>教师手动加币</b> —— 系统不自动发,请核实学生完成情况后点学生行的「加币」。
                </>
              ) : (
                <>
                  ⚙️ 当前:<b>系统自动发币</b> —— 学生完成当天全部任务自动 +{coinMode?.rules.task_reward ?? 1}
                  (当天追加的任务不再多给;被取消/关闭的任务不算);
                  当日单词王额外 +{coinMode?.rules.word_king_reward ?? 1}(次日 0 点后到账),一天最多 {coinMode?.rules.daily_cap ?? 2} 枚。
                </>
              )}
              <button
                onClick={() => setRulesOpen(true)}
                className="ml-1.5 font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
              >
                完整规则
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {coinMode?.can_edit ? (
                <button
                  onClick={handleToggleCoinMode}
                  disabled={modeSaving}
                  className="min-h-9 whitespace-nowrap rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:opacity-50"
                  title="切换金币发放方式"
                >
                  {modeSaving ? '切换中…' : coinMode.mode === 'manual' ? '↻ 改为系统自动发' : '↻ 改为教师手动加'}
                </button>
              ) : coinMode ? (
                <span className="whitespace-nowrap text-[11px] text-amber-600">
                  (仅管理员可切换发放方式)
                </span>
              ) : null}
              {coinMode?.can_edit && coinMode.mode === 'auto' && (
                <button
                  onClick={handleSettle}
                  disabled={settling}
                  className="min-h-9 whitespace-nowrap rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 disabled:opacity-50"
                  title="每晚 00:35 自动结算;服务器当晚重启错过时用这个补发(幂等,重复点不会多发)"
                >
                  {settling ? '结算中…' : '🔄 补算昨天'}
                </button>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-amber-600">
            系统发放的记录不可改;手动/兑换记录可增删改。老师额外奖励不受每日上限限制。
          </p>
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

        {/* 待审批兑换申请:有申请时高亮显示,同意扣币/拒绝不扣 */}
        {requests.length > 0 && (
          <div className="mb-5 rounded-2xl border-2 border-red-200 bg-red-50/50 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-red-600">
              🔔 学生兑换申请
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                {pendingCount}
              </span>
              <span className="text-xs font-normal text-gray-400">同意后按当前金币扣除</span>
            </h2>
            <div className="space-y-2">
              {requests.map((req) => (
                <div key={req.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5 shadow-sm">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800">
                      <span className="font-medium">{req.student_name}</span>
                      <span className="text-gray-400"> 申请兑换 </span>
                      <span className="font-medium">{req.reward_name}</span>
                    </p>
                    <p className="text-[11px] text-gray-400">{req.cost} 🪙 · {req.created_at.slice(5, 16).replace('T', ' ')}</p>
                  </div>
                  <div className="flex shrink-0 gap-2 ml-2">
                    <button disabled={busy} onClick={() => doApprove(req)}
                      className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium disabled:opacity-40">同意</button>
                    <button disabled={busy} onClick={() => doReject(req)}
                      className="px-3 py-1.5 rounded-lg border border-black/10 text-gray-500 text-xs disabled:opacity-40">拒绝</button>
                  </div>
                </div>
              ))}
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
            {/* 任务币状态图例:老师看一眼就知道谁为什么没币,不用再翻规则 */}
            <p className="mb-2 text-[11px] leading-relaxed text-gray-400">
              今/昨 = 当天完成任务数/布置数(隔天补做不计)。✓ 已发任务币,
              <span className="text-rose-500">红色</span> = 当天没做完,金币未发。
            </p>
            <div className="space-y-1 max-h-[560px] overflow-y-auto">
              {balances.map((s) => (
                <div key={s.student_id} className="flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-black/[0.02]">
                  <div className="min-w-0">
                    <span className="text-sm text-gray-700 truncate">{s.name}</span>
                    {(s.today || s.yesterday) && (
                      <p className="mt-0.5 flex flex-wrap gap-1 text-[10px] leading-none">
                        <DayStatusChip label="今" st={s.today} pendingOk />
                        <DayStatusChip label="昨" st={s.yesterday} />
                      </p>
                    )}
                  </div>
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
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">👑 {t.king_label || '单词王'}</span>
                        ) : (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-black/[0.04] text-gray-500">{t.source_label}</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-gray-500 text-xs max-w-[180px]">
                        <div className="truncate">{t.reason || '—'}</div>
                        {isSystem(t.source) && (t.day_tasks_done != null || t.day_words != null || t.day_units_done != null) && (
                          <div className="text-[10px] mt-0.5 text-gray-400">
                            当天完成 <span className="font-semibold text-orange-500">
                              {t.day_tasks_done ?? 0}{t.day_tasks_total ? `/${t.day_tasks_total}` : ''}
                            </span> 任务 · <span className="font-semibold text-sky-500">{t.day_units_done ?? 0}</span> 单元 · 学 <span className="font-semibold text-emerald-600">{t.day_words ?? 0}</span> 词
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
      </main>

      {/* 加/减金币弹窗 */}
      {adjustFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setAdjustFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 mb-1">{adjustFor.name}</h3>
            <p className="text-xs text-gray-400 mb-4">当前余额 {adjustFor.balance} 🪙</p>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setAdjustMode('grant')}
                className={`flex-1 py-2 rounded-lg text-sm ${adjustMode === 'grant' ? 'bg-green-100 text-green-700 font-semibold' : 'bg-black/[0.03] text-slate-600'}`}
              >➕ 发放</button>
              <button
                onClick={() => setAdjustMode('redeem')}
                className={`flex-1 py-2 rounded-lg text-sm ${adjustMode === 'redeem' ? 'bg-red-100 text-red-600 font-semibold' : 'bg-black/[0.03] text-slate-600'}`}
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
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-3"
            />
            {/* 加币和减币都要输金币密码(防学生冒用老师账号自己加/改币)。
                原先只在 grant 时渲染,减币没地方输密码 → 后端校验必然 403 */}
            <input
              type="password"
              value={adjustPin}
              onChange={(e) => setAdjustPin(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submitAdjust(); }}
              placeholder="金币密码"
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => { setAdjustFor(null); setAdjustPin(''); }} className="flex-1 py-2 rounded-lg border border-black/10 text-sm text-gray-500">取消</button>
              <button onClick={submitAdjust} disabled={busy} className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium disabled:opacity-50">{busy ? '处理中…' : '确定'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 设置/修改金币密码弹窗 */}
      {showSetPin && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowSetPin(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-1">🔒 {hasPin ? '修改金币密码' : '设置金币密码'}</h3>
            <p className="text-xs text-gray-500 mb-4">加币和减币时都需要输入此密码,和登录密码分开。防止学生用你的账号自己改币。</p>
            {hasPin && (
              <>
                <input
                  type="password" value={pinOld} onChange={(e) => setPinOld(e.target.value)}
                  placeholder="当前金币密码" autoComplete="off"
                  className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-1"
                />
                <p className="text-[11px] text-gray-400 mb-2">忘记了?请管理员在「教师管理」里点「重置金币密码」</p>
              </>
            )}
            <input
              type="password" value={pinNew} onChange={(e) => setPinNew(e.target.value)}
              placeholder="新金币密码(至少 4 位)" autoComplete="off"
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowSetPin(false)} className="flex-1 py-2 rounded-lg border border-black/10 text-sm text-gray-500">取消</button>
              <button onClick={submitSetPin} className="flex-1 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium">保存</button>
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
              {/* 商品图(可选):选了本地预览,提交时上传;编辑时显示已有图 */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                {formImagePreview
                  ? <img src={formImagePreview} alt="预览" className="h-11 w-11 rounded-lg object-cover" />
                  : editReward?.image_url
                    ? <img src={editReward.image_url} alt="已有图" className="h-11 w-11 rounded-lg object-cover" />
                    : <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-50 text-lg">🖼️</span>}
                <span className="text-xs text-gray-500">{formImageFile ? '已选图片,提交后生效' : '点这里加商品图(可选,png/jpg/webp ≤2MB)'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                  onChange={(e) => { pickFormImage(e.target.files?.[0]); e.currentTarget.value = ''; }} />
              </label>
              <div className="flex gap-2">
                {editReward && (
                  <button onClick={() => { setEditReward(null); setRewardForm({ name: '', cost: '', stock: '', note: '' }); setFormImageFile(null); setFormImagePreview((p) => { if (p) URL.revokeObjectURL(p); return null; }); }}
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
                <div key={r.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${r.is_active ? 'border-black/[0.06]' : 'border-black/[0.04] bg-black/[0.02] opacity-60'}`}>
                  {/* 商品图 + 点击换图 */}
                  <label className="shrink-0 cursor-pointer" title="点击上传/更换图片">
                    {r.image_url
                      ? <img src={r.image_url} alt={r.name} className="h-11 w-11 rounded-lg object-cover bg-black/[0.03]" />
                      : <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-50 text-lg">🖼️</span>}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                      onChange={(e) => { onUploadImage(r.id, e.target.files?.[0]); e.currentTarget.value = ''; }} />
                  </label>
                  <div className="min-w-0 flex-1">
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

      <CoinRulesModal
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        audience="teacher"
        autoCoin={coinMode?.mode !== 'manual'}
        rules={coinMode?.rules}
      />
    </div>
  );
}
