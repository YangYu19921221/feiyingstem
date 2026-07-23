import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, Trash2, Edit, Upload, FileSpreadsheet, Save } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  listSentenceUnits, createSentenceUnit, updateSentenceUnit, deleteSentenceUnit,
  listSentences, createSentence, updateSentence, deleteSentence,
  bulkImportSentences,
  type SentenceUnit, type Sentence,
} from '../api/sentences';
import { toast } from '../components/Toast';
import { parseError } from '../utils/errorMessage';
import Field from '../components/Field';

/**
 * 句子集详情：左侧单元列表，右侧句子列表 + 录入。
 * - 单元 / 句子的 CRUD 全在一页里
 * - 句子支持单条录入 + Excel/CSV 批量导入
 */
export default function TeacherSentenceEditor() {
  const navigate = useNavigate();
  const { bookId } = useParams<{ bookId: string }>();
  const bid = parseInt(bookId || '0', 10);

  const [units, setUnits] = useState<SentenceUnit[]>([]);
  const [activeUnit, setActiveUnit] = useState<SentenceUnit | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingS, setSavingS] = useState(false);

  // 新单元 / 编辑单元
  const [unitDialog, setUnitDialog] = useState<{ open: boolean; editing: SentenceUnit | null }>({ open: false, editing: null });
  const [unitForm, setUnitForm] = useState({ name: '', description: '' });

  // 新句子 / 编辑句子
  const [sentForm, setSentForm] = useState<{ id?: number; english: string; chinese: string; phonetic: string; difficulty: number; topic: string; grammar_focus: string; }>({
    english: '', chinese: '', phonetic: '', difficulty: 3, topic: '', grammar_focus: '',
  });

  const loadUnits = async (selectId?: number) => {
    setLoading(true);
    try {
      const list = await listSentenceUnits(bid);
      setUnits(list);
      const target = selectId ? list.find(u => u.id === selectId) : (activeUnit ? list.find(u => u.id === activeUnit.id) : list[0]);
      if (target) {
        setActiveUnit(target);
      } else {
        setActiveUnit(null);
        setSentences([]);
      }
    } catch (err: any) {
      toast.error(parseError(err, '加载失败').message);
    } finally {
      setLoading(false);
    }
  };

  const loadSentences = async (unitId: number) => {
    try {
      setSentences(await listSentences(unitId));
    } catch (err: any) {
      toast.error(parseError(err, '加载句子失败').message);
    }
  };

  useEffect(() => { if (bid) loadUnits(); }, [bid]);
  useEffect(() => { if (activeUnit) loadSentences(activeUnit.id); }, [activeUnit?.id]);

  const openCreateUnit = () => {
    setUnitForm({ name: '', description: '' });
    setUnitDialog({ open: true, editing: null });
  };

  const openEditUnit = (u: SentenceUnit) => {
    setUnitForm({ name: u.name, description: u.description || '' });
    setUnitDialog({ open: true, editing: u });
  };

  const submitUnit = async () => {
    if (!unitForm.name.trim()) { toast.warning('请输入单元名称'); return; }
    try {
      if (unitDialog.editing) {
        await updateSentenceUnit(unitDialog.editing.id, { name: unitForm.name.trim(), description: unitForm.description.trim() || undefined });
      } else {
        await createSentenceUnit(bid, { name: unitForm.name.trim(), description: unitForm.description.trim() || undefined });
      }
      setUnitDialog({ open: false, editing: null });
      loadUnits();
    } catch (err: any) {
      toast.error(parseError(err, '保存失败').message);
    }
  };

  const handleDeleteUnit = async (u: SentenceUnit) => {
    if (!confirm(`确定删除单元「${u.name}」？里面 ${u.sentence_count} 句也会一起删除。`)) return;
    try {
      await deleteSentenceUnit(u.id);
      toast.success('已删除');
      loadUnits();
    } catch (err: any) {
      toast.error(parseError(err, '删除失败').message);
    }
  };

  const resetSentForm = () => setSentForm({ english: '', chinese: '', phonetic: '', difficulty: 3, topic: '', grammar_focus: '' });

  const submitSentence = async () => {
    if (!activeUnit) return;
    if (!sentForm.english.trim() || !sentForm.chinese.trim()) {
      toast.warning('英文和中文都要填'); return;
    }
    setSavingS(true);
    try {
      const payload = {
        english: sentForm.english.trim(),
        chinese: sentForm.chinese.trim(),
        phonetic: sentForm.phonetic.trim() || undefined,
        difficulty: sentForm.difficulty,
        topic: sentForm.topic.trim() || undefined,
        grammar_focus: sentForm.grammar_focus.trim() || undefined,
      };
      if (sentForm.id) {
        await updateSentence(sentForm.id, payload);
      } else {
        await createSentence(activeUnit.id, payload);
      }
      resetSentForm();
      loadSentences(activeUnit.id);
      loadUnits();  // 更新计数
    } catch (err: any) {
      toast.error(parseError(err, '保存失败').message);
    } finally {
      setSavingS(false);
    }
  };

  const editSentence = (s: Sentence) => {
    setSentForm({
      id: s.id,
      english: s.english, chinese: s.chinese, phonetic: s.phonetic || '',
      difficulty: s.difficulty, topic: s.topic || '', grammar_focus: s.grammar_focus || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteSentence = async (s: Sentence) => {
    if (!confirm(`删除句子？\n${s.english}`)) return;
    try {
      await deleteSentence(s.id);
      if (activeUnit) loadSentences(activeUnit.id);
      loadUnits();
    } catch (err: any) {
      toast.error(parseError(err, '删除失败').message);
    }
  };

  const handleFileUpload = async (file: File | null) => {
    if (!file || !activeUnit) return;
    try {
      // 后端只解析 CSV — 若是 xlsx，浏览器先转 CSV 再上传
      let toUpload: File = file;
      if (/\.xlsx?$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(ws);
        // 加 UTF-8 BOM，避免后端 GBK 误判（虽然后端会试 utf-8-sig）
        toUpload = new File(
          [new Uint8Array([0xEF, 0xBB, 0xBF]), csv],
          file.name.replace(/\.xlsx?$/i, '.csv'),
          { type: 'text/csv;charset=utf-8' },
        );
      }
      const r = await bulkImportSentences(activeUnit.id, toUpload);
      const tip = `成功导入 ${r.added} 条`
        + (r.skipped ? `，跳过 ${r.skipped} 条` : '')
        + (r.errors?.length ? `\n${r.errors.join('；')}` : '');
      toast.success(tip);
      loadSentences(activeUnit.id);
      loadUnits();
    } catch (err: any) {
      toast.error(parseError(err, '导入失败').message);
    }
  };

  const downloadTemplate = () => {
    const rows = [
      { english: 'How are you?', chinese: '你好吗？', phonetic: '/haʊ ɑːr juː/', difficulty: 1, topic: '问候', grammar_focus: '一般疑问句' },
      { english: 'I am a student.', chinese: '我是一个学生。', phonetic: '', difficulty: 2, topic: '自我介绍', grammar_focus: '系动词' },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ['english', 'chinese', 'phonetic', 'difficulty', 'topic', 'grammar_focus'],
    });
    ws['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 6 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '句子导入模板');
    XLSX.writeFile(wb, '句子导入模板.xlsx');
  };

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button onClick={() => navigate('/teacher/sentences')} className="flex items-center gap-2 text-ink-soft hover:text-ink text-sm">
            <ArrowLeft className="w-4 h-4" /> 返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">句子集详情</h1>
          <div className="w-12" />
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-5 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* 左：单元 */}
          <aside className="lg:col-span-3">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-medium text-ink-soft">单元</span>
              <button onClick={openCreateUnit} className="text-xs text-accent-warm hover:underline inline-flex items-center gap-1">
                <Plus className="w-3 h-3" /> 新增
              </button>
            </div>
            <div className="bg-white rounded-2xl border border-black/[0.05] overflow-hidden divide-y divide-black/[0.05]">
              {loading ? (
                <div className="py-8 text-center text-xs text-ink-mute">加载中…</div>
              ) : units.length === 0 ? (
                <div className="py-8 text-center text-xs text-ink-mute">
                  还没有单元，点上方"新增"
                </div>
              ) : units.map(u => (
                <div
                  key={u.id}
                  onClick={() => setActiveUnit(u)}
                  className={`px-4 py-3 cursor-pointer flex items-start gap-2 ${activeUnit?.id === u.id ? 'bg-accent-warm/[0.08]' : 'hover:bg-black/[0.02]'}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">
                      <span className="text-ink-mute text-xs mr-1">{u.unit_number}.</span>
                      {u.name}
                    </p>
                    <p className="text-[11px] text-ink-mute mt-0.5">{u.sentence_count} 句</p>
                  </div>
                  <div className="flex flex-col gap-1 opacity-60">
                    <button onClick={(e) => { e.stopPropagation(); openEditUnit(u); }} title="编辑">
                      <Edit className="w-3.5 h-3.5 text-ink-mute hover:text-accent-warm" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteUnit(u); }} title="删除">
                      <Trash2 className="w-3.5 h-3.5 text-ink-mute hover:text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* 右：句子录入 + 列表 */}
          <main className="lg:col-span-9 space-y-5">
            {!activeUnit ? (
              <div className="py-20 text-center text-ink-mute text-sm">先在左侧选一个单元</div>
            ) : (
              <>
                {/* 录入栏 */}
                <section className="bg-white rounded-2xl border border-black/[0.05] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display text-base font-semibold text-ink">
                      {sentForm.id ? '编辑句子' : '录入新句子'} · 当前单元「{activeUnit.name}」
                    </h3>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-accent-warm hover:underline cursor-pointer inline-flex items-center gap-1">
                        <Upload className="w-3.5 h-3.5" />
                        批量导入（CSV / Excel）
                        <input
                          type="file" accept=".csv,.xls,.xlsx" className="hidden"
                          onChange={e => { handleFileUpload(e.target.files?.[0] || null); e.target.value = ''; }}
                        />
                      </label>
                      <button onClick={downloadTemplate} className="text-xs text-ink-soft hover:text-ink inline-flex items-center gap-1">
                        <FileSpreadsheet className="w-3.5 h-3.5" /> 模板
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="英文" required>
                      <input
                        value={sentForm.english}
                        onChange={e => setSentForm({ ...sentForm, english: e.target.value })}
                        placeholder="How are you?"
                        className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none"
                      />
                    </Field>
                    <Field label="中文" required>
                      <input
                        value={sentForm.chinese}
                        onChange={e => setSentForm({ ...sentForm, chinese: e.target.value })}
                        placeholder="你好吗？"
                        className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none"
                      />
                    </Field>
                    <Field label="音标（可选）">
                      <input
                        value={sentForm.phonetic}
                        onChange={e => setSentForm({ ...sentForm, phonetic: e.target.value })}
                        placeholder="/haʊ ɑːr juː/"
                        className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none"
                      />
                    </Field>
                    <Field label="难度 1-5">
                      <select
                        value={sentForm.difficulty}
                        onChange={e => setSentForm({ ...sentForm, difficulty: parseInt(e.target.value, 10) })}
                        className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none bg-white"
                      >
                        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </Field>
                    <Field label="主题（可选）">
                      <input
                        value={sentForm.topic}
                        onChange={e => setSentForm({ ...sentForm, topic: e.target.value })}
                        placeholder="问候 / 一般现在时"
                        className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none"
                      />
                    </Field>
                    <Field label="语法点（可选）">
                      <input
                        value={sentForm.grammar_focus}
                        onChange={e => setSentForm({ ...sentForm, grammar_focus: e.target.value })}
                        placeholder="一般疑问句"
                        className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none"
                      />
                    </Field>
                  </div>
                  <div className="flex gap-3 mt-4">
                    {sentForm.id && (
                      <button
                        onClick={resetSentForm}
                        className="px-4 py-2 rounded-lg border border-black/10 text-ink-soft hover:bg-black/[0.02]"
                      >取消编辑</button>
                    )}
                    <button
                      onClick={submitSentence}
                      disabled={savingS}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-accent-warm text-white font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      {savingS ? '保存中…' : sentForm.id ? '更新句子' : '添加句子'}
                    </button>
                  </div>
                </section>

                {/* 列表 */}
                <section className="bg-white rounded-2xl border border-black/[0.05] overflow-hidden">
                  <div className="px-5 py-3 border-b border-black/[0.05] flex items-baseline gap-2">
                    <span className="font-display text-sm font-semibold text-ink">已录入句子</span>
                    <span className="text-xs text-ink-mute">共 {sentences.length} 句</span>
                  </div>
                  {sentences.length === 0 ? (
                    <div className="py-12 text-center text-sm text-ink-mute">还没有句子，用上面表单录入或上传 CSV</div>
                  ) : (
                    <div className="divide-y divide-black/[0.05]">
                      {sentences.map(s => (
                        <div key={s.id} className="px-5 py-3.5 flex items-start gap-3 hover:bg-black/[0.02]">
                          <span className="text-xs text-ink-mute font-numeric mt-0.5 w-6">{s.order_index}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-ink">{s.english}</p>
                            <p className="text-sm text-ink-soft mt-0.5">{s.chinese}</p>
                            {(s.phonetic || s.topic || s.grammar_focus) && (
                              <p className="text-[11px] text-ink-mute mt-1 truncate">
                                {[s.phonetic, s.topic, s.grammar_focus, `难度 ${s.difficulty}`].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                          <button onClick={() => editSentence(s)} className="p-1.5 text-ink-mute hover:text-accent-warm">
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDeleteSentence(s)} className="p-1.5 text-ink-mute hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </main>
        </div>
      </div>

      {/* 单元弹窗 */}
      <AnimatePresence>
        {unitDialog.open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-5"
            onClick={() => setUnitDialog({ open: false, editing: null })}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 w-full max-w-sm"
            >
              <h3 className="font-display text-lg font-semibold text-ink mb-4">
                {unitDialog.editing ? '编辑单元' : '新建单元'}
              </h3>
              <div className="space-y-3">
                <Field label="单元名" required>
                  <input
                    value={unitForm.name}
                    onChange={e => setUnitForm({ ...unitForm, name: e.target.value })}
                    placeholder="Unit 1 问候"
                    className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none"
                  />
                </Field>
                <Field label="描述">
                  <textarea
                    value={unitForm.description}
                    onChange={e => setUnitForm({ ...unitForm, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none resize-none"
                  />
                </Field>
              </div>
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setUnitDialog({ open: false, editing: null })}
                  className="flex-1 py-2 rounded-lg border border-black/10 text-ink-soft hover:bg-black/[0.02]"
                >取消</button>
                <button
                  onClick={submitUnit}
                  className="flex-1 py-2 rounded-lg bg-accent-warm text-white font-medium hover:opacity-90"
                >保存</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
