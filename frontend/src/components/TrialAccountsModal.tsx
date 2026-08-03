/**
 * 一键开体验账号的结果弹窗
 * 给出可整段复制的纯文本(要直接转发给加盟商,所以不排表格),密码仅显示这一次。
 */
import { useState } from 'react';

export interface TrialAccountsResult {
  org: { name: string; code: string; student_quota: number };
  password: string;
  days: number;
  expires_on: string;
  books_assigned: number;
  accounts: { role: string; label: string; username: string }[];
}

export default function TrialAccountsModal({
  result, siteUrl, onClose,
}: {
  result: TrialAccountsResult;
  siteUrl: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const text = [
    '【飞鹰AI英语 · 体验账号】',
    '',
    `网址：${siteUrl}`,
    '',
    ...result.accounts.flatMap(a => [
      a.label,
      `账号：${a.username}`,
      `密码：${result.password}`,
      '',
    ]),
    `体验期：${result.days} 天（至 ${result.expires_on}，到期自动停用）`,
    `已开通 ${result.books_assigned} 本词书，学生名额 ${result.org.student_quota} 个`,
  ].join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-slate-800">✅ 体验账号已开通</h3>
        <p className="mt-1 text-sm text-slate-500">
          「{result.org.name}」· 机构码 {result.org.code} — 密码仅显示这一次，请立即复制
        </p>
        <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-orange-50 p-4 font-mono text-xs leading-relaxed text-slate-700">
          {text}
        </pre>
        <div className="mt-4 flex gap-2">
          <button
            className="flex-1 rounded-xl bg-[#FF6B35] py-2.5 font-bold text-white transition hover:bg-[#e95d2c]"
            onClick={copy}
          >
            {copied ? '✓ 已复制' : '复制全部'}
          </button>
          <button className="rounded-xl bg-gray-100 px-5 py-2.5 font-semibold text-slate-600" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
