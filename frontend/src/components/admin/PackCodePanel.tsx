/**
 * 新政策机构「按卡种发码」。
 * 10-09 起卡种是「N 本卡」: 选卡种 → 勾正好 N 本书。能勾哪些书由卡种决定
 * (小学2本卡只列小学书、只有单本卡能勾精品书),后端再校验一遍,前端过滤只是方便。
 */
import { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cardPackApi, type CardKind, type PackInfo } from '../../api/cardPack';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';
import CardPackRules from './CardPackRules';

interface Generated { id: number; code: string }

export default function PackCodePanel({ info, onIssued }: { info: PackInfo; onIssued: () => void }) {
  const { catalog, options, status } = info;
  const [kind, setKind] = useState<CardKind>('b5');
  const [picked, setPicked] = useState<number[]>([]);
  const [kw, setKw] = useState('');
  const [count, setCount] = useState(10);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Generated[]>([]);
  const [showRules, setShowRules] = useState(false);

  const spec = catalog.kinds.find(k => k.kind === kind)!;
  const row = status?.kinds.find(k => k.kind === kind);
  // 这种卡能勾的书: 按档位 + 学段过滤,按学段分组显示
  const bookList = useMemo(() => {
    const pool = [
      ...(spec.tiers.includes('basic') ? options.basic_books : []),
      ...(spec.tiers.includes('premium') ? options.premium_books.map(b => ({ ...b, stage_label: '精品书' })) : []),
    ];
    return pool.filter(b => !spec.stage || b.stage === spec.stage);
  }, [spec, options]);
  const groups = useMemo(() => {
    const k = kw.trim();
    const m = new Map<string, typeof bookList>();
    for (const b of bookList) {
      if (k && !b.name.includes(k)) continue;
      const g = b.stage_label || '其他';
      m.set(g, [...(m.get(g) ?? []), b]);
    }
    return [...m.entries()];
  }, [bookList, kw]);
  const nameOf = useMemo(() => new Map(bookList.map(b => [b.id, b.name])), [bookList]);

  const toggle = (id: number) => setPicked(p => p.includes(id) ? p.filter(x => x !== id)
    : spec.n === 1 ? [id] : p.length >= spec.n ? p : [...p, id]);

  // 这张卡会开哪些书: 发之前就让人看到,别发完才发现选错
  const preview = spec.pick === 'none'
    ? `${options.trial_books.length} 本(${options.trial_books.map(b => b.name).join('、') || '无'})`
    : picked.length === spec.n ? picked.map(id => nameOf.get(id)).join('、') : '';

  const ready = spec.pick === 'none' || picked.length === spec.n;

  const submit = async () => {
    if (!ready) { toast.warning(`${spec.label}要正好选 ${spec.n} 本书,现在选了 ${picked.length} 本`); return; }
    if (row && count > row.left) {
      toast.warning(row.left === 0
        ? `${spec.label}额度已用完,请联系平台确认下一期到账或补货`
        : `${spec.label}只剩 ${row.left} 张,本次要发 ${count} 张`);
      return;
    }
    setBusy(true);
    try {
      const res = (await cardPackApi.generate({
        card_kind: kind, count,
        ...(spec.pick === 'books' ? { book_ids: picked } : {}),
        batch_note: note || undefined,
      })) as unknown as Generated[];
      setResult(res);
      toast.success(`已生成 ${res.length} 张${spec.label}`);
      onIssued();
    } catch (e) {
      toast.error(getErrorMessage(e, '生成失败,请重试'));
    } finally { setBusy(false); }
  };

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(result.map(c => c.code).join('\n')); toast.success('已复制'); }
    catch { toast.warning('当前浏览器不允许复制,请手动选择兑换码'); }
  };

  const input = 'w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30';

  return (
    <div className="mb-6 space-y-4">
      {/* 每档额度 */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-amber-900">学习卡额度(每种卡分开算)</h2>
          <span className="text-xs text-amber-800">
            已到账 {status?.paid_installments.length ?? 0}/{catalog.installments.length} 期
            {status?.next_installment ? ` · 下一期是第 ${status.next_installment} 期` : ` · ${catalog.installments.length} 期已付清,再要卡请找平台补货`}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {status?.kinds.map(k => (
            <div key={k.kind} className="rounded-xl bg-white/80 px-3 py-2">
              <div className="text-xs text-slate-500">{k.label}</div>
              <div className={`text-lg font-bold ${k.left === 0 ? 'text-red-600' : 'text-slate-800'}`}>
                剩 {k.left}
                <span className="ml-1 text-xs font-normal text-slate-400">/ {k.quota}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-gray-800">按卡种发码</h2>
            <p className="text-xs text-slate-500">选卡种和范围,系统自动开对应的书。每张卡半年,兑换码 {catalog.code_valid_years} 年内有效。</p>
          </div>
          <button type="button" onClick={() => setShowRules(v => !v)}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-50">
            <BookOpen className="h-4 w-4" aria-hidden="true" />{showRules ? '收起规则' : '发卡规则(必看)'}
          </button>
        </div>

        {showRules && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <CardPackRules catalog={catalog} />
            <p className="mt-3 border-t border-amber-200 pt-3 text-sm text-slate-600">
              老师也要知道这套规则(课本不能直接分配、布置作业前学生要先兑换)。
              老师在工作台「课堂推进 → 学习卡规则」能看到,也可以直接把{' '}
              <Link to="/teacher/card-rules" className="font-semibold text-[#3976a9] underline">老师版说明</Link>{' '}
              发给他们。
            </p>
          </div>
        )}

        <div role="radiogroup" aria-label="卡种" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {catalog.kinds.map(k => {
            const left = status?.kinds.find(s => s.kind === k.kind)?.left ?? 0;
            const on = k.kind === kind;
            return (
              <button key={k.kind} type="button" role="radio" aria-checked={on}
                      onClick={() => { setKind(k.kind); setPicked([]); setResult([]); }}
                      className={`rounded-xl border px-3 py-2 text-left transition ${on ? 'border-[#3976a9] bg-[#3976a9]/10' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="font-semibold text-slate-800">{k.label}<span className="ml-1 text-xs font-normal text-slate-400">¥{k.price}</span></div>
                <div className="text-[11px] leading-4 text-slate-500">{k.covers}</div>
                <div className={`mt-1 text-[11px] ${left === 0 ? 'text-red-600' : 'text-slate-400'}`}>剩 {left} 张</div>
              </button>
            );
          })}
        </div>

        {spec.pick === 'books' && (
          <fieldset className="mb-4 rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm text-gray-600">
              选书:<strong className={picked.length === spec.n ? 'text-emerald-700' : 'text-slate-800'}>已选 {picked.length} / {spec.n} 本</strong>
              {spec.stage && <span className="ml-1 text-xs text-slate-400">(只能选小学课本)</span>}
            </legend>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜书名,如「七年级」"
                     aria-label="搜书名" className={`${input} max-w-xs py-1.5 text-sm`} />
              {picked.length > 0 && (
                <button type="button" onClick={() => setPicked([])} className="text-xs text-slate-500 underline">清空</button>
              )}
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {groups.length === 0 && <p className="text-sm text-slate-400">没有可选的书</p>}
              {groups.map(([g, list]) => (
                <div key={g}>
                  <div className="mb-1 text-xs font-semibold text-slate-500">{g}</div>
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map(b => {
                      const on = picked.includes(b.id);
                      const full = !on && spec.n > 1 && picked.length >= spec.n;
                      return (
                        <label key={b.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${on ? 'bg-[#3976a9]/10 text-slate-900' : full ? 'text-slate-300' : 'text-slate-700 hover:bg-slate-50'}`}>
                          <input type={spec.n === 1 ? 'radio' : 'checkbox'} name="pack-book" checked={on} disabled={full}
                                 onChange={() => toggle(b.id)} />
                          <span className="truncate">{b.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block text-sm text-gray-600">数量
            <input type="number" min={1} max={100} value={count}
                   onChange={e => setCount(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                   className={`${input} mt-1 sm:w-24`} />
          </label>
          <label className="block min-w-[200px] flex-1 text-sm text-gray-600">备注
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="可选,如「秋季班·三年级」"
                   className={`${input} mt-1`} />
          </label>
          <button type="button" onClick={submit} disabled={busy || !ready}
                  className={`rounded-lg px-6 py-2 font-medium text-white ${busy || !ready ? 'bg-gray-400' : 'bg-[#3976a9] hover:bg-[#2e628f]'}`}>
            {busy ? '生成中…' : `生成 ${count} 张${spec.label}`}
          </button>
        </div>
        {preview && <p className="mt-2 text-xs text-slate-500">每张开:{preview}。学生兑换后 {catalog.card_days} 天有效。</p>}

        {result.length > 0 && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-green-700">已生成 {result.length} 张{spec.label}</span>
              <button type="button" onClick={copyAll} className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700">复制全部</button>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto font-mono text-sm text-green-800">
              {result.map(c => <div key={c.id}>{c.code}</div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
