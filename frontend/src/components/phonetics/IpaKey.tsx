/**
 * 音标键盘上的一个键: 只印音标,点了读这个音本身(/b/,不是 bag)
 *
 * 11-03 用户要求去掉键下面的例词(c**a**t)、点键直接发这个音: 例词把孩子的注意力
 * 带到「这个词怎么拼」上,而这里练的是「听到这个音 → 找到这个符号」。
 * 声音是 public/phonemes/*.mp3(见 utils/ipaPhonemes 的 PHONEME_AUDIO)。
 * 键盘和「怎么打」演示共用这一个键,长得必须一样。
 *
 * 辅音白键、元音橙键: 与答案格「元音橙色」同一口径,第二遍「只填元音」就是只点橙键。
 */
import { isVowel } from '../../utils/ipaPhonemes';

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
  /** 视频提问框里的小键盘: 手机 36px / 电脑 40px 高、字号不放大 —— 那里地方小 */
  compact?: boolean;
  onClick?: () => void;
}

export default function IpaKey({ k, highlight, pressed, disabled, demo, title, compact, onClick }: Props) {
  const vowel = isVowel(k);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      tabIndex={demo ? -1 : undefined}
      aria-hidden={demo || undefined}
      aria-label={`音标 ${k}`}
      title={title}
      className={[
        'relative flex min-w-0 items-center justify-center rounded-lg',
        compact ? 'px-0' : 'px-0.5',
        'ring-1 transition duration-150 ease-out active:scale-95 disabled:opacity-40',
        // 视频提问框里地方小: 手机上 36px 高(7 行要和输入框、发送键一起放进一屏)
        compact ? 'h-9 md:h-10' : 'h-10 sm:h-11',
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
      <span className={`font-mono leading-none ${compact ? 'text-lg md:text-xl' : 'text-xl sm:text-2xl'}`}>{k}</span>
    </button>
  );
}
