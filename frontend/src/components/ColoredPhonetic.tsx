/**
 * 彩色音标组件 v3
 * 按音节分组，每个音节用不同背景色，元音核心突出显示
 * 帮助学生直观理解发音节奏和音节结构
 */

// ===== 音素识别 =====

const DIPHTHONGS = [
  'aɪə', 'aʊə',
  'aɪ', 'eɪ', 'ɔɪ', 'aʊ', 'əʊ', 'ɪə', 'eə', 'ʊə', 'oʊ',
];

const AFFRICATES = ['tʃ', 'dʒ', 'ʤ', 'ʧ', 'ts', 'dz'];

const LONG_VOWELS = ['iː', 'uː', 'ɑː', 'ɔː', 'ɜː', 'əː', 'eː', 'oː'];

const MULTI_PHONEMES = [...DIPHTHONGS, ...LONG_VOWELS, ...AFFRICATES]
  .sort((a, b) => b.length - a.length);

const VOWELS = new Set([
  'æ', 'ɪ', 'ʊ', 'ɒ', 'ʌ', 'ə', 'ɛ', 'ɔ',
  'i', 'u', 'e', 'o', 'a', 'ɑ', 'ɜ', 'ɐ',
]);

const CONSONANTS = new Set([
  'p', 'b', 't', 'd', 'k', 'g', 'f', 'v',
  'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h', 'ɹ',
  'm', 'n', 'ŋ', 'l', 'r', 'w', 'j',
  'x', 'ɡ', 'ɾ', 'ʔ', 'ɫ',
]);

const STRESS_MARKS = new Set(['ˈ', 'ˌ']);
const DELIMITERS = new Set(['/', '[', ']', '(', ')']);

type PType = 'vowel' | 'consonant' | 'stress' | 'delimiter' | 'space';

interface Phoneme {
  text: string;
  type: PType;
}

function classifyP(text: string): PType {
  if (text.length > 1) {
    const chars = Array.from(text);
    return chars.some(ch => VOWELS.has(ch)) ? 'vowel' : 'consonant';
  }
  if (VOWELS.has(text)) return 'vowel';
  if (CONSONANTS.has(text)) return 'consonant';
  if (STRESS_MARKS.has(text)) return 'stress';
  if (DELIMITERS.has(text)) return 'delimiter';
  if (text === ' ' || text === '.' || text === '-') return 'space';
  return 'consonant';
}

function parsePhonemes(phonetic: string): Phoneme[] {
  const result: Phoneme[] = [];
  const chars = Array.from(phonetic);
  let i = 0;
  while (i < chars.length) {
    const remaining = chars.slice(i).join('');
    let matched = false;
    for (const mp of MULTI_PHONEMES) {
      if (remaining.startsWith(mp)) {
        result.push({ text: mp, type: classifyP(mp) });
        i += Array.from(mp).length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result.push({ text: chars[i], type: classifyP(chars[i]) });
      i++;
    }
  }
  return result;
}

// ===== 音节分组 =====

interface Syllable {
  phonemes: Phoneme[];
  stressed: boolean;
}

function groupSyllables(phonemes: Phoneme[]): Syllable[] {
  const syllables: Syllable[] = [];
  let current: Phoneme[] = [];
  let stressed = false;

  for (const p of phonemes) {
    if (p.type === 'delimiter') continue;
    if (p.type === 'space') {
      if (current.length > 0) {
        syllables.push({ phonemes: current, stressed });
        current = [];
        stressed = false;
      }
      continue;
    }
    if (p.type === 'stress') {
      if (current.length > 0) {
        syllables.push({ phonemes: current, stressed });
        current = [];
      }
      stressed = true;
      continue;
    }
    // 元音触发新音节（如果当前已有元音）
    if (p.type === 'vowel') {
      const hasVowel = current.some(x => x.type === 'vowel');
      if (hasVowel) {
        // 把最后一个辅音移到新音节（onset）
        const lastC = current.length > 0 && current[current.length - 1].type === 'consonant'
          ? current.pop()! : null;
        if (current.length > 0) {
          syllables.push({ phonemes: current, stressed });
          stressed = false;
        }
        current = lastC ? [lastC] : [];
      }
    }
    current.push(p);
  }
  if (current.length > 0) {
    syllables.push({ phonemes: current, stressed });
  }
  return syllables;
}

// ===== 音节配色 =====

const SYLLABLE_COLORS = [
  { bg: 'bg-orange-50',  border: 'border-orange-200', vowel: 'text-orange-600', cons: 'text-orange-400', stressBg: 'bg-orange-100' },
  { bg: 'bg-sky-50',     border: 'border-sky-200',    vowel: 'text-sky-600',    cons: 'text-sky-400',    stressBg: 'bg-sky-100' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200',vowel: 'text-emerald-600',cons: 'text-emerald-400',stressBg: 'bg-emerald-100' },
  { bg: 'bg-violet-50',  border: 'border-violet-200', vowel: 'text-violet-600', cons: 'text-violet-400', stressBg: 'bg-violet-100' },
  { bg: 'bg-rose-50',    border: 'border-rose-200',   vowel: 'text-rose-600',   cons: 'text-rose-400',   stressBg: 'bg-rose-100' },
  { bg: 'bg-amber-50',   border: 'border-amber-200',  vowel: 'text-amber-600',  cons: 'text-amber-400',  stressBg: 'bg-amber-100' },
];

// ===== 组件 =====

interface ColoredPhoneticProps {
  phonetic: string;
  className?: string;
  showLegend?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CFG = {
  sm: { outer: 'text-sm gap-1.5', vowel: 'text-lg', cons: 'text-base', pill: 'px-2 py-1', gap: 'gap-0.5' },
  md: { outer: 'text-base gap-2', vowel: 'text-2xl', cons: 'text-xl', pill: 'px-3 py-1.5', gap: 'gap-0.5' },
  lg: { outer: 'text-lg gap-2.5', vowel: 'text-3xl', cons: 'text-2xl', pill: 'px-4 py-2', gap: 'gap-1' },
};

export default function ColoredPhonetic({
  phonetic,
  className = '',
  showLegend = false,
  size = 'md',
}: ColoredPhoneticProps) {
  if (!phonetic) return null;

  const phonemes = parsePhonemes(phonetic);
  const syllables = groupSyllables(phonemes);
  const cfg = SIZE_CFG[size];

  return (
    <span className={`inline-flex flex-col items-start ${className}`}>
      <span className={`inline-flex items-center flex-wrap font-mono ${cfg.outer}`}>
        <span className="text-gray-300 font-light">/</span>
        {syllables.map((syl, si) => {
          const color = SYLLABLE_COLORS[si % SYLLABLE_COLORS.length];
          const bg = syl.stressed ? color.stressBg : color.bg;
          return (
            <span
              key={si}
              className={`inline-flex items-baseline ${cfg.gap} ${bg} ${color.border} border ${cfg.pill} rounded-xl relative`}
            >
              {syl.stressed && (
                <span className="absolute -top-2 -left-1 text-red-400 font-bold leading-none" style={{ fontSize: '16px' }}>&#x2C8;</span>
              )}
              {syl.phonemes.map((p, pi) => (
                <span
                  key={pi}
                  className={
                    p.type === 'vowel'
                      ? `${color.vowel} ${cfg.vowel} font-extrabold`
                      : `${color.cons} ${cfg.cons} font-semibold`
                  }
                >
                  {p.text}
                </span>
              ))}
            </span>
          );
        })}
        <span className="text-gray-300 font-light">/</span>
      </span>
      {showLegend && (
        <span className="flex items-center gap-4 mt-2 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="text-red-400 font-bold">&#x2C8;</span> 重读音节
          </span>
          <span className="flex items-center gap-1">
            <span className="font-extrabold text-sm text-gray-600">大</span> 元音
          </span>
          <span className="flex items-center gap-1">
            <span className="font-semibold text-xs text-gray-400">小</span> 辅音
          </span>
          <span className="text-gray-400">不同颜色 = 不同音节</span>
        </span>
      )}
    </span>
  );
}
