/**
 * 音标听力 —— 老师端(2026-11-03)
 *
 * 纸书《听力练习本》一页 = 一套(如「听-2」),一套 10 来题,每题: 单词 / 音标 / 提示(老师自己写:
 * 「3—4 尾2」「4—5 [k]照抄 尾2」)/ 释义(做完才给学生看)/ 发音(系统读错时填读音一样的词)/ 老师录音。
 * 学生端听音写单词和音标,两个都对才算对。规则真源 backend/app/services/phonetic_listening.py。
 *
 * 读音默认系统读(全站同一个女声);某一题想用自己的声音,点「录音」现录或「传文件」,
 * 录了就替换系统读,点「改回系统读」去掉。
 *
 * 建题有两种: 一行一行填;或者整段粘贴(从 Excel / 微信复制,一行一题,用 Tab 或两个以上空格隔开:
 * 单词 音标 提示 释义)。存的时候整套校验,有一题音标不合格就一题都不存,列出是哪题。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Headphones, Plus, Trash2, Save, Mic, Square, Upload, Volume2, X, ClipboardPaste, BarChart3, ArrowLeft, LoaderCircle,
} from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import { rawTtsUrl } from '../hooks/useAudio';
import {
  createListeningSet, deleteListeningAudio, deleteListeningSet, fetchAuthedAudio, listeningAudioUrl,
  listeningResults, teacherGetListeningSet, teacherListeningBooks, teacherListeningSets, updateListeningSet,
  uploadListeningAudio, type ListeningResults, type TeacherListeningBook, type TeacherListeningItem,
} from '../api/phoneticListening';

type Draft = TeacherListeningItem & { key: string };
let seq = 0;
const blankRow = (): Draft => ({ key: `n${++seq}`, word: '', phonetic: '', hint: '', meaning: '', tts: '' });

/** 粘贴一段 → 题目。一行一题;Tab 或 2 个以上空格分列: 单词 音标 [提示] [释义] */
function parsePaste(text: string): Draft[] {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/);
    const [word = '', phonetic = '', hint = '', meaning = ''] = cols.map(c => c.trim());
    return { ...blankRow(), word, phonetic, hint, meaning };
  }).filter(r => r.word);
}

export default function TeacherPhoneticListening() {
  const [books, setBooks] = useState<TeacherListeningBook[] | null>(null);
  const [bookId, setBookId] = useState<number | null>(null);
  const [sets, setSets] = useState<{ id: number; title: string; item_count: number; audio_count: number; can_edit: boolean; is_platform: boolean }[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [editingCan, setEditingCan] = useState(false);
  const [editing, setEditing] = useState<{ id: number | null; title: string; rows: Draft[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [paste, setPaste] = useState<string | null>(null);
  const [results, setResults] = useState<{ title: string; data: ListeningResults } | null>(null);

  useEffect(() => {
    teacherListeningBooks().then(b => {
      setBooks(b);
      const first = b.find(x => x.can_edit) ?? b[0];
      if (first) setBookId(first.id);
    }).catch(e => toast.error(getErrorMessage(e, '加载音标教材失败')));
  }, []);

  const loadSets = useCallback(async (id: number) => {
    try {
      const r = await teacherListeningSets(id);
      setSets(r.sets);
      setCanEdit(r.can_edit);
    } catch (e) {
      toast.error(getErrorMessage(e, '加载听力失败'));
    }
  }, []);
  useEffect(() => { if (bookId) void loadSets(bookId); }, [bookId, loadSets]);

  const openSet = async (id: number) => {
    try {
      const s = await teacherGetListeningSet(id);
      setEditingCan(s.can_edit);
      setEditing({ id: s.id, title: s.title, rows: s.items.map(it => ({ ...it, key: `i${it.id}` })) });
      setErrors([]);
    } catch (e) {
      toast.error(getErrorMessage(e, '打开失败'));
    }
  };

  const newSet = () => {
    setEditingCan(true);
    setEditing({ id: null, title: `听-${sets.length + 1}`, rows: Array.from({ length: 10 }, blankRow) });
    setErrors([]);
  };

  const save = async () => {
    if (!editing || !bookId) return;
    const rows = editing.rows.filter(r => r.word.trim() || r.phonetic.trim());
    if (!rows.length) { toast.info('至少填一题'); return; }
    const half = rows.findIndex(r => !r.word.trim() || !r.phonetic.trim());
    if (half >= 0) { toast.warning(`第 ${half + 1} 题单词和音标都要填`); return; }
    setSaving(true);
    setErrors([]);
    const body = {
      title: editing.title.trim() || '听力',
      items: rows.map(r => ({ id: r.id, word: r.word, phonetic: r.phonetic, hint: r.hint || null,
        meaning: r.meaning || null, tts: r.tts || null })),
    };
    try {
      const s = editing.id ? await updateListeningSet(editing.id, body) : await createListeningSet(bookId, body);
      setEditing({ id: s.id, title: s.title, rows: s.items.map(it => ({ ...it, key: `i${it.id}` })) });
      toast.success(`已保存 ${s.items.length} 题。学生端「音标」→ 教材目录最上面能看到`);
      void loadSets(bookId);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: { errors?: string[] } } } })?.response?.data?.detail;
      if (d && Array.isArray(d.errors)) setErrors(d.errors);
      toast.error(getErrorMessage(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number, title: string) => {
    if (!window.confirm(`删除「${title}」?学生做过的记录会留着,布置了这套的作业学生那边就不显示了。`)) return;
    try {
      await deleteListeningSet(id);
      toast.success('已删除');
      if (editing?.id === id) setEditing(null);
      if (bookId) void loadSets(bookId);
    } catch (e) {
      toast.error(getErrorMessage(e, '删除失败'));
    }
  };

  const showResults = async (id: number, title: string) => {
    try {
      setResults({ title, data: await listeningResults(id) });
    } catch (e) {
      toast.error(getErrorMessage(e, '加载学情失败'));
    }
  };

  const setRow = (key: string, patch: Partial<Draft>) =>
    setEditing(ed => ed && { ...ed, rows: ed.rows.map(r => (r.key === key ? { ...r, ...patch } : r)) });


  return (
    <div className="min-h-screen bg-[#f6f7f9]">
      <StaffWorkspaceHeader role="teacher" title="音标听力" subtitle="建听力题、录读音,学生听音写单词和音标" icon={Headphones} />
      <div className="mx-auto max-w-6xl px-4 py-6">
        {!books ? (
          <div className="flex justify-center py-20"><LoaderCircle className="h-7 w-7 animate-spin text-[#2f8791]" /></div>
        ) : !books.length ? (
          <p className="rounded-2xl bg-white p-6 text-center text-slate-600 shadow-sm">
            还没有音标教材。先到「音标教材」上传一本,听力挂在教材下面。
          </p>
        ) : editing ? (
          <Editor
            editing={editing} setEditing={setEditing} setRow={setRow} canEdit={editingCan}
            saving={saving} errors={errors} onSave={save} onBack={() => { setEditing(null); if (bookId) void loadSets(bookId); }}
            onPaste={() => setPaste('')}
          />
        ) : (
          <>
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-slate-600">教材</label>
                <select value={bookId ?? ''} onChange={e => setBookId(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {books.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_preset ? '(平台预置)' : ''}</option>)}
                </select>
                {canEdit ? (
                  <button onClick={newSet} className="ml-auto flex items-center gap-1.5 rounded-xl bg-[#2f8791] px-4 py-2 text-sm font-medium text-white">
                    <Plus className="h-4 w-4" /> 新建一套听力
                  </button>
                ) : (
                  <span className="ml-auto text-sm text-slate-500">只能查看</span>
                )}
              </div>
              <p className="mt-3 text-sm text-slate-500">
                一套 = 练习本上的一页(如「听-2」)。每题填单词、音标、提示(「3—4 尾2」这些照练习本写);
                学生听读音,写出单词和音标,两个都对才算对。读音默认系统读,想用自己的声音每题可以录一段。
                布置作业: 「作业管理 → 布置句子 / 音标 / 复习 / 跟读作业」选「音标听力」。
              </p>
            </section>

            <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sets.map(s => (
                <div key={s.id} className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-lg font-bold text-[#173047]">
                      {s.title}
                      {s.is_platform && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">平台</span>}
                    </h3>
                    <span className="text-xs text-slate-500">{s.item_count} 题{s.audio_count ? ` · 录了 ${s.audio_count} 个` : ''}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => openSet(s.id)} className="rounded-lg bg-[#2f8791]/10 px-3 py-1.5 text-sm text-[#2f8791]">
                      {s.can_edit ? '编辑 / 录音' : '查看'}
                    </button>
                    <button onClick={() => showResults(s.id, s.title)} className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700">
                      <BarChart3 className="h-3.5 w-3.5" /> 学生做得怎么样
                    </button>
                    {s.can_edit && (
                      <button onClick={() => remove(s.id, s.title)} className="ml-auto rounded-lg px-2 py-1.5 text-sm text-rose-600 hover:bg-rose-50" aria-label={`删除 ${s.title}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!sets.length && (
                <p className="col-span-full rounded-2xl bg-white p-6 text-center text-slate-500 shadow-sm">
                  这本教材还没有听力。{canEdit && '点右上角「新建一套听力」。'}
                </p>
              )}
            </section>
          </>
        )}
      </div>

      {paste !== null && editing && (
        <Modal title="整段粘贴" onClose={() => setPaste(null)}>
          <p className="text-sm text-slate-600">
            一行一题,从 Excel 复制(列之间是 Tab)或用两个以上空格隔开:<br />
            <code className="text-slate-800">单词 · 音标 · 提示 · 释义</code>(提示、释义可以不填)
          </p>
          <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={10} autoFocus
            placeholder={'block\t[blɒk]\t3—4 尾2\t街区\nhoe\t[həʊ]\t3—4 元+a\t锄头'}
            className="mt-3 w-full rounded-xl border border-slate-300 p-3 font-mono text-sm" />
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setPaste(null)} className="rounded-lg px-4 py-2 text-sm text-slate-600">取消</button>
            <button onClick={() => {
              const rows = parsePaste(paste);
              if (!rows.length) { toast.info('没认出题目: 每行至少要有单词和音标'); return; }
              setEditing(ed => ed && { ...ed, rows: [...ed.rows.filter(r => r.word.trim() || r.phonetic.trim()), ...rows] });
              setPaste(null);
              toast.success(`加了 ${rows.length} 题,检查一下再保存`);
            }} className="rounded-lg bg-[#2f8791] px-4 py-2 text-sm text-white">加进去</button>
          </div>
        </Modal>
      )}

      {results && (
        <Modal title={`${results.title} · 学生做得怎么样`} onClose={() => setResults(null)} wide>
          <ResultsTable data={results.data} />
        </Modal>
      )}
    </div>
  );
}

function Editor({ editing, setEditing, setRow, canEdit, saving, errors, onSave, onBack, onPaste }: {
  editing: { id: number | null; title: string; rows: Draft[] };
  setEditing: React.Dispatch<React.SetStateAction<{ id: number | null; title: string; rows: Draft[] } | null>>;
  setRow: (key: string, patch: Partial<Draft>) => void;
  canEdit: boolean; saving: boolean; errors: string[];
  onSave: () => void; onBack: () => void; onPaste: () => void;
}) {
  const ro = !canEdit;
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <input value={editing.title} disabled={ro} maxLength={100}
          onChange={e => setEditing(ed => ed && { ...ed, title: e.target.value })}
          className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-lg font-bold text-[#173047]" aria-label="这套的名字" />
        {!ro && (
          <div className="ml-auto flex gap-2">
            <button onClick={onPaste} className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
              <ClipboardPaste className="h-4 w-4" /> 整段粘贴
            </button>
            <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 rounded-xl bg-[#2f8791] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 保存
            </button>
          </div>
        )}
      </div>
      {errors.length > 0 && (
        <div className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">
          <p className="font-medium">一题都没存,先改这些:</p>
          <ul className="mt-1 list-disc pl-5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        音标只能用学生键盘上的 48 个符号(写法不限,[blɒk]、/blɒk/ 都认)。系统读错了可以在「发音」填一个读音一样的词(cede 填 seed),
        或者直接录自己的声音;「录音」要先保存过这一题才能录。
      </p>

      <div className="mt-3 space-y-2">
        {editing.rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-xl border border-slate-200 p-2.5 lg:grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] lg:items-center">
            <span className="pt-2 text-center text-sm text-slate-400 md:pt-0">{i + 1}</span>
            <input value={r.word} disabled={ro} onChange={e => setRow(r.key, { word: e.target.value })} placeholder="单词"
              className="min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono" aria-label={`第 ${i + 1} 题单词`} />
            <input value={r.phonetic} disabled={ro} onChange={e => setRow(r.key, { phonetic: e.target.value })} placeholder="音标 [blɒk]"
              className="min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono" aria-label={`第 ${i + 1} 题音标`} />
            <input value={r.hint ?? ''} disabled={ro} maxLength={40} onChange={e => setRow(r.key, { hint: e.target.value })} placeholder="提示 3—4 尾2"
              className="col-start-2 min-w-0 rounded-lg border border-amber-300 bg-amber-50/50 px-2.5 py-1.5 lg:col-start-auto" aria-label={`第 ${i + 1} 题提示`} />
            <input value={r.meaning ?? ''} disabled={ro} onChange={e => setRow(r.key, { meaning: e.target.value })} placeholder="释义(做完才给看)"
              className="min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5" aria-label={`第 ${i + 1} 题释义`} />
            <input value={r.tts ?? ''} disabled={ro} maxLength={60} onChange={e => setRow(r.key, { tts: e.target.value })}
              placeholder="发音(可空)" title="系统读错时填一个读音一样的词,如 cede 填 seed"
              className="col-start-2 min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-sm lg:col-start-auto" aria-label={`第 ${i + 1} 题发音`} />
            <div className="col-span-3 flex flex-wrap items-center gap-1.5 lg:col-span-1 lg:flex-nowrap">
              <AudioCell row={r} ro={ro} onChange={has => setRow(r.key, { has_audio: has })} />
              {!ro && (
                <button onClick={() => setEditing(ed => ed && { ...ed, rows: ed.rows.filter(x => x.key !== r.key) })}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`删掉第 ${i + 1} 题`}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {!ro && (
        <button onClick={() => setEditing(ed => ed && { ...ed, rows: [...ed.rows, blankRow()] })}
          className="mt-3 flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-[#2f8791] hover:bg-[#2f8791]/10">
          <Plus className="h-4 w-4" /> 加一题
        </button>
      )}
    </section>
  );
}

/** 一题的读音: 听(系统读或老师录音)/ 录音 / 传文件 / 改回系统读 */
function AudioCell({ row, ro, onChange }: { row: Draft; ro: boolean; onChange: (has: boolean) => void }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const chunks = useRef<Blob[]>([]);

  const listen = async () => {
    try {
      // 老师录音: 要登录才拿得到,拉成 blob 再放。
      // 系统读: 按现在填的字现合成(填了发音读发音,否则读单词)—— 保存后学生听到的就是这个,还没保存也能先听
      const url = row.id && row.has_audio
        ? await fetchAuthedAudio(listeningAudioUrl({ id: row.id, has_audio: true }, true))
        : rawTtsUrl((row.tts || row.word).trim());
      await new Audio(url).play();
    } catch (e) {
      toast.error((e as Error)?.name === 'NotAllowedError' ? '再点一下就能听到' : getErrorMessage(e, '放不出来'));
    }
  };

  const send = async (blob: Blob, name: string) => {
    if (!row.id) return;
    setBusy(true);
    try {
      await uploadListeningAudio(row.id, blob, name);
      onChange(true);
      toast.success(`「${row.word}」换成你的录音了`);
    } catch (e) {
      toast.error(getErrorMessage(e, '上传失败'));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
        setRec(null);
        void send(blob, r.mimeType.includes('mp4') ? 'rec.m4a' : 'rec.webm');
      };
      r.start();
      setRec(r);
      window.setTimeout(() => { if (r.state === 'recording') r.stop(); }, 5000);   // 一个词最多录 5 秒
    } catch {
      toast.error('录不了音: 请允许浏览器使用麦克风(要 https 网址)');
    }
  };

  const clear = async () => {
    if (!row.id) return;
    try {
      await deleteListeningAudio(row.id);
      onChange(false);
    } catch (e) {
      toast.error(getErrorMessage(e, '没改成'));
    }
  };

  return (
    <>
      <button onClick={listen} disabled={!row.word.trim()} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-sky-50 px-2 py-1.5 text-xs text-sky-700 disabled:opacity-40">
        <Volume2 className="h-3.5 w-3.5" /> {row.has_audio ? '听录音' : '听系统读'}
      </button>
      {!ro && row.id && (rec ? (
        <button onClick={() => rec.stop()} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-rose-500 px-2 py-1.5 text-xs text-white">
          <Square className="h-3 w-3" /> 停
        </button>
      ) : (
        <>
          <button onClick={start} disabled={busy} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-slate-100 px-2 py-1.5 text-xs text-slate-700">
            <Mic className="h-3.5 w-3.5" /> 录音
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="rounded-lg bg-slate-100 p-1.5 text-slate-700" aria-label="传录音文件" title="传录音文件(mp3 / m4a)">
            <Upload className="h-3.5 w-3.5" />
          </button>
          <input ref={fileRef} type="file" accept="audio/*" hidden onChange={e => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void send(f, f.name);
          }} />
          {row.has_audio && (
            <button onClick={clear} className="shrink-0 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-xs text-slate-500 underline">改回系统读</button>
          )}
        </>
      ))}
    </>
  );
}

function ResultsTable({ data }: { data: ListeningResults }) {
  if (!data.students.length) return <p className="py-6 text-center text-slate-500">本班还没有学生做过这一套。</p>;
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-xs text-slate-500">✓ 第一次就对 · ○ 第二遍才对 · ✗ 没对 · 空 = 没做。鼠标放上去看他写的单词</p>
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2 pr-3">学生</th>
            <th className="py-2 pr-3">做了 / 一遍对</th>
            {data.items.map((it, i) => <th key={it.id} className="px-1 py-2 text-center font-mono text-xs" title={it.phonetic}>{i + 1}<br />{it.word}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.students.map(s => (
            <tr key={s.id} className="border-b last:border-0">
              <td className="py-2 pr-3 text-slate-800">{s.name}</td>
              <td className="py-2 pr-3 text-slate-600">{s.done} / {s.first_right}</td>
              {data.items.map(it => {
                const c = s.cells[String(it.id)];
                const mark = !c ? '' : c.first_ok ? '✓' : c.ok ? '○' : c.done ? '✗' : '…';
                const tone = !c ? '' : c.first_ok ? 'text-emerald-600' : c.ok ? 'text-amber-600' : 'text-rose-600';
                return <td key={it.id} className={`px-1 py-2 text-center ${tone}`} title={c?.wrote ? `写的: ${c.wrote}` : undefined}>{mark}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className={`my-auto w-full rounded-2xl bg-white p-5 shadow-xl ${wide ? 'max-w-5xl' : 'max-w-lg'}`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#173047]">{title}</h3>
          <button onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
