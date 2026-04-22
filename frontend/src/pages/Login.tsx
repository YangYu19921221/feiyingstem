import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { useCountdown } from '../hooks/useCountdown';
import Spinner from '../components/Spinner';
import AuthShell from '../components/auth/AuthShell';

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

const INPUT_BASE =
  'w-full px-4 py-3.5 rounded-xl outline-none transition text-white placeholder-gray-500';
const inputStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 34, 0.85)',
  border: '1px solid #2a3442',
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

  const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'var(--glow)';
    e.currentTarget.style.boxShadow = '0 0 0 3px var(--glow-ring)';
  };
  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = '#2a3442';
    e.currentTarget.style.boxShadow = 'none';
  };

  return (
    <AuthShell>
      {() => (
        <>
          <div className="mb-6">
            <h2 className="text-3xl font-bold" style={{ color: '#fff' }}>欢迎回来</h2>
            <p className="mt-1 text-sm" style={{ color: '#8a95a5' }}>登录账号，继续你的学习计划</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    color: '#fca5a5',
                  }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label htmlFor="username" className="block text-sm font-medium mb-1.5" style={{ color: '#c7d0dc' }}>
                用户名或邮箱
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={INPUT_BASE}
                style={inputStyle}
                onFocus={onFocus}
                onBlur={onBlur}
                placeholder="请输入用户名或邮箱"
                required
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1.5" style={{ color: '#c7d0dc' }}>
                密码
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={INPUT_BASE}
                style={inputStyle}
                onFocus={onFocus}
                onBlur={onBlur}
                placeholder="请输入密码"
                required
                disabled={loading}
              />
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowPhoneVerify(!showPhoneVerify)}
                className="text-sm transition flex items-center gap-1"
                style={{ color: '#8a95a5' }}
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
                          className={`flex-1 px-4 py-3 rounded-xl outline-none transition text-white placeholder-gray-500`}
                          style={inputStyle}
                          onFocus={onFocus}
                          onBlur={onBlur}
                          placeholder="手机号"
                          disabled={loading}
                          maxLength={11}
                        />
                        <button
                          type="button"
                          onClick={handleSendCode}
                          disabled={isActive || sendingCode || loading}
                          className={`px-4 py-3 rounded-xl text-sm font-medium whitespace-nowrap transition`}
                          style={{
                            background: isActive || sendingCode ? '#23303f' : 'var(--glow)',
                            color: isActive || sendingCode ? '#8a95a5' : '#0b1320',
                            cursor: isActive || sendingCode ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {sendingCode ? '...' : isActive ? `${remaining}s` : '发送'}
                        </button>
                      </div>
                      <input
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className={`w-full px-4 py-3 rounded-xl outline-none transition text-white placeholder-gray-500`}
                        style={inputStyle}
                        onFocus={onFocus}
                        onBlur={onBlur}
                        placeholder="请输入验证码"
                        disabled={loading}
                        maxLength={6}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="pt-1">
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: loading ? 1 : 1.01 }}
                whileTap={{ scale: loading ? 1 : 0.99 }}
                className="w-full py-4 rounded-xl font-bold text-lg transition-all"
                style={{
                  background: loading ? '#23303f' : 'var(--glow)',
                  color: loading ? '#8a95a5' : '#0b1320',
                  boxShadow: loading ? 'none' : '0 8px 24px var(--glow-soft)',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner />
                    登录中...
                  </span>
                ) : '登录'}
              </motion.button>
            </div>
          </form>

          <div className="mt-8 text-center text-sm" style={{ color: '#8a95a5' }}>
            还没有账号？
            <Link to="/register" className="font-semibold hover:underline ml-1" style={{ color: 'var(--glow)' }}>立即注册</Link>
            <span className="mx-2">·</span>
            <Link to="/forgot-password" className="font-semibold hover:underline" style={{ color: 'var(--glow)' }}>忘记密码</Link>
          </div>

          <Link
            to="/assessment"
            className="mt-6 block w-full py-3 text-center rounded-xl font-bold transition"
            style={{
              background: 'rgba(168, 85, 247, 0.15)',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              color: '#d8b4fe',
            }}
          >
            🏥 公益英语口语体检（无需注册）
          </Link>

          <div className="mt-8 text-center text-xs" style={{ color: '#5a6778' }}>
            AI 智能学习平台 · 展翅高飞，征服英语
          </div>
        </>
      )}
    </AuthShell>
  );
};

export default Login;
