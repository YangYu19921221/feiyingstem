import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, Trash2, Edit, FolderPlus, ChevronRight } from 'lucide-react';
import {
  listSentenceBooks, createSentenceBook, deleteSentenceBook, updateSentenceBook,
  type SentenceBook,
} from '../api/sentences';
import { toast } from '../components/Toast';
import { parseError } from '../utils/errorMessage';
import Field from '../components/Field';

export default function TeacherSentenceBooks() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<SentenceBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', description: '', grade_level: '', volume: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setBooks(await listSentenceBooks());
    } catch (err: any) {
      toast.error(parseError(err, '加载失败').message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm({ name: '', description: '', grade_level: '', volume: '' });
    setEditingId(null);
    setShowCreate(true);
  };

  const openEdit = (b: SentenceBook) => {
    setForm({
      name: b.name,
      description: b.description || '',
      grade_level: b.grade_level || '',
      volume: b.volume || '',
    });
    setEditingId(b.id);
    setShowCreate(true);
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.warning('请输入句子集名称'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        grade_level: form.grade_level.trim() || undefined,
        volume: form.volume.trim() || undefined,
      };
      if (editingId) {
        await updateSentenceBook(editingId, payload);
      } else {
        await createSentenceBook(payload);
      }
      setShowCreate(false);
      load();
    } catch (err: any) {
      toast.error(parseError(err, '保存失败').message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (b: SentenceBook) => {
    if (!confirm(`确定删除「${b.name}」？包括下面的所有单元与句子都会被删除。`)) return;
    try {
      await deleteSentenceBook(b.id);
      toast.success('已删除');
      load();
    } catch (err: any) {
      toast.error(parseError(err, '删除失败').message);
    }
  };

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-ink-soft hover:text-ink text-sm">
            <ArrowLeft className="w-4 h-4" /> 返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">句子背诵管理</h1>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-warm text-white text-sm font-medium hover:opacity-90"
          >
            <FolderPlus className="w-4 h-4" /> 新建
          </button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-5 py-8">
        <section className="mb-6">
          <p className="text-ink-mute text-sm mb-1.5">用句子集组织学生背诵的英文短句</p>
          <h2 className="font-display text-3xl font-semibold text-ink tracking-tight">
            句子集
          </h2>
          <p className="text-ink-soft text-sm mt-2">
            创建句子集 → 添加单元 → 单条录入或 Excel/CSV 批量导入。学生在「句子背诵」磁贴进入。
          </p>
        </section>

        {loading ? (
          <div className="py-16 text-center text-ink-mute text-sm">加载中…</div>
        ) : books.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-black/10 rounded-2xl">
            <p className="text-ink-soft mb-2">还没有句子集</p>
            <p className="text-xs text-ink-mute mb-4">点击右上角"新建"创建第一个</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-black/[0.05] divide-y divide-black/[0.05] overflow-hidden">
            {books.map(b => (
              <div
                key={b.id}
                className="flex items-center gap-3 px-5 py-4 hover:bg-black/[0.02] cursor-pointer"
                onClick={() => navigate(`/teacher/sentences/${b.id}`)}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-semibold"
                  style={{ background: b.cover_color || '#5FD35F' }}>
                  💬
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-ink truncate">{b.name}</p>
                    {(b.grade_level || b.volume) && (
                      <span className="text-[11px] text-accent-warm bg-accent-warm/[0.10] px-1.5 py-0.5 rounded-full">
                        {[b.grade_level, b.volume].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-mute mt-0.5">
                    {b.unit_count} 单元 · {b.sentence_count} 句
                    {b.description ? ` · ${b.description}` : ''}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(b); }}
                  className="p-1.5 text-ink-mute hover:text-accent-warm"
                  title="编辑"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(b); }}
                  className="p-1.5 text-ink-mute hover:text-red-500"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <ChevronRight className="w-4 h-4 text-ink-mute" />
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-5"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 w-full max-w-md"
            >
              <h3 className="font-display text-xl font-semibold text-ink mb-5">
                {editingId ? '编辑句子集' : '新建句子集'}
              </h3>
              <div className="space-y-4">
                <Field label="名称" required>
                  <input
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="例如：人教版七年级上册重点句型"
                    className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="年级">
                    <input
                      value={form.grade_level}
                      onChange={e => setForm({ ...form, grade_level: e.target.value })}
                      placeholder="七年级"
                      className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none"
                    />
                  </Field>
                  <Field label="册次">
                    <input
                      value={form.volume}
                      onChange={e => setForm({ ...form, volume: e.target.value })}
                      placeholder="上册"
                      className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none"
                    />
                  </Field>
                </div>
                <Field label="描述（可选）">
                  <textarea
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-black/10 focus:border-accent-warm outline-none resize-none"
                  />
                </Field>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCreate(false)}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg border border-black/10 text-ink-soft hover:bg-black/[0.02] disabled:opacity-50"
                >取消</button>
                <button
                  onClick={submit}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg bg-accent-warm text-white font-medium hover:opacity-90 disabled:opacity-50"
                >{saving ? '保存中…' : '保存'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

