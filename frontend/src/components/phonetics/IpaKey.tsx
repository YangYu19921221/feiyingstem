/**
 * 音标键盘上的一个键:上面是音标,下面是孩子认识的例词(c**a**t)
 *
 * 孩子卡住的地方是「不认识 æ」—— 但他认识 cat。例词里发这个音的字母加粗上色,
 * 一眼对上「哪个字母读这个音」。键盘和「怎么打」演示共用这一个键,长得必须一样。
 *
 * 辅音白键、元音橙键: 与答案格「元音橙色」同一口径,第二遍「只填元音」就是只点橙键。
 */
import { PHONEME_EXAMPLES, isVowel } from '../../utils/ipaPhonemes';

interface Props {
  k: string;
  /** 这一节在教的音: 橙圈 + 小圆点 */
  highlight?: boolean;
  /** 演示里「正在按」的那一下 */
  pressed?: boolean;
  disabled?: boolean;
  /** 演示用: 不可点、不进 Tab 顺序、读屏跳过(演示有自己的文字说明) */
  demo?: boolean;
  title?: string;
  onClick?: () => void;
}

export default function IpaKey({ k, highlight, pressed, disabled, demo, title, onClick }: Props) {
  const vowel = isVowel(k);
  const ex = PHONEME_EXAMPLES[k];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      tabIndex={demo ? -1 : undefined}
      aria-hidden={demo || undefined}
      aria-label={ex ? `音标 ${k},像 ${ex.join('')} 里的 ${ex[1]}` : `音标 ${k}`}
      title={title}
      className={[
        'relative flex h-10 min-w-0 flex-col items-center justify-center gap-[3px] rounded-lg px-0.5',
        'ring-1 transition duration-150 ease-out active:scale-95 disabled:opacity-40 sm:h-12',
        demo ? 'pointer-events-none' : '',
        vowel
          ? 'bg-orange-50 text-orange-700 ring-orange-200 hover:bg-orange-100'
          : 'bg-white text-slate-800 ring-slate-300 hover:bg-slate-50',
        highlight ? '!ring-2 !ring-[#FF6B35]' : '',
        pressed ? 'scale-95 !ring-2 !ring-[#FF6B35] brightness-95' : '',
      ].join(' ')}
    >
      {highlight && (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#FF6B35]" aria-hidden />
      )}
      <span className="font-mono text-lg leading-none sm:text-xl">{k}</span>
      {ex && (
        <span className="block max-w-full truncate text-[11px] leading-none text-slate-600 sm:text-xs">
          {ex[0]}
          <b className={vowel ? 'font-bold text-orange-700' : 'font-bold text-sky-700'}>{ex[1]}</b>
          {ex[2]}
        </span>
      )}
    </button>
  );
}
