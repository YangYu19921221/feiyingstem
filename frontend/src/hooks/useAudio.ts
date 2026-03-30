import { useCallback } from 'react';
import { API_BASE_URL } from '../config/env';

/**
 * 共享发音 hook
 * 统一使用后端 Edge TTS 接口（en-GB-SoniaNeural 英式女声）
 */

// 版本号：修改发音源时递增，使浏览器缓存失效
const TTS_VERSION = 4;

export function edgeTtsUrl(word: string): string {
  return `${API_BASE_URL}/pronunciation/edge-tts?word=${encodeURIComponent(word)}&v=${TTS_VERSION}`;
}

export function useAudio() {
  const playAudio = useCallback(async (text: string) => {
    try {
      const audio = new Audio(edgeTtsUrl(text));
      await audio.play();
    } catch (e) {
      console.warn('Edge TTS 播放失败:', e);
    }
  }, []);

  return { playAudio };
}
