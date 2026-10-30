/**
 * 电教室电脑的设备码(2026-10-30,规则真源 backend/app/services/classroom_net.py)。
 *
 * 老师在电教室的电脑上点「这台电脑在电教室」→ 后端给一个设备码,存在这台电脑的 localStorage 里。
 * 之后这台电脑发的每个请求都带请求头 X-EH-Classroom(不管谁登录),服务器据此记下学校现在的出网 IP ——
 * 学校换了 IP 也能自己跟上。
 *
 * ⚠️ 退出登录不能清它(只清 access_token): 电教室电脑上一天换好几个孩子登录,清了就得每次重新登记。
 */
const KEY = 'eh_classroom_device';
export const CLASSROOM_HEADER = 'X-EH-Classroom';

export function getClassroomDeviceKey(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && v.length >= 20 ? v : null;
  } catch {
    return null;
  }
}

export function setClassroomDeviceKey(key: string): void {
  try { localStorage.setItem(KEY, key); } catch { /* 隐私模式写不了,本次登记的 IP 照样算 7 天 */ }
}

export function clearClassroomDeviceKey(): void {
  try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
}

/** 给 axios 请求加上设备码头(两个拦截器共用) */
export function withClassroomHeader(headers: Record<string, unknown> | undefined): void {
  const k = getClassroomDeviceKey();
  if (k && headers) headers[CLASSROOM_HEADER] = k;
}
