/**
 * 直播互动 WebSocket hook —— 弹幕(第一期)/点名(后续)共用。
 *
 * 从 usePkSocket 泛化而来:同源拼 wss://${host}/api/v1/live/ws/{sid}?token=、
 * 15s 心跳、指数退避重连、failed 态给「重试」按钮。
 *
 * ⚠️ 那个「握手被网关拦→页面永远转圈」的坑(见 usePkSocket 注释):WS 请求被当
 * 普通 GET 转发、后端 404 时,靠 failed 让界面能说出来、给可操作提示,而不是干转。
 */
import { useEffect, useRef, useCallback, useState } from 'react';

export interface LiveWsEvent {
  type: string;
  [key: string]: any;
}

interface Options {
  sessionId: number;
  token: string;
  onEvent: (e: LiveWsEvent) => void;
  enabled?: boolean;
}

const MAX_RECONNECT = 5;

export function useLiveSocket({ sessionId, token, onEvent, enabled = true }: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const onEventRef = useRef(onEvent);
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  const retry = useCallback(() => {
    attemptRef.current = 0;
    setFailed(false);
    setRetryNonce((n) => n + 1);
  }, []);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!enabled || !token || !sessionId) return;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${proto}//${host}/api/v1/live/ws/${sessionId}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setFailed(false);
        attemptRef.current = 0;
        heartbeatRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat' }));
          }
        }, 15000);
      };

      ws.onmessage = (ev) => {
        try {
          onEventRef.current(JSON.parse(ev.data));
        } catch {
          // 非 JSON 忽略
        }
      };

      ws.onclose = (ev) => {
        setConnected(false);
        if (heartbeatRef.current) {
          window.clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        // 4xxx = 服务端主动拒(登录失效/非本班/别处打开),不重连
        const isAuthReject = ev.code >= 4000 && ev.code < 5000;
        if (!cancelled && !isAuthReject && attemptRef.current < MAX_RECONNECT && ev.code !== 1000) {
          const delay = Math.min(1000 * 2 ** attemptRef.current, 8000);
          attemptRef.current += 1;
          window.setTimeout(connect, delay);
        } else if (!cancelled && ev.code !== 1000) {
          setFailed(true);
        }
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      if (wsRef.current) wsRef.current.close(1000, 'unmount');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token, enabled, retryNonce]);

  return { send, connected, failed, retry };
}
