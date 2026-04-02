import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { useCountdown } from '../hooks/useCountdown';
import BrandPanel, { MobileBrandHeader } from '../components/BrandPanel';
import Spinner from '../components/Spinner';

const INPUT_CLASS = 'border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400 outline-none transition bg-gray-50/50 hover:bg-white';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const { remaining, isActive, start } = useCountdown(60);

  const [step, setStep] = useState<'verify' | 'reset'>('verify');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [success, setSuccess] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    return () => { clearTimeout(timerRef.current); };
  }, []);

  const handleSendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入正确的手机号');
      return;
    }
    setError('');
    setSendingCode(true);
    try {
      await axios.post(`${API_BASE_URL}/auth/send-code`, { phone, purpose: 'reset_password' });
      start();
    } catch (err: any) {
      setError(err.response?.data?.detail || '发送验证码失败');
    } finally {
      setSendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (step === 'verify') {
      if (!phone || !code) {
        setError('请填写手机号和验证码');
        return;
      }
      setStep('reset');
      return;
    }

    // step === 'reset'
    if (newPassword.length < 6) {
      setError('密码至少6位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API_BASE_URL}/auth/reset-password`, {
        phone,
        code,
        new_password: newPassword,
      });
      setSuccess(true);
      timerRef.current = setTimeout(() => navigate('/login'), 2000);
    } catch (err: any) {
      setError(err.response?.data?.detail || '重置密码失败');
      // 验证码错误时回到验证步骤
      if (err.response?.data?.detail?.includes('验证码')) {
        setStep('verify');
        setCode('');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      <BrandPanel tagline={<>忘记密码？<br />验证手机号即可重置</>}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="text-center"
        >
          <div className="text-blue-200 text-sm">安全验证，快速找回</div>
        </motion.div>
      </BrandPanel>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-gradient-to-b from-white to-blue-50/30">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <MobileBrandHeader />

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mb-8">
            <h2 className="text-2xl font-bold text-gray-800">找回密码</h2>
            <p className="text-gray-400 mt-1">
              {step === 'verify' ? '输入注册时使用的手机号' : '设置新密码'}
            </p>
          </motion.div>

          {/* 步骤指示器 */}
          <div className="flex items-center gap-3 mb-6">
            <div className={`flex items-center gap-2 text-sm font-medium ${step === 'verify' ? 'text-blue-600' : 'text-green-500'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs text-white ${step === 'verify' ? 'bg-blue-600' : 'bg-green-500'}`}>
                {step === 'verify' ? '1' : '✓'}
              </span>
              验证手机
            </div>
            <div className="flex-1 h-px bg-gray-200" />
            <div className={`flex items-center gap-2 text-sm font-medium ${step === 'reset' ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs text-white ${step === 'reset' ? 'bg-blue-600' : 'bg-gray-300'}`}>
                2
              </span>
              设置新密码
            </div>
          </div>

          {success ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-12"
            >
              <div className="text-5xl mb-4">✅</div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">密码重置成功</h3>
              <p className="text-gray-500">正在跳转到登录页...</p>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {step === 'verify' ? (
                <>
                  <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                    <label className="block text-sm font-medium text-gray-600 mb-1.5">手机号</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={`w-full px-4 py-3.5 text-base ${INPUT_CLASS}`}
                      placeholder="请输入注册时的手机号"
                      maxLength={11}
                      disabled={loading}
                    />
                  </motion.div>

                  <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                    <label className="block text-sm font-medium text-gray-600 mb-1.5">验证码</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className={`flex-1 px-4 py-3.5 text-base ${INPUT_CLASS}`}
                        placeholder="请输入验证码"
                        maxLength={6}
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={handleSendCode}
                        disabled={isActive || sendingCode || loading}
                        className={`px-5 py-3 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                          isActive || sendingCode
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                        }`}
                      >
                        {sendingCode ? '...' : isActive ? `${remaining}s` : '发送验证码'}
                      </button>
                    </div>
                  </motion.div>
                </>
              ) : (
                <>
                  <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}>
                    <label className="block text-sm font-medium text-gray-600 mb-1.5">新密码</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className={`w-full px-4 py-3.5 text-base ${INPUT_CLASS}`}
                      placeholder="请输入新密码（至少6位）"
                      disabled={loading}
                    />
                  </motion.div>

                  <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                    <label className="block text-sm font-medium text-gray-600 mb-1.5">确认密码</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={`w-full px-4 py-3.5 text-base ${INPUT_CLASS}`}
                      placeholder="请再次输入新密码"
                      disabled={loading}
                    />
                  </motion.div>
                </>
              )}

              <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="pt-2">
                <motion.button
                  type="submit"
                  disabled={loading}
                  whileHover={{ scale: loading ? 1 : 1.01 }}
                  whileTap={{ scale: loading ? 1 : 0.99 }}
                  className={`w-full py-4 rounded-xl font-bold text-white text-lg transition-all ${
                    loading
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] hover:shadow-lg hover:shadow-blue-300/40 shadow-md'
                  }`}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Spinner />
                      处理中...
                    </span>
                  ) : step === 'verify' ? '下一步' : '重置密码'}
                </motion.button>

                {step === 'reset' && (
                  <button
                    type="button"
                    onClick={() => { setStep('verify'); setError(''); }}
                    className="w-full mt-3 py-3 rounded-xl text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition"
                  >
                    返回上一步
                  </button>
                )}
              </motion.div>
            </form>
          )}

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="mt-8 text-center text-sm text-gray-400">
            想起密码了？
            <Link to="/login" className="text-blue-600 font-semibold hover:underline ml-1">返回登录</Link>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} className="mt-10 text-center text-xs text-gray-300">
            飞鹰英语培训机构 · AI 智能学习平台
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default ForgotPassword;
