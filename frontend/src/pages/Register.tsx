import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { useCountdown } from '../hooks/useCountdown';
import BrandPanel, { MobileBrandHeader } from '../components/BrandPanel';
import Spinner from '../components/Spinner';

interface RegisterResponse {
  access_token: string;
  token_type: string;
  user: {
    id: number;
    username: string;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
    phone?: string;
  };
}

const INPUT_CLASS = 'border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400 outline-none transition bg-gray-50/50 hover:bg-white';

const Register = () => {
  const navigate = useNavigate();
  const { remaining, isActive, start } = useCountdown(60);

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  const handleSendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入正确的手机号');
      return;
    }
    setError('');
    setSendingCode(true);
    try {
      await axios.post(`${API_BASE_URL}/auth/send-code`, { phone, purpose: 'register' });
      start();
    } catch (err: any) {
      setError(err.response?.data?.detail || '发送验证码失败');
    } finally {
      setSendingCode(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }
    setLoading(true);
    try {
      const response = await axios.post<RegisterResponse>(`${API_BASE_URL}/auth/register`, {
        phone, username: username.trim(), password, code,
      });
      localStorage.setItem('access_token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.detail || '注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      <BrandPanel tagline={<>加入飞鹰，展翅翱翔<br />让英语成为你的翅膀</>}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="space-y-3 text-left max-w-xs mx-auto"
        >
          {[
            { icon: '🧠', text: '艾宾浩斯记忆曲线，科学复习' },
            { icon: '🎙️', text: '剑桥真人发音，AI 纠音' },
            { icon: '📝', text: '智能出题，精准测评' },
            { icon: '📊', text: '学习数据可视化，进步看得见' },
          ].map((item, i) => (
            <motion.div
              key={item.text}
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.8 + i * 0.1 }}
              className="flex items-center gap-3 text-white/85"
            >
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              <span className="text-sm">{item.text}</span>
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

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mb-6">
            <h2 className="text-2xl font-bold text-gray-800">创建账号</h2>
            <p className="text-gray-400 mt-1">填写信息，开启学习之旅</p>
          </motion.div>

          <form onSubmit={handleRegister} className="space-y-4">
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
              <label className="block text-sm font-medium text-gray-600 mb-1.5">手机号</label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={`flex-1 px-4 py-3 ${INPUT_CLASS}`}
                  placeholder="请输入手机号"
                  required
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
                  {sendingCode ? '...' : isActive ? `${remaining}s` : '发送验证码'}
                </button>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">验证码</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`w-full px-4 py-3 ${INPUT_CLASS}`}
                placeholder="请输入验证码"
                required
                disabled={loading}
                maxLength={6}
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={`w-full px-4 py-3 ${INPUT_CLASS}`}
                placeholder="请输入用户名（至少3个字符）"
                required
                disabled={loading}
                minLength={3}
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full px-4 py-3 ${INPUT_CLASS}`}
                placeholder="请输入密码（至少6位）"
                required
                disabled={loading}
                minLength={6}
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">确认密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full px-4 py-3 ${INPUT_CLASS}`}
                placeholder="请再次输入密码"
                required
                disabled={loading}
                minLength={6}
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }} className="pt-1">
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: loading ? 1 : 1.01 }}
                whileTap={{ scale: loading ? 1 : 0.99 }}
                className={`w-full py-3.5 rounded-xl font-bold text-white text-lg transition-all ${
                  loading
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] hover:shadow-lg hover:shadow-blue-300/40 shadow-md'
                }`}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner />
                    注册中...
                  </span>
                ) : '创建账号'}
              </motion.button>
            </motion.div>
          </form>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="mt-6 text-center text-sm text-gray-400">
            已有账号？
            <Link to="/login" className="text-blue-600 font-semibold hover:underline ml-1">去登录</Link>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-8 text-center text-xs text-gray-300">
            飞鹰英语培训机构 · AI 智能学习平台
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default Register;
