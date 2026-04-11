import { useState, useCallback, useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

let listeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];
let nextId = 0;

function notify() {
  listeners.forEach((l) => l([...toasts]));
}

export function toast(message: string, type: ToastType = 'info') {
  const id = nextId++;
  toasts = [...toasts, { id, message, type }];
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 3000);
}

toast.success = (msg: string) => toast(msg, 'success');
toast.error = (msg: string) => toast(msg, 'error');
toast.info = (msg: string) => toast(msg, 'info');
toast.warning = (msg: string) => toast(msg, 'warning');

export function useToasts() {
  const [state, setState] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.push(setState);
    return () => {
      listeners = listeners.filter((l) => l !== setState);
    };
  }, []);
  return state;
}

const typeStyles: Record<ToastType, string> = {
  success: 'bg-green-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
  warning: 'bg-yellow-500 text-gray-900',
};

const typeIcons: Record<ToastType, string> = {
  success: '\u2705',
  error: '\u274C',
  info: '\u2139\uFE0F',
  warning: '\u26A0\uFE0F',
};

export default function ToastContainer() {
  const items = useToasts();
  if (items.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      {items.map((t) => (
        <div
          key={t.id}
          className={`${typeStyles[t.type]} text-white px-4 py-3 rounded-lg shadow-lg
            text-sm animate-slide-in flex items-start gap-2 leading-relaxed`}
        >
          <span className="flex-shrink-0">{typeIcons[t.type]}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
