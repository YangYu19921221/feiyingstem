import type { InputHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

interface AuthInputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  icon?: LucideIcon;
}

export default function AuthInput({
  id,
  label,
  icon: Icon,
  className = '',
  ...inputProps
}: AuthInputProps) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-[#293545]">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#687383]"
            strokeWidth={1.8}
          />
        )}
        <input
          id={id}
          {...inputProps}
          className={`h-12 w-full rounded-[14px] border border-[#cbd6e2] bg-[#f8fafc] pr-4 text-[15px] text-[#293545] outline-none transition duration-200 placeholder:text-[#687383] hover:border-[#aebdca] focus:border-[#bd5227] focus:bg-white focus:ring-4 focus:ring-[#bd5227]/10 disabled:cursor-not-allowed disabled:bg-[#eef2f5] disabled:text-[#687383] ${Icon ? 'pl-11' : 'pl-4'} ${className}`}
        />
      </div>
    </div>
  );
}
