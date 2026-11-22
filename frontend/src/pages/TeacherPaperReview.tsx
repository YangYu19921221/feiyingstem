/**
 * 教师端「核对拆出来的题」(2026-11-22,/teacher/paper-bank/:docId)。规则见后端 services/paper_bank.py 文件头第 1 条:
 * 老师核对通过的题才进题库 —— 答案错一个,系统就会把孩子做对的判成错。
 *
 * 每道题左边是原题图(从卷子上截的,看到了才加载),右边是拆出来的文字、答案、考的知识点、每个错选项代表哪种错。
 * 拆卷 AI 拿不准的标黄(答案是它自己做的、题目有字看不清…),先停在「标黄的」那一栏;没标黄的可以一键全部通过。
 * 改了题自动算通过(老师看过了)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, FileStack, ImageOff, LoaderCircle, PencilLine, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { toast } from '../components/Toast';
import {
  approveCleanItems, editPaperItem, getKpMap, getPaperDoc, paperItemImageUrl, paperTileUrl,
  type ItemEdit, type KpPoint, type PaperDocDetail, type PaperItem,
} from '../api/paperBank';
import { getErrorMessage } from '../utils/errorMessage';

type Filter = 'flagged' | 'pending' | 'approved' | 'rejected' | 'all';
const LETTERS = 'ABCDEF';
const SOURCE_LABEL: Record<string, string> = {
  page: '卷面上标了答案', key: '答案页上的答案', ai: '答案是 AI 做的', edited: '老师改过答案',
};

function Stem({ text }: { text: string }) {
  const parts = text.split('___');
  return (
    <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-900">
      {parts.map((p, i) => (
        <span key={i}>{p}{i < parts.length - 1 && <span className="mx-1 inline-block min-w-12 border-b-2 border-slate-500 align-baseline" />}</span>
      ))}
    </p>
  );
}

/** 看到了才去取原题图(一份卷子上百道题,一次全取太慢) */
function useLazyBlob(load: () => Promise<string>) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let made: string | null = null;
    let alive = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      load().then((u) => { made = u; if (alive) setUrl(u); else URL.revokeObjectURL(u); })
        .catch(() => alive && setFailed(true));
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => { alive = false; io.disconnect(); if (made) URL.revokeObjectURL(made); };
  }, [load]);
  return { ref, url, failed };
}

function TileModal({ docId, item, onClose }: { docId: number; item: PaperItem; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    let made: string | null = null;
    const page = item.page_no;
    const tile = item.tile_idx;
    if (page != null && tile != null) {
      paperTileUrl(docId, page, tile).then((u) => { made = u; setUrl(u); }).catch(() => setUrl(''));
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (made) URL.revokeObjectURL(made); };
  }, [docId, item.page_no, item.tile_idx]);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/70 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="原卷这一栏">
      <div className="max-h-full max-w-3xl overflow-auto rounded-xl bg-white p-2" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-sm text-slate-600">第 {item.page_no} 页 · 这一栏的原图</span>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="关闭"><X className="h-5 w-5" /></button>
        </div>
        {url === null ? <div className="p-10 text-center text-sm text-slate-500">加载中…</div>
          : url ? <img src={url} alt="原卷这一栏" className="w-full" /> : <div className="p-10 text-center text-sm text-slate-500">图已经没有了</div>}
      </div>
    </div>,
    document.body,
  );
}

function ItemCard({ docId, item, points, onSaved }: {
  docId: number; item: PaperItem; points: KpPoint[]; onSaved: (it: PaperItem) => void;
}) {
  const loadImg = useCallback(() => paperItemImageUrl(item.id), [item.id]);
  const img = useLazyBlob(loadImg);
  const [showTile, setShowTile] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    stem: item.stem, options: item.options.join('\n'),
    answer: item.kind === 'mc' ? String(item.answer || '') : (item.answer as string[]).join(' / '),
    alts: (item.alts || []).map((a) => a.join(' / ')).join(' | '),
    explain: item.explain, kps: item.kps, base_word: item.base_word, needs_image: item.needs_image,
  });
  const kpName = (id: string) => points.find((p) => p.id === id)?.name || id;

  const send = async (data: ItemEdit) => {
    setBusy(true);
    try {
      const it = await editPaperItem(item.id, data);
      onSaved(it);
      setEditing(false);
    } catch (e) {
      toast.error(getErrorMessage(e, '没保存上'));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = () => {
    const data: ItemEdit = { stem: form.stem, explain: form.explain, kps: form.kps, needs_image: form.needs_image };
    if (item.kind === 'mc') {
      data.options = form.options.split('\n').map((s) => s.trim()).filter(Boolean);
      data.answer = form.answer.trim().toUpperCase().slice(0, 1);
    } else {
      data.answer = form.answer.split('/').map((s) => s.trim()).filter(Boolean);
      data.alts = form.alts ? form.alts.split('|').map((g) => g.split('/').map((s) => s.trim()).filter(Boolean)) : [];
      data.base_word = form.base_word;
    }
    void send(data);
  };

  const statusBadge = item.status === 'approved' ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">已通过</span>
    : item.status === 'rejected' ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">不要了</span>
      : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">等核对</span>;

  return (
    <article className={`grid gap-3 rounded-xl border bg-white p-3 shadow-sm sm:grid-cols-[13rem,1fr] ${item.status === 'pending' && item.flags.length ? 'border-amber-300' : 'border-slate-200'}`}>
      <div ref={img.ref} className="flex min-h-24 items-start justify-center overflow-hidden rounded-lg bg-slate-50">
        {img.url ? (
          <button type="button" onClick={() => setShowTile(true)} className="block w-full" title="点开看这一栏的原图">
            <img src={img.url} alt={`第 ${item.no} 题原图`} className="w-full" />
          </button>
        ) : img.failed ? (
          <span className="flex items-center gap-1 p-4 text-xs text-slate-400"><ImageOff className="h-4 w-4" /> 没有原图</span>
        ) : <span className="p-4 text-xs text-slate-400">原题图</span>}
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-800">第 {item.no || '?'} 题</span>
          <span>{item.kind === 'mc' ? '单项选择' : '填空'}</span>
          <span className={item.answer_source === 'ai' ? 'text-amber-800' : ''}>{SOURCE_LABEL[item.answer_source] || ''}</span>
          {statusBadge}
        </div>
        {!editing ? (
          <>
            <Stem text={item.stem} />
            {item.base_word && <p className="text-sm text-slate-500">给的词: <b className="text-slate-800">{item.base_word}</b></p>}
            {item.kind === 'mc' ? (
              <ol className="grid gap-1 sm:grid-cols-2">
                {item.options.map((o, i) => {
                  const L = LETTERS[i];
                  const right = L === item.answer;
                  const w = item.wrong?.[L];
                  return (
                    <li key={L} className={`rounded-lg px-2 py-1 text-sm ${right ? 'bg-emerald-50 font-semibold text-emerald-900 ring-1 ring-emerald-200' : 'text-slate-700'}`}>
                      {L}. {o} {right && '✓'}
                      {w?.why && <span className="block text-xs font-normal text-orange-800">选它 = {w.why}</span>}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="text-sm">
                <p>答案: <b className="text-emerald-800">{(item.answer as string[]).join(' / ') || '(没认出来)'}</b>
                  {item.alts?.some((a) => a.length) && <span className="text-slate-500">(也算对: {item.alts.map((a) => a.join('、')).filter(Boolean).join(';')})</span>}</p>
                {item.traps?.map((t) => <p key={t.text} className="text-xs text-orange-800">填成 {t.text} = {t.why}</p>)}
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {item.kps.map((k) => <span key={k} className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-900 ring-1 ring-orange-200">{kpName(k)}</span>)}
            </div>
            {item.explain && <p className="text-xs text-slate-500">讲解: {item.explain}</p>}
            {item.flags.length > 0 && (
              <ul className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                {item.flags.map((f) => <li key={f}>· {f}</li>)}
              </ul>
            )}
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <label className="block"><span className="text-slate-600">题目(空写成 ___)</span>
              <textarea value={form.stem} onChange={(e) => setForm({ ...form, stem: e.target.value })} rows={3}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-base outline-none focus:border-orange-400 sm:text-sm" /></label>
            {item.kind === 'mc' ? (
              <>
                <label className="block"><span className="text-slate-600">选项(一行一个,不用写 A. B.)</span>
                  <textarea value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} rows={4}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-base outline-none focus:border-orange-400 sm:text-sm" /></label>
                <label className="block"><span className="text-slate-600">答案(选项字母)</span>
                  <input value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} maxLength={1}
                    className="mt-1 w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-base uppercase outline-none focus:border-orange-400 sm:text-sm" /></label>
              </>
            ) : (
              <>
                <label className="block"><span className="text-slate-600">答案(几个空用 / 隔开)</span>
                  <input value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-base outline-none focus:border-orange-400 sm:text-sm" /></label>
                <label className="block"><span className="text-slate-600">另外也算对的写法(同一个空用 / 隔开,不同的空用 | 隔开,可不填)</span>
                  <input value={form.alts} onChange={(e) => setForm({ ...form, alts: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-base outline-none focus:border-orange-400 sm:text-sm" /></label>
                <label className="block"><span className="text-slate-600">给的词(可不填)</span>
                  <input value={form.base_word} onChange={(e) => setForm({ ...form, base_word: e.target.value })}
                    className="mt-1 w-48 rounded-lg border border-slate-200 px-2 py-1.5 text-base outline-none focus:border-orange-400 sm:text-sm" /></label>
              </>
            )}
            <div>
              <span className="text-slate-600">考哪个知识点(最多 3 个,第一个最主要)</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {form.kps.map((k) => (
                  <button key={k} type="button" onClick={() => setForm({ ...form, kps: form.kps.filter((x) => x !== k) })}
                    className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-900">{kpName(k)} ×</button>
                ))}
                {form.kps.length < 3 && (
                  <select value="" onChange={(e) => e.target.value && setForm({ ...form, kps: [...form.kps, e.target.value] })}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
                    <option value="">+ 加一个</option>
                    {points.filter((p) => !form.kps.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.group_label} · {p.name}</option>)}
                  </select>
                )}
              </div>
            </div>
            <label className="block"><span className="text-slate-600">讲解(孩子做完才看得到)</span>
              <input value={form.explain} onChange={(e) => setForm({ ...form, explain: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-base outline-none focus:border-orange-400 sm:text-sm" /></label>
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" checked={form.needs_image} onChange={(e) => setForm({ ...form, needs_image: e.target.checked })} />
              这题要看原图才能做(孩子那边会显示原题图)
            </label>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {editing ? (
            <>
              <button type="button" disabled={busy} onClick={saveEdit}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-[#FF6B35] px-3 text-sm font-semibold text-white disabled:bg-slate-300">
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} 保存并通过
              </button>
              <button type="button" onClick={() => setEditing(false)} className="min-h-9 rounded-lg px-3 text-sm text-slate-600 ring-1 ring-slate-200">取消</button>
            </>
          ) : (
            <>
              {item.status !== 'approved' && (
                <button type="button" disabled={busy} onClick={() => send({ status: 'approved' })}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300">
                  <Check className="h-4 w-4" /> 没问题,通过
                </button>
              )}
              <button type="button" onClick={() => setEditing(true)}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-white px-3 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                <PencilLine className="h-4 w-4" /> 改一下
              </button>
              {item.status !== 'rejected' ? (
                <button type="button" disabled={busy} onClick={() => send({ status: 'rejected' })}
                  className="min-h-9 rounded-lg px-3 text-sm text-slate-500 hover:bg-slate-100">不要这题</button>
              ) : (
                <button type="button" disabled={busy} onClick={() => send({ status: 'pending' })}
                  className="min-h-9 rounded-lg px-3 text-sm text-slate-500 hover:bg-slate-100">放回待核对</button>
              )}
            </>
          )}
        </div>
      </div>
      {showTile && <TileModal docId={docId} item={item} onClose={() => setShowTile(false)} />}
    </article>
  );
}

export default function TeacherPaperReview() {
  const { docId } = useParams();
  const id = Number(docId);
  const navigate = useNavigate();
  const [doc, setDoc] = useState<PaperDocDetail | null>(null);
  const [points, setPoints] = useState<KpPoint[]>([]);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getPaperDoc(id);
      setDoc(d);
      setFilter((f) => f ?? (d.items.some((i) => i.status === 'pending' && i.flags.length) ? 'flagged'
        : d.items.some((i) => i.status === 'pending') ? 'pending' : 'all'));
    } catch (e) {
      toast.error(getErrorMessage(e, '加载失败'));
    }
  }, [id]);
  useEffect(() => { void load(); getKpMap().then((r) => setPoints(r.points)).catch(() => undefined); }, [load]);

  const items = useMemo(() => doc?.items ?? [], [doc]);
  const counts = useMemo(() => ({
    flagged: items.filter((i) => i.status === 'pending' && i.flags.length).length,
    pending: items.filter((i) => i.status === 'pending').length,
    approved: items.filter((i) => i.status === 'approved').length,
    rejected: items.filter((i) => i.status === 'rejected').length,
    all: items.length,
    clean: items.filter((i) => i.status === 'pending' && !i.flags.length).length,
  }), [items]);
  const shown = useMemo(() => items.filter((i) => {
    if (filter === 'flagged') return i.status === 'pending' && i.flags.length > 0;
    if (filter === 'pending' || filter === 'approved' || filter === 'rejected') return i.status === filter;
    return true;
  }), [items, filter]);
  const groups = useMemo(() => {
    const out: Array<{ key: string; title: string; section: string; items: PaperItem[] }> = [];
    for (const it of shown) {
      const key = `${it.paper_title}|${it.section}`;
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(it);
      else out.push({ key, title: it.paper_title, section: it.section, items: [it] });
    }
    return out;
  }, [shown]);

  const onSaved = (it: PaperItem) => setDoc((d) => d && { ...d, items: d.items.map((x) => (x.id === it.id ? it : x)) });

  const approveClean = async () => {
    if (!window.confirm(`把 ${counts.clean} 道没标黄的题一起通过?\n\n这些题的答案是卷面上标的或答案页上的。建议先在「等核对」里随手翻几道看看拆得对不对。`)) return;
    setBulkBusy(true);
    try {
      const r = await approveCleanItems(id);
      toast.success(`通过了 ${r.approved} 道`);
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '没通过'));
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title={doc ? `核对: ${doc.title}` : '核对拆出来的题'}
        subtitle={doc ? `${doc.grade} · ${doc.pages} 页 · 拆出 ${doc.item_count} 道` : undefined} icon={FileStack} backTo="/teacher/paper-bank" />
      <main className="teacher-workspace-main mx-auto max-w-5xl space-y-4">
        {!doc && <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> 加载中…</div>}
        {doc && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6">
              <p>对着每道题的原题图(电脑上在左边,手机上在上面)看: <b>题目有没有抄错、答案对不对、知识点标得像不像</b>。没问题点「通过」,有错点「改一下」(改完自动通过),拆坏了的点「不要这题」。</p>
              <p className="text-slate-500">只有通过的题才会出给孩子。每个错选项下面写的「选它 = …」,是孩子选错时系统告诉他的话,也是判断他犯哪种错的依据。</p>
              {doc.reason && <p className="mt-1 text-amber-800">{doc.reason}</p>}
              {doc.skipped.length > 0 && (
                <p className="mt-1 text-slate-500">这些大题这一版没拆: {Array.from(new Set(doc.skipped.map((s) => s.name))).join('、')}</p>
              )}
            </section>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
              {([
                ['flagged', `标黄的 ${counts.flagged}`], ['pending', `等核对 ${counts.pending}`], ['approved', `已通过 ${counts.approved}`],
                ['rejected', `不要的 ${counts.rejected}`], ['all', `全部 ${counts.all}`],
              ] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                  className={`min-h-9 rounded-lg px-3 text-sm ${filter === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
              ))}
              {counts.clean > 0 && (
                <button type="button" disabled={bulkBusy} onClick={approveClean}
                  className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white disabled:bg-slate-300">
                  {bulkBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} 没标黄的一起通过({counts.clean})
                </button>
              )}
            </div>
            {shown.length === 0 && (
              <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                {filter === 'flagged' ? '标黄的都看完了。' : '这一栏没有题。'}
                {counts.pending === 0 && counts.approved > 0 && (
                  <button type="button" onClick={() => navigate('/teacher/paper-bank/class')} className="ml-2 font-semibold text-[#d9541e] underline">去看全班薄弱点、布置小卷</button>
                )}
              </p>
            )}
            {groups.map((g) => (
              <section key={g.key + g.items[0].id} className="space-y-2">
                <h3 className="pt-2 text-sm font-semibold text-slate-600">{g.title} · {g.section || '题'}</h3>
                {g.items.map((it) => <ItemCard key={it.id} docId={id} item={it} points={points} onSaved={onSaved} />)}
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
