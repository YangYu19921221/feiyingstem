/**
 * 复习「本轮错误次数」→ 薄弱/一般/熟练 分档。
 *
 * 记忆曲线的三档原本只按累计 mastery_level 分，会把"打错一个字母"误判成薄弱。
 * 改为：以"最近一次复习这一轮答错几遍"为准 —— 错≥3 薄弱、错2 一般、错≤1 熟练
 *（只错一遍多半是手滑，仍算熟悉）。没有本轮记录的词回退到 mastery_level，不影响首次出现。
 *
 * 生产者：WordClassifyLearning 复习模式下，答错即 bumpReviewWrong 累加；
 *         只有真正答对/通过该词时才 markReviewPassed(记 0=熟练)。
 *         绝不在"开练时"预置 0，否则没做/中途退出的词会被误判成熟练。
 * 消费者：MemoryCurve.tierOfWord 优先读这里。
 * 纯前端 localStorage，零后端、零其它模块影响。
 */
export type ReviewTier = 'weak' | 'medium' | 'fluent';

const KEY = 'review_last_wrong';
// 上限：防止 localStorage 里这张表无限增长。超过则丢弃最早的一批(被丢的词回退按
// mastery_level 分,无副作用)。5000 远超任何学生实际复习过的不同词数。
const MAX_ENTRIES = 5000;

function read(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function write(map: Record<string, number>) {
  try {
    let toStore = map;
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      // 只保留最后 MAX_ENTRIES 个键，丢弃最早写入的
      toStore = {};
      for (const k of keys.slice(keys.length - MAX_ENTRIES)) toStore[k] = map[k];
    }
    localStorage.setItem(KEY, JSON.stringify(toStore));
  } catch { /* 忽略配额错误 */ }
}

/**
 * 答对/通过该词：记本轮错误数为 0（= 熟练）。
 * 只在确实答对时调用,绝不在开练时预置,否则没答对就会被误升熟练。
 * 已有错误记录(说明本轮错过)时不覆盖,保留其薄弱/一般档。
 */
export function markReviewPassed(wordIds: number[]) {
  if (wordIds.length === 0) return;
  const map = read();
  for (const id of wordIds) {
    const k = String(id);
    if (!(map[k] > 0)) map[k] = 0;  // 本轮没错过才标熟练
  }
  write(map);
}

/** 答错时累加这些词的本轮错误数 */
export function bumpReviewWrong(wordIds: number[]) {
  if (wordIds.length === 0) return;
  const map = read();
  for (const id of wordIds) map[String(id)] = (map[String(id)] || 0) + 1;
  write(map);
}

/** 取某词最近一轮错误数；没有记录返回 null */
export function lastWrongCount(wordId: number): number | null {
  const v = read()[String(wordId)];
  return typeof v === 'number' ? v : null;
}

/** 错误数 → 档位 */
export function tierByWrong(wrong: number): ReviewTier {
  if (wrong >= 3) return 'weak';
  if (wrong === 2) return 'medium';
  return 'fluent';
}
