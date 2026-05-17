import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { parentLogin } from '../api/parent';
import { toast } from '../components/Toast';
import FormError from '../components/auth/FormError';
import { parseError } from '../utils/errorMessage';

const ParentLogin = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setErrorCode(null);
    if (!phone || !password) {
      toast.warning('请填写完整');
      return;
    }
    setLoading(true);
    try {
      const res = await parentLogin(phone, password);
      localStorage.setItem('access_token', res.access_token);
      localStorage.setItem('user', JSON.stringify({
        id: res.parent_id,
        full_name: res.full_name,
        role: 'parent',
      }));
      navigate('/parent/dashboard');
    } catch (err: any) {
      const e = parseError(err, '登录失败，请稍后重试');
      setError(e.message);
      setErrorCode(e.code);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper page-warm-glow flex items-center justify-center px-5">
      <div className="card-soft rounded-2xl p-8 w-full max-w-sm">
        <p className="text-ink-mute text-sm mb-2">家长端登录</p>
        <h1 className="font-display text-3xl font-semibold text-ink mb-8 tracking-tight">
          欢迎回来
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormError
            message={error}
            code={errorCode}
            context="parent-login"
            onDismiss={() => { setError(''); setErrorCode(null); }}
          />

          <div>
            <label className="block text-xs text-ink-soft mb-1.5">手机号</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              autoComplete="username"
              className="w-full px-4 py-3 rounded-xl border border-black/10 bg-white text-ink focus:border-accent-warm focus:outline-none transition"
              placeholder="11 位手机号"
            />
          </div>

          <div>
            <label className="block text-xs text-ink-soft mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-4 py-3 rounded-xl border border-black/10 bg-white text-ink focus:border-accent-warm focus:outline-none transition"
              placeholder="至少 6 位"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-glow w-full py-3.5 text-white rounded-xl text-base font-semibold disabled:opacity-50"
          >
            {loading ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="text-center text-ink-soft text-sm mt-6">
          还没有账号？
          <Link to="/parent/register" className="text-accent-warm font-medium ml-1 hover:underline">
            用绑定码注册
          </Link>
        </p>
        <p className="text-center text-ink-mute text-xs mt-6 pt-6 border-t border-black/[0.05]">
          学生 / 老师请走
          <Link to="/login" className="text-ink-soft ml-1 hover:text-ink">
            学生登录入口
          </Link>
        </p>
      </div>
    </div>
  );
};

export default ParentLogin;
