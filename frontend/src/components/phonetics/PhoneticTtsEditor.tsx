/**
 * 音标教材「改发音」—— 标准音读得不对的词,指定按哪个词读(2026-10-30)
 *
 * 用户原话:「有的长音或者短音发音的后台传的时候可以增加个重发音按我给的单词发音吗」。
 * 标准音是 Edge TTS 按拼写读的,cede、faff 这类生僻词常读错长短音。老师填一个读音一样的
 * 常见词(cede 填 seed),学生端「听标准音」「再听一遍」就逐字读它。
 *
 * ## 为什么不是改 Excel 再整本替换
 * 替换会删掉所有题重建,题目 id 全换 —— 学生「写对 N 个」、跟读录音全对不上。
 * 这里按题目 id 只改发音,别的一样不动。新教材可以直接在上传的 Excel 里加「发音」列。
 *
 * ## 试听
 * 「试听」逐字合成输入框里的字(rawTtsUrl),和保存后学生听到的一字不差;
 * 「听默认」走学生端不填发音时的同一个接口(edgeTtsUrl),听的就是现在学生听到的。
 * 两个按钮老师会连着点做对比,所以每次播放先停掉上一条。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Play, Search, Volume2, X } from 'lucide-react';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';
import { edgeTtsUrl, rawTtsUrl } from '../../hooks/useAudio';
import { fetchBookItems, updateBookTts, type BookItem, type PhoneticBookOut } from '../../api/phoneticBooks';

/** 与后端 services/phonetic_tokenize.check_tts_text 同口径(那边是准,这里只为当场提示) */
const TTS_MAX = 60;
const TTS_OK = /^[A-Za-z][A-Za-z '-]*$/;
const cleanTts = (v: string) => v.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
const ttsError = (v: string): string | null => {
  const t = cleanTts(v);
  if (!t) return null;
  if (t.length > TTS_MAX) return `最多 ${TTS_MAX} 个字母`;
  if (!TTS_OK.test(t)) return '只能填英文单词,不能填音标或中文';
  return null;
};

interface Props {
  book: PhoneticBookOut;
  onClose: (changed: boolean) => void;
}

export default function PhoneticTtsEditor({ book, onClose }: Props) {
  const [items, setItems] = useState<BookItem[] | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [code, setCode] = useState<string>('');
  const [q, setQ] = useState('');
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const savedOnce = useRef(false);
  const readOnly = !book.can_edit;

  useEffect(() => {
    let alive = true;
    fetchBookItems(book.id)
      .then((d) => {
        if (!alive) return;
        setItems(d);
        setCode(d[0]?.code ?? '');
      })
      .catch((e) => { toast.error(getErrorMessage(e, '加载失败')); onClose(false); });
    return () => { alive = false; };
  }, [book.id, onClose]);

  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const codes = useMemo(() => {
    const seen: string[] = [];
    for (const it of items ?? []) if (!seen.includes(it.code)) seen.push(it.code);
    return seen;
  }, [items]);

  const valueOf = (it: BookItem) => draft[it.id] ?? it.tts_text ?? '';
  const changed = useMemo(
    () => (items ?? []).filter((it) => draft[it.id] !== undefined
      && cleanTts(draft[it.id]) !== (it.tts_text ?? '')),
    [items, draft],
  );
  const badCount = changed.filter((it) => ttsError(draft[it.id])).length;

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (items ?? []).filter((it) => {
      if (kw) return it.word.toLowerCase().includes(kw) || (it.meaning ?? '').includes(kw);
      if (onlyFilled) return !!cleanTts(draft[it.id] ?? it.tts_text ?? '');
      return it.code === code;
    });
  }, [items, q, code, onlyFilled, draft]);

  const play = async (key: string, url: string) => {
    audioRef.current?.pause();
    const a = new Audio(url);
    audioRef.current = a;
    setPlaying(key);
    a.onended = () => setPlaying((p) => (p === key ? null : p));
    a.onerror = () => { setPlaying(null); toast.error('试听失败,请重试'); };
    try { await a.play(); } catch { setPlaying(null); toast.error('试听失败,请重试'); }
  };

  const save = async () => {
    if (!changed.length || badCount || saving) return;
    setSaving(true);
    try {
      const r = await updateBookTts(book.id, changed.map((it) => ({
        id: it.id, tts: cleanTts(draft[it.id]) || null,
      })));
      setItems((prev) => (prev ?? []).map((it) => (draft[it.id] !== undefined
        ? { ...it, tts_text: cleanTts(draft[it.id]) || null } : it)));
      setDraft({});
      savedOnce.current = true;
      toast.success(`已保存 ${r.updated} 个发音,学生那边马上生效(这本书现在 ${r.with_tts} 个词指定了发音)`);
    } catch (e) {
      toast.error(getErrorMessage(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (changed.length && !window.confirm(`有 ${changed.length} 个发音还没保存,关掉就不要了?`)) return;
    onClose(savedOnce.current);
  };

  // Esc 关(有没保存的先问)。输入框里按 Esc 也关 —— 这个弹层没有别的需要 Esc 的东西
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4"
         role="dialog" aria-modal="true" aria-label={`改发音:${book.name}`}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 p-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-[#173047]">改发音 · {book.name}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              标准音读得不对(长音短音读错)的词,在「发音」里填一个读音一样的常见词,
              比如 cede 填 <span className="font-mono">seed</span>。学生点「听标准音」就按它读。
              先点「听默认」听现在学生听到的,再填、点「试听」对比。空着 = 按单词读。
            </p>
            {readOnly && (
              <p className="mt-1.5 text-xs text-amber-700">这是平台预置教材,只能看,发音要平台管理员改</p>
            )}
          </div>
          <button onClick={close} aria-label="关闭" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <select
            value={code}
            onChange={(e) => { setCode(e.target.value); setQ(''); setOnlyFilled(false); }}
            disabled={!items}
            aria-label="选一节"
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          >
            {codes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="relative min-w-[9rem] flex-1">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜整本的单词"
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={onlyFilled} onChange={(e) => { setOnlyFilled(e.target.checked); setQ(''); }} />
            只看填了发音的
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-4">
          {!items ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
              <LoaderCircle className="h-4 w-4 animate-spin" /> 加载中…
            </p>
          ) : shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              {q ? '整本没有这个词' : onlyFilled ? '还没有词填了发音' : '这一节没有词'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.map((it) => {
                const v = valueOf(it);
                const err = ttsError(v);
                const dirty = draft[it.id] !== undefined && cleanTts(draft[it.id]) !== (it.tts_text ?? '');
                const t = cleanTts(v);
                return (
                  <li key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                    {/* 手机上单词占一整行,下面一行是「听默认 / 发音 / 试听」 */}
                    <div className="w-full sm:w-[9.5rem] sm:shrink-0">
                      <p className="text-sm font-medium text-slate-800">
                        {it.word}
                        {(q || onlyFilled) && <span className="ml-1.5 font-mono text-[11px] text-slate-400">{it.code}</span>}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        <span className="font-mono">{it.phonetic}</span> {it.meaning}
                      </p>
                    </div>
                    <button
                      onClick={() => play(`d${it.id}`, edgeTtsUrl(it.word))}
                      className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                    >
                      <Volume2 className="h-3.5 w-3.5" /> {playing === `d${it.id}` ? '播放中' : '听默认'}
                    </button>
                    <div className="min-w-[8rem] flex-1">
                      <input
                        value={v}
                        disabled={readOnly}
                        onChange={(e) => setDraft((d) => ({ ...d, [it.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing && t && !err) {
                            play(`t${it.id}`, rawTtsUrl(t));
                          }
                        }}
                        placeholder="发音(可留空)"
                        aria-label={`${it.word} 的发音`}
                        aria-invalid={!!err}
                        className={[
                          'w-full rounded-lg border px-2.5 py-1.5 font-mono text-sm disabled:bg-slate-50',
                          err ? 'border-rose-300 bg-rose-50/40' : dirty ? 'border-orange-300 bg-orange-50/40' : 'border-slate-200',
                        ].join(' ')}
                      />
                      {err && <p className="mt-0.5 text-[11px] text-rose-600">{err}</p>}
                    </div>
                    <button
                      onClick={() => play(`t${it.id}`, rawTtsUrl(t))}
                      disabled={!t || !!err}
                      className="flex items-center gap-1 rounded-lg bg-[#2f8791]/10 px-2 py-1.5 text-xs text-[#24707a] hover:bg-[#2f8791]/15 disabled:opacity-40"
                    >
                      <Play className="h-3.5 w-3.5" /> {playing === `t${it.id}` ? '播放中' : '试听'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-3 sm:px-4">
            <p className="flex-1 text-xs text-slate-500">
              {badCount ? <span className="text-rose-600">有 {badCount} 个发音填得不对,改好才能保存</span>
                : changed.length ? `改了 ${changed.length} 个,还没保存` : '填完点保存;只改发音,学生的进度和录音都不受影响'}
            </p>
            <button onClick={close} className="rounded-xl px-4 py-2 text-sm text-slate-500">关闭</button>
            <button
              onClick={() => void save()}
              disabled={!changed.length || !!badCount || saving}
              className="rounded-xl bg-[#2f8791] px-5 py-2 text-sm font-medium text-white disabled:bg-slate-200 disabled:text-slate-400"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
