/**
 * 学习页在线状态上报(实时课堂)
 * - 每 30 秒心跳:在学 / 页面可见性 / 是否无操作(idle) / 当前单元
 * - visibilitychange 即时上报切出/切回(sendBeacon,切走也保证送达)
 * 失败全部静默,绝不影响学习流程。
 */
import { useEffect, useRef } from 'react';
import { API_BASE_URL } from '../config/env';

const HEARTBEAT_MS = 15_000;

export default function usePresence(opts: {
  unitId?: number;
  unitName?: string;
  idle: boolean;
  enabled?: boolean;
}) {
  const { unitId, unitName, idle, enabled = true } = opts;
  // 用 ref 携带最新值,避免定时器/事件闭包拿到旧状态
  const stateRef = useRef({ unitId, unitName, idle });
  stateRef.current = { unitId, unitName, idle };

  useEffect(() => {
    if (!enabled) return;
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const post = (path: string, body: object) => {
      fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        keepalive: true, // 页面卸载/切走时也尽量送达
      }).catch(() => {});
    };

    const beat = () => {
      const s = stateRef.current;
      post('/student/presence/heartbeat', {
        visible: !document.hidden,
        idle: s.idle,
        unit_id: s.unitId ?? null,
        unit_name: s.unitName ?? null,
      });
    };

    const onVisibility = () => {
      // 切出/切回即时上报;fetch keepalive 等效 sendBeacon 且能带 Authorization 头
      post('/student/presence/switch', { leaving: document.hidden });
    };

    beat(); // 进页面立即报一次
    const timer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
