/**
 * 管理端首页「小鹰老师 · 自动布置」(2026-10-30)。规则真源 backend/app/services/autopilot.py。
 * 平台只有一个总开关: 关掉 = 所有班都不再自动派、老师页也不给「按建议布置」;已经派出去的作业照常留着。
 * 每个班开不开自动、上不上限,是老师在自己的「小鹰老师 · 自动布置」页定的。
 */
import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { autopilotApi, type AdminState } from '../../api/autopilot';

const STATUS: Record<string, string> = {
  dispatched: '已派', skipped_manual: '老师自己布置了', paused: '暂停', no_book: '没有书', gated: '书要卡', finished: '书学完了',
};

export default function AutopilotAdminCard() {
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    autopilotApi.admin().then(setState).catch(() => setError('读不到小鹰老师自动布置的状态'));
  }, []);

  const toggle = async () => {
    if (!state || busy) return;
    const next = !state.enabled;
    if (!next && !window.confirm('关掉后全平台所有班都不再自动派任务,老师页的「按建议布置」也会停用。已经派出去的作业照常留着。确定关掉?')) return;
    setBusy(true);
    setError('');
    try {
      setState(await autopilotApi.saveAdmin(next));
    } catch {
      setError('保存失败,稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-panel rounded-2xl p-5 sm:p-6" aria-labelledby="autopilot-admin-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fce9dc] text-[#c76333]">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <h3 id="autopilot-admin-heading" className="font-bold text-[#173047]">小鹰老师 · 自动布置</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              小鹰老师按每个孩子的能力每天排任务(新词 + 第 2、3 轮 + 复习)、按能力调过关线、做完写点评。
              每个班默认「给建议、老师点了才布置」,老师在自己的页面里改成「签到就派」。这里是全平台总开关。
            </p>
          </div>
        </div>
        {state && (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            aria-pressed={state.enabled}
            className={`admin-focus-ring inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-60 ${
              state.enabled ? 'bg-[#e8f6ef] text-[#32815f] hover:bg-[#d8efe3]' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
          >
            {busy ? '保存中…' : state.enabled ? '开着(点击关掉)' : '关着(点击打开)'}
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {state && (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-[#f5f8fa] px-3.5 py-3">
            <dt className="text-xs text-slate-500">签到就派的班</dt>
            <dd className="mt-1 text-lg font-bold text-[#173047]">{state.auto_classes}</dd>
          </div>
          <div className="rounded-xl bg-[#f5f8fa] px-3.5 py-3">
            <dt className="text-xs text-slate-500">派过任务的孩子</dt>
            <dd className="mt-1 text-lg font-bold text-[#173047]">{state.students}</dd>
          </div>
          <div className="rounded-xl bg-[#f5f8fa] px-3.5 py-3">
            <dt className="text-xs text-slate-500">今天派了</dt>
            <dd className="mt-1 text-lg font-bold text-[#173047]">{state.today.dispatched ?? 0} 人</dd>
          </div>
          <div className="rounded-xl bg-[#f5f8fa] px-3.5 py-3">
            <dt className="text-xs text-slate-500">今天 AI 点评</dt>
            <dd className="mt-1 text-lg font-bold text-[#173047]">
              {state.ai_comments_today} 条
              <span className="ml-1 text-xs font-normal text-slate-500">{state.ai_tokens_today} token</span>
            </dd>
          </div>
        </dl>
      )}
      {state && Object.keys(state.today).some((k) => k !== 'dispatched') && (
        <p className="mt-3 text-xs text-slate-500">
          今天没派的:{' '}
          {Object.entries(state.today).filter(([k]) => k !== 'dispatched' && k !== 'claiming')
            .map(([k, v]) => `${STATUS[k] ?? k} ${v} 人`).join(' · ')}
        </p>
      )}
    </section>
  );
}
