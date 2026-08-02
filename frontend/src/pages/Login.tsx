import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  KeyRound,
  LockKeyhole,
  Phone,
  Stethoscope,
  UserRound,
  UsersRound,
} from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { useCountdown } from '../hooks/useCountdown';
import Spinner from '../components/Spinner';
import AuthShell from '../components/auth/AuthShell';
import AuthInput from '../components/auth/AuthInput';
import FormError from '../components/auth/FormError';
import { parseError } from '../utils/errorMessage';

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

const Login = () => {
  const navigate = useNavigate();
  const { remaining, isActive, start } = useCountdown(60);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);

  const handleSendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入正确的手机号');
      setErrorCode(null);
      return;
    }
    setError('');
    setErrorCode(null);
    setSendingCode(true);
    try {
      await axios.post(`${API_BASE_URL}/auth/send-code`, { phone, purpose: 'login' });
      start();
    } catch (err: unknown) {
      const e = parseError(err, '发送验证码失败');
      setError(e.message);
      setErrorCode(e.code);
    } finally {
      setSendingCode(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setErrorCode(null);
    setLoading(true);

    try {
      const payload: { username: string; password: string; phone?: string; code?: string } = {
        username: username.trim(),
        password,
      };
      if (phone && code) {
        payload.phone = phone;
        payload.code = code;
      }
      const response = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/login/json`, payload);
      localStorage.setItem('access_token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      navigate('/dashboard');
    } catch (err: unknown) {
      const e = parseError(err, '登录失败，请稍后重试');
      setError(e.message);
      setErrorCode(e.code);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell mode="login">
      <header data-auth-reveal className="mb-7">
        <h2 className="font-display text-3xl font-black tracking-[-0.03em] text-[#293545] sm:text-[2.25rem]">
          欢迎回来
        </h2>
        <p className="mt-2 text-[15px] leading-6 text-[#5f6b7a]">登录账号，继续今天的学习。</p>
      </header>

      <form onSubmit={handleLogin} className="space-y-5" data-auth-reveal>
        <FormError
          message={error}
          code={errorCode}
          context="login"
          onDismiss={() => { setError(''); setErrorCode(null); }}
        />

        <AuthInput
          id="username"
          label="用户名或邮箱"
          icon={UserRound}
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="请输入用户名或邮箱"
          autoComplete="username"
          required
          disabled={loading}
        />

        <AuthInput
          id="password"
          label="密码"
          icon={LockKeyhole}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
          autoComplete="current-password"
          required
          disabled={loading}
        />

        <div>
          <button
            type="button"
            onClick={() => setShowPhoneVerify((value) => !value)}
            aria-expanded={showPhoneVerify}
            aria-controls="phone-verification-fields"
            className="flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-[#5f6b7a] transition hover:text-[#293545]"
          >
            <Phone className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            手机验证码（可选）
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${showPhoneVerify ? 'rotate-180' : ''}`}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </button>

          {showPhoneVerify && (
            <div id="phone-verification-fields" className="space-y-4 pt-3" aria-label="手机验证码登录">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <AuthInput
                  id="phone"
                  label="手机号"
                  icon={Phone}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="请输入手机号"
                  autoComplete="tel"
                  inputMode="numeric"
                  disabled={loading}
                  maxLength={11}
                />
                <div className="space-y-2">
                  <span className="block select-none text-sm font-semibold text-transparent" aria-hidden="true">验证码</span>
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={isActive || sendingCode || loading}
                    className="h-12 min-w-[5.5rem] rounded-[14px] border border-[#bd5227]/25 bg-[#fff3eb] px-4 text-sm font-bold text-[#a9441c] transition hover:bg-[#ffe7d8] active:scale-[0.98] disabled:cursor-not-allowed disabled:border-[#d7dee5] disabled:bg-[#eef2f5] disabled:text-[#687383]"
                  >
                    {sendingCode ? '发送中' : isActive ? `${remaining}s` : '发送'}
                  </button>
                </div>
              </div>
              <AuthInput
                id="verification-code"
                label="验证码"
                icon={KeyRound}
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="请输入 6 位验证码"
                autoComplete="one-time-code"
                inputMode="numeric"
                disabled={loading}
                maxLength={6}
              />
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border border-[#a9441c] bg-[#bd5227] px-5 text-base font-bold text-white transition duration-200 hover:bg-[#a9441c] active:scale-[0.985] disabled:cursor-not-allowed disabled:border-[#cbd3db] disabled:bg-[#dfe5ea] disabled:text-[#687383]"
        >
          {loading ? (
            <>
              <Spinner />
              登录中...
            </>
          ) : (
            <>
              登录
              <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <div data-auth-reveal className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-[#5f6b7a]">
        <span>
          还没有账号？
          <Link to="/register" className="ml-1 font-bold text-[#a9441c] underline-offset-4 hover:underline">立即注册</Link>
        </span>
        <span className="hidden h-4 w-px bg-[#d6dee5] sm:block" aria-hidden="true" />
        <Link to="/forgot-password" className="font-bold text-[#a9441c] underline-offset-4 hover:underline">忘记密码</Link>
      </div>

      <Link
        data-auth-reveal
        to="/assessment"
        className="group mt-7 flex items-center gap-3 rounded-[14px] bg-[#eef6fc] px-4 py-3.5 text-left transition hover:bg-[#e3f0f8] active:scale-[0.99]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#3976a9] shadow-[0_4px_14px_rgb(35_83_119/0.08)]">
          <Stethoscope className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-[#293545]">公益英语口语体检</span>
          <span className="mt-0.5 block text-xs text-[#5f6b7a]">无需注册，直接测评</span>
        </span>
        <ArrowRight className="h-[18px] w-[18px] text-[#5d94c4] transition-transform group-hover:translate-x-0.5" strokeWidth={1.8} aria-hidden="true" />
      </Link>

      <div data-auth-reveal className="mt-4 flex items-start gap-3 border-t border-[#dfe5ea] pt-4 text-sm text-[#5f6b7a]">
        <UsersRound className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#687383]" strokeWidth={1.8} aria-hidden="true" />
        <p className="leading-6">
          您是家长？
          <Link to="/parent/login" className="ml-1 font-bold text-[#a9441c] underline-offset-4 hover:underline">家长登录</Link>
          <span className="mx-2 text-[#aeb8c2]">/</span>
          <Link to="/parent/register" className="font-bold text-[#a9441c] underline-offset-4 hover:underline">首次注册</Link>
        </p>
      </div>
    </AuthShell>
  );
};

export default Login;
