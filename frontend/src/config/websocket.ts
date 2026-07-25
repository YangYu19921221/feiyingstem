import { WS_BASE_URL } from './env';

export const getWebSocketUrl = (path: string) => {
  // 调用方传入完整 /api/v1 路径；这里只取可由环境变量覆盖的 WS origin。
  const wsOrigin = WS_BASE_URL.replace(/\/api\/v1\/?$/, '');
  return `${wsOrigin}${path}`;
};
