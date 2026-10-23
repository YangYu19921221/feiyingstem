/**
 * 句子填空判分(2026-10-23,唯一真源)
 *
 * 判的是**句子里那个空该填的形式**,不是词表里的原形:
 * 生产填句用到的 850 个单词里 120 个在例句中是变形(help → "He always helps others."),
 * 以前按原形判,孩子照句子写 helps 被判错、写 help 反而判对,读出来句子是错的。
 * 空里该填什么由 blankSentence.findBlankRange 定(挖空和判分用同一个区间,不会对不上)。
 *
 * - 大小写不算错: 词在句首要大写(27 个词只差大小写),孩子照句子写成大写也对
 * - 写成原形(句子要 sings 写了 sing)单独标 baseForm: 单词会了、词形没掌握,
 *   界面给一次机会改,首次作答仍记为错(用户 10-23 定)
 */
import { findBlankRange } from './blankSentence';
import { normalizeAnswer } from './normalizeAnswer';

/** 比较用: 规范空白、小写、去掉首尾非字母(内部的撇号/连字符/空格保留) */
const norm = (s: string): string =>
  normalizeAnswer(s).toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');

export interface BlankAnswer {
  start: number;
  end: number;
  /** 空里该填的原文(可能是变形、可能首字母大写) */
  expected: string;
}

/** 例句里该挖的空和该填的形式;挖不出来返回 null(调用方应跳过这个词) */
export function blankAnswer(sentence: string | null | undefined, word: string): BlankAnswer | null {
  if (!sentence) return null;
  const range = findBlankRange(sentence, word);
  if (!range) return null;
  return { ...range, expected: sentence.slice(range.start, range.end) };
}

export interface FillCheck {
  correct: boolean;
  /** 写的是原形,但句子里要的是变形 */
  baseForm: boolean;
}

export function checkFill(input: string, expected: string, word: string): FillCheck {
  const got = norm(input);
  if (!got) return { correct: false, baseForm: false };
  if (got === norm(expected)) return { correct: true, baseForm: false };
  return { correct: false, baseForm: got === norm(word) && norm(word) !== norm(expected) };
}

/** 字母个数(不数空格和标点),给「一共 N 个字母」的提示用 */
export const letterCount = (s: string): number => s.replace(/[^A-Za-z]/g, '').length;

export interface DiffChar {
  ch: string;
  ok: boolean;
}

/**
 * 按最长公共子序列对齐,标出孩子写的哪些字母是多的/错的(got),正确答案里哪些是漏的(want)。
 * 不区分大小写。只用于显示,不参与判分。
 */
export function letterDiff(input: string, expected: string): { got: DiffChar[]; want: DiffChar[] } {
  const a = input;
  const b = expected;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const gotOk = new Array<boolean>(n).fill(false);
  const wantOk = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (al[i] === bl[j]) {
      gotOk[i] = true;
      wantOk[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return {
    got: [...a].map((ch, k) => ({ ch, ok: gotOk[k] || ch === ' ' })),
    want: [...b].map((ch, k) => ({ ch, ok: wantOk[k] || ch === ' ' })),
  };
}
