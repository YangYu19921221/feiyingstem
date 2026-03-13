/**
 * Centralized runtime configuration for API/WS endpoints.
 * Allows overriding via Vite env vars while keeping sensible local fallbacks.
 */

const API_PREFIX = '/api/v1';
const DEFAULT_API_PORT = 8000;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const resolveDefaultApiBaseUrl = () => {
  const hasWindow = typeof window !== 'undefined' && typeof window.location !== 'undefined';

  if (hasWindow && window.location.origin) {
    // Use same-origin requests in the browser so the Vite dev proxy can handle CORS.
    return `${window.location.origin}${API_PREFIX}`;
  }

  const protocol = hasWindow && window.location.protocol === 'https:' ? 'https:' : 'http:';
  const hostname = hasWindow && window.location.hostname ? window.location.hostname : 'localhost';
  return `${protocol}//${hostname}:${DEFAULT_API_PORT}${API_PREFIX}`;
};

const rawApiBase = import.meta.env.VITE_API_BASE_URL || resolveDefaultApiBaseUrl();

export const API_BASE_URL = trimTrailingSlash(rawApiBase);

const rawWsBase =
  import.meta.env.VITE_WS_BASE_URL ||
  API_BASE_URL.replace(/^http(s?):/i, (_match, isSecure) => (isSecure ? 'wss:' : 'ws:'));

export const WS_BASE_URL = trimTrailingSlash(rawWsBase);
export const COMPETITION_WS_URL = `${WS_BASE_URL}/competition/ws/competition`;
