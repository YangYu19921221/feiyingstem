/**
 * 学生端-兑换商城弹窗
 * 列出可兑换商品(带图/价格/库存),点「申请兑换」发起申请等老师审批;
 * 底部展示我的申请状态(申请中/已通过/已拒绝)。
 */
import { useState, useEffect, useCallback } from 'react';
import { toast } from './Toast';
import {
  getStudentRewards, getMyRedeemRequests, applyRedeem,
  type StudentReward, type MyRedeemRequest,
} from '../api/coins';

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: '申请中', cls: 'bg-amber-100 text-amber-700' },
  approved: { text: '已通过', cls: 'bg-green-100 text-green-700' },
  rejected: { text: '已拒绝', cls: 'bg-gray-100 text-gray-500' },
};

export default function RedeemShopModal({ onClose }: { onClose: () => void }) {
  const [balance, setBalance] = useState(0);
  const [rewards, setRewards] = useState<StudentReward[]>([]);
  const [mine, setMine] = useState<MyRedeemRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'shop' | 'mine'>('shop');

  const load = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([getStudentRewards(), getMyRedeemRequests()]);
      setBalance(r.balance); setRewards(r.rewards); setMine(m);
    } catch { /* 静默 */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const apply = async (r: StudentReward) => {
    if (busy) return;
    if (balance < r.cost) { toast.warning(`金币不足,还差 ${r.cost - balance} 枚`); return; }
    setBusy(true);
    try {
      await applyRedeem(r.id);
      toast.success('已提交申请,等老师审批');
      await load();
      setTab('mine');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '申请失败');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-800 flex items-center gap-1.5">
            🎁 金币商城 <span className="text-amber-500 font-numeric">{balance}</span> <span className="text-xs text-gray-400">枚可用</span>
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">关闭</button>
        </div>

        {/* Tab */}
        <div className="flex gap-1 mb-4 bg-black/[0.03] rounded-xl p-1">
          {(['shop', 'mine'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-white shadow-sm text-amber-600' : 'text-gray-500'}`}>
              {t === 'shop' ? '可兑换' : `我的申请${mine.length ? ` (${mine.length})` : ''}`}
            </button>
          ))}
        </div>

        {tab === 'shop' ? (
          <div className="space-y-2.5">
            {rewards.map((r) => {
              const afford = balance >= r.cost;
              const disabled = busy || r.sold_out || r.pending || !afford;
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-xl border border-black/[0.06] p-2.5">
                  {r.image_url ? (
                    <img src={r.image_url} alt={r.name} className="h-14 w-14 rounded-lg object-cover shrink-0 bg-black/[0.03]" />
                  ) : (
                    <div className="h-14 w-14 rounded-lg bg-amber-50 flex items-center justify-center text-2xl shrink-0">🎁</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{r.name}</p>
                    <p className="text-xs text-amber-600 font-semibold">{r.cost} 🪙
                      {r.stock !== null && <span className="text-gray-400 font-normal"> · 剩 {r.stock}</span>}
                    </p>
                    {r.note && <p className="text-[11px] text-gray-400 truncate">{r.note}</p>}
                  </div>
                  <button
                    disabled={disabled}
                    onClick={() => apply(r)}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium disabled:opacity-40"
                  >
                    {r.sold_out ? '已兑完' : r.pending ? '申请中' : afford ? '申请兑换' : '币不足'}
                  </button>
                </div>
              );
            })}
            {rewards.length === 0 && <p className="text-center text-xs text-gray-400 py-10">老师还没上架奖品,先努力攒金币吧!</p>}
          </div>
        ) : (
          <div className="space-y-2">
            {mine.map((m) => {
              const s = STATUS_LABEL[m.status] || STATUS_LABEL.pending;
              return (
                <div key={m.id} className="flex items-center justify-between py-2 border-b border-black/[0.04]">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{m.reward_name}</p>
                    <p className="text-[11px] text-gray-400">{m.cost} 🪙 · {m.created_at.slice(5, 16).replace('T', ' ')}</p>
                  </div>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.text}</span>
                </div>
              );
            })}
            {mine.length === 0 && <p className="text-center text-xs text-gray-400 py-10">还没有兑换申请</p>}
          </div>
        )}
      </div>
    </div>
  );
}
