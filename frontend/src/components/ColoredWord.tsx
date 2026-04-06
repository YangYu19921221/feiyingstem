/**
 * 彩色单词组件
 * 根据 syllables 字段按音节给单词字母上不同颜色
 *
 * 单词示例：syllables = "coun#try" → "coun"(橙) + "try"(蓝)
 * 短语示例：syllables = "look at" → "look"(橙) + " "(无色) + "at"(蓝)
 *          syllables = "ice cream" → "ice"(橙) + " "(无色) + "cream"(蓝)
 *          syllables = "look#ing at" → "look"(橙) + "ing"(蓝) + " "(无色) + "at"(绿)
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
  if (!syllables) {
    return <span className={className}>{word}</span>;
  }

  // syllables 只用来决定分段长度和颜色，实际字符取自 word，避免大小写不一致问题
  // syllables 去掉 # 后的纯字母长度应与 word 对应单词长度一致
  const wordGroups = syllables.split(' ');
  const wordParts = word.split(' ');
  let colorIndex = 0;

  return (
    <span className={className}>
      {wordGroups.map((group, gi) => {
        const syllableParts = group.includes('#') ? group.split('#') : [group];
        // 从 word 对应单词里按音节长度切片取字符
        const sourceWord = wordParts[gi] ?? '';
        let charOffset = 0;
        return (
          <span key={gi}>
            {gi > 0 && <span> </span>}
            {syllableParts.map((part, pi) => {
              const color = SYLLABLE_COLORS[colorIndex % SYLLABLE_COLORS.length];
              colorIndex++;
              const slice = sourceWord.slice(charOffset, charOffset + part.length);
              charOffset += part.length;
              return (
                <span key={pi} className={color}>
                  {slice}
                </span>
              );
            })}
          </span>
        );
      })}
    </span>
  );
}
