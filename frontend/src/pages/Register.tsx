import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  LockKeyhole,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import Spinner from '../components/Spinner';
import AuthShell from '../components/auth/AuthShell';
import AuthInput from '../components/auth/AuthInput';
import FormError from '../components/auth/FormError';
import { parseError } from '../utils/errorMessage';

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

interface RegisterField {
  id: string;
  label: string;
  type: string;
  value: string;
  setter: (value: string) => void;
  placeholder: string;
  icon: LucideIcon;
  autoComplete?: string;
  inputMode?: 'text' | 'tel' | 'numeric';
  maxLength?: number;
  minLength?: number;
}

const Register = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const hasOrgParam = !!searchParams.get('org');
  const [orgCode, setOrgCode] = useState(() => (searchParams.get('org') || '').toUpperCase());
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setErrorCode(null);
    if (password !== confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }
    setLoading(true);
    try {
      const response = await axios.post<RegisterResponse>(`${API_BASE_URL}/auth/register`, {
        phone,
        username: username.trim(),
        password,
        org_code: orgCode.trim() || undefined,
      });
      localStorage.setItem('access_token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      navigate('/dashboard');
    } catch (err: unknown) {
      const e = parseError(err, '注册失败，请稍后重试');
      setError(e.message);
      setErrorCode(e.code);
    } finally {
      setLoading(false);
    }
  };

  const fields: RegisterField[] = [
    {
      id: 'register-phone',
      label: '手机号',
      type: 'tel',
      value: phone,
      setter: setPhone,
      placeholder: '请输入手机号',
      icon: Phone,
      autoComplete: 'tel',
      inputMode: 'numeric',
      maxLength: 11,
    },
    {
      id: 'register-username',
      label: '用户名',
      type: 'text',
      value: username,
      setter: setUsername,
      placeholder: '支持中文用户名',
      icon: UserRound,
      autoComplete: 'username',
      minLength: 1,
    },
    {
      id: 'register-password',
      label: '密码',
      type: 'password',
      value: password,
      setter: setPassword,
      placeholder: '至少 6 位',
      icon: LockKeyhole,
      autoComplete: 'new-password',
      minLength: 6,
    },
    {
      id: 'register-confirm-password',
      label: '确认密码',
      type: 'password',
      value: confirmPassword,
      setter: setConfirmPassword,
      placeholder: '请再次输入密码',
      icon: ShieldCheck,
      autoComplete: 'new-password',
      minLength: 6,
    },
    ...(hasOrgParam ? [{
      id: 'register-org-code',
      label: '机构码（来自邀请链接）',
      type: 'text',
      value: orgCode,
      setter: (value: string) => setOrgCode(value.toUpperCase()),
      placeholder: '机构提供的邀请码',
      icon: Building2,
      autoComplete: 'off',
      inputMode: 'text' as const,
      maxLength: 16,
    }] : []),
  ];

  return (
    <AuthShell mode="register">
      <header data-auth-reveal className="mb-6">
        <h2 className="font-display text-3xl font-black tracking-[-0.03em] text-[#293545] sm:text-[2.25rem]">
          创建账号
        </h2>
        <p className="mt-2 text-[15px] leading-6 text-[#5f6b7a]">填写信息，开启学习之旅。</p>
      </header>

      <form onSubmit={handleRegister} className="space-y-4" data-auth-reveal>
        <FormError
          message={error}
          code={errorCode}
          context="register"
          onDismiss={() => { setError(''); setErrorCode(null); }}
        />

        {fields.map((field) => (
          <AuthInput
            key={field.id}
            id={field.id}
            label={field.label}
            icon={field.icon}
            type={field.type}
            value={field.value}
            onChange={(e) => field.setter(e.target.value)}
            placeholder={field.placeholder}
            autoComplete={field.autoComplete}
            inputMode={field.inputMode}
            required
            disabled={loading}
            maxLength={field.maxLength}
            minLength={field.minLength}
          />
        ))}

        <button
          type="submit"
          disabled={loading}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border border-[#a9441c] bg-[#bd5227] px-5 text-base font-bold text-white transition duration-200 hover:bg-[#a9441c] active:scale-[0.985] disabled:cursor-not-allowed disabled:border-[#cbd3db] disabled:bg-[#dfe5ea] disabled:text-[#687383]"
        >
          {loading ? (
            <>
              <Spinner />
              注册中...
            </>
          ) : (
            <>
              创建账号
              <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <div data-auth-reveal className="mt-5 text-center text-sm text-[#5f6b7a]">
        已有账号？
        <Link to="/login" className="ml-1 font-bold text-[#a9441c] underline-offset-4 hover:underline">去登录</Link>
      </div>

      <p data-auth-reveal className="mt-7 border-t border-[#dfe5ea] pt-4 text-center text-xs leading-5 text-[#687383]">
        注册后会自动进入学习中心，已有学习数据不会受影响。
      </p>
    </AuthShell>
  );
};

export default Register;
