import { useEffect, useState } from 'react';
import { Check, Clipboard, Swords, X } from 'lucide-react';

interface Props {
  inviteCode: string;
  onClose: () => void;
}

export default function PkInviteModal({ inviteCode, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose} role="presentation">
      <div
        className="relative w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pk-invite-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-xl text-ink-mute transition hover:bg-slate-100 hover:text-ink"
          aria-label="关闭邀请码弹窗"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
          <Swords className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 id="pk-invite-title" className="font-display text-xl font-semibold text-ink">房间创建成功</h3>
        <p className="mt-1 text-sm text-ink-mute">复制邀请码发给学生，页面稍后会自动进入房间。</p>
        <div className="my-5 select-all rounded-xl bg-orange-50 px-4 py-4 text-center font-numeric text-4xl font-semibold tracking-[0.22em] text-accent-warm">
          {inviteCode}
        </div>
        {copyFailed && <p className="mb-3 text-sm text-error" role="alert">浏览器没有允许自动复制，请长按上方邀请码手动复制。</p>}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={copy}
            className="btn-glow inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-semibold text-white"
            autoFocus
          >
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Clipboard className="h-4 w-4" aria-hidden="true" />}
            {copied ? '已复制' : '复制邀请码'}
          </button>
          <button
            onClick={onClose}
            className="min-h-12 rounded-xl bg-gray-100 px-4 font-semibold text-ink transition hover:bg-gray-200"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
