import { useState, useEffect } from 'react';
import { admin } from '../../api/admin';
import type { AdminStudentBook, AdminWordBookOption } from '../../api/admin';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

interface Props {
  studentId: number;
  studentName: string;
  open: boolean;
  onClose: () => void;
}

const StudentBooksDialog = ({ studentId, studentName, open, onClose }: Props) => {
  const [books, setBooks] = useState<AdminStudentBook[]>([]);
  const [allBooks, setAllBooks] = useState<AdminWordBookOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [owned, all] = await Promise.all([
        admin.studentBooks(studentId),
        admin.listWordBooks(),
      ]);
      setBooks(owned);
      setAllBooks(all);
    } catch {
      toast.error('加载书本数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setQ('');
    setAdding('');
    load();
  }, [open, studentId]);

  const ownedIds = new Set(books.map((b) => b.book_id));
  const candidates = allBooks.filter(
    (b) => !ownedIds.has(b.id) &&
      (!q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase()))
  );

  const handleAdd = async (bookId: number) => {
    setBusy(true);
    try {
      await admin.addStudentBook(studentId, bookId);
      toast.success('已添加书本');
      setQ('');
      setAdding('');
      await load();
    } catch (err: any) {
      toast.error(getErrorMessage(err, '添加失败'));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (assignmentId: number) => {
    if (!confirm('确定取消该书本授权吗？学生将无法继续学习这本书。')) return;
    setBusy(true);
    try {
      await admin.removeStudentBook(studentId, assignmentId);
      toast.success('已取消授权');
      await load();
    } catch (err: any) {
      toast.error(getErrorMessage(err, '取消失败'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">{studentName} 的订阅书本</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-gray-400">加载中…</div>
        ) : (
          <>
            {/* 已授权书本 */}
            <div className="mb-5">
              <div className="text-sm font-medium text-gray-600 mb-2">已授权（{books.length}）</div>
              {books.length === 0 ? (
                <p className="text-sm text-gray-400 py-3 text-center bg-gray-50 rounded-lg">还没有授权任何书本</p>
              ) : (
                <div className="space-y-2">
                  {books.map((b) => (
                    <div key={b.assignment_id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{b.book_name}</div>
                        <div className="text-xs text-gray-400">
                          {b.scope_type === 'book' ? '整本' : b.scope_type}
                          {b.assigned_at && ` · ${new Date(b.assigned_at).toLocaleDateString('zh-CN')}`}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemove(b.assignment_id)}
                        disabled={busy}
                        className="text-red-500 hover:text-red-700 text-sm shrink-0 ml-3 disabled:opacity-50"
                      >
                        取消
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 添加书本 */}
            <div>
              <div className="text-sm font-medium text-gray-600 mb-2">添加书本</div>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索书名"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <div className="max-h-52 overflow-y-auto space-y-1">
                {candidates.length === 0 ? (
                  <p className="text-sm text-gray-400 py-3 text-center">
                    {q.trim() ? '没有匹配的书' : '没有可添加的书'}
                  </p>
                ) : (
                  candidates.map((b) => (
                    <div key={b.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-lg">
                      <div className="min-w-0">
                        <span className="text-sm text-gray-800">{b.name}</span>
                        {b.grade_level && <span className="text-xs text-gray-400 ml-2">{b.grade_level}</span>}
                      </div>
                      <button
                        onClick={() => handleAdd(b.id)}
                        disabled={busy}
                        className="text-orange-600 hover:text-orange-800 text-sm shrink-0 ml-3 disabled:opacity-50"
                      >
                        + 添加
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default StudentBooksDialog;
