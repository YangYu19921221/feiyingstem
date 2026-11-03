/**
 * 音标软键盘
 *
 * 为什么要软键盘:æ ɪ ʊ ə ŋ ʒ ɑː 这些符号系统键盘上打不出来。
 *
 * 孩子「不会打」卡在三处(10-28 按生产作答查的),各有对策:
 * ① 不认识 æ —— 点键就读出这个音本身(/æ/),听着对就是它。
 *    10-28 起键下面印过例词(c**a**t)、点键读例词;11-03 用户要求去掉,直接发音标的音
 *    (例词把注意力带到拼写上,而这里练的是「听到音 → 找符号」)。声音见 PHONEME_AUDIO
 * ② 不知道从哪下手 —— 第一次打开自动放一遍「怎么打」演示(IpaHowTo),工具条上随时再看
 * ③ 重音符 ˈ 当成一个音去填 —— 177 道题第 0 格是重音,孩子把第一个音填进去整排错位。
 *    重音判分本来就不算,所以题目里直接印好(后端 stress_at),键盘上不再放这个键
 *
 * 辅音白键、元音橙键,与答案格「元音橙色」同一口径。键的顺序仍照音标视频的分组
 * (爆破音 → 摩擦音 → … → 单元音 → 双元音),分组名在每个键的提示里。
 * 49 个键 = 辅音 28(4 行)+ 元音 21(3 行),每行 7 个正好排满。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CircleHelp, Delete, Volume2, VolumeX } from 'lucide-react';
import { PHONEME_GROUPS, STRESS_MARK, isVowel, phonemeAudioUrl } from '../../utils/ipaPhonemes';
import { useAudio, preloadStaticAudio } from '../../hooks/useAudio';
import IpaKey from './IpaKey';
import IpaHowTo from './IpaHowTo';

const KEYS = PHONEME_GROUPS.flatMap(g =>
  g.keys.filter(k => k !== STRESS_MARK).map(k => ({ k, group: g.label })));
const CONSONANTS = KEYS.filter(x => !isVowel(x.k));
const VOWELS = KEYS.filter(x => isVowel(x.k));

/** 按账号记(一台平板几个孩子轮着用,共用一个键会让后一个孩子看不到演示) */
function perUser(name: string): string {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return `${name}_${u?.id ?? 'anon'}`;
  } catch {
    return `${name}_anon`;
  }
}

interface Props {
  onKey: (phoneme: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  /** 已填满时禁用音素键(但退格/清空仍可用),避免学生多点了却没反馈 */
  full?: boolean;
  disabled?: boolean;
  /** 高亮这一节在教的音素,做视觉引导 */
  highlight?: string[];
  /** 清空键文案。整页版清的是"本行",卡片版只有一个词,说"本行"会让人找不到行在哪 */
  clearLabel?: string;
  /** 键盘右下角的额外按钮(卡片版放"不会,看答案") */
  action?: ReactNode;
  /**
   * 每行几个键。默认 7 个;容器够宽时调用方给 14 个,省出高度给卡片和交卷键。
   * 要调用方给而不是按视口判断: 整页版电脑上键盘在 26rem 的侧栏里,视口宽不代表键盘宽
   */
  gridClassName?: string;
  /** 键矮一档(手机 36px): 卡片版一屏放 6 张卡,键盘要让出高度 */
  dense?: boolean;
}

export default function IpaKeyboard({
  onKey, onBackspace, onClear, full = false, disabled = false, highlight = [],
  clearLabel = '清空本行', action, gridClassName = 'grid-cols-7', dense = false,
}: Props) {
  const hi = new Set(highlight);
  const { playStatic } = useAudio();
  // 48 个音一共不到 200KB: 键盘一出来就全部拉下来,点键不用等网络
  useEffect(() => {
    preloadStaticAudio(KEYS.map(x => phonemeAudioUrl(x.k)).filter((u): u is string => !!u));
  }, []);
  const [sound, setSound] = useState(() => localStorage.getItem(perUser('ipa_key_sound')) !== '0');
  // 第一次用键盘自动放一遍演示;看过(点了关闭)就不再自动弹
  const [howTo, setHowTo] = useState(() => !localStorage.getItem(perUser('ipa_howto_seen')));

  const closeHowTo = useCallback(() => {
    localStorage.setItem(perUser('ipa_howto_seen'), '1');
    setHowTo(false);
  }, []);

  const toggleSound = () => {
    setSound(s => {
      localStorage.setItem(perUser('ipa_key_sound'), s ? '0' : '1');
      return !s;
    });
  };

  const press = (k: string) => {
    onKey(k);
    // 读这个音本身: 孩子不认识 æ,听到 /æ/ 就知道是不是自己要的那个
    const url = phonemeAudioUrl(k);
    if (sound && url) playStatic(url).catch(() => {});
  };

  const keys = (list: typeof KEYS) => (
    <div className={`grid gap-1 ${gridClassName}`}>
      {list.map(({ k, group }) => (
        <IpaKey
          key={k}
          k={k}
          highlight={hi.has(k)}
          disabled={disabled || full}
          compact={dense}
          title={`${group} ${k}${hi.has(k) ? ' · 这节课学的音' : ''}`}
          onClick={() => press(k)}
        />
      ))}
    </div>
  );

  return (
    <div className={`rounded-2xl bg-white ring-1 ring-slate-200 ${dense ? 'p-2' : 'p-2.5'}`}>
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 ${dense ? 'mb-1.5' : 'mb-2'}`}>
        {/* 图例: 颜色是这块键盘唯一的分区方式,要写出来 */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-700">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[4px] bg-white ring-1 ring-slate-400" aria-hidden />辅音
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[4px] bg-orange-100 ring-1 ring-orange-300" aria-hidden />元音
          </span>
          {highlight.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#FF6B35]" aria-hidden />本课的音
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          aria-label="点键时读出这个音"
          title={sound ? '点键时会读出这个音,点这里关掉' : '点键时不出声,点这里打开'}
          className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold
                     text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 ${dense ? 'h-8' : 'h-9'}`}
        >
          {sound
            ? <Volume2 className="h-4 w-4 text-sky-700" aria-hidden />
            : <VolumeX className="h-4 w-4 text-slate-500" aria-hidden />}
          {/* 手机上只留图标,图例和「怎么打?」才挤得进一行 */}
          <span className="hidden sm:inline">{sound ? '发音' : '静音'}</span>
        </button>
        <button
          type="button"
          onClick={() => setHowTo(true)}
          className={`flex shrink-0 items-center gap-1 rounded-full bg-orange-50 px-3 text-sm font-bold
                     text-accent-warm ring-1 ring-orange-300 transition hover:bg-orange-100 ${dense ? 'h-8' : 'h-9'}`}
        >
          <CircleHelp className="h-4 w-4" aria-hidden /> 怎么打?
        </button>
      </div>

      {keys(CONSONANTS)}
      <div className={dense ? 'h-1.5' : 'h-2'} aria-hidden />
      {keys(VOWELS)}

      <div className={`flex flex-wrap items-center gap-2 ${dense ? 'mt-2' : 'mt-2.5'}`}>
        <button
          type="button"
          onClick={onBackspace}
          disabled={disabled}
          className="flex h-10 items-center gap-1.5 rounded-lg bg-white px-3.5 text-sm font-semibold text-slate-700
                     ring-1 ring-slate-300 transition active:scale-95 hover:bg-slate-50 disabled:opacity-40"
        >
          <Delete className="h-4 w-4" aria-hidden /> 退格
        </button>
        {/* 卡片版一个词最多 8 格,退格就够了;省下这个键的位置给交卷键 */}
        {!dense && (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="h-10 rounded-lg bg-white px-3.5 text-sm text-slate-700 ring-1 ring-slate-300
                       transition active:scale-95 hover:bg-slate-50 disabled:opacity-40"
          >
            {clearLabel}
          </button>
        )}
        {action && (
          <div className={dense ? 'flex min-w-0 flex-1 justify-end gap-2' : 'ml-auto'}>{action}</div>
        )}
      </div>

      {howTo && <IpaHowTo onClose={closeHowTo} />}
    </div>
  );
}
