/**
 * 查缺补漏「每一条都能自己选」(2026-11-01,用户「都需要可以自己选默认老师 你要把规则风险字面说明在教师端」)。
 * 每一项的选项、默认、会怎样、风险都从后端 services/catchup.OPTIONS 来,这里原样显示,不另写一份。
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import type { ClassSync, SyncOptionValue } from '../../api/autopilot';

export default function SyncOptionsPanel({ sync, saving, onSave }: {
  sync: ClassSync; saving: boolean;
  onSave: (opts: Record<string, SyncOptionValue | boolean>) => void;
}) {
  const [open, setOpen] = useState(false);
  const changed = sync.option_meta.filter((m) => sync.options[m.key] !== m.default);
  return (
    <div className="rounded-lg border border-sky-200 bg-white/80">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <span className="font-semibold text-slate-800">每一条规则都能自己选</span>
        <span className="text-xs text-slate-500">
          {changed.length ? `你改过 ${changed.length} 条,其余按默认` : '现在全按默认'}
        </span>
        <span className="ml-auto text-xs text-slate-500">{open ? '收起' : '展开看每一条和风险'}</span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden /> : <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-sky-100 px-3 py-3">
          {sync.option_meta.map((m) => {
            const cur = sync.options[m.key];
            const isDefault = cur === m.default;
            return (
              <fieldset key={m.key} className="rounded-lg border border-slate-200 px-3 py-2">
                <legend className="px-1 text-sm font-semibold text-slate-800">
                  {m.label}
                  {!isDefault && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">已改</span>}
                </legend>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={m.label}>
                  {m.choices.map((c) => {
                    const on = cur === c.value;
                    return (
                      <button key={String(c.value)} type="button" role="radio" aria-checked={on} disabled={saving}
                        onClick={() => !on && onSave({ [m.key]: c.value })}
                        className={`min-h-9 rounded-lg px-2.5 text-xs font-medium disabled:opacity-60 ${on ? 'bg-sky-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-600"><b className="text-slate-700">会怎样:</b>{m.effect}</p>
                <p className="mt-0.5 text-xs leading-5 text-amber-800"><b>风险:</b>{m.risk}</p>
              </fieldset>
            );
          })}
          {changed.length > 0 && (
            <button type="button" disabled={saving} onClick={() => onSave({ reset: true })}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> 全部恢复默认
            </button>
          )}
        </div>
      )}
    </div>
  );
}
