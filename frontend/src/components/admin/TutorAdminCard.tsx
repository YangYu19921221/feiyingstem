/**
 * 管理端首页「AI 学习助手」(2026-10-26)。规则见后端 services/tutor.py
 *
 * 学习助手用单独的一个 Claude Key(贵),只给学习助手,周报 / 例句这些不走它。
 * 这里管: 开给谁(关闭 / 只开直营 / 直营 + 卡包机构 / 全部机构)、每个学生一共送几次(用完了老师在「学习助手次数」加)、
 * 快速 / 深度思考两组模型(深度思考模型留空 = 关掉)、深度思考一次算几次、Key(留空 = 不改),
 * 以及近 7 天用了多少(回答数、提问人数、token,按模型和回答方式分开)。
 */
import { useCallback, useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { getTutorAdmin, saveTutorAdmin, testTutorAdmin, type TutorAdminState } from '../../api/tutor';

type Note = { ok: boolean; text: string } | null;

function errorText(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return e instanceof Error ? e.message : '操作失败,请稍后再试';
}

const SCOPES: Array<{ value: TutorAdminState['scope']; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'hq', label: '只开直营' },
  { value: 'pack', label: '直营 + 卡包机构(合同里写了)' },
  { value: 'all', label: '全部机构' },
];

const k = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n));

export default function TutorAdminCard() {
  const [state, setState] = useState<TutorAdminState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({
    scope: 'hq' as TutorAdminState['scope'], free_total: 20, deep_cost: 2, model: '', fallback_model: '',
    deep_model: '', deep_fallback_model: '', base_url: '', api_key: '',
  });
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  const [note, setNote] = useState<Note>(null);
  const [showUsage, setShowUsage] = useState(false);

  const apply = (s: TutorAdminState) => {
    setState(s);
    setForm({
      scope: s.scope, free_total: s.free_total, deep_cost: s.deep_cost, model: s.provider?.model ?? '',
      fallback_model: s.provider?.fallback_model ?? '', deep_model: s.provider?.deep_model ?? '',
      deep_fallback_model: s.provider?.deep_fallback_model ?? '', base_url: s.provider?.base_url ?? '', api_key: '',
    });
  };

  const load = useCallback(async () => {
    setLoadError('');
    try { apply(await getTutorAdmin()); } catch (e) { setLoadError(errorText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (busy) return;
    setBusy('save');
    setNote(null);
    try {
      apply(await saveTutorAdmin({ ...form, api_key: form.api_key.trim() || undefined }));
      setNote({ ok: true, text: '已保存' });
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy('test');
    setNote(null);
    try {
      const r = await testTutorAdmin();
      setNote({
        ok: r.results.some((x) => x.ok),
        text: r.results.map((x) => `${x.mode === 'deep' ? '深度' : '快速'} ${x.model}: ${x.ok ? `通(${(x.ms / 1000).toFixed(1)} 秒)` : x.message}`).join(';'),
      });
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy('');
    }
  };

  const today = state?.usage[0];
  const sum = (d: TutorAdminState['usage'][number] | undefined, f: 'answers' | 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'errors') =>
    (d?.by_model || []).reduce((s, m) => s + m[f], 0);
  const input = 'admin-focus-ring min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#173047]';

  return (
    <section className="admin-panel rounded-2xl p-5 sm:p-6" aria-labelledby="tutor-admin-title">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fce9dc] text-[#c76333]">
          <MessageCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="tutor-admin-title" className="font-bold text-[#173047]">AI 学习助手「小鹰老师」</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            学生问单词、语法、拍题问思路,可以选「快速」或「深度思考」(更强的模型先想再答)。用单独的 Claude Key,
            只给学习助手用,周报、例句这些照旧走默认通道。每个学生一共送几次在这里设,用完了老师在「学习助手次数」给本班学生加。
          </p>
          {loadError && <p className="mt-2 text-sm text-red-600">读取失败: {loadError}</p>}
          {state && (
            <p className="mt-2 text-sm text-slate-600">
              今天: {today?.students ?? 0} 人问了 {sum(today, 'answers')} 次
              {sum(today, 'errors') > 0 && <span className="text-amber-700"> · {sum(today, 'errors')} 次没调通</span>}
              {!state.provider?.key_ok && <span className="text-red-600"> · Key 还没配好</span>}
            </p>
          )}
        </div>
      </div>

      {state && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-xs text-slate-500">开给谁
            <select value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as TutorAdminState['scope'] }))} className={`${input} mt-1`}>
              {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-500">每个学生一共送几次(不按天清零)
            <input type="number" min={1} max={1000} value={form.free_total}
              onChange={(e) => setForm((f) => ({ ...f, free_total: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) }))}
              className={`${input} mt-1`} />
          </label>
          <label className="block text-xs text-slate-500">深度思考一次算几次
            <input type="number" min={1} max={10} value={form.deep_cost}
              onChange={(e) => setForm((f) => ({ ...f, deep_cost: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))}
              className={`${input} mt-1`} />
          </label>
          <label className="block text-xs text-slate-500">快速: 主模型
            <input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="claude-haiku-5-5" className={`${input} mt-1`} />
          </label>
          <label className="block text-xs text-slate-500">快速: 备用模型(主模型没号时自动换)
            <input value={form.fallback_model} onChange={(e) => setForm((f) => ({ ...f, fallback_model: e.target.value }))} placeholder="claude-sonnet-4-6" className={`${input} mt-1`} />
          </label>
          <label className="block text-xs text-slate-500">深度思考: 主模型(留空 = 关掉深度思考)
            <input value={form.deep_model} onChange={(e) => setForm((f) => ({ ...f, deep_model: e.target.value }))} placeholder="claude-opus-5-5" className={`${input} mt-1`} />
          </label>
          <label className="block text-xs text-slate-500">深度思考: 备用模型
            <input value={form.deep_fallback_model} onChange={(e) => setForm((f) => ({ ...f, deep_fallback_model: e.target.value }))} placeholder="claude-sonnet-5-5" className={`${input} mt-1`} />
          </label>
          <label className="block text-xs text-slate-500">中转地址
            <input value={form.base_url} onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))} placeholder="https://..." className={`${input} mt-1`} />
          </label>
          <label className="block text-xs text-slate-500">Key{state.provider?.api_key_masked ? `(现在: ${state.provider.api_key_masked},留空不改)` : ''}
            <input type="password" autoComplete="new-password" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} placeholder={state.provider ? '留空 = 不改' : 'sk-...'} className={`${input} mt-1`} />
          </label>
        </div>
      )}

      {state && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={!!busy}
            className="admin-focus-ring inline-flex min-h-11 items-center rounded-xl bg-[#35658d] px-4 text-sm font-semibold text-white transition hover:bg-[#2b5576] disabled:opacity-50">
            {busy === 'save' ? '保存中…' : '保存'}
          </button>
          <button type="button" onClick={test} disabled={!!busy || !state.provider?.key_ok}
            className="admin-secondary-light admin-focus-ring inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50">
            {busy === 'test' ? '测试中…' : '测试模型'}
          </button>
          <button type="button" onClick={() => setShowUsage((v) => !v)} aria-expanded={showUsage}
            className="admin-focus-ring inline-flex min-h-11 items-center rounded-xl px-3 text-sm text-[#397b9b] hover:bg-[#eaf5fa]">
            {showUsage ? '收起用量' : '近 7 天用量'}
          </button>
        </div>
      )}
      {note && (
        <p role="status" className={`mt-3 rounded-xl px-4 py-2.5 text-sm ${note.ok ? 'bg-[#e8f6ef] text-[#2a6f50]' : 'bg-red-50 text-red-700'}`}>{note.text}</p>
      )}

      {showUsage && state && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs text-slate-600">
            <thead className="text-slate-400">
              <tr><th className="py-1.5 pr-3 font-medium">日期</th><th className="pr-3 font-medium">方式</th><th className="pr-3 font-medium">模型</th><th className="pr-3 font-medium">回答</th><th className="pr-3 font-medium">人数</th><th className="pr-3 font-medium">输入</th><th className="pr-3 font-medium">缓存命中</th><th className="pr-3 font-medium">输出</th><th className="font-medium">没调通</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.usage.flatMap((d) => (d.by_model.length ? d.by_model.map((m, i) => (
                <tr key={`${d.date}-${m.model}-${m.mode}`}>
                  <td className="py-1.5 pr-3">{i === 0 ? d.date.slice(5) : ''}</td>
                  <td className="pr-3">{m.mode === 'deep' ? '深度思考' : '快速'}</td>
                  <td className="pr-3">{m.model}</td><td className="pr-3">{m.answers}</td><td className="pr-3">{m.students}</td>
                  <td className="pr-3">{k(m.input_tokens)}</td><td className="pr-3">{k(m.cache_read_tokens)}</td>
                  <td className="pr-3">{k(m.output_tokens)}</td><td>{m.errors || ''}</td>
                </tr>
              )) : [<tr key={d.date}><td className="py-1.5 pr-3">{d.date.slice(5)}</td><td className="pr-3 text-slate-400" colSpan={8}>没人用</td></tr>]))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">token 数按中转返回的计;缓存命中的那部分按原价一成左右计费(以中转实际扣费为准)。</p>
        </div>
      )}
    </section>
  );
}
