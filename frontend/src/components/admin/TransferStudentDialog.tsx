import { useState, useEffect } from 'react';
import { admin } from '../../api/admin';
import type { AdminClassListItem } from '../../api/admin';
import { toast } from '../Toast';

interface Props {
  studentId: number;
  currentClassId: number;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const TransferStudentDialog = ({ studentId, currentClassId, open, onClose, onSuccess }: Props) => {
  const [classes, setClasses] = useState<AdminClassListItem[]>([]);
  const [targetClassId, setTargetClassId] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTargetClassId('');
    setError('');
    setLoading(true);
    admin.listClasses()
      .then((all) => setClasses(all.filter((c) => c.id !== currentClassId)))
      .catch(() => setError('加载班级列表失败'))
      .finally(() => setLoading(false));
  }, [open, currentClassId]);

  const handleConfirm = async () => {
    if (!targetClassId) { setError('请选择目标班级'); return; }
    setSubmitting(true);
    setError('');
    try {
      await admin.transferStudent(studentId, targetClassId as number);
      toast.success('转班成功');
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || '转班失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-sm shadow-xl">
        <h2 className="text-lg font-bold text-gray-800 mb-4">转班</h2>
        {loading ? (
          <div className="text-center py-6">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-4 border-orange-500 border-t-transparent"></div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">选择目标班级</label>
              <select
                value={targetClassId}
                onChange={(e) => { setTargetClassId(e.target.value ? Number(e.target.value) : ''); setError(''); }}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="">-- 请选择 --</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{c.teacher_username}，{c.student_count} 人）
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleConfirm}
            disabled={submitting || loading}
            className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 text-sm font-medium"
          >
            {submitting ? '转班中...' : '确认转班'}
          </button>
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransferStudentDialog;
