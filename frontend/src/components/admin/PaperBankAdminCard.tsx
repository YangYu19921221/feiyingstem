/**
 * 管理端「试卷库 · 拆卷 AI」卡片(2026-11-22,只给平台管理员): 拆卷用的 Key / 模型、开放范围、每天能拆几页、小卷几题。
 * 规则见后端 services/paper_parse.py(Key 单独一行 claude_paper,不能设默认、别的功能读不到)。
 * Key 留空 = 不改(显式分支,空串不会把密钥清掉)。
 */
import { useEffect, useState } from 'react';
import { FileStack, LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../Toast';
import { getPaperAdmin, savePaperAdmin, testPaperAdmin, type PaperAdminState } from '../../api/paperBank';
import { getErrorMessage } from '../../utils/errorMessage';

const SCOPE_LABEL: Record<string, string> = { off: '关掉', hq: '只开直营(试用)', all: '所有机构' };

export default function PaperBankAdminCard({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [st, setSt] = useState<PaperAdminState | null>(null);
  const [open, setOpen] = useState(!compact);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [fallback, setFallback] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

  const apply = (s: PaperAdminState) => {
    setSt(s);
    setModel(s.provider.model);
    setFallback(s.provider.fallback_model);
    setBaseUrl(s.provider.base_url);
  };
  useEffect(() => { getPaperAdmin().then(apply).catch(() => setSt(null)); }, []);

  if (!st) return null;
  const s = st.settings;

  const save = async (patch: Parameters<typeof savePaperAdmin>[0]) => {
    setBusy('save');
    try {
      apply(await savePaperAdmin(patch));
      setKey('');
      toast.success('保存了');
    } catch (e) {
      toast.error(getErrorMessage(e, '没保存上'));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await testPaperAdmin();
      if (r.ok) toast.success(`通了: ${r.model},${r.seconds} 秒拆出 ${r.items} 道`);
      else toast.error(`调通了但没拆出题(${r.model}),换个模型试试`);
    } catch (e) {
      toast.error(getErrorMessage(e, '没调通'));
    } finally {
      setBusy(null);
    }
  };

  const tokens = st.usage.input_tokens + st.usage.output_tokens;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <FileStack className="h-5 w-5 text-[#FF6B35]" />
        <h3 className="text-base font-semibold text-slate-900">试卷库 · 拆卷 AI</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs ${st.provider.configured && st.provider.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
          {st.provider.configured ? (st.provider.enabled ? 'Key 已填' : 'Key 已停用') : '还没填 Key,老师传不了卷子'}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{SCOPE_LABEL[s.scope]}</span>
        <div className="ml-auto flex gap-2">
          {!compact && (
            <button type="button" onClick={() => navigate('/teacher/paper-bank')} className="min-h-9 rounded-lg px-3 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">去试卷库</button>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)} className="min-h-9 rounded-lg px-3 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
            {open ? '收起' : '设置'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        近 {st.usage.days} 天拆了 {st.usage.docs} 份 / {st.usage.pages} 页,用了 {(tokens / 1000).toFixed(0)}k token。
        这个 Key 只用来拆卷,和「问小鹰老师」的 Key 分开记钱。
      </p>
      {open && (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-slate-600">Claude 中转的 Key(留空不改)</span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off"
              placeholder={st.provider.configured ? '已经填过,要换才填' : 'sk-…'}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-orange-400" />
          </label>
          <label>
            <span className="mb-1 block text-slate-600">拆卷模型</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-orange-400" />
          </label>
          <label>
            <span className="mb-1 block text-slate-600">备用模型(主模型不通时用,留空 = 不要备用)</span>
            <input value={fallback} onChange={(e) => setFallback(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-orange-400" />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-slate-600">中转地址</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-orange-400" />
          </label>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null}
              onClick={() => save({ api_key: key.trim() || undefined, model: model.trim(), fallback_model: fallback.trim(), base_url: baseUrl.trim() })}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 font-semibold text-white disabled:bg-slate-300">
              {busy === 'save' && <LoaderCircle className="h-4 w-4 animate-spin" />} 保存 Key 和模型
            </button>
            <button type="button" disabled={busy !== null || !st.provider.configured} onClick={test}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-4 text-slate-700 ring-1 ring-slate-200 disabled:opacity-50">
              {busy === 'test' && <LoaderCircle className="h-4 w-4 animate-spin" />} 试一下通不通
            </button>
            {st.provider.configured && (
              <button type="button" disabled={busy !== null} onClick={() => save({ enabled: !st.provider.enabled })}
                className="min-h-10 rounded-lg px-4 text-slate-600 ring-1 ring-slate-200">
                {st.provider.enabled ? '停用这个 Key' : '启用这个 Key'}
              </button>
            )}
          </div>
          <div className="sm:col-span-2 border-t border-slate-100 pt-3">
            <span className="mb-1 block text-slate-600">谁能用</span>
            <div className="flex flex-wrap gap-2">
              {st.scopes.map((sc) => (
                <button key={sc} type="button" disabled={busy !== null} aria-pressed={s.scope === sc} onClick={() => save({ scope: sc as typeof s.scope })}
                  className={`min-h-9 rounded-lg px-3 ${s.scope === sc ? 'bg-[#FF6B35] font-semibold text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>
                  {SCOPE_LABEL[sc]}
                </button>
              ))}
            </div>
          </div>
          {([
            ['daily_pages', '每位老师每天最多拆几页', 5, 400],
            ['daily_pages_all', '全平台每天最多拆几页(防费用失控)', 20, 3000],
            ['quiz_size', '每份小卷几道题', 5, 20],
          ] as const).map(([k, label, lo, hi]) => (
            <label key={k}>
              <span className="mb-1 block text-slate-600">{label}({lo}–{hi})</span>
              <input type="number" min={lo} max={hi} defaultValue={s[k]} key={`${k}-${s[k]}`}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v !== s[k] && v >= lo && v <= hi) void save({ [k]: v });
                }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-orange-400" />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
