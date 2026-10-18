/**
 * 分类学习「今天已学完的组」本地存档
 *
 * 组结果原先只在内存里(WordClassifyLearning 的 allGroupResults):刷新/重进页面就丢,
 * 整单元结算页、学习报告、作业交卷都只算到「最后一次进页面之后学的那几组」。
 * 实案(2026-10-18): 九上 Unit 4 共 61 词分 4 组(20/20/20/1),学生做到第 4 组时刷新了一下,
 * 学习报告只剩 1 个词,整单元作业也按 1/1 记了 100 分(实际首答 57/61)。
 * 生产 10-04 起整单元分类作业有 222 份是这样只按后半截判的分。
 *
 * 与 classify_progress_*(组内断点)分开存: 那份在每组过关后就清掉(组小结页刷新靠后端进度
 * 跳到下一组),这份要一直留到整单元结算。
 */
import type { DictationResult } from '../components/classify/DictationPhase';
import type { WordCategory } from '../components/classify/ClassificationPhase';

export interface DoneGroupEntry {
  groupIndex: number;
  /** 这组的词 id(按顺序)。恢复时与当前分组逐个比对,对不上(老师改了词表/组大小)就不用 */
  wordIds: number[];
  dictationResults: DictationResult[];
  classifyResults: Array<[number, WordCategory]>;
  /** 这组的净活动秒数(报告/结算页的学习用时) */
  seconds: number;
  /** 本地日期:只恢复今天的,昨天学的组不进今天的报告 */
  day: string;
}

export function localDay(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 同一组再学一遍(重学/第二轮)以最新一次为准 */
export function upsertDoneGroup(list: DoneGroupEntry[], entry: DoneGroupEntry): DoneGroupEntry[] {
  return [...list.filter(e => e.groupIndex !== entry.groupIndex), entry]
    .sort((a, b) => a.groupIndex - b.groupIndex);
}

/**
 * 进页面时挑出能接上的组。
 *
 * 只取「紧挨着当前组往前、连续」的那一段: 换设备学了中间几组时,这台设备上的存档会有缺口,
 * 跨过缺口拼起来,报告上「第 2–3 组」写的就不是图里那些词了。
 *
 * current 是存档里「当前组」那条。只有当前组听写已交(恢复到过关检测/单元复习)时调用方
 * 才该用它(补用时、留着别删);还在分类/听写时同号那条是更早一轮的,算进去就重复了。
 */
export function pickRestorableGroups(
  list: DoneGroupEntry[],
  groupWordIds: number[][],
  currentGroupIndex: number,
  today: string,
): { groups: DoneGroupEntry[]; seconds: number; current: DoneGroupEntry | null } {
  const valid = new Map<number, DoneGroupEntry>();
  for (const e of list) {
    if (!e || e.day !== today || !Array.isArray(e.dictationResults)) continue;
    const ids = groupWordIds[e.groupIndex];
    if (!ids || !Array.isArray(e.wordIds) || ids.length !== e.wordIds.length) continue;
    if (ids.some((id, i) => id !== e.wordIds[i])) continue;
    valid.set(e.groupIndex, e);
  }
  const groups: DoneGroupEntry[] = [];
  for (let gi = currentGroupIndex - 1; gi >= 0; gi -= 1) {
    const e = valid.get(gi);
    if (!e) break;
    groups.unshift(e);
  }
  return {
    groups,
    seconds: groups.reduce((s, g) => s + entrySeconds(g), 0),
    current: valid.get(currentGroupIndex) ?? null,
  };
}

export function entrySeconds(e: DoneGroupEntry | null | undefined): number {
  return Math.max(0, Number(e?.seconds) || 0);
}

export function loadDoneGroups(key: string): DoneGroupEntry[] {
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveDoneGroups(key: string, list: DoneGroupEntry[]): void {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch { /* 存满/隐私模式:丢了只是退回旧行为 */ }
}

export function doneGroupsKeyOf(uid: string, unitId: string, suffix: string): string {
  return `${DONE_KEY_PREFIX}${uid}_${unitId}${suffix}`;
}

export function clearDoneGroups(key: string): void {
  if (!key) return;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** 扫掉不是今天的存档(学到一半没结算的单元会一直留着,共用设备上越攒越多) */
export function pruneStaleDoneGroups(today: string): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DONE_KEY_PREFIX)) continue;
      if (!loadDoneGroups(k).some(e => e?.day === today)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

export const DONE_KEY_PREFIX = 'classify_done_';
