import { API_BASE_URL } from '../config/env';

/** 走神事件落库(静默失败)。切屏 / 摄像头离开带上离开了多久和在哪个学习页(家长、老师看得到时长) */
export const reportFocusEvent = (kind: 'switch' | 'distracted' | 'no_face', awayMs?: number) => {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  fetch(`${API_BASE_URL}/student/presence/focus-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(awayMs !== undefined
      ? { kind, away_ms: Math.round(awayMs), page: window.location.pathname.slice(0, 80) }
      : { kind }),
    keepalive: true,
  }).catch(() => {});
};
