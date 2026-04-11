/**
 * 彩色单词组件
 * 根据 syllables 字段按音节给单词字母上不同颜色
 *
 * 单词示例：syllables = "coun#try" → "coun"(橙) + "try"(蓝)
 * 连字符：  syllables = "self#stu#dy" + word "self-study" → "self-"(橙) + "stu"(蓝) + "dy"(绿)
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

  // syllables 只用来决定分段长度和颜色，实际字符取自 word
  // 用全局游标遍历 word，避免连字符/短语空格不匹配导致字符丢失
  const groups = syllables.split(' ');
  let colorIndex = 0;
  let cursor = 0; // 在 word 中的位置

  const elements: React.ReactNode[] = [];

  groups.forEach((group, gi) => {
    // 组间空格
    if (gi > 0) {
      if (cursor < word.length && word[cursor] === ' ') {
        elements.push(<span key={`sp-${gi}`}> </span>);
        cursor++;
      } else {
        elements.push(<span key={`sp-${gi}`}> </span>);
      }
    }

    const parts = group.includes('#') ? group.split('#') : [group];
    const isLastGroup = gi === groups.length - 1;

    parts.forEach((part, pi) => {
      const color = SYLLABLE_COLORS[colorIndex % SYLLABLE_COLORS.length];
      colorIndex++;
      const isLastPart = pi === parts.length - 1;

      let end = cursor + part.length;

      if (isLastPart && isLastGroup) {
        // 最后一段：取完所有剩余字符，防止末尾丢字
        end = word.length;
      } else {
        // 把紧跟的非字母非空格字符（连字符 - 等）并入当前段
        while (end < word.length && word[end] !== ' ' && !/[a-zA-Z]/.test(word[end])) {
          end++;
        }
      }

      const slice = word.slice(cursor, end);
      cursor = end;
      elements.push(
        <span key={`${gi}-${pi}`} className={color}>
          {slice}
        </span>
      );
    });
  });

  return <span className={className}>{elements}</span>;
}
