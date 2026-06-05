import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import { getErrorMessage } from '../utils/errorMessage';

interface ChangeUsernameModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUsername?: string;
  /** 修改成功后回调，传入新用户名 */
  onSuccess?: (newUsername: string) => void;
}

export default function ChangeUsernameModal({
  isOpen,
  onClose,
  currentUsername,
  onSuccess,
}: ChangeUsernameModalProps) {
  const [newUsername, setNewUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => { clearTimeout(timerRef.current); };
  }, []);

  const reset = () => {
    setNewUsername('');
    setPassword('');
    setError('');
    setSuccess(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmed = newUsername.trim();
    if (!trimmed) {
      setError('用户名不能为空');
      return;
    }
    if (trimmed === currentUsername) {
      setError('新用户名与当前用户名相同');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.put('/auth/change-username', {
        new_username: trimmed,
        password,
      });
      // 更新本地缓存的用户信息
      try {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          const u = JSON.parse(userStr);
          u.username = data?.username ?? trimmed;
          localStorage.setItem('user', JSON.stringify(u));
        }
      } catch { /* 忽略本地缓存写入异常 */ }

      setSuccess(true);
      onSuccess?.(data?.username ?? trimmed);
      timerRef.current = setTimeout(handleClose, 1200);
    } catch (err: any) {
      setError(getErrorMessage(err, '修改用户名失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-gray-800">修改用户名</h3>
              <button
                onClick={handleClose}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition"
              >
                ✕
              </button>
            </div>

            {success ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-8"
              >
                <div className="text-4xl mb-3">✅</div>
                <p className="text-gray-700 font-medium">用户名修改成功</p>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                {currentUsername && (
                  <p className="text-sm text-gray-500">
                    当前用户名：<span className="font-medium text-gray-700">{currentUsername}</span>
                  </p>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">新用户名</label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400 outline-none transition bg-gray-50/50"
                    placeholder="请输入新用户名"
                    maxLength={50}
                    required
                    disabled={loading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">当前密码</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400 outline-none transition bg-gray-50/50"
                    placeholder="输入密码确认本人操作"
                    required
                    disabled={loading}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full py-3 rounded-xl font-bold text-white transition-all ${
                    loading
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] hover:shadow-lg hover:shadow-blue-300/30'
                  }`}
                >
                  {loading ? '提交中...' : '确认修改'}
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
