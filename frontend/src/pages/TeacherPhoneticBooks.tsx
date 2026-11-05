/**
 * 音标教材管理 — 教师端
 *
 * ## 为什么有这个页面
 * 音标教材此前**只能命令行导入**,老师加不了新教材、改不了题目 ——
 * 唯一入口在能 ssh 的人手上。单词早就能在网页导入,这里补齐同样的能力。
 *
 * ## 校验先行
 * 音标里只要有一个键盘上没有的符号,那题学生就永远填不出来(软键盘上打不出)。
 * 所以选完文件先调 validate,把有问题的行**指名道姓**列出来,老师改好 Excel
 * 再传。后端也拦:有任何一行不合格就整本不导,不会留个残缺教材在库里。
 *
 * ## 建好之后的增删改(2026-11-05)
 * 改教材名 / 册次、上下架、删整本(先看影响);点开一本: 每节「编辑」(改编号、名字、题)、「删除」、上下移、「加一节」。
 * 同名覆盖导入现在是原地改,题目 id 不换,学生记录和挂在下面的音标听力都还在。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  BookOpen, Upload, Trash2, Eye, EyeOff, AlertTriangle, Download, Volume2, Pencil, Plus, ArrowUp, ArrowDown, X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import PhoneticTtsEditor from '../components/phonetics/PhoneticTtsEditor';
import PhoneticLessonEditor from '../components/phonetics/PhoneticLessonEditor';
import { downloadPhoneticTemplate } from '../utils/phoneticTemplate';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import {
  fetchPhoneticBooks, fetchPhoneticLessons, validatePhoneticImport,
  importPhoneticBook, updatePhoneticBook, deletePhoneticBook,
  fetchBookUsage, fetchLessonUsage, deletePhoneticLesson, reorderPhoneticLessons,
  type PhoneticUsage,
  type PhoneticBookOut, type PhoneticLessonBrief,
  type ImportLesson, type ValidateOut,
} from '../api/phoneticBooks';

/** 表头认哪些写法。与命令行脚本一致(单词/音标/释义/发音) */
const COL = {
  word: ['单词', 'word', 'Word'],
  phonetic: ['音标', 'phonetic', 'Phonetic', '音標'],
  meaning: ['释义', '意思', '中文', 'meaning', 'Meaning'],
  // 可选:标准音按这个读(cede 填 seed)。空着 = 按单词读
  tts: ['发音', '读音', '發音'],
};

const pick = (row: Record<string, unknown>, names: string[]): string => {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return '';
};

/** sheet 名里取小节编号:「1—1 拼读」→ 1—1。取不到就用整个 sheet 名 */
const codeOf = (sheet: string): string => {
  const m = sheet.match(/^(\d+[—-]\d+)/);
  return m ? m[1].replace('-', '—') : sheet.slice(0, 20);
};

export default function TeacherPhoneticBooks() {
  const [books, setBooks] = useState<PhoneticBookOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [lessons, setLessons] = useState<PhoneticLessonBrief[]>([]);

  // 待导入的解析结果
  const [staged, setStaged] = useState<{
    bookName: string; volume: string; lessons: ImportLesson[]; skipped: string[];
  } | null>(null);
  const [checked, setChecked] = useState<ValidateOut | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 正在改发音的那本
  const [ttsBook, setTtsBook] = useState<PhoneticBookOut | null>(null);
  // 改名 / 册次
  const [renaming, setRenaming] = useState<{ book: PhoneticBookOut; name: string; volume: string } | null>(null);
  // 编辑 / 新加的那一节(lessonId null = 新加)
  const [lessonEdit, setLessonEdit] = useState<{ book: PhoneticBookOut; lessonId: number | null; suggest?: string } | null>(null);
  // 删除前的影响确认
  const [confirmDel, setConfirmDel] = useState<{ title: string; usage: PhoneticUsage | null; isPreset: boolean; run: () => Promise<void> } | null>(null);

  const load = useCallback(async () => {
    try {
      setBooks(await fetchPhoneticBooks());
    } catch (e) {
      toast.error(getErrorMessage(e, '加载音标教材失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openLessons = async (id: number) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    setLessons([]);
    try {
      setLessons(await fetchPhoneticLessons(id));
    } catch (e) {
      toast.error(getErrorMessage(e, '加载分节失败'));
    }
  };

  const onTemplate = () => {
    try {
      downloadPhoneticTemplate();
      toast.success('模板已下载:照着「1—1 拼读」那两张表填,填写说明在第一张表');
    } catch (e) {
      console.error(e);
      toast.error('模板生成失败,请重试');
    }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    setChecked(null);
    setReplace(false);
    try {
      toast.info('正在解析工作簿…');
      // 大文件在主线程解析会卡一拍,先让提示绘制出来
      await new Promise(r => setTimeout(r, 50));
      const wb = XLSX.read(await f.arrayBuffer());
      const ls: ImportLesson[] = [];
      const skipped: string[] = [];
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name]);
        const got = rows
          .map(r => ({
            word: pick(r, COL.word),
            phonetic: pick(r, COL.phonetic),
            meaning: pick(r, COL.meaning) || null,
            tts: pick(r, COL.tts) || null,
          }))
          .filter(r => r.word && r.phonetic);
        if (got.length) ls.push({ code: codeOf(name), title: name.slice(0, 200), rows: got });
        else skipped.push(name);   // 目录/说明页,没有 单词+音标 两列
      }
      if (!ls.length) {
        toast.error('没有解析到任何题目:请确认各工作表都有「单词」和「音标」两列');
        return;
      }
      setStaged({
        bookName: f.name.replace(/\.(xlsx|xls)$/i, '').trim().slice(0, 200),
        volume: '', lessons: ls, skipped,
      });
    } catch (err) {
      console.error(err);
      toast.error('文件解析失败,请确认是有效的 Excel 文件(.xlsx/.xls)');
    }
  };

  const doValidate = async () => {
    if (!staged) return;
    setBusy(true);
    try {
      const r = await validatePhoneticImport({
        book_name: staged.bookName, volume: staged.volume || null,
        lessons: staged.lessons,
      });
      setChecked(r);
      if (r.ok) {
        toast.success(`校验通过:${r.lesson_count} 节 / ${r.item_count} 题`
          + (r.tts_count ? `,${r.tts_count} 个词指定了发音` : ''));
      }
      else toast.warning(`有 ${r.errors.length} 行音标不合格,改好再传`);
    } catch (e) {
      toast.error(getErrorMessage(e, '校验失败'));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!staged) return;
    setBusy(true);
    try {
      const r = await importPhoneticBook({
        book_name: staged.bookName, volume: staged.volume || null,
        lessons: staged.lessons, replace,
      });
      toast.success(
        `「${r.book_name}」导入完成:${r.lesson_count} 节 / ${r.item_count} 题`
        + (r.replaced ? '(已替换同名教材)' : ''));
      setStaged(null);
      setChecked(null);
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '导入失败'));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (b: PhoneticBookOut) => {
    try {
      await updatePhoneticBook(b.id, { is_active: !b.is_active });
      toast.success(b.is_active ? '已下架,学生看不到了' : '已上架');
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '操作失败'));
    }
  };

  const reloadLessons = async (id: number) => {
    try { setLessons(await fetchPhoneticLessons(id)); } catch { /* 列表那边已经提示过 */ }
  };

  const removeBook = async (b: PhoneticBookOut) => {
    let usage: PhoneticUsage | null = null;
    try { usage = await fetchBookUsage(b.id); } catch { /* 查不到也让删,弹窗里写明 */ }
    setConfirmDel({
      title: `删除「${b.name}」整本(${b.lesson_count} 节 / ${b.item_count} 题)`, usage, isPreset: b.is_preset,
      run: async () => {
        const r = await deletePhoneticBook(b.id) as { listening_sets?: number };
        toast.success('已删除' + (r.listening_sets ? `,挂在下面的 ${r.listening_sets} 套听力也停用了` : ''));
        if (openId === b.id) setOpenId(null);
        await load();
      },
    });
  };

  const removeLesson = async (b: PhoneticBookOut, l: PhoneticLessonBrief) => {
    let usage: PhoneticUsage | null = null;
    try { usage = await fetchLessonUsage(l.id); } catch { /* 同上 */ }
    setConfirmDel({
      title: `删除「${l.code}」这一节(${l.item_count} 题)`, usage, isPreset: b.is_preset,
      run: async () => {
        await deletePhoneticLesson(l.id);
        toast.success(`「${l.code}」已删除`);
        await Promise.all([reloadLessons(b.id), load()]);
      },
    });
  };

  const moveLesson = async (b: PhoneticBookOut, i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= lessons.length) return;
    const next = [...lessons];
    [next[i], next[j]] = [next[j], next[i]];
    setLessons(next);
    try {
      await reorderPhoneticLessons(b.id, next.map(x => x.id));
    } catch (e) {
      toast.error(getErrorMessage(e, '调顺序失败'));
      await reloadLessons(b.id);
    }
  };

  /** 接着最后一节往下编号: 1—12 → 1—13 */
  const nextCode = () => {
    const m = lessons.length ? lessons[lessons.length - 1].code.match(/^(\d+)—(\d+)$/) : null;
    return m ? `${m[1]}—${Number(m[2]) + 1}` : '';
  };

  const saveRename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) { toast.warning('教材名不能为空'); return; }
    try {
      await updatePhoneticBook(renaming.book.id, { name, volume: renaming.volume.trim() || null });
      toast.success('已保存。学生端刷新就是新名字');
      setRenaming(null);
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '保存失败'));
    }
  };

  const total = staged?.lessons.reduce((s, l) => s + l.rows.length, 0) ?? 0;

  return (
    <div className="min-h-screen bg-[#f6f7f9]">
      <StaffWorkspaceHeader
        role="teacher"
        title="音标教材管理"
        subtitle="上传音标教材 Excel,学生端「读音标 / 写音标」直接用"
        icon={BookOpen}
      />
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* 上传区 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold text-[#173047]">
            <Upload className="h-5 w-5 text-[#2f8791]" /> 上传教材
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            每个工作表 = 一小节(表名如「1—1 拼读」),表内需要
            <strong className="text-slate-700">「单词」</strong>和
            <strong className="text-slate-700">「音标」</strong>两列,
            「释义」可选。音标写法不限(<code>[eɪ]</code>/<code>/ei/</code> 都认),
            系统会统一归一成软键盘上的音素。
            标准音读错长短音的词,可以加一列<strong className="text-slate-700">「发音」</strong>,
            填一个读音一样的常见词(cede 填 seed),学生听到的就按它读。
            已经在用的教材,点下面每本的「改发音」改,不用重新上传。
          </p>

          {!staged && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-xl bg-[#2f8791] px-5 py-2.5 text-sm font-medium
                           text-white transition hover:bg-[#276f78]"
              >
                选择 Excel 文件
              </button>
              {/* 模板放在「选择文件」旁边而不是说明文字里 —— 第一次用的老师
                  多半不知道格式,得让他先看到这个 */}
              <button
                onClick={onTemplate}
                className="flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5
                           text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                <Download className="h-4 w-4" /> 下载模板
              </button>
              <span className="text-xs text-slate-400">
                第一次用先下模板,里面有示例和可用音标总表
              </span>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={onPick} />

          {staged && (
            <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-slate-500">教材名称</span>
                  <input
                    value={staged.bookName}
                    onChange={e => setStaged({ ...staged, bookName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">册次(可留空,如「第1册」)</span>
                  <input
                    value={staged.volume}
                    onChange={e => setStaged({ ...staged, volume: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <p className="text-sm text-slate-600">
                解析到 <strong>{staged.lessons.length}</strong> 节、
                <strong>{total}</strong> 题
                {staged.skipped.length > 0 && (
                  <span className="text-slate-400">
                    (跳过 {staged.skipped.length} 个没有「单词+音标」两列的表)
                  </span>
                )}
              </p>

              {checked && !checked.ok && (
                <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
                    <AlertTriangle className="h-4 w-4" />
                    {checked.errors.length} 行音标不合格,这些题学生填不出来
                  </p>
                  <div className="mt-2 max-h-48 overflow-y-auto text-xs text-amber-900">
                    {checked.errors.map((e, i) => (
                      <p key={i} className="py-0.5">
                        <span className="font-mono">{e.lesson}</span> · {e.word} —— {e.reason}
                      </p>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-amber-700">
                    改好 Excel 再传。整本要么全进要么全不进,不会留半本在库里。
                  </p>
                </div>
              )}

              {checked?.existing_book_id && (
                <label className="flex items-start gap-2 rounded-lg bg-rose-50 p-3
                                  text-sm text-rose-800 ring-1 ring-rose-200">
                  <input
                    type="checkbox" checked={replace}
                    onChange={e => setReplace(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    已存在同名教材(现有 {checked.existing_item_count} 题)。
                    勾选表示<strong>按 Excel 改这本</strong>: 同一个编号的节、同一节里同一个单词的题原地改,
                    学生做过的记录、挂在这本下面的听力都还在;Excel 里没有的节和题会删掉。
                  </span>
                </label>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={doValidate} disabled={busy || !staged.bookName.trim()}
                  className="rounded-xl bg-white px-4 py-2 text-sm text-slate-700
                             ring-1 ring-slate-200 disabled:opacity-40"
                >
                  {busy ? '校验中…' : '先校验'}
                </button>
                <button
                  onClick={doImport}
                  disabled={busy || !staged.bookName.trim() || !checked?.ok
                    || (!!checked?.existing_book_id && !replace)}
                  className="rounded-xl bg-[#2f8791] px-4 py-2 text-sm font-medium text-white
                             disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {busy ? '导入中…' : '确认导入'}
                </button>
                <button
                  onClick={() => { setStaged(null); setChecked(null); }}
                  disabled={busy}
                  className="rounded-xl px-4 py-2 text-sm text-slate-500"
                >
                  取消
                </button>
              </div>
              {!checked && (
                <p className="text-xs text-slate-400">
                  先点「先校验」—— 校验通过后「确认导入」才可点
                </p>
              )}
            </div>
          )}
        </section>

        {/* 教材列表 */}
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold text-[#173047]">
            <BookOpen className="h-5 w-5 text-[#2f8791]" /> 现有教材
          </h2>
          {loading ? (
            <p className="mt-3 text-sm text-slate-400">加载中…</p>
          ) : books.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">还没有音标教材,上传一本试试</p>
          ) : (
            <div className="mt-3 space-y-2">
              {books.map(b => (
                <div key={b.id} className="rounded-xl ring-1 ring-slate-100">
                  <div className="flex flex-wrap items-center gap-2 p-3">
                    <button
                      onClick={() => void openLessons(b.id)}
                      className="flex-1 text-left"
                    >
                      {/* 册次只在书名里**没有**它的时候才另外显示 ——
                          不判的话「飞鹰英语专用教材第1册」+ volume「第1册」
                          会连着渲染成「…第1册第1册」(实测) */}
                      <p className="flex flex-wrap items-center gap-1.5
                                    font-medium text-slate-800">
                        <span>{b.name}</span>
                        {b.volume && !b.name.includes(b.volume) && (
                          <span className="text-xs text-slate-400">{b.volume}</span>
                        )}
                        {b.is_preset && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5
                                           text-xs text-slate-500">平台预置</span>
                        )}
                        {!b.is_active && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5
                                           text-xs text-amber-700">已下架</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400">
                        {b.lesson_count} 节 · {b.item_count} 题 · {openId === b.id ? '收起' : b.can_edit ? '点开改分节和题目' : '点开看分节'}
                      </p>
                    </button>
                    {/* 改发音: 平台预置的也能点开看(只读),老师常想先听听哪些词读得不对 */}
                    <button
                      onClick={() => setTtsBook(b)}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-[#24707a]
                                 ring-1 ring-[#2f8791]/30 hover:bg-[#2f8791]/10"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                      {b.can_edit ? '改发音' : '听发音'}
                      {!!b.tts_count && <span className="text-slate-400">· {b.tts_count}</span>}
                    </button>
                    {b.can_edit ? (
                      <>
                        <button
                          onClick={() => setRenaming({ book: b, name: b.name, volume: b.volume ?? '' })}
                          title="改名字 / 册次"
                          aria-label={`改「${b.name}」的名字`}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => void toggleActive(b)}
                          title={b.is_active ? '下架' : '上架'}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                        >
                          {b.is_active
                            ? <Eye className="h-4 w-4" />
                            : <EyeOff className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => void removeBook(b)}
                          title="删除"
                          className="rounded-lg p-2 text-rose-500 hover:bg-rose-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">只读</span>
                    )}
                  </div>
                  {openId === b.id && (
                    <div className="border-t border-slate-100 p-3">
                      {lessons.length === 0 && b.lesson_count > 0 ? (
                        <p className="text-xs text-slate-400">加载中…</p>
                      ) : (
                        <>
                          {lessons.length === 0 && <p className="text-xs text-slate-400">这本还没有小节</p>}
                          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                            {lessons.map((l, i) => (
                              <div key={l.id} className="flex items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                                <button onClick={() => setLessonEdit({ book: b, lessonId: l.id })}
                                  className="min-w-0 flex-1 truncate text-left hover:text-[#24707a]"
                                  title={b.can_edit ? '编辑这一节' : '查看这一节'}>
                                  <span className="font-mono text-slate-600">{l.code}</span>
                                  {l.title && !l.title.startsWith(l.code) && <span className="ml-1 text-slate-500">{l.title}</span>}
                                  {l.title.startsWith(l.code) && l.title.length > l.code.length && (
                                    <span className="ml-1 text-slate-500">{l.title.slice(l.code.length).trim()}</span>
                                  )}
                                  <span className="ml-1.5 text-slate-400">{l.item_count} 题</span>
                                  {!!l.tts_count && <span className="ml-1 text-[#24707a]">· {l.tts_count} 改了发音</span>}
                                  {l.removed_count > 0 && <span className="ml-1 text-amber-600">已剔{l.removed_count}词</span>}
                                </button>
                                {b.can_edit && (
                                  <span className="flex shrink-0">
                                    <button onClick={() => void moveLesson(b, i, -1)} disabled={i === 0}
                                      aria-label={`${l.code} 上移`} className="rounded p-1 text-slate-400 hover:bg-white disabled:opacity-30">
                                      <ArrowUp className="h-3.5 w-3.5" /></button>
                                    <button onClick={() => void moveLesson(b, i, 1)} disabled={i === lessons.length - 1}
                                      aria-label={`${l.code} 下移`} className="rounded p-1 text-slate-400 hover:bg-white disabled:opacity-30">
                                      <ArrowDown className="h-3.5 w-3.5" /></button>
                                    <button onClick={() => setLessonEdit({ book: b, lessonId: l.id })}
                                      aria-label={`编辑 ${l.code}`} className="rounded p-1 text-slate-500 hover:bg-white">
                                      <Pencil className="h-3.5 w-3.5" /></button>
                                    <button onClick={() => void removeLesson(b, l)}
                                      aria-label={`删除 ${l.code}`} className="rounded p-1 text-rose-500 hover:bg-white">
                                      <Trash2 className="h-3.5 w-3.5" /></button>
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                          {b.can_edit && (
                            <button onClick={() => setLessonEdit({ book: b, lessonId: null, suggest: nextCode() })}
                              className="mt-2 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#2f8791] hover:bg-[#2f8791]/10">
                              <Plus className="h-3.5 w-3.5" /> 加一节
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {lessonEdit && (
        <PhoneticLessonEditor
          book={lessonEdit.book} lessonId={lessonEdit.lessonId} suggestCode={lessonEdit.suggest}
          onClose={(changed) => {
            const bid = lessonEdit.book.id;
            setLessonEdit(null);
            if (changed) { void reloadLessons(bid); void load(); }
          }}
        />
      )}
      {renaming && (
        <SmallDialog title="改名字 / 册次" onClose={() => setRenaming(null)}>
          <label className="block text-sm text-slate-600">
            教材名
            <input value={renaming.name} autoFocus maxLength={200}
              onChange={e => setRenaming({ ...renaming, name: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveRename(); }}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800" />
          </label>
          <label className="mt-3 block text-sm text-slate-600">
            册次(可空,如「第1册」)
            <input value={renaming.volume} maxLength={50}
              onChange={e => setRenaming({ ...renaming, volume: e.target.value })}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800" />
          </label>
          {renaming.book.is_preset && (
            <p className="mt-3 rounded-lg bg-sky-50 p-2.5 text-xs text-sky-800">这是平台预置教材,改了所有机构看到的都是新名字。</p>
          )}
          <p className="mt-3 text-xs text-slate-500">以后用 Excel 覆盖这本,要用新名字当文件名(系统按名字找要覆盖的那本)。</p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setRenaming(null)} className="rounded-lg px-4 py-2 text-sm text-slate-500">取消</button>
            <button onClick={() => void saveRename()} className="rounded-lg bg-[#2f8791] px-4 py-2 text-sm font-medium text-white">保存</button>
          </div>
        </SmallDialog>
      )}
      {confirmDel && <DeleteConfirm {...confirmDel} onClose={() => setConfirmDel(null)} />}
      {ttsBook && (
        <PhoneticTtsEditor
          book={ttsBook}
          onClose={(changed) => {
            setTtsBook(null);
            if (changed) {
              void load();
              if (openId === ttsBook.id) void fetchPhoneticLessons(ttsBook.id).then(setLessons).catch(() => {});
            }
          }}
        />
      )}
    </div>
  );
}


function SmallDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-[#173047]">{title}</h3>
          <button onClick={onClose} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** 删整本 / 删一节前: 把会影响什么摆出来,勾了「我知道」才能删 */
function DeleteConfirm({ title, usage, isPreset, run, onClose }: {
  title: string; usage: PhoneticUsage | null; isPreset: boolean; run: () => Promise<void>; onClose: () => void;
}) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await run(); onClose(); } catch (e) { toast.error(getErrorMessage(e, '删除失败')); setBusy(false); }
  };
  const hits = usage ? [
    usage.students ? `${usage.students} 个学生练过(写音标 ${usage.attempts} 次、读音标录音 ${usage.readings} 条),记录会留着,但学生在目录里就看不到这些题了` : '',
    usage.homework ? `${usage.homework} 份没关闭的作业布置了这里,学生那边不再显示` : '',
    usage.listening_sets ? `挂在这本下面的 ${usage.listening_sets} 套音标听力会一起停用` : '',
  ].filter(Boolean) : [];
  return (
    <SmallDialog title={title} onClose={() => !busy && onClose()}>
      {usage === null ? (
        <p className="text-sm text-amber-700">没查到会影响多少学生,删之前请自己确认没人在用。</p>
      ) : hits.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{hits.map(h => <li key={h}>{h}</li>)}</ul>
      ) : (
        <p className="text-sm text-slate-600">还没有学生练过,也没有作业和听力挂在这里。</p>
      )}
      {isPreset && <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">这是平台预置教材,所有机构都会一起没了。</p>}
      <p className="mt-3 text-xs text-slate-500">删了不能恢复。只是暂时不想让学生看到,用「下架」更好。</p>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> 我知道删了不能恢复
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-slate-500">取消</button>
        <button onClick={() => void go()} disabled={!ok || busy}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{busy ? '删除中…' : '删除'}</button>
      </div>
    </SmallDialog>
  );
}
