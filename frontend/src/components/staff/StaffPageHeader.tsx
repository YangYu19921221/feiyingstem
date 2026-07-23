import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface StaffPageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  backTo?: string;
  maxWidth?: '5xl' | '6xl' | '7xl';
}

const widths = {
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
};

export default function StaffPageHeader({
  title,
  subtitle,
  icon: Icon,
  action,
  backTo,
  maxWidth = '7xl',
}: StaffPageHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className={`${widths[maxWidth]} mx-auto flex min-h-[64px] items-center gap-3 px-4 py-2.5 sm:px-6`}>
        <button type="button" onClick={() => backTo ? navigate(backTo) : navigate(-1)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="返回" title="返回">
          <ArrowLeft className="h-5 w-5" />
        </button>
        {Icon && (
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-[#ff6b35] sm:flex">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold leading-tight text-slate-900 sm:text-lg">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}
