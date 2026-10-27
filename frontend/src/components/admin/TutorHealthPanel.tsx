/**
 * 管理端「AI 学习助手」卡片顶上: 中转钱包还剩多少、两个 Key 能不能用、最近 1 小时有没有调不通(2026-10-27,
 * 后端 services/tutor_relay_health,主进程每 30 分钟自动查一次)+ 需要关心的孩子(services/tutor_safety)。
 *
 * 钱包见底 / Key 失效时孩子问什么都是「没有回答上来」,以前要等有人来报才知道 —— 这里出问题标红,点「现在查一次」立刻重查。
 * 余额单位是美元(中转后台显示的那个数)。Key 只在服务器上用,这里不显示。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeartHandshake, RefreshCw } from 'lucide-react';
import { checkTutorHealth, getAdminAlerts, getTutorHealth, type RelayHealth, type RelayProbe } from '../../api/tutor';

const TONE: Record<RelayProbe['status'], string> = {
  ok: 'text-emerald-700', low: 'text-amber-700', empty: 'text-rose-700', invalid: 'text-rose-700',
  unknown: 'text-slate-500', unset: 'text-slate-400',
};

function Line({ label, p }: { label: string; p: RelayProbe }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${TONE[p.status]}`}>{p.note}</span>
      {p.balance != null && <span className="text-slate-600">余额 ${p.balance}</span>}
    </p>
  );
}

export default function TutorHealthPanel() {
  const navigate = useNavigate();
  const [h, setH] = useState<RelayHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [alerts, setAlerts] = useState<{ open: number; urgent: number } | null>(null);
  useEffect(() => {
    getTutorHealth().then(setH).catch(() => setH(null));
    getAdminAlerts('open').then((r) => setAlerts(r.counts)).catch(() => setAlerts(null));
  }, []);

  const recheck = async () => {
    setBusy(true);
    try { setH(await checkTutorHealth()); } catch { /* 上面那行照旧显示上次的 */ } finally { setBusy(false); }
  };

  const bad = h && (['empty', 'invalid'].includes(h.tutor.status) || (h.recent.failed >= 3 && h.recent.failed * 2 >= h.recent.answers));
  const warn = h && !bad && (h.tutor.status === 'low' || ['low', 'empty', 'invalid'].includes(h.picture.status));
  return (
    <div className="mt-3 space-y-2">
      {!!alerts?.open && (
        <button type="button" onClick={() => navigate('/admin/tutor-alerts')}
          className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${alerts.urgent ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-orange-200 bg-orange-50 text-orange-900'}`}>
          <HeartHandshake className="h-4 w-4 shrink-0" aria-hidden="true" />
          <b>{alerts.urgent ? `${alerts.urgent} 个孩子说到了不想活或想伤害自己` : `${alerts.open} 个孩子需要关心`}</b>
          <span className="ml-auto text-xs">去看 →</span>
        </button>
      )}
      {h && (
        <div className={`rounded-xl border px-3 py-2 text-sm leading-6 ${bad ? 'border-rose-300 bg-rose-50' : warn ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#173047]">中转钱包和 Key</span>
            <span className="text-xs text-slate-400">每 30 分钟自动查 · 上次 {new Date(h.checked_at.endsWith('Z') || h.checked_at.includes('+') ? h.checked_at : `${h.checked_at}Z`).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
            <button type="button" onClick={() => void recheck()} disabled={busy}
              className="admin-focus-ring ml-auto inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[#397b9b] hover:bg-[#eaf5fa] disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />现在查一次
            </button>
          </div>
          <Line label="学习助手" p={h.tutor} />
          <Line label="画记忆图" p={h.picture} />
          <p className={h.recent.failed ? 'text-amber-700' : 'text-slate-500'}>
            最近 1 小时回答 {h.recent.answers} 次{h.recent.failed ? `,${h.recent.failed} 次没调通` : ',都调通了'}
          </p>
          {bad && <p className="text-xs font-semibold text-rose-700">孩子现在可能问不了: 去中转后台充值或换 Key,换了在下面填新的(留空不改)。</p>}
          {warn && <p className="text-xs text-amber-800">余额低于 ${h.warn_balance},建议这几天充值。</p>}
        </div>
      )}
    </div>
  );
}
