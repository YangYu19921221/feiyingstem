import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import Spinner from '../components/Spinner';
import AuthShell from '../components/auth/AuthShell';

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

const INPUT_BASE = 'w-full px-4 py-3 rounded-xl outline-none transition text-white placeholder-gray-500';
const inputStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 34, 0.85)',
  border: '1px solid #2a3442',
};

const Register = () => {
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        phone, username: username.trim(), password,
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

  const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'var(--glow)';
    e.currentTarget.style.boxShadow = '0 0 0 3px var(--glow-ring)';
  };
  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = '#2a3442';
    e.currentTarget.style.boxShadow = 'none';
  };

  const fields: Array<{ label: string; type: string; value: string; setter: (v:string)=>void; placeholder: string; maxLength?: number; minLength?: number; }> = [
    { label: '手机号', type: 'tel', value: phone, setter: setPhone, placeholder: '请输入手机号', maxLength: 11 },
    { label: '用户名', type: 'text', value: username, setter: setUsername, placeholder: '请输入用户名（支持中文，不限字数）', minLength: 1 },
    { label: '密码', type: 'password', value: password, setter: setPassword, placeholder: '请输入密码（至少6位）', minLength: 6 },
    { label: '确认密码', type: 'password', value: confirmPassword, setter: setConfirmPassword, placeholder: '请再次输入密码', minLength: 6 },
  ];

  return (
    <AuthShell>
      {() => (
        <>
          <div className="mb-6">
            <h2 className="text-3xl font-bold" style={{ color: '#fff' }}>创建账号</h2>
            <p className="mt-1 text-sm" style={{ color: '#8a95a5' }}>填写信息，开启学习之旅</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
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

            {fields.map((f) => (
              <div key={f.label}>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#c7d0dc' }}>{f.label}</label>
                <input
                  type={f.type}
                  value={f.value}
                  onChange={(e) => f.setter(e.target.value)}
                  className={INPUT_BASE}
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                  placeholder={f.placeholder}
                  required
                  disabled={loading}
                  maxLength={f.maxLength}
                  minLength={f.minLength}
                />
              </div>
            ))}

            <div className="pt-1">
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: loading ? 1 : 1.01 }}
                whileTap={{ scale: loading ? 1 : 0.99 }}
                className="w-full py-3.5 rounded-xl font-bold text-lg transition-all"
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
                    注册中...
                  </span>
                ) : '创建账号'}
              </motion.button>
            </div>
          </form>

          <div className="mt-6 text-center text-sm" style={{ color: '#8a95a5' }}>
            已有账号？
            <Link to="/login" className="font-semibold hover:underline ml-1" style={{ color: 'var(--glow)' }}>去登录</Link>
          </div>

          <div className="mt-8 text-center text-xs" style={{ color: '#5a6778' }}>
            AI 智能学习平台 · 让英语成为你的翅膀
          </div>
        </>
      )}
    </AuthShell>
  );
};

export default Register;
