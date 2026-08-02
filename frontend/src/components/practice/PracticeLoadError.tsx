import { ArrowLeft, RefreshCw, WifiOff } from 'lucide-react';
import useGoBack from '../../hooks/useGoBack';

interface PracticeLoadErrorProps {
  title?: string;
  message: string;
  onRetry: () => void;
}

export default function PracticeLoadError({
  title = '题目暂时没准备好',
  message,
  onRetry,
}: PracticeLoadErrorProps) {
  const goBack = useGoBack('/student/dashboard');

  return (
    <main className="page-warm-glow flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <section className="card-soft w-full max-w-md rounded-2xl p-6 text-center sm:p-8" role="alert">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
          <WifiOff className="h-8 w-8" aria-hidden="true" />
        </div>
        <h1 className="font-display text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          {message} 你的学习记录不会丢失。
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            再试一次
          </button>
          <button
            type="button"
            onClick={() => goBack()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-black/[0.05] px-5 text-sm font-semibold text-ink transition hover:bg-black/[0.08]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回上一页
          </button>
        </div>
      </section>
    </main>
  );
}
