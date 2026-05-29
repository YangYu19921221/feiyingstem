import { useState } from 'react';
import { motion } from 'framer-motion';

/** 家长绑定码使用说明弹窗（自原 StudentLeaderboard 抽出，逻辑不变） */
export default function BindCodeDialog({ code, minutesLeft, onClose }: {
  code: string;
  minutesLeft: number;
  onClose: () => void;
}) {
  const parentUrl = `${window.location.origin}/parent/register?code=${code}`;
  const shareText =
    `我在「飞鹰AI英语」学习呢，邀请你查看我的学习数据：\n\n` +
    `1. 打开链接：${parentUrl}\n` +
    `2. 输入手机号 + 设置密码（绑定码已自动填好：${code}）\n` +
    `3. 注册后就能看到我的学习情况啦\n\n` +
    `（绑定码 ${minutesLeft} 分钟内有效，过期我会再发一个）`;

  const [copied, setCopied] = useState<'code' | 'text' | null>(null);

  const copy = async (text: string, kind: 'code' | 'text') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // 兜底：选中可手动复制
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center px-5 py-10 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl p-6 w-full max-w-md my-auto"
      >
        <p className="text-ink-mute text-xs uppercase tracking-widest mb-3 text-center">家长绑定码</p>
        <button
          onClick={() => copy(code, 'code')}
          className="w-full py-4 rounded-xl bg-paper hover:bg-black/[0.03] transition mb-2 group"
        >
          <p className="font-display text-5xl font-bold text-accent-warm font-numeric text-glow-warm tracking-[0.25em]">
            {code}
          </p>
          <p className="text-xs text-ink-mute mt-2 group-hover:text-accent-warm">
            {copied === 'code' ? '✓ 已复制' : '点击复制绑定码'}
          </p>
        </button>
        <p className="text-center text-xs text-ink-mute mb-6">
          ⏱ {minutesLeft} 分钟内有效，过期请重新生成
        </p>

        <div className="bg-paper rounded-xl p-4 mb-4">
          <p className="font-display text-sm font-semibold text-ink mb-3">告诉家长怎么用：</p>
          <ol className="space-y-2.5 text-sm text-ink-soft leading-relaxed">
            <li className="flex gap-2">
              <span className="font-numeric font-semibold text-accent-warm shrink-0">1.</span>
              <span>家长用手机或电脑打开网址 <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border border-black/[0.06]">{window.location.host}/parent/register</span></span>
            </li>
            <li className="flex gap-2">
              <span className="font-numeric font-semibold text-accent-warm shrink-0">2.</span>
              <span>输入这 6 位绑定码：<span className="font-numeric font-semibold text-ink">{code}</span></span>
            </li>
            <li className="flex gap-2">
              <span className="font-numeric font-semibold text-accent-warm shrink-0">3.</span>
              <span>填家长手机号 + 设置密码 → 注册成功</span>
            </li>
            <li className="flex gap-2">
              <span className="font-numeric font-semibold text-accent-warm shrink-0">4.</span>
              <span>以后家长用 <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border border-black/[0.06]">{window.location.host}/parent/login</span> 登录就能查看你的学习数据</span>
            </li>
          </ol>
        </div>

        <button
          onClick={() => copy(shareText, 'text')}
          className="w-full py-3 mb-2 rounded-xl border border-black/15 text-ink hover:bg-black/5 transition text-sm font-medium"
        >
          {copied === 'text' ? '✓ 邀请文案已复制，去微信粘贴给家长' : '📋 复制完整邀请文案'}
        </button>

        <button
          onClick={onClose}
          className="btn-glow w-full py-3 text-white rounded-xl font-semibold"
        >
          我已告诉家长
        </button>
      </motion.div>
    </motion.div>
  );
}
