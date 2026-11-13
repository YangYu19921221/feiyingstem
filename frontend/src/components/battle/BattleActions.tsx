/**
 * 宠物对战 · 出招(2026-11-12)
 *
 * 以前选完答案只有「普通攻击 / 大招」两个按钮,没什么可琢磨的。现在:
 * - **三选一**: 重击(答对伤害高,答错自己掉得多)/ 攻击(和以前一样)/ 防守(答对伤害低,这回合挨打减伤,
 *   答错不掉血、连对不断)。有把握就重击,没把握就防守 —— 孩子每题都得先掂量自己会不会。
 *   具体的倍率和扣多少血在后端(pet_battle_service),按钮上那行带数字的小字也是后端给的。
 * - **大招要念咒语**: 手里有大招时,这一回合会给一个中文意思,把对应的单词拼出来才放得出去。
 *   拼错只算一记普通攻击,大招那一格还留着。拼写是最提分的练法,最炫的画面留给它。
 *
 * 数字和判定都在后端(服务端说了算),这里只管让孩子选和拼。平台把某个玩法关掉时(props 里 stances / spellOn 为假),
 * 退回原来的样子: 一个「攻击」按钮,大招点一下就放。
 *
 * 键盘(电脑): 回车 攻击 / Q 重击 / E 防守 / 空格 大招;念咒语时直接打字母,退格删,回车放,Esc 不放了。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete, Shield, Swords, Zap } from 'lucide-react';
import type { SpellChallenge, Stance } from '../../api/petBattle';

export interface ActOptions {
  ultimate?: boolean;
  stance?: Stance;
  spell?: string;
}

interface Props {
  /** 选了哪个答案(A–D);没选是 null,这时候所有出招按钮都按不了 */
  selected: string | null;
  charges: number;
  skillName: string;
  /** 离下一格大招还差几题(0–3 里走到第几格) */
  skillProgress: number;
  spell: SpellChallenge | null;
  stances: boolean;
  spellOn: boolean;
  /** 三个出招按钮下面那行小字(带数字的),后端给;没给用不带数字的兜底说法 */
  hints?: Partial<Record<Stance, string>> | null;
  onAct: (opts: ActOptions) => void;
  /** 拼对咒语有什么好处(后端给的一句话,带数字);没给就不写 */
  spellBonus?: string | null;
  /** 开始 / 不再念咒语: 外面据此把四个选项收成一行,给字母块让地方(笔记本一屏要放下) */
  onCastingChange?: (casting: boolean) => void;
}

// hint 是兜底的说法,故意不带数字: 伤害倍率、答错扣多少都在后端,按钮上带数字的那行字由后端给(props.hints)。
// 在这里写死数字的话,后端一调,按钮上的字就成了假话
const STANCES: Array<{ key: Stance; name: string; hint: string; keycap: string; cls: string }> = [
  { key: 'heavy', name: '重击', hint: '伤害高 · 答错扣得多', keycap: 'Q', cls: 'bg-[#c2410c] hover:bg-[#a8380a]' },
  { key: 'normal', name: '攻击', hint: '稳稳打一下', keycap: '回车', cls: 'bg-[#FF6B35] hover:bg-[#f25c25]' },
  { key: 'guard', name: '防守', hint: '少挨打 · 答错不掉血', keycap: 'E', cls: 'bg-[#0e8fb0] hover:bg-[#0b7d9a]' },
];

export default function BattleActions({
  selected, charges, skillName, skillProgress, spell, stances, spellOn, hints, spellBonus, onAct, onCastingChange,
}: Props) {
  const needSpell = spellOn && !!spell;
  const [casting, setCasting] = useState(false);
  // 念咒语: 依次点了哪几块字母(存下标 —— 同一个字母可能有两块)
  const [picked, setPicked] = useState<number[]>([]);
  const letters = spell?.letters ?? [];
  const full = !!spell && picked.length >= spell.length;

  // 念咒语的那块出来时: 告诉外面收起选项;手机上把它滚进屏幕(它在题目卡的最下面)
  const castBox = useRef<HTMLDivElement>(null);
  const castingCb = useRef(onCastingChange);
  useEffect(() => {
    castingCb.current = onCastingChange;
  });
  useEffect(() => {
    castingCb.current?.(casting);
    if (casting) castBox.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [casting]);
  // 这个组件每回合重新挂一次: 走的时候告诉外面「没在念了」
  useEffect(() => () => castingCb.current?.(false), []);

  const need = spell?.length ?? 0;
  // 键盘监听只挂一次,要读「现在」的状态: 每次渲染完把最新的放进 ref(不在渲染过程中写 ref)
  const latest = useRef({ selected, charges, casting, picked, letters, full, needSpell, stances, need });
  const actRef = useRef(onAct);
  useEffect(() => {
    latest.current = { selected, charges, casting, picked, letters, full, needSpell, stances, need };
    actRef.current = onAct;
  });

  // 这两个只读 ref、只调 setState,所以不用跟着渲染变
  const cast = useCallback(() => {
    const st = latest.current;
    if (!st.full) return;
    actRef.current({ ultimate: true, spell: st.picked.map((i) => st.letters[i]).join('') });
  }, []);

  const startUltimate = useCallback(() => {
    const st = latest.current;
    if (!st.selected || st.charges < 1) return;
    if (st.needSpell) setCasting(true);
    else actRef.current({ ultimate: true });
  }, []);

  useEffect(() => {
    // 挂在捕获阶段: 念咒语时字母键归这里,不能漏给外面「A–D 选答案」的监听
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = latest.current;
      const key = e.key;
      if (st.casting) {
        if (key === 'Escape') {
          setCasting(false);
          setPicked([]);
        } else if (key === 'Backspace') {
          setPicked((prev) => prev.slice(0, -1));
        } else if (key === 'Enter') {
          cast();
        } else if (/^[a-zA-Z]$/.test(key)) {
          setPicked((prev) => {
            const now = latest.current;
            if (prev.length >= now.need) return prev;
            const i = now.letters.findIndex((ch, idx) => !prev.includes(idx) && ch.toLowerCase() === key.toLowerCase());
            return i >= 0 ? [...prev, i] : prev;
          });
        } else {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!st.selected) return;
      const k = key.toLowerCase();
      if (k === 'q' && st.stances) actRef.current({ stance: 'heavy' });
      else if (k === 'e' && st.stances) actRef.current({ stance: 'guard' });
      else if (key === ' ' && st.charges >= 1) startUltimate();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cast, startUltimate]);

  // ------------------------------------------------------------ 念咒语
  if (casting && spell) {
    return (
      <div ref={castBox} className="rounded-xl border-2 border-[#FFD23F] bg-[#fffaf0] p-3">
        <div className="text-center">
          <div className="text-xs font-bold text-[#b45309]">念咒语放大招: 把这个词拼出来{spellBonus ? ` · ${spellBonus}` : ''}</div>
          <div className="mt-0.5 break-words font-display text-xl font-black text-ink sm:text-2xl">{spell.meaning}</div>
        </div>

        {/* 字母格 */}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1" aria-label={`已经拼了 ${picked.length} 个字母,一共 ${spell.length} 个`}>
          {Array.from({ length: spell.length }).map((_, i) => (
            <span
              key={i}
              className={`flex h-9 w-7 items-center justify-center rounded-md border-b-[3px] font-display text-lg font-black sm:h-10 sm:w-8 ${
                i < picked.length ? 'border-[#FF6B35] bg-white text-ink' : 'border-black/20 bg-black/[0.04] text-transparent'
              }`}
            >
              {i < picked.length ? letters[picked[i]] : '·'}
            </span>
          ))}
          <button
            type="button"
            onClick={() => setPicked((prev) => prev.slice(0, -1))}
            disabled={!picked.length}
            aria-label="删掉最后一个字母"
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-md text-ink-soft transition hover:bg-black/[0.06] disabled:opacity-30 sm:h-10 sm:w-10"
          >
            <Delete className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* 字母块(里面混着两个用不上的) */}
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {letters.map((ch, i) => {
            const used = picked.includes(i);
            return (
              <button
                key={i}
                type="button"
                disabled={used || full}
                onClick={() => setPicked((prev) => (prev.includes(i) || prev.length >= spell.length ? prev : [...prev, i]))}
                aria-label={`字母 ${ch}`}
                className={`flex h-11 w-10 items-center justify-center rounded-lg border-2 font-display text-xl font-black transition ${
                  used
                    ? 'border-transparent bg-black/[0.04] text-transparent'
                    : 'border-[#e0a800] bg-[#FFE38A] text-[#5c3d00] hover:-translate-y-0.5 disabled:opacity-50'
                }`}
              >
                {ch}
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={cast}
            disabled={!full}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 text-base font-bold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
          >
            <Zap className="h-5 w-5" aria-hidden="true" />
            放大招!
          </button>
          <button
            type="button"
            onClick={() => {
              setCasting(false);
              setPicked([]);
            }}
            className="min-h-12 rounded-lg bg-black/[0.06] px-3 text-sm font-semibold text-ink transition hover:bg-black/[0.1]"
          >
            不放了
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] leading-4 text-ink-soft">拼错了只算一记普通攻击,大招还留着,下回合换个词再试。</p>
      </div>
    );
  }

  // ------------------------------------------------------------ 选招
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-slate-700">
            {charges > 0 ? `${skillName} 攒好了` : '连对 3 题攒一格大招'}
          </div>
          <div className="mt-1 flex gap-1.5" aria-label={`大招进度 ${skillProgress}/3`}>
            {[1, 2, 3].map((step) => (
              <span key={step} className={`h-1.5 w-8 rounded-full transition-colors ${step <= skillProgress ? 'bg-amber-500' : 'bg-slate-200'}`} />
            ))}
          </div>
        </div>
        <div className="shrink-0 text-xs font-black tabular-nums text-amber-700">{charges} 格</div>
      </div>

      {stances ? (
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          {STANCES.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={!selected}
              onClick={() => onAct({ stance: s.key })}
              className={`flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center rounded-lg px-1 py-1 text-white transition disabled:cursor-not-allowed disabled:opacity-45 ${s.cls}`}
            >
              <span className="flex items-center gap-1 text-sm font-bold sm:text-base">
                {s.key === 'guard' ? <Shield className="h-4 w-4" aria-hidden="true" /> : <Swords className="h-4 w-4" aria-hidden="true" />}
                {s.name}
                <kbd className="hidden rounded bg-black/20 px-1 text-[10px] font-semibold lg:inline">{s.keycap}</kbd>
              </span>
              <span className="mt-0.5 text-center text-[10px] font-semibold leading-3 text-white/85">{hints?.[s.key] || s.hint}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled={!selected}
          onClick={() => onAct({ stance: 'normal' })}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#FF6B35] px-3 text-base font-bold text-white transition hover:bg-[#f25c25] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Swords className="h-5 w-5" aria-hidden="true" />
          普通攻击
        </button>
      )}

      {charges > 0 && (
        <button
          type="button"
          disabled={!selected}
          onClick={startUltimate}
          className={`mt-2 flex min-h-12 w-full min-w-0 items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 text-sm font-bold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 sm:text-base ${selected ? 'battle-ult-ready' : ''}`}
        >
          <Zap className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="truncate">放大招 · {skillName}{needSpell ? '(要念咒语)' : ''}</span>
          <kbd className="hidden rounded bg-black/20 px-1 text-[10px] font-semibold lg:inline">空格</kbd>
        </button>
      )}
      {!selected && <p className="mt-1.5 text-center text-[11px] text-gray-500">先选答案,再选怎么出招</p>}
    </div>
  );
}
