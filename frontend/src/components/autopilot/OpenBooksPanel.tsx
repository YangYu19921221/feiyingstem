/**
 * 查缺补漏「开书」(2026-11-01,规则真源 backend/app/services/catchup.py 文件头第 6 条)。
 * 小鹰老师不自己开书(分配即权限照旧),这里把没开书的情况一次列全,老师勾了一键开:
 *   ①一本书都没开 → 开他在学的那本  ②摸底测出前几册有漏洞、那本没开 → 开那几本
 *   ③卡包机构要兑换学习卡 / 专属没开通 → 只写原因,不能勾  ④不知道在学哪本 → 让老师去分配单词本
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { BookOpen, LoaderCircle, X } from 'lucide-react';
import { autopilotApi, type BookGaps } from '../../api/autopilot';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

type Row = { key: string; student_id: number; name: string; book_id: number; book_name: string; locked: string | null; kind: 'no_book' | 'gap' };

export default function OpenBooksPanel({ classId, refreshKey, onOpened }: { classId: number; refreshKey: number; onOpened: () => void }) {
  const [data, setData] = useState<BookGaps | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    autopilotApi.bookGaps(classId).then(setData).catch(() => setData(null));
  }, [classId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const a: Row[] = data.no_book.map((x) => ({ key: `${x.student_id}-${x.book_id}`, ...x, kind: 'no_book' as const }));
    const b: Row[] = data.gap_books.flatMap((x) => x.books.map((bk) => ({
      key: `${x.student_id}-${bk.book_id}`, student_id: x.student_id, name: x.name, book_id: bk.book_id,
      book_name: bk.book_name, locked: bk.locked, kind: 'gap' as const })));
    return [...a, ...b];
  }, [data]);
  const canOpen = rows.filter((r) => !r.locked);
  const locked = rows.filter((r) => r.locked);

  const show = () => {
    setPicked(new Set(canOpen.map((r) => r.key)));
    setOpen(true);
  };
  const submit = async () => {
    const items = canOpen.filter((r) => picked.has(r.key)).map((r) => ({ student_id: r.student_id, book_id: r.book_id }));
    if (!items.length) return;
    setSaving(true);
    try {
      const r = await autopilotApi.openBooks(classId, items);
      toast.success(`开好了 ${r.created} 本${r.already ? `,${r.already} 本本来就开着` : ''}${r.locked.length ? `,${r.locked.length} 本要兑换学习卡没开` : ''}`);
      setOpen(false);
      load();
      onOpened();
    } catch (e) {
      toast.error(getErrorMessage(e, '没开成,再试一次'));
    } finally {
      setSaving(false);
    }
  };

  if (!data) return null;
  const nNo = data.no_book.length, nGap = data.gap_books.length, nUnknown = data.unknown.length;
  if (!nNo && !nGap && !nUnknown) {
    return <p className="text-xs text-emerald-700">书都开好了: 每个孩子在学的书和摸底要补的书都能学。</p>;
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-900">
      <p className="font-semibold">开书</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-5">
        {nNo > 0 && <li><b>{nNo}</b> 个孩子一本书都没开,小鹰老师只能在你布置的作业单元里排</li>}
        {nGap > 0 && <li><b>{nGap}</b> 个孩子摸底测出前几册有漏洞,那几本没开,小鹰老师补不了</li>}
        {locked.length > 0 && <li>其中 <b>{locked.length}</b> 本要兑换学习卡 / 专属内容没开通,不能直接开,去「兑换码管理」发卡</li>}
        {nUnknown > 0 && (
          <li><b>{nUnknown}</b> 个孩子不知道在学哪本({data.unknown.slice(0, 5).map((x) => x.name).join('、')}{nUnknown > 5 ? '…' : ''}),
            去 <Link to="/teacher/assignments" className="font-semibold underline">分配单词本</Link> 给他们分一本</li>
        )}
      </ul>
      {canOpen.length > 0 && (
        <button type="button" onClick={show}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700">
          <BookOpen className="h-4 w-4" aria-hidden /> 看看要开哪些书({canOpen.length} 本)
        </button>
      )}
      {open && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-3" role="dialog" aria-modal="true" aria-labelledby="open-books-title">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <h3 id="open-books-title" className="font-semibold text-slate-800">给这些孩子开书(整本)</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭" className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3 text-sm">
              <p className="mb-2 text-xs text-slate-500">默认全勾上。不想开的取消勾选。开了和在「分配单词本」里分配一样,随时能在那里取消。</p>
              <label className="mb-2 flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" className="h-4 w-4" checked={picked.size === canOpen.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(canOpen.map((r) => r.key)) : new Set())} />
                全选
              </label>
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <li key={r.key} className="flex items-center gap-2 py-2">
                    <input type="checkbox" className="h-4 w-4" disabled={!!r.locked} aria-label={`给${r.name}开《${r.book_name}》`}
                      checked={!r.locked && picked.has(r.key)}
                      onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n; })} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-800">{r.name}</span>
                      <span className="text-slate-500"> · 《{r.book_name}》</span>
                      <span className="block text-xs text-slate-400">{r.locked ? r.locked : r.kind === 'no_book' ? '他在学的书' : '摸底测出要补'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
              <span className="text-xs text-slate-500">勾了 {canOpen.filter((r) => picked.has(r.key)).length} 本</span>
              <button type="button" onClick={() => setOpen(false)} className="ml-auto min-h-10 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">取消</button>
              <button type="button" onClick={() => void submit()} disabled={saving || !canOpen.some((r) => picked.has(r.key))}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />} 开书
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
