import { useCallback, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../config/env';

/**
 * 共享发音 hook
 * 统一使用后端 Edge TTS 接口（en-GB-SoniaNeural 英式女声）
 * 支持预加载、缓存、重试、移动端兼容
 */

// 版本号：修改发音源时递增，使浏览器缓存失效
const TTS_VERSION = 5;

export function edgeTtsUrl(word: string, wordId?: number): string {
  // 传 word_id 时按 id 精确定位发音（区分一词多音，如 record 名词/动词），
  // 否则按拼写查库（普通词足够）
  if (wordId != null) {
    return `${API_BASE_URL}/pronunciation/edge-tts?word_id=${wordId}&word=${encodeURIComponent(word)}&v=${TTS_VERSION}`;
  }
  return `${API_BASE_URL}/pronunciation/edge-tts?word=${encodeURIComponent(word)}&v=${TTS_VERSION}`;
}

// 全局音频缓存（blob URL），页面生命周期内有效
const audioCache = new Map<string, string>();
// 正在加载中的请求，避免重复请求
const loadingMap = new Map<string, Promise<string>>();

// ---- 全局发音互斥：任意时刻只允许一个发音在响，杜绝两个词声音重叠 ----
// 即使多个组件各自 useAudio()，<audio> 元素不同，speechSynthesis 仍是全局单例，
// 因此用模块级状态统一登记“当前在响的 <audio>”和全局令牌。
let activeAudioEl: HTMLAudioElement | null = null;
let globalPlayToken = 0;

/**
 * 掐断当前所有发音通道（HTMLAudio + 浏览器 TTS），返回新的全局令牌。
 * 每次发起新播放都先调用它，旧的循环/兜底据令牌判断自己已过期而退出。
 */
function interruptAllAudio(): number {
  globalPlayToken++;
  if (activeAudioEl) {
    try { activeAudioEl.pause(); activeAudioEl.currentTime = 0; } catch {}
  }
  if ('speechSynthesis' in window) {
    try { speechSynthesis.cancel(); } catch {}
  }
  return globalPlayToken;
}

// 缓存浏览器 TTS 音色，首次 getVoices() 常为空，需等 voiceschanged
let cachedVoices: SpeechSynthesisVoice[] = [];
function ensureVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve([]);
      return;
    }
    const got = speechSynthesis.getVoices();
    if (got && got.length) {
      cachedVoices = got;
      resolve(got);
      return;
    }
    // 音色异步加载：监听一次 voiceschanged，最多等 1s 后兜底返回
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cachedVoices = speechSynthesis.getVoices() || [];
      resolve(cachedVoices);
    };
    speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 1000);
  });
}

function pickEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  // 优先英式，其次任意英语
  return (
    voices.find(v => v.lang === 'en-GB') ||
    voices.find(v => v.lang?.startsWith('en-GB')) ||
    voices.find(v => v.lang?.startsWith('en'))
  );
}

/**
 * 浏览器内置 TTS 兜底：Edge TTS 网络偶发失败时仍要发出声音。
 * 等音色加载完成并显式指定英语音色，避免首次 getVoices() 为空导致的静音。
 * 传入 token：等音色期间若已发起新播放（token 失配）则放弃，防止盖在新词上。
 */
async function speakWithBrowserTTS(text: string, rate: number, token: number, onDone?: () => void) {
  if (!('speechSynthesis' in window)) {
    onDone?.();
    return;
  }
  try { speechSynthesis.cancel(); } catch {}
  const voices = await ensureVoices();
  if (token !== globalPlayToken) { onDone?.(); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickEnglishVoice(voices);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || 'en-GB';
  utterance.rate = rate;
  if (onDone) {
    utterance.onend = onDone;
    utterance.onerror = onDone;
  }
  speechSynthesis.speak(utterance);
}

async function fetchAudioBlob(word: string, wordId?: number): Promise<string> {
  // 缓存键带 word_id,避免一词多音(同拼写不同 id)共用同一音频
  const key = wordId != null ? `id:${wordId}` : word.trim().toLowerCase();

  // 命中缓存
  if (audioCache.has(key)) {
    return audioCache.get(key)!;
  }

  // 正在加载，复用同一个 Promise
  if (loadingMap.has(key)) {
    return loadingMap.get(key)!;
  }

  const promise = (async () => {
    const url = edgeTtsUrl(word, wordId);
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        // 校验音频有效性：空 blob 或非音频类型说明后端返回了坏数据，
        // 不能缓存（否则该词整个会话都静音），抛错走重试/兜底
        if (!blob || blob.size === 0) throw new Error('empty audio blob');
        if (blob.type && !blob.type.startsWith('audio')) {
          throw new Error(`bad audio type: ${blob.type}`);
        }
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
export function preloadAudio(words: Array<string | { word: string; id?: number }>) {
  words.forEach(w => {
    // 接受纯字符串或带 id 的词对象。带 id 时按 id 预热,与播放时
    // playAudio(text, rate, id) 的缓存键(`id:N`)一致,确保预热真正命中。
    if (typeof w === 'string') {
      fetchAudioBlob(w).catch(() => {});
    } else {
      fetchAudioBlob(w.word, w.id).catch(() => {});
    }
  });
}

export function useAudio() {
  const audioRef = useRef<HTMLAudioElement>(new Audio());

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      try { audio.pause(); } catch {}
      // 卸载时若本实例是当前在响的音频，连同浏览器 TTS 一并停掉并清登记
      if (activeAudioEl === audio) {
        if ('speechSynthesis' in window) {
          try { speechSynthesis.cancel(); } catch {}
        }
        activeAudioEl = null;
      }
    };
  }, []);

  const playAudio = useCallback(async (text: string, rate: number = 1, wordId?: number) => {
    const audio = audioRef.current;
    // 全局打断：掐断所有 <audio> 与浏览器 TTS，拿到本次播放的全局令牌
    const token = interruptAllAudio();
    if (audio) activeAudioEl = audio;
    try {
      const blobUrl = await fetchAudioBlob(text, wordId);
      // fetch 期间若已发起新的播放（快速切词/循环重播），本次已过期，直接放弃，
      // 否则慢请求 resolve 后会把 audio.src 改回旧词并打断当前播放，造成静音/串音
      if (!audio || globalPlayToken !== token) return;
      audio.pause();
      audio.src = blobUrl;
      audio.playbackRate = rate;
      audio.currentTime = 0;
      await audio.play();
    } catch (e) {
      // 本次播放已过期则不再兜底，避免对旧词朗读盖过当前词
      if (globalPlayToken !== token) return;
      // 最终 fallback：浏览器内置 TTS（已等音色加载，指定英语音色）
      console.warn('Edge TTS 失败，回退浏览器发音:', e);
      await speakWithBrowserTTS(text, rate, token);
    }
  }, []);

  /**
   * 循环播放：播放 times 遍，每遍之间间隔 gapMs 毫秒
   * 后续调用 playAudio / playAudioLoop / stopAudio 会打断上一轮循环
   */
  const playAudioLoop = useCallback(async (
    text: string,
    times: number = 6,
    gapMs: number = 600,
    rate: number = 1,
    wordId?: number,
  ) => {
    const audio = audioRef.current;
    const token = interruptAllAudio();
    if (audio) activeAudioEl = audio;
    try {
      const blobUrl = await fetchAudioBlob(text, wordId);
      if (!audio || globalPlayToken !== token) return;
      for (let i = 0; i < times; i++) {
        if (globalPlayToken !== token) return;
        audio.pause();
        audio.src = blobUrl;
        audio.playbackRate = rate;
        audio.currentTime = 0;
        await new Promise<void>((resolve) => {
          const onEnd = () => { audio.removeEventListener('ended', onEnd); resolve(); };
          audio.addEventListener('ended', onEnd);
          audio.play().catch(() => {
            audio.removeEventListener('ended', onEnd);
            speakWithBrowserTTS(text, rate, token, resolve);
          });
        });
        if (globalPlayToken !== token) return;
        if (i < times - 1) {
          await new Promise(r => setTimeout(r, gapMs));
        }
      }
    } catch (e) {
      console.warn('循环播放失败:', e);
    }
  }, []);

  const stopAudio = useCallback(() => {
    // 全局停止：同时掐断 <audio> 与浏览器 TTS，并令所有进行中的循环过期
    interruptAllAudio();
  }, []);

  return { playAudio, playAudioLoop, stopAudio };
}
