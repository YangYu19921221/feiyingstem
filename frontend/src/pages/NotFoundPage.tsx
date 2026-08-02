import { Compass, Home, LogIn } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const getStoredRole = () => {
  try {
    return (JSON.parse(localStorage.getItem('user') || 'null') as { role?: string } | null)?.role;
  } catch {
    return undefined;
  }
};

export default function NotFoundPage() {
  const navigate = useNavigate();
  const role = getStoredRole();
  const isStudent = role === 'student';
  const destination = role ? '/dashboard' : '/login';

  return (
    <main className={`flex min-h-screen items-center justify-center px-4 py-10 ${isStudent ? 'page-warm-glow bg-paper' : 'bg-slate-50'}`}>
      <section className="w-full max-w-lg rounded-2xl bg-white p-7 text-center shadow-[0_14px_40px_rgba(47,54,61,0.10)] sm:p-10">
        <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ${isStudent ? 'bg-orange-50 text-accent-warm' : 'bg-slate-100 text-slate-600'}`}>
          <Compass className="h-8 w-8" aria-hidden="true" />
        </div>
        <p className="font-numeric text-sm font-semibold text-ink-mute">404</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-ink">
          {isStudent ? '这里不是学习路线' : '没有找到这个页面'}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-soft">
          {isStudent
            ? '可能是地址过期了。回到学习中心，你的书本和学习记录都还在。'
            : '请检查地址，或返回工作台继续操作。'}
        </p>
        <button
          type="button"
          onClick={() => navigate(destination, { replace: true })}
          className={`mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition ${isStudent ? 'bg-accent-warm text-white hover:opacity-90' : 'bg-slate-800 text-white hover:bg-slate-700'}`}
        >
          {role ? <Home className="h-4 w-4" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
          {role ? (isStudent ? '返回学习中心' : '返回工作台') : '去登录'}
        </button>
      </section>
    </main>
  );
}
