/**
 * 小课里的声音: 讲解、整句、一块积木的读音,都是提前配好的静态文件(backend/scripts/gen_grammar_audio.py)。
 *
 * 和背单词的 useAudio 分开写,因为小课要「一句接一句」放(先夸一句,再读整句),要知道上一句什么时候放完。
 * 规矩和那边一样:
 * - 同一时刻只有一个声音。新的一开口,旧的马上停
 * - 取不到声音(还没配音 / 网断了)就保持安静,只有字幕 —— 不用浏览器自带的声音顶替
 * - 自动播放被浏览器拦了: 等孩子点一下屏幕,从被拦的那一句接着放
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// 网址 → 已经拉下来的声音(整个页面共用;一节课的声音加起来不到 1MB)
const cache = new Map<string, Promise<string>>();

function load(url: string): Promise<string> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.size) throw new Error('empty audio');
      // 文件不存在时,有的服务器会回首页那张网页(状态码还是 200)。不是声音就当没有
      if (blob.type && !blob.type.startsWith('audio')) throw new Error(`not audio: ${blob.type}`);
      return URL.createObjectURL(blob);
    });
    p.catch(() => cache.delete(url));     // 失败的不留着,下次还能再取
    cache.set(url, p);
  }
  return p;
}

// 一小段没有声音的音频。孩子第一次点按钮时放一下,之后这个播放器再出声就不会被浏览器拦
const SILENCE = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

type Urls = string | null | undefined | (string | null | undefined)[];

export default function useLessonAudio() {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const tokenRef = useRef(0);
  // 正在等「这一句放完」的那个回调。新的声音要开口时,先让它结束(pause 不会触发 ended)
  const pendingRef = useRef<((finished: boolean) => void) | null>(null);
  const blockedRef = useRef<string[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [missing, setMissing] = useState(false);

  const el = useCallback(() => {
    if (!elRef.current && typeof Audio !== 'undefined') elRef.current = new Audio();
    return elRef.current;
  }, []);

  const interrupt = useCallback(() => {
    tokenRef.current += 1;
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.(false);
    const a = elRef.current;
    if (a) {
      try { a.pause(); } catch { /* 还没开始放 */ }
    }
    return tokenRef.current;
  }, []);

  const stop = useCallback(() => {
    interrupt();
    blockedRef.current = null;
    setBlocked(false);
    setPlaying(false);
  }, [interrupt]);

  /** 一句接一句放。新的调用会打断正在放的。回: 是不是都放完了(被打断 / 被拦 / 没取到 = false) */
  const play = useCallback(async (urls: Urls): Promise<boolean> => {
    const list = (Array.isArray(urls) ? urls : [urls]).filter((u): u is string => !!u);
    const token = interrupt();
    blockedRef.current = null;
    setBlocked(false);
    const a = el();
    if (!a || !list.length) {
      setPlaying(false);
      return false;
    }
    let all = true;
    for (let n = 0; n < list.length; n += 1) {
      let src: string;
      try {
        src = await load(list[n]);
      } catch {
        if (tokenRef.current !== token) return false;
        setMissing(true);
        all = false;
        continue;
      }
      if (tokenRef.current !== token) return false;
      const finished = await new Promise<boolean>((resolve) => {
        const done = (ok: boolean) => {
          a.removeEventListener('ended', onEnd);
          a.removeEventListener('error', onErr);
          if (pendingRef.current === done) pendingRef.current = null;
          resolve(ok);
        };
        const onEnd = () => done(true);
        const onErr = () => done(false);
        pendingRef.current = done;
        a.addEventListener('ended', onEnd);
        a.addEventListener('error', onErr);
        a.src = src;
        a.currentTime = 0;
        a.play().then(() => {
          if (tokenRef.current === token) setPlaying(true);
        }).catch((e: unknown) => {
          if (tokenRef.current === token && (e as Error)?.name === 'NotAllowedError') {
            // 记下从哪一句开始没放出来,等孩子点一下屏幕再接着放
            blockedRef.current = list.slice(n);
            setBlocked(true);
          }
          done(false);
        });
      });
      if (tokenRef.current !== token) return false;
      if (!finished) {
        all = false;
        if (blockedRef.current) break;
      }
    }
    if (tokenRef.current === token) setPlaying(false);
    return all;
  }, [el, interrupt]);

  /** 在点击事件里调: 让这个播放器之后能自己出声(手机浏览器要求第一次出声必须是手指点出来的) */
  const unlock = useCallback(() => {
    const a = el();
    if (!a) return;
    try {
      a.src = SILENCE;
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* 解不开就等下一次点击 */ });
    } catch { /* 忽略 */ }
  }, [el]);

  const preload = useCallback((urls: (string | null | undefined)[]) => {
    urls.forEach((u) => { if (u) load(u).catch(() => { /* 取不到就安静 */ }); });
  }, []);

  // 被拦了: 孩子下一次点屏幕时,从被拦的那一句接着放
  useEffect(() => {
    if (!blocked) return undefined;
    const onTap = () => {
      const rest = blockedRef.current;
      blockedRef.current = null;
      setBlocked(false);
      if (rest?.length) void play(rest);
    };
    window.addEventListener('pointerdown', onTap, { once: true, capture: true });
    return () => window.removeEventListener('pointerdown', onTap, { capture: true });
  }, [blocked, play]);

  useEffect(() => () => {
    tokenRef.current += 1;
    pendingRef.current?.(false);
    pendingRef.current = null;
    const a = elRef.current;
    if (a) {
      try { a.pause(); a.removeAttribute('src'); } catch { /* 忽略 */ }
    }
  }, []);

  return { play, stop, unlock, preload, playing, blocked, missing };
}
