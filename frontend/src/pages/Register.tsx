import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { useCountdown } from '../hooks/useCountdown';

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

// 浮动字母组件
const FloatingLetters = () => {
  const letters = useMemo(() => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const colors = ['#FF6B35', '#FFD23F', '#00D9FF', '#5FD35F'];
    return Array.from({ length: 40 }, (_, i) => ({
      id: i,
      char: alphabet[Math.floor(Math.random() * alphabet.length)],
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 200 + 100,
      color: colors[Math.floor(Math.random() * colors.length)],
      duration: Math.random() * 15 + 20,
      delay: Math.random() * 8,
      rotation: Math.random() * 360,
    }));
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {letters.map((letter) => (
        <motion.div
          key={letter.id}
          initial={{ x: `${letter.x}vw`, y: `${letter.y}vh`, rotate: letter.rotation, opacity: 0 }}
          animate={{
            x: [`${letter.x}vw`, `${letter.x + (Math.random() - 0.5) * 30}vw`, `${letter.x}vw`],
            y: [`${letter.y}vh`, `${letter.y + (Math.random() - 0.5) * 40}vh`, `${letter.y}vh`],
            rotate: [letter.rotation, letter.rotation + 360],
            opacity: [0, 0.15, 0.15, 0],
          }}
          transition={{ duration: letter.duration, delay: letter.delay, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute', fontSize: `${letter.size}px`, fontWeight: 900,
            color: letter.color, userSelect: 'none', filter: 'blur(0.5px)',
          }}
        >
          {letter.char}
        </motion.div>
      ))}
    </div>
  );
};

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
        phone, username, password, code,
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#FFF8F0] via-[#FFE8D6] to-[#FFD4BA] relative overflow-hidden">
      <FloatingLetters />
      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-primary via-secondary to-accent"></div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, type: 'spring', stiffness: 100 }}
        className="bg-white/90 backdrop-blur-md rounded-3xl shadow-2xl p-10 w-full max-w-md relative z-10 border border-white/50"
      >
        <div className="text-center mb-8">
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-4xl font-bold mb-3 bg-gradient-to-br from-primary via-secondary to-accent bg-clip-text text-transparent"
          >
            注册账号
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-gray-600"
          >
            加入 AI 英语提分助手
          </motion.p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          {error && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-error/10 border border-error/30 text-error px-4 py-3 rounded-lg text-sm"
            >
              {error}
            </motion.div>
          )}

          {/* 手机号 + 发送验证码 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">📱 手机号</label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all bg-gray-50 hover:bg-white"
                placeholder="请输入手机号"
                required
                disabled={loading}
                maxLength={11}
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={isActive || sendingCode || loading}
                className={`px-4 py-3 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${
                  isActive || sendingCode
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-gradient-to-r from-primary to-secondary text-white hover:shadow-lg'
                }`}
              >
                {sendingCode ? '发送中...' : isActive ? `${remaining}s` : '发送验证码'}
              </button>
            </div>
          </div>

          {/* 验证码 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">🔑 验证码</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all bg-gray-50 hover:bg-white"
              placeholder="请输入验证码"
              required
              disabled={loading}
              maxLength={6}
            />
          </div>

          {/* 用户名 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">👤 用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all bg-gray-50 hover:bg-white"
              placeholder="请输入用户名（至少3个字符）"
              required
              disabled={loading}
              minLength={3}
            />
          </div>

          {/* 密码 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">🔒 密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all bg-gray-50 hover:bg-white"
              placeholder="请输入密码（至少6位）"
              required
              disabled={loading}
              minLength={6}
            />
          </div>

          {/* 确认密码 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">🔒 确认密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all bg-gray-50 hover:bg-white"
              placeholder="请再次输入密码"
              required
              disabled={loading}
              minLength={6}
            />
          </div>

          {/* 注册按钮 */}
          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: loading ? 1 : 1.03 }}
            whileTap={{ scale: loading ? 1 : 0.97 }}
            className={`w-full py-4 rounded-xl font-bold text-white text-lg transition-all ${
              loading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-primary via-secondary to-accent hover:shadow-xl shadow-lg'
            }`}
          >
            {loading ? '注册中...' : '🚀 注册'}
          </motion.button>
        </form>

        <div className="mt-6 text-center text-gray-600">
          已有账号？
          <Link to="/login" className="text-primary font-semibold hover:underline ml-1">
            去登录
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default Register;
