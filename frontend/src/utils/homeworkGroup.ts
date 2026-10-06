/**
 * 从作业入口进来时的作业分配 ID(homework_student_assignments.id)。
 * 「只能从作业进入」的作业不在单元白名单里,取词/出题/考试请求必须带上它后端才放行。
 *
 * 读的是 window.history.state.usr(React Router 把 navigate 的 state 存在那里),
 * 而不是让每个学习页各自从 useLocation 取再一路传 —— 学习页有十来个,漏一个就是
 * 「从作业点进去却提示要从作业进入」。state 跟着这条历史记录走:自学入口没有 state,
 * 刷新/返回仍是同一条记录,行为与 fromHomework 的其它用法一致。
 */
export function currentHomeworkAssignmentId(): number | null {
  const s = (window.history.state as { usr?: { fromHomework?: boolean; assignmentId?: unknown } } | null)?.usr;
  if (!s?.fromHomework) return null;
  const id = s.assignmentId;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

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

/** 请求体里展开用:`{ ...withHomeworkAssignment() }`,不在作业里时是空对象 */
export function withHomeworkAssignment(): { assignment_id?: number } {
  const id = currentHomeworkAssignmentId();
  return id ? { assignment_id: id } : {};
}
