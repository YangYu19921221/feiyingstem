/**
 * 复习「逐级晋级」档位：薄弱 → 一般 → 熟练 → 毕业。
 *
 * 规则(用户确认)：复习中每答对一次，该词往上升一档；答错直接跌回「薄弱」重新爬；
 * 熟练再答对则毕业(从今日复习列表消失，靠后端 SRS 排期隔几天再到期巩固)。
 *
 * 纯前端 localStorage，不动后端 mastery_level 算法，零影响成就/统计/光荣榜等。
 * 没有晋级记录的词，由 MemoryCurve 回退按 mastery_level 初始定档。
 *
 * 档位编码: 0=薄弱 1=一般 2=熟练 3=毕业(隐藏)
 * 生产者：WordClassifyLearning 复习模式下答对 promoteReviewWords、答错 demoteReviewWords(跌回薄弱)。
 * 消费者：MemoryCurve.tierOfWord 优先读这里。
 */
export type ReviewTier = 'weak' | 'medium' | 'fluent';

const KEY = 'review_stage_map';
// 上限：防止 localStorage 无限增长。超过丢弃最早一批(被丢的词回退按 mastery_level 定档)。
const MAX_ENTRIES = 5000;

// 档位数值 → 三档名(3=毕业，调用方据 isGraduated 单独隐藏)
const STAGE_WEAK = 0;
const STAGE_MEDIUM = 1;
const STAGE_FLUENT = 2;
const STAGE_GRADUATED = 3;

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
      toStore = {};
      for (const k of keys.slice(keys.length - MAX_ENTRIES)) toStore[k] = map[k];
    }
    localStorage.setItem(KEY, JSON.stringify(toStore));
  } catch { /* 忽略配额错误 */ }
}

/** 一次性读出整张晋级表，供批量分档避免逐词反复读 localStorage */
export function readAllStages(): Record<string, number> {
  return read();
}

/**
 * 批量复习答对：一次读、内存逐词升一档、一次写(避免逐词反复 parse/stringify 整表)。
 * baseStage：没有晋级记录的词的起始档。
 */
export function promoteReviewWords(wordIds: number[], baseStage: number) {
  if (wordIds.length === 0) return;
  const map = read();
  for (const id of wordIds) {
    const k = String(id);
    const cur = typeof map[k] === 'number' ? map[k] : baseStage;
    map[k] = Math.min(STAGE_GRADUATED, cur + 1);
  }
  write(map);
}

/**
 * 批量答错：直接打回「薄弱」档(0)。
 * 规则(用户确认)：在一般/熟练档答错 → 跌回薄弱,重新一档一档往上爬;
 * 已在薄弱的保持薄弱。一次读一次写。
 */
export function demoteReviewWords(wordIds: number[]) {
  if (wordIds.length === 0) return;
  const map = read();
  for (const id of wordIds) {
    map[String(id)] = STAGE_WEAK;
  }
  write(map);
}

/** 档位数值 → 三档名 */
export function tierByStage(stage: number): ReviewTier {
  if (stage <= STAGE_WEAK) return 'weak';
  if (stage === STAGE_MEDIUM) return 'medium';
  return 'fluent';  // 2=熟练；3=毕业由 isGraduated 单独判隐藏
}

/** 是否已毕业(应从今日复习列表隐藏) */
export function isGraduated(stage: number | null): boolean {
  return stage !== null && stage >= STAGE_GRADUATED;
}

/** 由 mastery_level 推初始档位(没复习过的词的起点): 0-1→薄弱 2-3→一般 4+→熟练 */
export function stageFromMastery(level: number): number {
  if (level >= 4) return STAGE_FLUENT;
  if (level >= 2) return STAGE_MEDIUM;
  return STAGE_WEAK;
}
