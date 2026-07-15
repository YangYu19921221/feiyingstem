/** 机构管理共享小组件: 初始密码弹窗 + 配额水位条 */

/** 初始密码仅展示一次的弹窗(平台开机构管理员 / 机构建老师共用) */
export function InitialPasswordModal({
  title, subtitle, username, password, onClose,
}: {
  title: string;
  subtitle: string;
  username: string;
  password: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-4">{subtitle}</p>
        <div className="bg-orange-50 rounded-xl p-4 font-mono text-sm space-y-1">
          <div>账号: <b>{username}</b></div>
          <div>初始密码: <b className="text-[#FF6B35]">{password}</b></div>
        </div>
        <button
          className="mt-4 w-full py-2 rounded-xl bg-[#FF6B35] text-white font-bold"
          onClick={() => { navigator.clipboard?.writeText(`账号:${username} 密码:${password}`); onClose(); }}
        >
          复制并关闭
        </button>
      </div>
    </div>
  );
}

export function quotaPercent(active: number, quota: number): number {
  return Math.min(100, Math.round(active / Math.max(1, quota) * 100));
}

/** 配额水位条: 90% 以上变红 */
export function QuotaBar({ active, quota, className = 'w-full' }: { active: number; quota: number; className?: string }) {
  const pct = quotaPercent(active, quota);
  return (
    <div className={`h-2 bg-gray-100 rounded-full overflow-hidden ${className}`}>
      <div className={`h-full ${pct >= 90 ? 'bg-red-400' : 'bg-[#5FD35F]'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
