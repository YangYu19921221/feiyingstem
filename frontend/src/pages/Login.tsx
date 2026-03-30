import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { useCountdown } from '../hooks/useCountdown';
import BrandPanel, { MobileBrandHeader } from '../components/BrandPanel';
import Spinner from '../components/Spinner';

interface LoginResponse {
  access_token: string;
  token_type: string;
  user: {
    id: number;
    username: string;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
    subscription_expires_at?: string | null;
  };
}

const INPUT_CLASS = 'border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400 outline-none transition bg-gray-50/50 hover:bg-white';

const Login = () => {
  const navigate = useNavigate();
  const { remaining, isActive, start } = useCountdown(60);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);

  const handleSendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入正确的手机号');
      return;
    }
    setError('');
    setSendingCode(true);
    try {
      await axios.post(`${API_BASE_URL}/auth/send-code`, { phone, purpose: 'login' });
      start();
    } catch (err: any) {
      setError(err.response?.data?.detail || '发送验证码失败');
    } finally {
      setSendingCode(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload: any = { username: username.trim(), password };
      if (phone && code) {
        payload.phone = phone;
        payload.code = code;
      }
      const response = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/login/json`, payload);
      localStorage.setItem('access_token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.status === 401 ? '用户名或密码错误' : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      <BrandPanel tagline={<>展翅高飞，征服英语<br />AI 赋能，高效提分</>}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="grid grid-cols-3 gap-4"
        >
          {[
            { num: '10万+', label: '学员选择' },
            { num: '98%', label: '提分率' },
            { num: '500+', label: '精选词库' },
          ].map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9 + i * 0.1 }}
              className="text-center"
            >
              <div className="text-2xl font-bold text-white">{item.num}</div>
              <div className="text-xs text-blue-300 mt-1">{item.label}</div>
            </motion.div>
          ))}
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
            <h2 className="text-2xl font-bold text-gray-800">欢迎回来</h2>
            <p className="text-gray-400 mt-1">登录账号，继续你的学习计划</p>
          </motion.div>

          <form onSubmit={handleLogin} className="space-y-5">
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

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <label htmlFor="username" className="block text-sm font-medium text-gray-600 mb-1.5">用户名或邮箱</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={`w-full px-4 py-3.5 text-base ${INPUT_CLASS}`}
                placeholder="请输入用户名或邮箱"
                required
                disabled={loading}
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <label htmlFor="password" className="block text-sm font-medium text-gray-600 mb-1.5">密码</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full px-4 py-3.5 text-base ${INPUT_CLASS}`}
                placeholder="请输入密码"
                required
                disabled={loading}
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
              <button
                type="button"
                onClick={() => setShowPhoneVerify(!showPhoneVerify)}
                className="text-sm text-gray-400 hover:text-gray-500 transition flex items-center gap-1"
              >
                <span className={`transition-transform text-xs ${showPhoneVerify ? 'rotate-90' : ''}`}>▸</span>
                手机验证码（可选）
              </button>
              <AnimatePresence>
                {showPhoneVerify && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className={`flex-1 px-4 py-3 ${INPUT_CLASS}`}
                          placeholder="手机号"
                          disabled={loading}
                          maxLength={11}
                        />
                        <button
                          type="button"
                          onClick={handleSendCode}
                          disabled={isActive || sendingCode || loading}
                          className={`px-4 py-3 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                            isActive || sendingCode
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                          }`}
                        >
                          {sendingCode ? '...' : isActive ? `${remaining}s` : '发送'}
                        </button>
                      </div>
                      <input
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className={`w-full px-4 py-3 ${INPUT_CLASS}`}
                        placeholder="请输入验证码"
                        disabled={loading}
                        maxLength={6}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="pt-2">
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
                    登录中...
                  </span>
                ) : '登录'}
              </motion.button>
            </motion.div>
          </form>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="mt-8 text-center text-sm text-gray-400">
            还没有账号？
            <Link to="/register" className="text-blue-600 font-semibold hover:underline ml-1">立即注册</Link>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} className="mt-10 text-center text-xs text-gray-300">
            飞鹰英语培训机构 · AI 智能学习平台
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;
