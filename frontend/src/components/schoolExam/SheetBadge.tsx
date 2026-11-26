/** 一个孩子这次考试的卷子传了没有 / 读到哪了(学校考试 · 丢分分析) */
import { LoaderCircle } from 'lucide-react';
import type { SheetInfo } from '../../api/schoolExam';

export default function SheetBadge({ sheet }: { sheet: SheetInfo | null }) {
  if (!sheet) return <span className="text-slate-400">没传</span>;
  if (sheet.status === 'pending') return <span className="inline-flex items-center gap-1 text-sky-700"><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> 在读</span>;
  if (sheet.status === 'failed') return <span className="text-rose-600">没读出来</span>;
  if (sheet.confirm > 0) return <span className="font-semibold text-amber-700">要你确认 {sheet.confirm} 处</span>;
  return <span className="text-emerald-700">读好了</span>;
}
