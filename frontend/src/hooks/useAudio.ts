import { useCallback, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../config/env';

/**
 * 共享发音 hook
 * 统一使用后端 Edge TTS 接口（en-GB-SoniaNeural 英式女声）
 * 支持预加载、缓存、重试、移动端兼容
 */

// 版本号：修改发音源时递增，使浏览器缓存失效
const TTS_VERSION = 4;

export function edgeTtsUrl(word: string): string {
  return `${API_BASE_URL}/pronunciation/edge-tts?word=${encodeURIComponent(word)}&v=${TTS_VERSION}`;
}

// 全局音频缓存（blob URL），页面生命周期内有效
const audioCache = new Map<string, string>();
// 正在加载中的请求，避免重复请求
const loadingMap = new Map<string, Promise<string>>();

async function fetchAudioBlob(word: string): Promise<string> {
  const key = word.trim().toLowerCase();

  // 命中缓存
  if (audioCache.has(key)) {
    return audioCache.get(key)!;
  }

  // 正在加载，复用同一个 Promise
  if (loadingMap.has(key)) {
    return loadingMap.get(key)!;
  }

  const promise = (async () => {
    const url = edgeTtsUrl(word);
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        audioCache.set(key, blobUrl);
        return blobUrl;
      } catch (e) {
        clearTimeout(timeout);
        if (attempt === maxRetries) throw e;
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw new Error('unreachable');
  })();

  loadingMap.set(key, promise);
  promise.finally(() => loadingMap.delete(key));
  return promise;
}

/**
 * 预加载一组单词的发音
 */
export function preloadAudio(words: string[]) {
  words.forEach(word => {
    fetchAudioBlob(word).catch(() => {});
  });
}

export function useAudio() {
  // 复用同一个 Audio 元素，避免移动端多实例问题
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioRef.current = new Audio();
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const playAudio = useCallback(async (text: string, rate: number = 1) => {
    try {
      const blobUrl = await fetchAudioBlob(text);
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.src = blobUrl;
      audio.playbackRate = rate;
      audio.currentTime = 0;
      await audio.play();
    } catch (e) {
      // 最终 fallback：浏览器内置 TTS
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-GB';
        utterance.rate = rate;
        speechSynthesis.speak(utterance);
      } else {
        console.warn('发音播放失败:', e);
      }
    }
  }, []);

  return { playAudio };
}
