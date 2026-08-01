import { useCallback, useRef, useEffect, useState } from 'react';
import { API_BASE_URL } from '../config/env';

/**
 * 共享发音 hook
 * 统一使用后端 Edge TTS 接口（en-GB-SoniaNeural 英式女声）
 * 支持预加载、缓存、重试、移动端兼容
 *
 * ⚠️ 发音只允许这一个声音(2026-08-01 拍板):任何失败都保持安静,
 * 绝不退浏览器 speechSynthesis——系统音色和 Sonia 差异巨大,
 * 刷新页面(无用户手势)时 audio.play() 被自动播放策略拦截,
 * 旧的兜底会用系统音开口,学生听到"发音变了"。现在被拦就静默跳过,
 * 循环播放隔 1s 重试,用户一交互下一遍自然恢复正常声音。
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
// （2026-08-01 起浏览器 TTS 兜底整体移除:只保留 interruptAllAudio 里的
//  speechSynthesis.cancel(),用于掐掉历史版本页面可能残留的系统发音）

// ---- 自动播放解锁:刷新后无用户手势,play() 会被浏览器拦(NotAllowedError) ----
// 被拦时亮出全屏「点击继续学习」蒙层(AudioUnlockOverlay,订阅下面的状态),
// 首次手势(点击/按键)在事件处理器里同步补读当前词——带用户激活,浏览器放行。
// 否则学生刷新后干等,不知道为什么没声音(2026-08-01 实际反馈)
let audioBlocked = false;
let blockedListeners: Array<(blocked: boolean) => void> = [];
function setAudioBlocked(b: boolean) {
  if (audioBlocked === b) return;
  audioBlocked = b;
  blockedListeners.forEach((l) => l(b));
}

/** 全局蒙层订阅:发音是否正被自动播放策略拦着 */
export function useAudioBlocked(): boolean {
  const [blocked, setBlocked] = useState(audioBlocked);
  useEffect(() => {
    blockedListeners.push(setBlocked);
    return () => {
      blockedListeners = blockedListeners.filter((l) => l !== setBlocked);
    };
  }, []);
  return blocked;
}

let pendingUnlockRetry: (() => void) | null = null;
let unlockListenersOn = false;

function handleAutoplayBlocked(retry: () => void) {
  pendingUnlockRetry = retry;
  setAudioBlocked(true);
  if (unlockListenersOn) return;
  unlockListenersOn = true;
  const onFirstGesture = () => {
    unlockListenersOn = false;
    window.removeEventListener('pointerdown', onFirstGesture, true);
    window.removeEventListener('keydown', onFirstGesture, true);
    const r = pendingUnlockRetry;
    pendingUnlockRetry = null;
    setAudioBlocked(false);
    // 手势事件处理器内同步发起播放,天然带用户激活,浏览器放行
    r?.();
  };
  window.addEventListener('pointerdown', onFirstGesture, true);
  window.addEventListener('keydown', onFirstGesture, true);
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
      // 本次播放已过期则不必提示
      if (globalPlayToken !== token) return;
      // 只允许 Edge TTS 一个声音:失败保持安静,不用系统音色兜底。
      // 自动播放被拦 → 提示点屏,首次手势立刻补读这个词(src 已就位)
      if ((e as Error)?.name === 'NotAllowedError') {
        handleAutoplayBlocked(() => {
          if (globalPlayToken === token && audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
          }
        });
      } else {
        console.warn('Edge TTS 播放失败,本次保持静默:', e);
      }
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
          const tryPlay = (isRetry: boolean) => {
            audio.addEventListener('ended', onEnd);
            audio.play().catch((err) => {
              audio.removeEventListener('ended', onEnd);
              if (!isRetry && (err as Error)?.name === 'NotAllowedError') {
                // 自动播放被拦(刷新后无用户手势):本遍挂起,亮蒙层等首次手势,
                // 在点击瞬间原地补读——绝不退浏览器系统音色
                handleAutoplayBlocked(() => {
                  if (globalPlayToken !== token) { resolve(); return; }
                  audio.currentTime = 0;
                  tryPlay(true);
                });
                return;
              }
              resolve(); // 其他播放失败:静默跳过本遍,循环隔 gapMs 自会再试
            });
          };
          tryPlay(false);
        });
        if (globalPlayToken !== token) return;
        if (i < times - 1) {
          await new Promise(r => setTimeout(r, gapMs));
        }
      }
    } catch (e) {
      // 音频拉取失败同样保持安静(fetch 自带3次重试),不用系统音色兜底
      if (globalPlayToken !== token) return;
      console.warn('循环播放拉取音频失败,保持静默:', e);
    }
  }, []);

  const stopAudio = useCallback(() => {
    // 全局停止：同时掐断 <audio> 与浏览器 TTS，并令所有进行中的循环过期
    interruptAllAudio();
  }, []);

  return { playAudio, playAudioLoop, stopAudio };
}
