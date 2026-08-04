import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useGoBack from '../../hooks/useGoBack';

interface StudentPageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  backTo?: string;
  maxWidth?: '3xl' | '5xl' | '6xl';
}

const widths = {
  '3xl': 'max-w-3xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
};

export default function StudentPageHeader({
  title,
  subtitle,
  icon: Icon,
  action,
  backTo,
  maxWidth = '6xl',
}: StudentPageHeaderProps) {
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');

  return (
    <header className="student-page-header sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className={`${widths[maxWidth]} mx-auto flex min-h-[64px] items-center gap-3 px-4 sm:px-5 py-2.5`}>
        <button
          type="button"
          onClick={() => backTo ? navigate(backTo) : goBack()}
          className="student-focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#536170] transition hover:bg-orange-50 hover:text-accent-warm"
          aria-label="返回"
          title="返回"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {Icon && (
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-primary sm:flex">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-base font-bold leading-tight text-gray-900 sm:text-lg">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-xs text-gray-500">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}
