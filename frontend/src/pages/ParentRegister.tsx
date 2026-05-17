import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { parentRegister } from '../api/parent';
import { toast } from '../components/Toast';
import FormError from '../components/auth/FormError';
import { getErrorMessage, getErrorCode } from '../utils/errorMessage';

const ParentRegister = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [bindCode, setBindCode] = useState(params.get('code') || '');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setErrorCode(null);
    if (!bindCode || !phone || !password) {
      toast.warning('请填写完整');
      return;
    }
    if (password.length < 6) {
      toast.warning('密码至少 6 位');
      return;
    }
    if (phone.length < 11) {
      toast.warning('请输入正确的手机号');
      return;
    }
    setLoading(true);
    try {
      const res = await parentRegister({
        bind_code: bindCode.trim(),
        phone: phone.trim(),
        password,
        full_name: fullName.trim() || undefined,
      });
      localStorage.setItem('access_token', res.access_token);
      localStorage.setItem('user', JSON.stringify({
        id: res.parent_id,
        full_name: res.full_name,
        role: 'parent',
      }));
      toast.success('注册成功');
      navigate('/parent/dashboard');
    } catch (err: any) {
      setError(getErrorMessage(err, '注册失败，请稍后重试'));
      setErrorCode(getErrorCode(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper page-warm-glow flex items-center justify-center px-5 py-10">
      <div className="card-soft rounded-2xl p-8 w-full max-w-sm">
        <p className="text-ink-mute text-sm mb-2">家长端注册</p>
        <h1 className="font-display text-3xl font-semibold text-ink mb-3 tracking-tight">
          绑定孩子账号
        </h1>
        <p className="text-ink-soft text-sm mb-4 leading-relaxed">
          请孩子在「光荣榜 → 让家长看到你的进步」中获取 6 位绑定码（5 分钟内有效）。
        </p>

        {/* 注册后能看到什么的简介 */}
        <details className="mb-6 text-sm">
          <summary className="cursor-pointer text-accent-warm font-medium hover:underline">
            注册后能看到什么？
          </summary>
          <ul className="mt-3 space-y-1.5 text-ink-soft text-xs leading-relaxed pl-4">
            <li>· 今日学习时长 / 新词数 / 连续打卡天数</li>
            <li>· 本周与上周对比（时长/词数/正确率）</li>
            <li>· 孩子在系统中的排名（词汇王 / 勤奋王 / 精准王）</li>
            <li>· 30 天学习日历（哪天学了多少分钟）</li>
            <li>· 正在学的书 + 每本进度</li>
            <li>· 最薄弱的 10 个词 + 错过次数</li>
            <li>· 解锁的成就徽章</li>
          </ul>
        </details>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormError
            message={error}
            code={errorCode}
            context="parent-register"
            onDismiss={() => { setError(''); setErrorCode(null); }}
          />

          <div>
            <label className="block text-xs text-ink-soft mb-1.5">6 位绑定码</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              value={bindCode}
              onChange={e => setBindCode(e.target.value.replace(/\s/g, ''))}
              className="w-full px-4 py-3 rounded-xl border border-black/10 bg-white text-ink font-numeric text-lg tracking-widest focus:border-accent-warm focus:outline-none transition"
              placeholder="例如 123456"
            />
          </div>

          <div>
            <label className="block text-xs text-ink-soft mb-1.5">您的手机号</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              autoComplete="username"
              maxLength={11}
              className="w-full px-4 py-3 rounded-xl border border-black/10 bg-white text-ink focus:border-accent-warm focus:outline-none transition"
              placeholder="11 位手机号"
            />
          </div>

          <div>
            <label className="block text-xs text-ink-soft mb-1.5">设置密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-4 py-3 rounded-xl border border-black/10 bg-white text-ink focus:border-accent-warm focus:outline-none transition"
              placeholder="至少 6 位"
            />
          </div>

          <div>
            <label className="block text-xs text-ink-soft mb-1.5">称呼（可选）</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              maxLength={20}
              className="w-full px-4 py-3 rounded-xl border border-black/10 bg-white text-ink focus:border-accent-warm focus:outline-none transition"
              placeholder="如：小明妈妈"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-glow w-full py-3.5 text-white rounded-xl text-base font-semibold disabled:opacity-50"
          >
            {loading ? '注册中…' : '注册并绑定'}
          </button>
        </form>

        <p className="text-center text-ink-soft text-sm mt-6">
          已有账号？
          <Link to="/parent/login" className="text-accent-warm font-medium ml-1 hover:underline">
            直接登录
          </Link>
        </p>
      </div>
    </div>
  );
};

export default ParentRegister;
