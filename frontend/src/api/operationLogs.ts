/** 操作记录(追责)API —— 平台 admin 看全部,机构管理员只看本机构 */
import client from './client';

export interface OperationLogItem {
  id: number;
  created_at: string | null;
  actor_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  action_label: string;
  target_type: string | null;
  target_id: number | null;
  summary: string;
  /** 改前/改后、被删对象的快照;超长被截断时是字符串 */
  detail: unknown;
  ip: string | null;
  /** 后端由 User-Agent 解析,如「iPhone · 微信」 */
  device: string;
  user_agent: string | null;
}

export interface OperationLogResult {
  total: number;
  page: number;
  page_size: number;
  items: OperationLogItem[];
  actors: { id: number; name: string | null; role: string | null }[];
  /** 动作中文名与大类都以后端为准,前端不维护副本 */
  action_labels: Record<string, string>;
  action_groups: Record<string, string>;
}

export interface OperationLogFilters {
  actor_id?: number | '';
  group?: string;
  keyword?: string;
  ip?: string;
  date_from?: string;
  date_to?: string;
}

const clean = (f: OperationLogFilters) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export const operationLogApi = {
  list: (filters: OperationLogFilters, page = 1, pageSize = 50) =>
    client.get<OperationLogResult>('/admin/operation-logs', {
      params: { ...clean(filters), page, page_size: pageSize },
    }),
};
