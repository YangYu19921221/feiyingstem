/**
 * PK 分组赛队名显示。
 *
 * 分组赛的组由教师建房时创建并命名,学生进等待室自己选组(见后端 manager.normalize_team_names)。
 * 组名只在两处下发:房间快照的 team_names 映射、队伍榜每行的 team_name;
 * 实时榜/结算的**每个学生行只有组号**(每行塞组名会白占广播带宽)。
 * 所以拿到学生行时要用 team_names 映射反查——统一走这里,别在组件里各写一遍
 * `team_name || '第N组'`:之前散在 6 个组件里,文案已经漂成"第 3 队"和"3队"两种。
 */

/** 队号 → 队名的映射(来自 RoomSnapshot.team_names,key 是字符串化的队号) */
export type TeamNameMap = Record<string, string> | undefined | null;

/** 兜底队名:老房间/晋级赛没有 team_names 时仍要显示得像个队伍 */
export function teamFallback(team: number): string {
  return `第 ${team} 队`;
}

/**
 * 队名。优先用行内已带的 name(队伍榜),否则查映射(学生行),最后兜底"第N队"。
 * team 为空(个人赛)返回空串,调用方按需判空。
 */
export function teamLabel(
  team: number | null | undefined,
  names?: TeamNameMap,
  inlineName?: string | null,
): string {
  if (!team) return '';
  return inlineName || names?.[String(team)] || teamFallback(team);
}

/**
 * 每队前 N 名。items 必须已按名次升序(实时榜/结算榜服务端下发即有序),
 * 组内按原序截取,口径天然与总榜一致;无队号的行(个人赛/未选组)跳过。
 */
export function topMembersByTeam<T extends { team?: number | null }>(
  items: T[] | null | undefined,
  limit = 3,
): Map<number, T[]> {
  const byTeam = new Map<number, T[]>();
  for (const it of items ?? []) {
    if (!it.team) continue;
    const list = byTeam.get(it.team) ?? [];
    if (list.length < limit) {
      list.push(it);
      byTeam.set(it.team, list);
    }
  }
  return byTeam;
}
