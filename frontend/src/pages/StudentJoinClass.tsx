import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { ArrowLeft, KeyRound, Check } from 'lucide-react';
import { API_BASE_URL } from '../config/env';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

interface MyClassItem {
  class_id: number;
  class_name: string;
  teacher_id: number;
  teacher_name: string | null;
}

const StudentJoinClass = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [my, setMy] = useState<MyClassItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMy();
  }, []);

  const loadMy = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('access_token');
      const res = await axios.get(`${API_BASE_URL}/student/class/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMy(res.data?.classes || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    const c = code.trim();
    if (c.length < 6) {
      toast.warning('请输入老师给的 6 位邀请码');
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await axios.post(
        `${API_BASE_URL}/student/class/join-by-code`,
        { code: c },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const d = res.data;
      const tip = d.transferred_from
        ? `已加入「${d.class_name}」，从「${d.transferred_from}」转过来的`
        : `已加入「${d.class_name}」（班主任：${d.teacher_name || '老师'}）`;
      toast.success(tip);
      setCode('');
      await loadMy();
    } catch (error: any) {
      toast.error(getErrorMessage(error, '加入失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      <div className="max-w-xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-ink-soft hover:text-ink mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          返回
        </button>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-soft rounded-2xl p-6"
        >
          <div className="flex items-center gap-3 mb-2">
            <KeyRound className="w-6 h-6 text-accent-warm" />
            <h1 className="font-display text-2xl font-semibold text-ink">加入班级</h1>
          </div>
          <p className="text-sm text-ink-soft mb-6">
            找老师要 <span className="font-semibold text-ink">6 位邀请码</span>，输入后即可加入班级。
          </p>

          <div className="space-y-3">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6 位数字邀请码"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="w-full px-4 py-3 text-center text-2xl font-mono tracking-[0.4em] border-2 border-gray-200 rounded-xl outline-none focus:border-accent-warm"
            />
            <button
              onClick={handleJoin}
              disabled={submitting || code.length < 6}
              className="w-full btn-glow py-3 rounded-xl bg-accent-warm text-white font-semibold disabled:opacity-50"
            >
              {submitting ? '加入中…' : '加入班级'}
            </button>
          </div>

          <div className="mt-3 text-xs text-ink-mute">
            邀请码 24 小时有效；加入后如果你已在其它班级，会自动从原班转过来。
          </div>
        </motion.div>

        {/* 当前班级 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card-soft rounded-2xl p-6 mt-4"
        >
          <h2 className="font-display text-lg font-semibold text-ink mb-3">我的班级</h2>
          {loading ? (
            <div className="text-sm text-ink-mute">加载中…</div>
          ) : my.length === 0 ? (
            <div className="text-sm text-ink-mute">还没有加入任何班级</div>
          ) : (
            <ul className="space-y-2">
              {my.map((c) => (
                <li
                  key={c.class_id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-paper border border-gray-100"
                >
                  <Check className="w-4 h-4 text-green-600" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink truncate">{c.class_name}</p>
                    <p className="text-xs text-ink-mute truncate">班主任：{c.teacher_name || '老师'}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default StudentJoinClass;
