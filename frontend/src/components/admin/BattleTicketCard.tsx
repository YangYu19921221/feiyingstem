/**
 * 管理端首页「宠物对战: 场数和玩法」(2026-11-11;11-12 加玩法开关)。规则真源 backend/app/services/battle_tickets.py。
 * 上半张是场数(要不要先挣场数 + 那几个数),下半张是玩法开关(出招三选一、大招要拼咒语、学习增益 …,都是开 / 关)。
 *
 * 每一条的名字、选项、「会怎样」「风险」都是接口给的(OPTIONS),这里原样显示,不另写一份 ——
 * 改规则只改后端那张表,这张卡跟着变。只有平台管理员能改,改了进操作记录。
 */
import { useEffect, useState } from 'react';
import { Swords } from 'lucide-react';
import { getTicketSettings, saveTicketSettings, type TicketSettings } from '../../api/petBattle';
import { getErrorMessage } from '../../utils/errorMessage';

export default function BattleTicketCard() {
  const [state, setState] = useState<TicketSettings | null>(null);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getTicketSettings().then(setState).catch(() => setError('读不到宠物对战场数的设置'));
  }, []);

  const save = async (key: string, value: boolean | number) => {
    if (!state || busyKey) return;
    if (state.values[key] === value) return;
    if (key === 'enabled' && value === false
      && !window.confirm('关掉后孩子的对战不再限场数: 作业没做完也能一直打(以前一个孩子一天打过 54 场)。确定关掉?')) return;
    setBusyKey(key);
    setError('');
    try {
      setState(await saveTicketSettings({ [key]: value }));
    } catch (e) {
      setError(getErrorMessage(e, '保存失败,稍后再试'));
    } finally {
      setBusyKey(null);
    }
  };

  const reset = async () => {
    if (!state || busyKey) return;
    if (!window.confirm('把这几条全部改回默认值?')) return;
    setBusyKey('reset');
    setError('');
    try {
      setState(await saveTicketSettings({ reset: true }));
    } catch (e) {
      setError(getErrorMessage(e, '恢复默认失败,稍后再试'));
    } finally {
      setBusyKey(null);
    }
  };

  const enabled = state ? state.values.enabled === true : false;
  const changed = state ? Object.keys(state.values).filter((k) => state.values[k] !== state.defaults[k]) : [];
  const main = state?.options.find((o) => o.key === 'enabled');
  // 除了总开关,选项分两类: 场数的那几个数(每天送几场 …)和玩法开关(出招三选一、大招要拼咒语 …,都是开 / 关)。
  // 玩法开关和「要不要先挣场数」没关系,场数关着也要看得到、改得了
  const isToggle = (key: string) => typeof state?.defaults[key] === 'boolean';
  const rest = state?.options.filter((o) => o.key !== 'enabled' && !isToggle(o.key)) ?? [];
  const plays = state?.options.filter((o) => o.key !== 'enabled' && isToggle(o.key)) ?? [];
  const labelOf = (key: string) => {
    const opt = state?.options.find((o) => o.key === key);
    const choice = opt?.choices.find((c) => c.value === state?.values[key]);
    return choice ? choice.label.replace('(默认)', '') : '';
  };

  return (
    <section className="admin-panel rounded-2xl p-5 sm:p-6" aria-labelledby="battle-ticket-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fce9dc] text-[#c76333]">
            <Swords className="h-5 w-5" />
          </span>
          <div>
            <h3 id="battle-ticket-heading" className="font-bold text-[#173047]">宠物对战: 场数和玩法</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              {/* 接口给的那句话结尾没有句号: 补上,不然和后一句连成一句 */}
              {`${(main?.effect ?? '孩子每天先做作业、做今日复习、学新词才有对战场数').replace(/[。.!!]$/, '')}。`}
              宠物对战是孩子最爱玩的,这条规则让「想打对战」变成「先把今天该做的做了」。
            </p>
          </div>
        </div>
        {state && (
          <button
            type="button"
            onClick={() => save('enabled', !enabled)}
            disabled={busyKey !== null}
            aria-pressed={enabled}
            className={`admin-focus-ring inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-60 ${
              enabled ? 'bg-[#e8f6ef] text-[#32815f] hover:bg-[#d8efe3]' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
          >
            {busyKey === 'enabled' ? '保存中…' : enabled ? '开着(点击关掉)' : '关着(点击打开)'}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}

      {state && !enabled && main && (
        <p className="mt-3 rounded-xl bg-[#fff6e6] px-3.5 py-2.5 text-sm leading-6 text-[#8a5a12]">
          现在关着。{main.risk}
        </p>
      )}

      {state && enabled && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {rest.map((o) => (
              <div key={o.key} className="rounded-xl bg-[#f5f8fa] px-3.5 py-3">
                <dt className="text-xs text-slate-500">{o.label}</dt>
                <dd className="mt-1 text-base font-bold text-[#173047]">
                  {labelOf(o.key)}
                  {state.values[o.key] !== state.defaults[o.key] && (
                    <span className="ml-1 text-[11px] font-normal text-[#c76333]">改过</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="admin-secondary-light admin-focus-ring inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold transition"
            >
              {open ? '收起' : '改这几条(每条写了会怎样、有什么风险)'}
            </button>
            {changed.length > 0 && (
              <button
                type="button"
                onClick={reset}
                disabled={busyKey !== null}
                className="admin-focus-ring inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-60"
              >
                {busyKey === 'reset' ? '恢复中…' : '全部恢复默认'}
              </button>
            )}
          </div>

          {open && (
            <ul className="mt-4 space-y-4">
              {rest.map((o) => (
                <li key={o.key} className="rounded-xl border border-slate-100 p-4">
                  <p className="text-sm font-semibold text-[#173047]">{o.label}</p>
                  <div className="mt-2.5 flex flex-wrap gap-2" role="radiogroup" aria-label={o.label}>
                    {o.choices.map((c) => {
                      const on = state.values[o.key] === c.value;
                      return (
                        <button
                          key={String(c.value)}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={busyKey !== null}
                          onClick={() => save(o.key, c.value)}
                          className={`admin-focus-ring inline-flex min-h-11 items-center rounded-xl border px-3.5 text-sm font-semibold transition disabled:opacity-60 ${
                            on ? 'border-[#c76333] bg-[#fce9dc] text-[#8f431d]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600"><span className="font-semibold text-[#173047]">会怎样: </span>{o.effect}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600"><span className="font-semibold text-[#8a5a12]">风险: </span>{o.risk}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* 对战玩法: 每一样都能单独关(出了问题不用发版)。和上面的场数没关系,场数关着也在 */}
      {state && plays.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h4 className="text-sm font-bold text-[#173047]">对战玩法</h4>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">每一样都能单独关。改了以后,新开的对战按新的来;正在打的那一场不变。</p>
          <ul className="mt-3 space-y-3">
            {plays.map((o) => {
              const on = state.values[o.key] === true;
              return (
                <li key={o.key} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[#173047]">
                      {o.label}
                      {state.values[o.key] !== state.defaults[o.key] && (
                        <span className="ml-1.5 text-[11px] font-normal text-[#c76333]">改过</span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => save(o.key, !on)}
                      disabled={busyKey !== null}
                      aria-pressed={on}
                      aria-label={`${o.label}: 现在${on ? '开着' : '关着'}`}
                      className={`admin-focus-ring inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-60 ${
                        on ? 'bg-[#e8f6ef] text-[#32815f] hover:bg-[#d8efe3]' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
                    >
                      {busyKey === o.key ? '保存中…' : on ? '开着(点击关掉)' : '关着(点击打开)'}
                    </button>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600"><span className="font-semibold text-[#173047]">会怎样: </span>{o.effect}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600"><span className="font-semibold text-[#8a5a12]">风险: </span>{o.risk}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
