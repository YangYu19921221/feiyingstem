import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Volume2 } from 'lucide-react';
import { useAudio } from '../../hooks/useAudio';
import { boardDate, dayPart, wordForScene } from './boardWords';
import type { DayPart } from './boardWords';
import { WEEK_ORDER, sceneById, sceneForDate } from './loginScenes';
import type { Scene, SceneId } from './loginScenes';
import SceneAmbient from './SceneAmbient';
import './AuthShell.css';
import './AuthScenes.css';
import './AuthAmbient.css';

gsap.registerPlugin(useGSAP);

interface Props {
  children: ReactNode;
  mode?: 'login' | 'register';
}

/**
 * 登录 / 注册页外壳: 左边(手机在上面)是「小鹰的一周」,按星期几换场景(周一黑板 / 周二书桌 / 周三太空 /
 * 周四海底 / 周五放风筝 / 周六花园 / 周日夜晚书房),场景定义在 loginScenes.ts。
 * 场景里的问候、日期、今日单词(点喇叭能听)都是网页上的真字;右上角那排「一二三…日」能预览别的几天(不记住,刷新回到今天)。
 * 背景图一律不动,会动的只有叠在上面的小东西(SceneAmbient)、小鹰和单词卡(11-04 用户: 背景不要乱动,图上的动画可以)。
 * 中文用字体子集,改了中文要重出子集,见 boardWords.ts 文件头
 */
const TIME_ZH: Record<DayPart, string> = { morning: '早上好', noon: '中午好', afternoon: '下午好', evening: '晚上好' };
const TIME_EN: Record<DayPart, string> = {
  morning: 'Good morning!', noon: 'Good afternoon!', afternoon: 'Good afternoon!', evening: 'Good evening!',
};

interface StageBox { left: number; width: number; height: number }

/** 背景按 cover 铺满时图片实际落在哪(底边对齐面板底边),小鹰按它踩在图里的地面上 */
function useStageBox(ref: RefObject<HTMLElement | null>, scene: Scene): StageBox | null {
  const [box, setBox] = useState<StageBox | null>(null);
  const bg = scene.bg;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !bg) return;
    const update = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      const wide = W / H > bg.aspect;
      const width = wide ? W : H * bg.aspect;
      const height = wide ? W / bg.aspect : H;
      const focus = W / H < 1.25 ? bg.focusDesk : bg.focusBand;
      setBox((old) => {
        const left = (W - width) * focus;
        if (old && Math.abs(old.left - left) < 0.5 && Math.abs(old.width - width) < 0.5 && Math.abs(old.height - height) < 0.5) return old;
        return { left, width, height };
      });
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update); };
  }, [ref, bg]);
  return box;
}

function Eagle({ scene, style, speaking }: { scene: Scene; style?: CSSProperties; speaking: boolean }) {
  const mon = scene.id === 'mon';
  const base = mon ? '/board-art/eagle' : `/board-art/week/${scene.id}-eagle`;
  return (
    <div
      className={`scene-eagle ${scene.floaty ? 'is-floaty' : ''} ${speaking ? 'is-speaking' : ''}`}
      style={{ ...style, ['--eagle-aspect' as string]: scene.eagleAspect }}
    >
      <picture>
        <source
          type="image/webp"
          srcSet={`${base}-480.webp 450w, ${base}-880.webp 820w`}
          sizes="(min-width: 1024px) 26rem, 10rem"
        />
        <img src={`${base}-480.png`} alt={scene.eagleAlt} decoding="async" />
      </picture>
    </div>
  );
}

/** 周五: 风筝 + 从小鹰手里的线轴拉过去的线(两头按两张图的实际位置现算) */
function FridayKite({ panelRef, box }: { panelRef: RefObject<HTMLElement | null>; box: StageBox | null }) {
  const [line, setLine] = useState<string | null>(null);
  const kiteRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const kite = kiteRef.current;
    if (!panel || !kite) return;
    const update = () => {
      const eagle = panel.querySelector<HTMLElement>('.scene-eagle img');
      if (!eagle) return;
      const p = panel.getBoundingClientRect();
      const e = eagle.getBoundingClientRect();
      const k = kite.getBoundingClientRect();
      if (!e.width || !k.width || getComputedStyle(kite).display === 'none') { setLine(null); return; }
      // 小鹰图里线从右上角出去(x 0.947, y 0);风筝线拴在风筝下角(x 0.6, y 0.62)
      const x1 = e.left - p.left + e.width * 0.947;
      const y1 = e.top - p.top + e.height * 0.012;
      const x2 = k.left - p.left + k.width * 0.6;
      const y2 = k.top - p.top + k.height * 0.62;
      const cx = (x1 + x2) / 2 + 12;
      const cy = (y1 + y2) / 2 + Math.abs(x2 - x1) * 0.14;
      setLine(`M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    };
    update();
    // 小鹰入场时往上移了一点,动画走完再量一次
    const t = window.setTimeout(update, 800);
    window.addEventListener('resize', update);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', update); };
  }, [panelRef, box]);
  return (
    <>
      {line && (
        <svg className="fri-string" aria-hidden="true">
          <path d={line} />
        </svg>
      )}
      <div ref={kiteRef} className="fri-kite" aria-hidden="true">
        <picture>
          <source type="image/webp" srcSet="/board-art/week/fri-kite.webp" />
          <img src="/board-art/week/fri-kite.png" alt="" decoding="async" />
        </picture>
      </div>
    </>
  );
}

function CardFrame({ card }: { card: Scene['card'] }) {
  if (card === 'chalk') {
    return (
      <svg className="card-frame" viewBox="0 0 400 240" preserveAspectRatio="none" aria-hidden="true">
        <path
          className="scene-stroke"
          d="M24 19 C 120 11, 280 13, 376 20 C 390 21, 393 33, 392 50 C 390 110, 395 168, 390 214 C 388 227, 378 229, 362 230 C 262 235, 132 232, 32 228 C 18 227, 11 218, 12 203 C 14 150, 9 92, 13 36 C 14 24, 20 20, 38 18"
        />
      </svg>
    );
  }
  if (card === 'orbit') {
    return (
      <span className="card-orbit" aria-hidden="true">
        <span className="card-orbit-ring" />
        <span className="card-orbit-x"><span className="card-orbit-y"><span className="card-orbit-moon" /></span></span>
      </span>
    );
  }
  if (card === 'cloud') {
    return (
      <svg className="card-cloud" viewBox="0 0 400 230" preserveAspectRatio="none" aria-hidden="true">
        <path d="M70 200 C 22 200, 8 160, 30 132 C 6 104, 30 62, 72 70 C 80 30, 130 14, 168 36 C 192 6, 252 4, 276 40 C 312 22, 360 44, 356 86 C 394 98, 398 150, 366 170 C 372 198, 340 214, 310 204 C 280 222, 230 222, 206 206 C 180 222, 120 224, 100 204 C 92 204, 80 202, 70 200 Z" />
      </svg>
    );
  }
  return <span className="card-deco" aria-hidden="true" />;
}

export default function AuthShell({ children, mode = 'login' }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [previewId, setPreviewId] = useState<SceneId | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const speakTimer = useRef<number | undefined>(undefined);
  const { playAudio } = useAudio();

  // 页面开着过了饭点 / 过了半夜,问候、场景、今日单词跟着换
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 5 * 60_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(speakTimer.current);
    };
  }, []);

  const today = sceneForDate(now);
  const scene = previewId ? sceneById(previewId) : today;
  const part = dayPart(now);
  const greeting = mode === 'register'
    ? { en: 'Welcome!', zh: '新同学，欢迎你加入' }
    : { en: scene.en ?? TIME_EN[part], zh: `${TIME_ZH[part]}，${scene.zh}` };
  const date = boardDate(now);
  const word = wordForScene(scene.id, now);
  // 长单词按字母数缩小,butterfly 也写得进一行
  const wordScale = Math.min(1, 6.5 / word.word.length);
  const box = useStageBox(panelRef, scene);

  const speak = useCallback(() => {
    setSpeaking(true);
    window.clearTimeout(speakTimer.current);
    speakTimer.current = window.setTimeout(() => setSpeaking(false), 1400);
    void playAudio(word.word);
  }, [playAudio, word.word]);

  // 表单只在第一次进来时滑入
  useGSAP(() => {
    const root = shellRef.current;
    if (!root) return;
    const form = root.querySelector('.auth-form-content');
    const reveal = root.querySelectorAll('[data-auth-reveal]');
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(form, { autoAlpha: 0, y: 14, duration: 0.42, delay: 0.15, ease: 'power3.out' });
      gsap.from(reveal, { autoAlpha: 0, y: 10, duration: 0.32, stagger: 0.045, delay: 0.32, ease: 'power3.out' });
    });
    return () => mm.revert();
  }, { scope: shellRef });

  // 场景入场: 每换一天(或预览别的一天)重播一次
  useGSAP(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const q = (s: string) => Array.from(panel.querySelectorAll<Element>(s));
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      q('.scene-stroke').forEach((path) => {
        const len = (path as SVGPathElement).getTotalLength();
        gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
      });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      // 背景图不动(11-04 用户定),只让小鹰、字和单词卡进场
      tl.from(q('.scene-eagle'), { autoAlpha: 0, y: 26, duration: 0.5 }, 0.1)
        // 字从左往右「写」出来;不认 clip-path 的老浏览器直接显示
        .fromTo(q('.scene-greet-line'),
          { clipPath: 'inset(-20% 100% -20% 0)' },
          { clipPath: 'inset(-20% 0% -20% 0)', duration: 0.6, ease: 'power2.inOut', stagger: 0.16 }, 0.16)
        .to(q('.scene-stroke'), { strokeDashoffset: 0, duration: 0.55, ease: 'power2.inOut', stagger: 0.08 }, 0.42)
        .from(q('.scene-card'), { autoAlpha: 0, y: 14, scale: 0.97, duration: 0.45 }, 0.32)
        .from(q('.scene-fade'), { autoAlpha: 0, y: 8, duration: 0.4 }, 0.46)
        .from(q('.fx, .fri-kite'), { autoAlpha: 0, duration: 0.8 }, 0.5);
      return () => tl.kill();
    });
    return () => mm.revert();
  }, { scope: panelRef, dependencies: [scene.id], revertOnUpdate: true });

  const bgBase = scene.bg ? `/board-art/week/${scene.bg.name}-bg` : '';
  const stageStyle: CSSProperties | undefined = box ? { left: box.left, width: box.width, height: box.height } : undefined;
  const eagleStyle: CSSProperties | undefined = scene.bg && box ? { bottom: box.height * scene.bg.ground } : undefined;

  return (
    <div ref={shellRef} className={`auth-shell auth-shell-${mode}`}>
      <section
        ref={panelRef}
        className={`scene scene-${scene.id}`}
        aria-label={`小鹰的一周 · 星期${scene.short} · ${scene.name}`}
      >
        {scene.id === 'mon' ? (
          <>
            <picture className="scene-board-surface scene-bg-layer" aria-hidden="true">
              <source
                type="image/webp"
                srcSet="/board-art/board-surface-960.webp 960w, /board-art/board-surface.webp 1672w"
                sizes="(min-width: 1024px) 58vw, 100vw"
              />
              <img
                src="/board-art/board-surface.jpg"
                srcSet="/board-art/board-surface-960.jpg 960w, /board-art/board-surface.jpg 1672w"
                sizes="(min-width: 1024px) 58vw, 100vw"
                alt=""
                fetchPriority="high"
                decoding="async"
              />
            </picture>
            <div className="scene-board-ledge" aria-hidden="true">
              <picture>
                <source type="image/webp" srcSet="/board-art/board-ledge.webp" />
                <img src="/board-art/board-ledge.jpg" alt="" decoding="async" />
              </picture>
            </div>
          </>
        ) : (
          <div key={`bg-${scene.id}`} className="scene-stage scene-bg-layer" style={stageStyle} aria-hidden="true">
            <picture>
              <source
                type="image/webp"
                srcSet={`${bgBase}-960.webp 960w, ${bgBase}.webp 1672w`}
                sizes="(min-width: 1024px) 178vh, (min-width: 768px) 100vw, 120vw"
              />
              <img src={`${bgBase}.jpg`} alt="" fetchPriority="high" decoding="async" />
            </picture>
          </div>
        )}
        <div className="scene-shade" aria-hidden="true" />
        <SceneAmbient id={scene.id} />

        <div className="scene-text">
          <div className="scene-greet">
            <p className="scene-greet-line scene-greet-en" lang="en">
              {greeting.en}
              <svg className="scene-sparkle" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 17 L8 11 M10 9 L11 2 M13 11 L19 8" />
              </svg>
            </p>
            <svg className="scene-underline" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true">
              <path className="scene-stroke" d="M4 13 C 70 6, 170 3, 296 9" />
            </svg>
            <p className="scene-greet-line scene-greet-zh">{greeting.zh}</p>
          </div>

          <div className="scene-corner scene-fade">
            <time dateTime={date.iso} className="scene-date">{date.zh}</time>
            <div className="scene-week" role="group" aria-label="小鹰的一周,点一下看看别的几天">
              {WEEK_ORDER.map((id) => {
                const s = sceneById(id);
                const active = s.id === scene.id;
                const isToday = s.id === today.id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`scene-week-day ${active ? 'is-active' : ''} ${isToday ? 'is-today' : ''}`}
                    aria-pressed={active}
                    aria-label={`星期${s.short} · ${s.name}${isToday ? '(今天)' : ''}`}
                    title={`星期${s.short} · ${s.name}${isToday ? '(今天)' : ''}`}
                    onClick={() => setPreviewId(isToday ? null : s.id)}
                  >
                    {s.short}
                  </button>
                );
              })}
            </div>
          </div>

          <section className="scene-card" aria-label="今日单词" style={{ ['--word-scale' as string]: wordScale }}>
            <CardFrame card={scene.card} />
            <p className="card-tag">
              <span>今日单词</span>
              <span lang="en" className="card-tag-en">word of the day</span>
            </p>
            <p className="card-word" lang="en">{word.word}</p>
            <div className="card-meta">
              <button
                type="button"
                onClick={speak}
                className={`card-speak ${speaking ? 'is-speaking' : ''}`}
                aria-label={`听 ${word.word} 的发音`}
              >
                <Volume2 className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
              </button>
              <span className="card-ipa" lang="en">/{word.ipa}/</span>
              <span className="card-meaning">
                <span lang="en">{word.pos}</span> {word.meaning}
              </span>
            </div>
          </section>
        </div>

        {scene.id === 'fri' && <FridayKite panelRef={panelRef} box={box} />}
        <Eagle key={`eagle-${scene.id}`} scene={scene} style={eagleStyle} speaking={speaking} />
      </section>

      <main className="auth-form-plane">
        <div className="auth-form-content">
          <div className="auth-brand" data-auth-reveal>
            <span className="auth-brand-mark" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="font-display text-xl font-black tracking-[-0.02em] text-[#293545]">飞鹰AI英语</h1>
              <p className="text-xs font-semibold text-[#687383]">AI 智能学习平台</p>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
