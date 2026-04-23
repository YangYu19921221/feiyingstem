import { useCallback, useEffect, useRef } from 'react';
import { Howl } from 'howler';

export type SfxKey =
  | 'sword_slash'
  | 'particle_tick'   // 播放时随机选 5 个变种之一
  | 'coin_drop'
  | 'crit_boom'
  | 'miracle_horn'
  | 'legendary_horn'
  | 'piano_credits';

const MUTE_STORAGE_KEY = 'challenge_sfx_muted';

function isMuted(): boolean {
  return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
}

export function setMuted(muted: boolean) {
  localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  window.dispatchEvent(new Event('challenge-sfx-mute-change'));
}

// 全局单例缓存：同一个音效只加载一次
const pool: Partial<Record<string, Howl>> = {};

function resolveSrc(key: SfxKey): string[] {
  if (key === 'particle_tick') {
    const i = Math.floor(Math.random() * 5);
    return [`/sfx/particle_tick_${i}.mp3`];
  }
  return [`/sfx/${key}.mp3`];
}

function getOrLoad(key: SfxKey): Howl {
  const src = resolveSrc(key);
  const cacheKey = src[0];
  let howl = pool[cacheKey];
  if (!howl) {
    howl = new Howl({ src, volume: 0.7, preload: true });
    pool[cacheKey] = howl;
  }
  return howl;
}

/**
 * 闯关音效 hook
 * - 首次用户手势后才能播放（iOS Safari 限制）
 * - 全局静音开关走 localStorage
 * - 粒子连击时可用 rate 参数做音高递增
 */
export function useChallengeSfx() {
  const mutedRef = useRef<boolean>(isMuted());

  useEffect(() => {
    const onChange = () => { mutedRef.current = isMuted(); };
    window.addEventListener('challenge-sfx-mute-change', onChange);
    return () => window.removeEventListener('challenge-sfx-mute-change', onChange);
  }, []);

  const play = useCallback((key: SfxKey, opts?: { rate?: number; volume?: number }) => {
    if (mutedRef.current) return;
    try {
      const howl = getOrLoad(key);
      const id = howl.play();
      if (opts?.rate !== undefined) howl.rate(opts.rate, id);
      if (opts?.volume !== undefined) howl.volume(opts.volume, id);
    } catch {
      // autoplay 拦截或资源缺失，静默
    }
  }, []);

  return { play, setMuted };
}
