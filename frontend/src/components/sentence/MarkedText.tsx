/**
 * 显示带 # 高频词标记的句子(2026-10-11): `I #like# apples.` → like 换色加粗。
 * marked 为空时原样显示 text。对话破折号由调用方决定要不要去掉(传 stripDash)。
 */
import { stripDialogueDash } from '../../utils/sentenceCheck';

export default function MarkedText({ text, marked, stripDash = true, className = '' }: {
  text: string;
  marked?: string | null;
  stripDash?: boolean;
  className?: string;
}) {
  const src = marked || text;
  const shown = stripDash ? stripDialogueDash(src) : src;
  if (!marked) return <span className={className}>{shown}</span>;
  const parts = shown.split('#');
  return (
    <span className={className}>
      {parts.map((seg, i) => i % 2 === 1
        ? <mark key={i} className="rounded bg-amber-100 px-0.5 font-semibold text-[#E8590C]">{seg}</mark>
        : <span key={i}>{seg}</span>)}
    </span>
  );
}
