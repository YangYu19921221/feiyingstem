/**
 * 「句子积木」(语法小课)在管理端首页 / 教师工作台最上面的入口卡片(2026-11-15)。
 *
 * 样课上线那天页面上没有任何按钮通向 /student/grammar,用户在手机上找不到(微信里也没地方输地址)——
 * 「功能上线却没人发现,等于没做」。所以工作台最上面放一张显眼的卡片,工具列表里也有一项。
 * 放不放见 grammarEntry.ts 的 useGrammarEntry。
 */
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { GRAMMAR_HOME } from './grammarEntry';

export default function GrammarTrialCard({ show }: { show: boolean }) {
  const navigate = useNavigate();
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => navigate(GRAMMAR_HOME)}
      className="flex w-full items-center gap-3 rounded-2xl border-2 border-orange-300 bg-orange-50 px-4 py-3.5 text-left transition hover:border-orange-400 hover:bg-orange-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 sm:gap-4 sm:px-5 sm:py-4"
    >
      <img src="/tutor-avatar.jpg" alt="" className="h-12 w-12 shrink-0 rounded-full border-2 border-orange-200 object-cover sm:h-14 sm:w-14" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold text-slate-900 sm:text-lg">句子积木(语法小课)</span>
          <span className="rounded-full bg-orange-600 px-2 py-0.5 text-[11px] font-bold text-white">试课</span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-slate-700 sm:text-sm">
          小鹰老师一句一句讲,句子摆成彩色积木,孩子点一点就学。现在有 10 节,先请你点开试。
          <span className="text-slate-600">只有管理员和直营老师看得到,学生那边还没有入口。</span>
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white sm:inline-flex">
        去试课 <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-orange-700 sm:hidden" aria-hidden="true" />
    </button>
  );
}
