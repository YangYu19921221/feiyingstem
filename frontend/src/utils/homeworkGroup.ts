/**
 * 按组布置的作业:从路由 state 取组号(1 基)。
 * 只在从作业入口进来(fromHomework)时生效;自学进入同一单元照旧是整单元。
 * 学习页取词(startLearning / 出题)都要带上它,否则老师选的「第2组」会变成整单元。
 */
export function homeworkGroupIndex(state: unknown): number | null {
  const s = state as { fromHomework?: boolean; groupIndex?: unknown } | null;
  if (!s?.fromHomework) return null;
  const g = s.groupIndex;
  return typeof g === 'number' && Number.isInteger(g) && g >= 1 ? g : null;
}
