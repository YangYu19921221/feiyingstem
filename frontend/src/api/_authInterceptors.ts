import type { AxiosError } from 'axios';

export function onUnauthorized() {
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
