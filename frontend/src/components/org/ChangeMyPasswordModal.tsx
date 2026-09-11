/** 机构管理员改自己的密码。
 *
 * 与 components/ChangePasswordModal 的分工: 那个走通用 `/auth/change-password`
 * (全站任何角色都能用),这个走 `/org/my-password` —— 后端在机构端多拦一条
 * 「新密码与当前密码相同」(通用端点允许,改了等于没改却提示成功)。
 * 两者都不 bump session_ver,改完密码不会把自己踢下线。
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { orgAdminApi } from '../../api/organizations';
import { getErrorMessage } from '../../utils/errorMessage';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangeMyPasswordModal({ isOpen, onClose }: Props) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 卸载时清掉定时器,否则关窗后 1.5s 还会对已卸载组件 setState
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleClose = () => {
    // 密码留在内存里没意义,关窗即清
    setOldPassword(''); setNewPassword(''); setConfirmPassword('');
    setError(''); setSuccess(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) { setError('新密码至少 6 位'); return; }
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return; }
    if (oldPassword === newPassword) { setError('新密码与当前密码相同，等于没改'); return; }

    setLoading(true);
    try {
      await orgAdminApi.changeMyPassword({ old_password: oldPassword, new_password: newPassword });
      setSuccess(true);
      timerRef.current = setTimeout(handleClose, 1500);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '修改密码失败'));
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-[#3976a9] focus:ring-4 focus:ring-[#3976a9]/10';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
          role="dialog" aria-modal="true" aria-labelledby="org-pwd-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <h3 id="org-pwd-title" className="text-lg font-bold text-slate-900">修改我的密码</h3>
              <button type="button" onClick={handleClose} aria-label="关闭"
                      className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
            </div>

            {success ? (
              <div className="py-8 text-center">
                <div className="mb-3 text-4xl">✅</div>
                <p className="font-medium text-slate-700">密码已修改</p>
                <p className="mt-1 text-xs text-slate-500">下次登录请用新密码</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                {error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
                )}
                <label className="block text-sm font-medium text-slate-700">
                  当前密码
                  <input type="password" value={oldPassword} autoFocus required disabled={loading}
                         onChange={(e) => setOldPassword(e.target.value)}
                         placeholder="请输入当前密码" className={inputCls} />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  新密码
                  <input type="password" value={newPassword} required disabled={loading}
                         onChange={(e) => setNewPassword(e.target.value)}
                         placeholder="至少 6 位" className={inputCls} />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  确认新密码
                  <input type="password" value={confirmPassword} required disabled={loading}
                         onChange={(e) => setConfirmPassword(e.target.value)}
                         placeholder="再输一次新密码" className={inputCls} />
                </label>
                <button type="submit" disabled={loading}
                        className="admin-primary admin-focus-ring mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-semibold disabled:opacity-50">
                  {loading ? '提交中…' : '确认修改'}
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
