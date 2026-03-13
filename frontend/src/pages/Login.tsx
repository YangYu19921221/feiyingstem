import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { useCountdown } from '../hooks/useCountdown';

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

// 浮动字母组件 - 增强版
const FloatingLetters = () => {
  const letters = useMemo(() => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const colors = ['#FF6B35', '#FFD23F', '#00D9FF', '#5FD35F'];

    return Array.from({ length: 40 }, (_, i) => ({
      id: i,
      char: alphabet[Math.floor(Math.random() * alphabet.length)],
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 200 + 100, // 更大的字母 100-300px
      color: colors[Math.floor(Math.random() * colors.length)],
      duration: Math.random() * 15 + 20, // 20-35秒
      delay: Math.random() * 8,
      rotation: Math.random() * 360,
    }));
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {letters.map((letter) => (
        <motion.div
          key={letter.id}
          initial={{
            x: `${letter.x}vw`,
            y: `${letter.y}vh`,
            rotate: letter.rotation,
            opacity: 0,
          }}
          animate={{
            x: [`${letter.x}vw`, `${letter.x + (Math.random() - 0.5) * 30}vw`, `${letter.x}vw`],
            y: [`${letter.y}vh`, `${letter.y + (Math.random() - 0.5) * 40}vh`, `${letter.y}vh`],
            rotate: [letter.rotation, letter.rotation + 360],
            opacity: [0, 0.15, 0.15, 0], // 更明显的透明度
          }}
          transition={{
            duration: letter.duration,
            delay: letter.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{
            position: 'absolute',
            fontSize: `${letter.size}px`,
            fontWeight: 900,
            color: letter.color,
            userSelect: 'none',
            filter: 'blur(0.5px)',
          }}
        >
          {letter.char}
        </motion.div>
      ))}
    </div>
  );
};

// 装饰性圆点
const DecorativeDots = () => {
  const dots = useMemo(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 8 + 4,
      color: ['#FF6B35', '#FFD23F', '#00D9FF', '#5FD35F'][Math.floor(Math.random() * 4)],
      duration: Math.random() * 5 + 3,
      delay: Math.random() * 3,
    })), []
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {dots.map((dot) => (
        <motion.div
          key={dot.id}
          initial={{ x: `${dot.x}vw`, y: `${dot.y}vh`, scale: 0 }}
          animate={{
            x: [`${dot.x}vw`, `${dot.x + (Math.random() - 0.5) * 15}vw`, `${dot.x}vw`],
            y: [`${dot.y}vh`, `${dot.y + (Math.random() - 0.5) * 15}vh`, `${dot.y}vh`],
            scale: [0, 1, 0],
          }}
          transition={{
            duration: dot.duration,
            delay: dot.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{
            position: 'absolute',
            width: `${dot.size}px`,
            height: `${dot.size}px`,
            borderRadius: '50%',
            backgroundColor: dot.color,
            opacity: 0.4,
          }}
        />
      ))}
    </div>
  );
};

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
      const payload: any = { username, password };
      if (phone && code) {
        payload.phone = phone;
        payload.code = code;
      }
      const response = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/login/json`, payload);

      // 保存token到localStorage
      localStorage.setItem('access_token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));

      // 跳转到仪表盘(会根据角色自动跳转)
      navigate('/dashboard');
    } catch (err: any) {
      if (err.response?.status === 401) {
        setError('用户名或密码错误');
      } else {
        setError('登录失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#FFF8F0] via-[#FFE8D6] to-[#FFD4BA] relative overflow-hidden">
      {/* 浮动字母背景 */}
      <FloatingLetters />

      {/* 装饰性圆点 */}
      <DecorativeDots />

      {/* 顶部装饰条 */}
      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-primary via-secondary to-accent"></div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, type: 'spring', stiffness: 100 }}
        className="bg-white/90 backdrop-blur-md rounded-3xl shadow-2xl p-10 w-full max-w-md relative z-10 border border-white/50"
      >
        {/* Logo和标题 */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 150, damping: 10 }}
            className="inline-block relative mb-5"
          >
            <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="mx-auto drop-shadow-2xl">
              {/* 背景圆 */}
              <circle cx="60" cy="60" r="58" fill="url(#gradient1)" />

              {/* 渐变定义 */}
              <defs>
                <linearGradient id="gradient1" x1="0" y1="0" x2="120" y2="120">
                  <stop offset="0%" stopColor="#FF6B35" />
                  <stop offset="50%" stopColor="#FFD23F" />
                  <stop offset="100%" stopColor="#00D9FF" />
                </linearGradient>
                <linearGradient id="gradient2" x1="0" y1="0" x2="100" y2="100">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#f0f0f0" />
                </linearGradient>
              </defs>

              {/* 书本主体 */}
              <g transform="translate(30, 25)">
                {/* 左侧书页 */}
                <path d="M5 10 L5 60 L28 65 L28 15 Z" fill="#fff" opacity="0.95" />
                <path d="M5 10 L5 60 L28 65 L28 15 Z" fill="url(#gradient2)" opacity="0.3" />

                {/* 右侧书页 */}
                <path d="M32 15 L32 65 L55 60 L55 10 Z" fill="#fff" opacity="0.98" />
                <path d="M32 15 L32 65 L55 60 L55 10 Z" fill="url(#gradient2)" opacity="0.2" />

                {/* 书脊 */}
                <path d="M28 15 L32 15 L32 65 L28 65 Z" fill="#FFD23F" />
                <path d="M28 15 L32 15 L32 65 L28 65 Z" fill="#000" opacity="0.1" />

                {/* 装饰线 - 左页 */}
                <line x1="10" y1="25" x2="23" y2="27" stroke="#FF6B35" strokeWidth="1.5" opacity="0.6" />
                <line x1="10" y1="32" x2="23" y2="34" stroke="#FFD23F" strokeWidth="1.5" opacity="0.6" />
                <line x1="10" y1="39" x2="23" y2="41" stroke="#00D9FF" strokeWidth="1.5" opacity="0.6" />

                {/* 装饰线 - 右页 */}
                <line x1="37" y1="25" x2="50" y2="23" stroke="#FF6B35" strokeWidth="1.5" opacity="0.6" />
                <line x1="37" y1="32" x2="50" y2="30" stroke="#FFD23F" strokeWidth="1.5" opacity="0.6" />
                <line x1="37" y1="39" x2="50" y2="37" stroke="#00D9FF" strokeWidth="1.5" opacity="0.6" />

                {/* 字母装饰 */}
                <text x="12" y="52" fill="#FF6B35" fontSize="12" fontWeight="bold" opacity="0.7">A</text>
                <text x="40" y="50" fill="#00D9FF" fontSize="12" fontWeight="bold" opacity="0.7">Z</text>
              </g>

              {/* 光圈动画效果 */}
              <motion.circle
                cx="60"
                cy="60"
                r="58"
                stroke="#FF6B35"
                strokeWidth="3"
                fill="none"
                opacity="0.3"
                initial={{ scale: 1, opacity: 0.3 }}
                animate={{
                  scale: [1, 1.15, 1],
                  opacity: [0.3, 0, 0.3],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* 闪烁星星 */}
              <motion.g
                animate={{
                  opacity: [0.4, 1, 0.4],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                <path d="M85 25 L87 30 L92 30 L88 33 L90 38 L85 35 L80 38 L82 33 L78 30 L83 30 Z" fill="#FFD23F" />
                <path d="M30 85 L32 90 L37 90 L33 93 L35 98 L30 95 L25 98 L27 93 L23 90 L28 90 Z" fill="#00D9FF" />
              </motion.g>
            </svg>
          </motion.div>
          {/* 3D标题动效 */}
          <div className="mb-3 perspective-1000">
            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-5xl font-bold mb-3 flex justify-center gap-1"
              style={{ perspective: '1000px' }}
            >
              {['A', 'I', '英', '语', '提', '分', '助', '手'].map((char, index) => (
                <motion.span
                  key={index}
                  initial={{
                    opacity: 0,
                    y: -50,
                    rotateX: -90,
                    scale: 0.5,
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    rotateX: 0,
                    scale: 1,
                  }}
                  transition={{
                    delay: 0.4 + index * 0.1,
                    duration: 0.6,
                    type: 'spring',
                    stiffness: 200,
                    damping: 15,
                  }}
                  whileHover={{
                    rotateY: 360,
                    scale: 1.2,
                    transition: { duration: 0.6 },
                  }}
                  className="inline-block bg-gradient-to-br from-primary via-secondary to-accent bg-clip-text text-transparent cursor-pointer"
                  style={{
                    transformStyle: 'preserve-3d',
                    textShadow: '2px 2px 4px rgba(0,0,0,0.1)',
                  }}
                >
                  {char}
                </motion.span>
              ))}
            </motion.h1>
            {/* 3D底部光效 */}
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 1, duration: 0.8 }}
              className="h-1 w-48 mx-auto bg-gradient-to-r from-primary via-secondary to-accent rounded-full opacity-60"
              style={{
                boxShadow: '0 0 20px rgba(255, 107, 53, 0.5)',
              }}
            />
          </div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-gray-600 text-lg"
          >
            ✨ 欢迎回来！让我们一起进步
          </motion.p>
        </div>

        {/* 登录表单 */}
        <form onSubmit={handleLogin} className="space-y-6">
          {/* 错误提示 */}
          {error && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-error/10 border border-error/30 text-error px-4 py-3 rounded-lg"
            >
              {error}
            </motion.div>
          )}

          {/* 用户名输入 */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
          >
            <label htmlFor="username" className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <span>👤</span> 用户名或邮箱
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-5 py-4 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all duration-300 bg-gray-50 hover:bg-white"
              placeholder="请输入用户名或邮箱"
              required
              disabled={loading}
            />
          </motion.div>

          {/* 密码输入 */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.7 }}
          >
            <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <span>🔒</span> 密码
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-5 py-4 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all duration-300 bg-gray-50 hover:bg-white"
              placeholder="请输入密码"
              required
              disabled={loading}
            />
          </motion.div>

          {/* 手机号 + 验证码（可选） */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.75 }}
          >
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <span>📱</span> 手机验证码（可选）
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all bg-gray-50 hover:bg-white"
                placeholder="手机号"
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
                {sendingCode ? '...' : isActive ? `${remaining}s` : '发送'}
              </button>
            </div>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all bg-gray-50 hover:bg-white"
              placeholder="请输入验证码"
              disabled={loading}
              maxLength={6}
            />
          </motion.div>

          {/* 登录按钮 */}
          <motion.button
            type="submit"
            disabled={loading}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            whileHover={{ scale: loading ? 1 : 1.03, boxShadow: '0 10px 30px rgba(255, 107, 53, 0.3)' }}
            whileTap={{ scale: loading ? 1 : 0.97 }}
            className={`w-full py-4 rounded-xl font-bold text-white text-lg transition-all duration-300 ${
              loading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-primary via-secondary to-accent hover:shadow-xl shadow-lg'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-3">
                <svg
                  className="animate-spin"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="60"
                    strokeDashoffset="15"
                    opacity="0.25"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="15 45"
                    opacity="0.75"
                  />
                </svg>
                登录中...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                🚀 开始学习
              </span>
            )}
          </motion.button>
        </form>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="mt-6 text-center text-gray-600"
        >
          没有账号？
          <Link to="/register" className="text-primary font-semibold hover:underline ml-1">
            去注册
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default Login;
