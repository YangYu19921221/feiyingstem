/**
 * 音标填空判分。纯函数,不碰 DOM/网络,便于单测。
 *
 * 逐格比对而不是整串比对 —— 这样能告诉学生**哪一格错了**,
 * 而不是甩一句「答案错误」。第二遍要挖的格就是第一遍错的那些元音格。
 */
import { isVowel } from './ipaPhonemes';

export interface GradeResult {
  /** 每格对错,null = 该格本来就不要求填(第二遍已给出的辅音格) */
  perSlot: (boolean | null)[];
  allCorrect: boolean;
  /** 填错的格下标 */
  wrongIndexes: number[];
  /** 下一遍该挖的格:错格里的元音格。空数组表示没有可继续挖的 */
  nextBlanks: number[];
}

export interface GradeOptions {
  /** 重音符是否计入判分。默认 false —— 位置判错对初学者太狠,老师可开 */
  strictStress?: boolean;
}

export function gradeAnswer(
  answer: string[],
  submitted: (string | null)[],
  editable: number[],
  opts: GradeOptions = {},
): GradeResult {
  const { strictStress = false } = opts;
  const canEdit = new Set(editable);
  const perSlot: (boolean | null)[] = [];
  const wrongIndexes: number[] = [];

  for (let i = 0; i < answer.length; i++) {
    if (!canEdit.has(i)) {
      perSlot.push(null);
      continue;
    }
    // 宽松模式下重音格一律算对(学生漏点最常见,不该因此判错整题)
    if (!strictStress && answer[i] === 'ˈ') {
      perSlot.push(true);
      continue;
    }
    const ok = submitted[i] === answer[i];
    perSlot.push(ok);
    if (!ok) wrongIndexes.push(i);
  }

  // 下一遍挖错掉的元音格。若错的全是辅音,退一步挖全部错格,
  // 否则会出现「有错但没格可挖」而卡死在同一遍
  const wrongVowels = wrongIndexes.filter(i => isVowel(answer[i]));
  const nextBlanks = wrongVowels.length ? wrongVowels : wrongIndexes;

  return {
    perSlot,
    allCorrect: wrongIndexes.length === 0,
    wrongIndexes,
    nextBlanks,
  };
}

/** 建初始格:第一遍全空,第二遍只空 blanks,其余按答案预填 */
export function buildSlots(answer: string[], blanks: number[]): (string | null)[] {
  const b = new Set(blanks);
  return answer.map((t, i) => (b.has(i) ? null : t));
}

/** 光标落到第一个空的可填格;没有则回 -1 */
export function firstEmpty(slots: (string | null)[], editable: number[]): number {
  for (const i of editable) if (slots[i] == null) return i;
  return -1;
}
