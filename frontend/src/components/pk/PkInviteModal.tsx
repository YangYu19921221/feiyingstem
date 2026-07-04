import { useState } from 'react';

interface Props {
  inviteCode: string;
  onClose: () => void;
}

export default function PkInviteModal({ inviteCode, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — clipboard might be denied
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-80 shadow-xl">
        <h3 className="text-lg font-bold mb-1 text-ink">🎉 房间创建成功</h3>
        <p className="text-xs text-ink-mute">邀请码</p>
        <div className="text-4xl font-mono font-bold tracking-[0.3em] text-center my-4 select-all text-primary">
          {inviteCode}
        </div>
        <p className="text-sm text-ink-soft mb-4">
          把这个 6 位码发给同班同学,他们就能加入这一局 PK,马上进入房间…
        </p>
        <div className="flex gap-2">
          <button
            onClick={copy}
            className="btn-glow flex-1 px-4 py-2 text-white rounded-xl font-medium"
          >
            {copied ? '✅ 已复制' : '📋 复制'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-ink rounded-xl font-medium transition"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
