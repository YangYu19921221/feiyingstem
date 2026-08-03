import type { AxiosError } from 'axios';

/** 登录页读取此标记显示"被顶下线"提示(sessionStorage:标签页内有效,刷新登录页不消失) */
export const KICKED_FLAG = 'session_kicked';

export function onUnauthorized(error?: AxiosError) {
  // 顶号下线与普通过期区分开:登录页要告诉学生"账号在别处登录了",
  // 否则被顶的人只会觉得"莫名其妙退出了",还以为是bug
  const detail = (error?.response?.data as { detail?: { code?: string } } | undefined)?.detail;
  if (detail?.code === 'SESSION_KICKED') {
    try { sessionStorage.setItem(KICKED_FLAG, '1'); } catch { /* 隐私模式等存不了就算了 */ }
  }
  localStorage.removeItem('access_token');
  localStorage.removeItem('user');
  const { pathname } = window.location;
  if (pathname !== '/login' && pathname !== '/register') {
    window.location.href = '/login';
  }
}

export function isUnauthorizedError(error: AxiosError): boolean {
  return error.response?.status === 401;
}
