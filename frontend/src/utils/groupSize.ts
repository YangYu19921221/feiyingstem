/**
 * 单元分组规则(与分类学习同源)
 *
 * 老师给单元设了 group_size 就用它,否则按学段:小学 10 个一组,其他 20 个一组。
 * 生产实测单元词数中位数在 51-100,最大 147 —— 任何"一次过完整单元"的模式
 * 都必须分组,否则一次要背 147 个词,没有孩子做得完。
 */
export function getGroupSize(gradeLevel: string | null | undefined, customGroupSize?: number): number {
  if (customGroupSize && customGroupSize > 0) return customGroupSize;
  return gradeLevel?.includes('小学') ? 10 : 20;
}

/** 按分组大小切分,顺序不变(所以第 N 组对应的题号始终是连续的一段) */
export function splitIntoGroups<T>(items: T[], groupSize: number): T[][] {
  const size = Math.max(1, groupSize);
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}
