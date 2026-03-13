import { useCallback } from 'react';

/**
 * 共享发音 hook
 * 优先使用有道词典真人发音(英式)，失败时降级到浏览器 Speech API
 */
export function useAudio() {
  const playAudio = useCallback(async (text: string) => {
    try {
      // 优先使用有道词典发音（type=1 英式，type=2 美式）
      const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=1`;
      const audio = new Audio(url);
      audio.onerror = () => {
        // 有道失败时降级到浏览器 Web Speech API
        fallbackSpeak(text);
      };
      await audio.play();
    } catch {
      fallbackSpeak(text);
    }
  }, []);

  return { playAudio };
}

function fallbackSpeak(text: string) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.rate = 0.8;
    window.speechSynthesis.speak(u);
  }
}
