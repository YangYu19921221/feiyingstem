/**
 * 音标软键盘
 *
 * 为什么要软键盘:æ ɪ ʊ ə ŋ ʒ ɑː ˈ 这些符号系统键盘上打不出来。
 * 分组严格照音标视频的分组排(爆破音/摩擦音/双辅音/鼻音/似拼音/单元音/双元音/半元音),
 * 学生刚看完「爆破音 [p][b]」那一课,键盘上第一区就是他刚学的。
 * 键盘同时就是一张音标表,不用另做参考图。
 *
 * 全书只用到 38 个音素,这里放全 48 个:与视频课程对齐,以后第 2 册用到剩下的不用改。
 */
import { PHONEME_GROUPS } from '../../utils/ipaPhonemes';

interface Props {
  onKey: (phoneme: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  /** 已填满时禁用音素键(但退格/清空仍可用),避免学生多点了却没反馈 */
  full?: boolean;
  disabled?: boolean;
  /** 高亮这一节在教的音素,做视觉引导 */
  highlight?: string[];
}

export default function IpaKeyboard({
  onKey, onBackspace, onClear, full = false, disabled = false, highlight = [],
}: Props) {
  const hi = new Set(highlight);

  return (
    <div className="rounded-xl bg-slate-50/60 p-2">
      {/* 整页布局里键盘常驻底部,所以行距压紧:9 组要在一屏内放得下 */}
      <div className="space-y-1">
        {PHONEME_GROUPS.map(group => (
          <div key={group.label} className="flex items-center gap-1.5">
            <span className="w-11 shrink-0 text-right text-[10px] leading-none text-slate-400">
              {group.label}
            </span>
            <div className="flex flex-wrap gap-1">
              {group.keys.map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => onKey(k)}
                  disabled={disabled || full}
                  aria-label={`音标 ${k}`}
                  className={[
                    'min-w-[2.1rem] rounded-md px-1.5 py-1.5 font-mono text-base leading-none',
                    'transition active:scale-95 disabled:opacity-40',
                    hi.has(k)
                      ? 'bg-orange-100 text-orange-700 ring-1 ring-orange-300'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100',
                  ].join(' ')}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          onClick={onBackspace}
          disabled={disabled}
          className="rounded-md bg-white px-3 py-1.5 text-xs text-slate-600 ring-1
                     ring-slate-200 transition active:scale-95 hover:bg-slate-100
                     disabled:opacity-40"
        >
          ← 退格
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="rounded-md bg-white px-3 py-1.5 text-xs text-slate-500 ring-1
                     ring-slate-200 transition active:scale-95 hover:bg-slate-100
                     disabled:opacity-40"
        >
          清空本行
        </button>
      </div>
    </div>
  );
}
