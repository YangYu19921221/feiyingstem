import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { BookMarked, BookOpenCheck, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { redeemCode } from '../api/subscription';
import { getErrorMessage } from '../utils/errorMessage';
import StudentPageHeader from '../components/student/StudentPageHeader';

gsap.registerPlugin(useGSAP);

const RedeemSubscription = () => {
  const navigate = useNavigate();
  const pageRef = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 自动格式化兑换码输入
  const handleCodeChange = (value: string) => {
    const clean = value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '');
    const parts = [];
    for (let i = 0; i < clean.length && i < 16; i += 4) {
      parts.push(clean.slice(i, i + 4));
    }
    setCode(parts.join('-'));
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 19) {
      setError('请输入完整的兑换码（格式：XXXX-XXXX-XXXX-XXXX）');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res: any = await redeemCode(code);
      if (res.success) {
        setSuccess(res.message);
        setTimeout(() => navigate('/student/dashboard'), 2000);
      } else {
        setError(res.message);
      }
    } catch (err: any) {
      setError(getErrorMessage(err, '兑换失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  useGSAP(() => {
    const root = pageRef.current;
    if (!root) return;

    const media = gsap.matchMedia();
    media.add(
      { reduceMotion: '(prefers-reduced-motion: reduce)' },
      (context) => {
        if (context.conditions?.reduceMotion) return;
        gsap.from(root.querySelectorAll<HTMLElement>('[data-redeem-reveal]'), {
          autoAlpha: 0,
          y: 16,
          duration: 0.46,
          stagger: 0.07,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        });
      },
    );

    return () => media.revert();
  }, { scope: pageRef });

  return (
    <div ref={pageRef} className="min-h-screen bg-paper page-warm-glow">
      <StudentPageHeader
        title="兑换教材"
        subtitle="输入兑换码，把新教材加入书架"
        icon={KeyRound}
        backTo="/student/dashboard"
        maxWidth="5xl"
      />

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-5 sm:py-10">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.82fr)]">
          <section
            data-redeem-reveal
            className="student-colorful-surface order-2 overflow-hidden rounded-2xl border border-orange-100 lg:order-1"
          >
            <div className="relative flex h-36 items-center justify-center overflow-hidden bg-[#fff1df] sm:h-48" aria-hidden="true">
              <div className="absolute -left-10 top-3 h-24 w-24 rounded-full bg-amber-200/35" />
              <div className="absolute -right-8 bottom-0 h-28 w-28 rounded-full bg-orange-200/40" />
              <div className="absolute inset-x-8 bottom-5 h-3 rounded-full bg-orange-200/70 shadow-[0_6px_0_rgba(255,255,255,0.8)] sm:inset-x-16" />
              <div className="relative flex items-end gap-2 text-accent-warm">
                <div className="flex h-20 w-16 -rotate-3 items-center justify-center rounded-lg border border-orange-200 bg-white shadow-sm sm:h-24 sm:w-20">
                  <BookMarked className="h-9 w-9 sm:h-11 sm:w-11" />
                </div>
                <div className="flex h-16 w-14 rotate-2 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 shadow-sm sm:h-20 sm:w-16">
                  <BookOpenCheck className="h-8 w-8 sm:h-9 sm:w-9" />
                </div>
                <Sparkles className="absolute -right-7 -top-4 h-6 w-6 text-amber-500" />
              </div>
            </div>
            <div className="p-5 sm:p-7">
              <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">把新教材放进书架</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-ink-soft sm:text-base">
                兑换成功后，教材会立即出现在首页“我的书架”中，可以直接选择单元开始学习。
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div data-redeem-reveal className="rounded-xl bg-white/85 p-4">
                  <BookOpenCheck className="h-5 w-5 text-accent-warm" />
                  <p className="mt-2 font-semibold text-ink">兑换后自动入架</p>
                  <p className="mt-1 text-xs leading-5 text-ink-mute">不用重新登录，也不会影响已有教材和学习进度。</p>
                </div>
                <div data-redeem-reveal className="rounded-xl bg-white/85 p-4">
                  <ShieldCheck className="h-5 w-5 text-accent-warm" />
                  <p className="mt-2 font-semibold text-ink">一人一码更安全</p>
                  <p className="mt-1 text-xs leading-5 text-ink-mute">如果提示已使用或无效，请联系发放兑换码的老师。</p>
                </div>
              </div>
            </div>
          </section>

          <section
            data-redeem-reveal
            className="card-soft order-1 rounded-2xl p-5 sm:p-7 lg:order-2"
          >
            <div className="mb-6">
              <p className="text-xs font-semibold text-accent-warm">教材兑换</p>
              <h2 className="mt-1 font-display text-xl font-bold text-ink">输入 16 位兑换码</h2>
              <p className="mt-1 text-sm text-ink-soft">系统会自动补上分隔符，直接粘贴也可以。</p>
            </div>

            <form onSubmit={handleRedeem} className="space-y-4" aria-busy={loading}>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700"
                >
                  {error}
                </motion.div>
              )}
              {success && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="status"
                  className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm leading-5 text-green-700"
                >
                  {success}，正在返回书架…
                </motion.div>
              )}

              <div>
                <label htmlFor="redeem-code" className="mb-2 block text-sm font-medium text-ink">
                  兑换码
                </label>
                <input
                  id="redeem-code"
                  type="text"
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="font-numeric w-full rounded-xl border-2 border-gray-200 px-3 py-3.5 text-center text-base font-semibold uppercase tracking-[0.12em] outline-none sm:px-4 sm:text-lg sm:tracking-[0.18em]"
                  maxLength={19}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={loading || Boolean(success)}
                  aria-describedby="redeem-code-help"
                />
                <p id="redeem-code-help" className="mt-2 text-xs leading-5 text-ink-mute">
                  兑换码不包含数字 0、1 和字母 I、O，避免看错。
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || Boolean(success) || code.length !== 19}
                className="btn-glow w-full rounded-xl py-3.5 font-semibold text-white disabled:cursor-not-allowed"
              >
                {loading ? '正在兑换…' : success ? '兑换成功' : '兑换并加入书架'}
              </button>
            </form>

            <button
              type="button"
              onClick={() => navigate('/student/dashboard')}
              className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-medium text-accent-warm transition hover:bg-orange-50"
            >
              返回我的书架
            </button>
          </section>
        </div>
      </main>
    </div>
  );
};

export default RedeemSubscription;
