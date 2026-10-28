/**
 * 提问框里的「打音标」小键盘 —— 孩子的手机 / 电脑键盘打不出 æ,而他要问的恰恰是 /æ/
 *
 * 键和写音标用的是同一个 IpaKey(键下面印 c**a**t),孩子在两处学到的是同一套键。
 * 点一个键插成 /æ/,紧接着再点就拼进同一对斜杠: b æ d → /bæd/(规则见 utils/ipaPhonemes.insertIpaAt)。
 *
 * 排法按宽度(视频面板本来就比一屏高,这块越矮越不容易把「发给老师」挤出屏幕):
 * - 手机: 辅音 4 行、元音 3 行上下排,7 列,键 36px 高。输入框 + 这块 + 发送键 ≈ 510px,
 *   iPhone SE 的 Safari 可见区 553px 也放得下
 * - 768 以上: 辅音、元音左右并排,只占 4 行高。之前一行 14 个,元音 21 个排成 14 + 7,下面空半行
 *
 * 不读例词: 这块在视频下面,视频正在放,再出一个声音会盖住老师讲课。
 * 整块按下时 preventDefault: 电脑上焦点留在文字框里、光标不丢;手机上不让系统键盘弹回来盖住这块。
 */
import { ChevronDown, Delete } from 'lucide-react';
import { PHONEME_GROUPS, STRESS_MARK, isVowel } from '../../utils/ipaPhonemes';
import IpaKey from './IpaKey';

const KEYS = PHONEME_GROUPS.flatMap(g => g.keys.filter(k => k !== STRESS_MARK));
const CONSONANTS = KEYS.filter(k => !isVowel(k));
const VOWELS = KEYS.filter(k => isVowel(k));

interface Props {
  id: string;
  onKey: (phoneme: string) => void;
  onBackspace: () => void;
  onClose: () => void;
}

export default function IpaInsertPad({ id, onKey, onBackspace, onClose }: Props) {
  const block = (label: string, tone: string, list: string[]) => (
    <div className="min-w-0">
      {/* 并排时才写组名: 上下排时白键 / 橙键挨在一起,颜色自己就分得开,省一行高度 */}
      <p className={`mb-1 hidden text-xs font-semibold md:block ${tone}`}>{label}</p>
      <div className="grid grid-cols-7 gap-1">
        {list.map(k => <IpaKey key={k} k={k} compact onClick={() => onKey(k)} />)}
      </div>
    </div>
  );

  return (
    <div
      id={id}
      role="group"
      aria-label="插入音标"
      onMouseDown={e => e.preventDefault()}
      className="mb-2 rounded-xl bg-slate-50 p-1.5 ring-1 ring-slate-200 min-[360px]:mx-1 min-[360px]:p-2"
    >
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] leading-5 text-slate-700">
          <span className="md:hidden">连着点能拼词,如</span>
          <span className="hidden md:inline">点一下插进问题里,连着点能拼成一个词,如</span>
          <span className="ml-1 whitespace-nowrap font-mono font-semibold text-slate-900">/bæd/</span>
        </p>
        <button
          type="button"
          onClick={onBackspace}
          aria-label="删掉一个"
          className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 text-[13px] font-semibold text-slate-700
                     ring-1 ring-slate-300 transition active:scale-95 hover:bg-slate-100"
        >
          <Delete className="h-4 w-4" aria-hidden /> 退格
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起音标键"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-200"
        >
          <ChevronDown className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="grid gap-1.5 md:grid-cols-2 md:gap-3">
        {block('辅音', 'text-slate-600', CONSONANTS)}
        {block('元音', 'text-orange-700', VOWELS)}
      </div>
    </div>
  );
}
