// WebSocket配置
// 生产环境使用wss + 当前域名，开发环境使用ws://localhost:8000
const getWsBaseUrl = () => {
  if (typeof window === 'undefined') return 'ws://localhost:8000';

  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isDev) {
    return 'ws://localhost:8000';
  }

  // 生产环境：使用wss + 当前域名
  return `wss://${window.location.host}`;
};

export const getWebSocketUrl = (path: string) => {
  return `${getWsBaseUrl()}${path}`;
};
