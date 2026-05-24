import { useEffect, useRef, useCallback, useState } from 'react';

export interface PkServerEvent {
  type: string;
  [key: string]: any;
}

export interface UsePkSocketOptions {
  roomId: number;
  token: string;
  onEvent: (event: PkServerEvent) => void;
  onClose?: (code: number, reason: string) => void;
}

export function usePkSocket({ roomId, token, onEvent, onClose }: UsePkSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const onEventRef = useRef(onEvent);
  const onCloseRef = useRef(onClose);
  const [connected, setConnected] = useState(false);

  // Keep refs up-to-date so the WS callback closure always sees the latest version
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${proto}//${host}/api/v1/pk/ws?token=${encodeURIComponent(token)}&room_id=${roomId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttemptRef.current = 0;
        heartbeatRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat' }));
          }
        }, 15000);
      };

      ws.onmessage = (ev) => {
        try {
          const data: PkServerEvent = JSON.parse(ev.data);
          onEventRef.current(data);
        } catch {
          // ignore non-JSON
        }
      };

      ws.onerror = () => {
        // Let onclose handle reconnection
      };

      ws.onclose = (ev) => {
        setConnected(false);
        if (heartbeatRef.current) {
          window.clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        if (onCloseRef.current) onCloseRef.current(ev.code, ev.reason);
        // Exponential backoff reconnect, max 5 attempts, only on unexpected close
        if (!cancelled && reconnectAttemptRef.current < 5 && ev.code !== 1000) {
          const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 8000);
          reconnectAttemptRef.current += 1;
          window.setTimeout(connect, delay);
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
  }, [roomId, token]);

  return { send, connected };
}
