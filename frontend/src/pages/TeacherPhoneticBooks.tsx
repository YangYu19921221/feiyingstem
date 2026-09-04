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
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  BookOpen, Upload, Trash2, Eye, EyeOff, AlertTriangle, Download,
} from 'lucide-react';
import { downloadPhoneticTemplate } from '../utils/phoneticTemplate';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import {
  fetchPhoneticBooks, fetchPhoneticLessons, validatePhoneticImport,
  importPhoneticBook, updatePhoneticBook, deletePhoneticBook,
  type PhoneticBookOut, type PhoneticLessonBrief,
  type ImportLesson, type ValidateOut,
} from '../api/phoneticBooks';

/** 表头认哪些写法。与命令行脚本一致(单词/音标/释义) */
const COL = {
  word: ['单词', 'word', 'Word'],
  phonetic: ['音标', 'phonetic', 'Phonetic', '音標'],
  meaning: ['释义', '意思', '中文', 'meaning', 'Meaning'],
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
  const m = sheet.match(/^(\d+[—\-]\d+)/);
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
      if (r.ok) toast.success(`校验通过:${r.lesson_count} 节 / ${r.item_count} 题`);
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

  const removeBook = async (b: PhoneticBookOut) => {
    if (!window.confirm(
      `删除「${b.name}」?${b.lesson_count} 节 / ${b.item_count} 题会一起删掉。\n`
      + '学生已有的答题记录会保留(那是学情数据)。此操作不可撤销。')) return;
    try {
      await deletePhoneticBook(b.id);
      toast.success('已删除');
      if (openId === b.id) setOpenId(null);
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '删除失败'));
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
                    勾选表示<strong>替换</strong> —— 旧的节和题会被删掉,
                    学生的答题记录保留。
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
                        {b.lesson_count} 节 · {b.item_count} 题 · 点开看分节
                      </p>
                    </button>
                    {b.can_edit ? (
                      <>
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
                      {lessons.length === 0 ? (
                        <p className="text-xs text-slate-400">加载中…</p>
                      ) : (
                        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {lessons.map(l => (
                            <div key={l.id}
                                 className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                              <span className="font-mono text-slate-600">{l.code}</span>
                              <span className="ml-1.5 text-slate-500">{l.item_count} 题</span>
                              {l.removed_count > 0 && (
                                <span className="ml-1 text-amber-600">
                                  已剔{l.removed_count}词
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
