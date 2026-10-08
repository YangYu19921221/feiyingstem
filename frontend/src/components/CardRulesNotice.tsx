/**
 * 新卡包政策提醒条(2026-10-08)。只在本机构是新卡包政策时显示,老政策机构什么都不渲染。
 * 放在「布置作业」「分配单词本」这些老师最容易撞上规则的地方,点「看规则」进 /teacher/card-rules。
 */
import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useCardPlan } from '../hooks/useCardPlan';

export default function CardRulesNotice({ context }: { context: 'homework' | 'assign' }) {
  const plan = useCardPlan();
  if (plan !== 'pack') return null;
  const text = context === 'homework'
    ? '课本作业只有已兑换学习卡的学生能做,没兑换的学生打开会提示先兑换。入门课和本机构自建的书不受限制。'
    : '课本要学生用兑换码开通,不能在这里直接分配;这里只能分配入门课和本机构自建的书。';
  return (
    <div role="note" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{text}</span>
      <Link to="/teacher/card-rules" className="shrink-0 font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-950">
        看规则
      </Link>
    </div>
  );
}
