/**
 * 音标教材 · 编辑一节(2026-11-05)
 *
 * 用户「我需要可以改教材的名字 还有些增删改查的功能你设计完善点」。以前一本建好后只能整本替换,
 * 改一个词也要重新传 Excel。这里一节一节改: 编号、名字、每题的单词 / 音标 / 释义 / 发音,加题、删题、调顺序。
 *
 * 规矩和后端同口径(api/v1/teacher/phonetic_books.py「分节 / 题目的增删改」):
 * - 有一题音标不合格一题都不存,错误列在上面
 * - 单词没改的题 id 不变,学生记录还对得上;**单词改了算新题**(这条写在页面上,老师别以为改个拼写记录还在)
 * - 新加一节时 lessonId 为空,保存走「加一节」
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  addPhoneticLesson, fetchLessonForEdit, updatePhoneticLesson, type LessonEditItem, type PhoneticBookOut,
} from '../../api/phoneticBooks';

type Row = LessonEditItem & { key: string };
let seq = 0;
const blank = (): Row => ({ key: `n${++seq}`, word: '', phonetic: '', meaning: '', tts: '' });

interface Props {
  book: PhoneticBookOut;
  /** 空 = 新加一节 */
  lessonId: number | null;
  /** 新加一节时预填的编号(接着最后一节往下) */
  suggestCode?: string;
  onClose: (changed: boolean) => void;
}

export default function PhoneticLessonEditor({ book, lessonId, suggestCode, onClose }: Props) {
  const [loading, setLoading] = useState(!!lessonId);
  const [code, setCode] = useState(suggestCode ?? '');
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<Row[]>(() => (lessonId ? [] : Array.from({ length: 5 }, blank)));
  const [canEdit, setCanEdit] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = useRef(false);
  const saved = useRef(false);

  useEffect(() => {
    if (!lessonId) return;
    fetchLessonForEdit(lessonId).then(d => {
      setCode(d.code);
      setTitle(d.title === d.code ? '' : d.title);
      setRows(d.items.map(it => ({ ...it, key: `i${it.id}` })));
      setCanEdit(d.can_edit);
    }).catch(e => {
      toast.error(getErrorMessage(e, '打开失败'));
      onClose(false);
    }).finally(() => setLoading(false));
  }, [lessonId, onClose]);

  const ro = !canEdit;
  // 同一节里重复的单词: 不拦(老师可能故意),但标出来 —— 手动加题最容易把已有的词再加一遍
  const dupWords = (() => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const w = r.word.trim().toLowerCase();
      if (w) seen.set(w, (seen.get(w) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([w]) => w));
  })();
  const touch = () => { dirty.current = true; };
  const setRow = (key: string, patch: Partial<Row>) => {
    touch();
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  };
  const move = (i: number, d: -1 | 1) => {
    touch();
    setRows(rs => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const n = [...rs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };

  const close = () => {
    if (dirty.current && !saved.current && !window.confirm('改的还没保存,关掉就不要了?')) return;
    onClose(saved.current);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const save = async () => {
    const filled = rows.filter(r => r.word.trim() || r.phonetic.trim());
    const half = filled.findIndex(r => !r.word.trim() || !r.phonetic.trim());
    if (half >= 0) { toast.warning(`第 ${rows.indexOf(filled[half]) + 1} 题单词和音标都要填`); return; }
    if (!code.trim()) { toast.warning('小节编号要填,写成「1—1」这样'); return; }
    if (lessonId && !filled.length) { toast.warning('一节至少要有一题。整节不要了,在列表里点删除'); return; }
    setSaving(true);
    setErrors([]);
    const body = {
      code: code.trim(), title: title.trim() || null,
      rows: filled.map(r => ({ id: r.id, word: r.word, phonetic: r.phonetic, meaning: r.meaning || null, tts: r.tts || null })),
    };
    try {
      const d = lessonId ? await updatePhoneticLesson(lessonId, body) : await addPhoneticLesson(book.id, body);
      saved.current = true;
      toast.success(`「${d.code}」已保存,${d.items.length} 题。学生刷新目录就能看到`);
      onClose(true);
    } catch (e) {
      const det = (e as { response?: { data?: { detail?: { errors?: string[] } } } })?.response?.data?.detail;
      if (det && Array.isArray(det.errors)) setErrors(det.errors);
      toast.error(getErrorMessage(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4"
         role="dialog" aria-modal="true" aria-label={lessonId ? `编辑小节 ${code}` : '加一节'}>
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 p-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-[#173047]">
              {lessonId ? (ro ? '查看小节' : '编辑小节') : '加一节'} · {book.name}
            </h3>
            {!ro ? (
              <p className="mt-1 text-xs leading-5 text-slate-500">
                音标只能用学生键盘上的 48 个符号,[bæd]、/bæd/ 都认。只改释义、音标、发音的题,学生做过的记录还在;
                <strong className="text-slate-700">把单词改成另一个词就算新题</strong>,旧词的记录不会算到新词头上。
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-amber-700">这是平台预置教材,只能看,要改请找平台管理员</p>
            )}
          </div>
          <button onClick={close} aria-label="关闭" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <LoaderCircle className="h-4 w-4 animate-spin" /> 加载中…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
              <label className="text-xs text-slate-500">
                小节编号
                <input value={code} disabled={ro} maxLength={20} onChange={e => { touch(); setCode(e.target.value); }}
                  placeholder="1—1" className="mt-1 block w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-sm text-slate-800" />
              </label>
              <label className="min-w-[12rem] flex-1 text-xs text-slate-500">
                小节名(可空,空着就用编号)
                <input value={title} disabled={ro} maxLength={200} onChange={e => { touch(); setTitle(e.target.value); }}
                  placeholder="1—1 拼读" className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800" />
              </label>
              <span className="text-xs text-slate-400">学生目录里显示编号,做题页顶上显示小节名</span>
            </div>

            {errors.length > 0 && (
              <div className="mx-4 mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">
                <p className="font-medium">一题都没存,先改这些:</p>
                <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-4">
              <ol className="space-y-2">
                {rows.map((r, i) => (
                  <li key={r.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 rounded-xl border border-slate-200 p-2 md:grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_auto]">
                    <span className="text-center text-sm text-slate-400">{i + 1}</span>
                    <input value={r.word} disabled={ro} onChange={e => setRow(r.key, { word: e.target.value })} placeholder="单词"
                      aria-label={`第 ${i + 1} 题单词`} title={dupWords.has(r.word.trim().toLowerCase()) ? '这一节里有两个一样的词' : undefined}
                      className={`min-w-0 rounded-lg border px-2.5 py-1.5 font-mono ${dupWords.has(r.word.trim().toLowerCase()) ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`} />
                    <input value={r.phonetic} disabled={ro} onChange={e => setRow(r.key, { phonetic: e.target.value })} placeholder="音标 [bæd]"
                      aria-label={`第 ${i + 1} 题音标`} className="min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono" />
                    <input value={r.meaning ?? ''} disabled={ro} onChange={e => setRow(r.key, { meaning: e.target.value })} placeholder="释义(可空)"
                      aria-label={`第 ${i + 1} 题释义`} className="col-start-2 min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5 md:col-start-auto" />
                    <input value={r.tts ?? ''} disabled={ro} maxLength={60} onChange={e => setRow(r.key, { tts: e.target.value })}
                      placeholder="发音(可空)" title="系统读错时填一个读音一样的词,如 cede 填 seed"
                      aria-label={`第 ${i + 1} 题发音`} className="min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-sm" />
                    {!ro && (
                      <div className="col-span-3 flex justify-end gap-0.5 md:col-span-1">
                        <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`第 ${i + 1} 题上移`}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                        <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`第 ${i + 1} 题下移`}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                        <button onClick={() => { touch(); setRows(rs => rs.filter(x => x.key !== r.key)); }} aria-label={`删掉第 ${i + 1} 题`}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {!ro && (
                <button onClick={() => { touch(); setRows(rs => [...rs, blank()]); }}
                  className="mt-2 flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-[#2f8791] hover:bg-[#2f8791]/10">
                  <Plus className="h-4 w-4" /> 加一题
                </button>
              )}
            </div>

            {!ro && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-3 sm:px-4">
                <p className="flex-1 text-xs text-slate-500">
                  {rows.filter(r => r.word.trim()).length} 题。删掉的题学生做过的记录会留着
                  {dupWords.size > 0 && <span className="ml-1 text-amber-700">· 有重复的词: {[...dupWords].join('、')}(标黄的,不是故意的就删掉一个)</span>}
                </p>
                <button onClick={close} className="rounded-xl px-4 py-2 text-sm text-slate-500">取消</button>
                <button onClick={() => void save()} disabled={saving}
                  className="flex items-center gap-1.5 rounded-xl bg-[#2f8791] px-5 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {saving && <LoaderCircle className="h-4 w-4 animate-spin" />} 保存
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
