/**
 * 彩色单词组件
 * 根据 syllables 字段（如 "coun-try"）按音节给单词字母上不同颜色
 */

const SYLLABLE_COLORS = [
  'text-orange-500',
  'text-sky-500',
  'text-emerald-500',
  'text-violet-500',
  'text-rose-500',
  'text-amber-500',
];

interface ColoredWordProps {
  word: string;
  syllables?: string | null;
  className?: string;
}

export default function ColoredWord({ word, syllables, className = '' }: ColoredWordProps) {
  if (!syllables || !syllables.includes('-')) {
    return <span className={className}>{word}</span>;
  }

  const parts = syllables.split('-');

  return (
    <span className={className}>
      {parts.map((part, i) => (
        <span key={i} className={SYLLABLE_COLORS[i % SYLLABLE_COLORS.length]}>
          {part}
        </span>
      ))}
    </span>
  );
}
