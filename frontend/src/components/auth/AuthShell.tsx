import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Volume2 } from 'lucide-react';
import { useAudio } from '../../hooks/useAudio';
import { boardDate, dayPart, wordOfDay } from './boardWords';
import type { DayPart } from './boardWords';
import './AuthShell.css';

gsap.registerPlugin(useGSAP);

interface Props {
  children: ReactNode;
  mode?: 'login' | 'register';
}

/**
 * 登录 / 注册页外壳(2026-11-04 改成教室黑板): 左边(手机在上面)是一块黑板,
 * 小鹰站在粉笔槽上,黑板上用粉笔写着按时间变的问候、今天的日期和「今日单词」(点喇叭能听)。
 * 黑板、粉笔槽、小鹰是三张图分层叠的,字全是网页上的真字(会变、放大不糊)。
 * 黑板上的中文用字体子集,改了中文要重出子集,见 boardWords.ts 文件头
 */
const GREETING: Record<DayPart, { en: string; zh: string }> = {
  morning: { en: 'Good morning!', zh: '早上好，欢迎回来' },
  noon: { en: 'Good afternoon!', zh: '中午好，欢迎回来' },
  afternoon: { en: 'Good afternoon!', zh: '下午好，欢迎回来' },
  evening: { en: 'Good evening!', zh: '晚上好，欢迎回来' },
};

const REGISTER_GREETING = { en: 'Welcome!', zh: '新同学，欢迎你加入' };

export default function AuthShell({ children, mode = 'login' }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [speaking, setSpeaking] = useState(false);
  const speakTimer = useRef<number | undefined>(undefined);
  const { playAudio } = useAudio();

  // 页面开着过了饭点 / 过了半夜,问候和今日单词跟着换
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 5 * 60_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(speakTimer.current);
    };
  }, []);

  const greeting = mode === 'register' ? REGISTER_GREETING : GREETING[dayPart(now)];
  const date = boardDate(now);
  const word = wordOfDay(now);
  // 长单词按字母数缩小,butterfly 也写得进一行
  const wordScale = Math.min(1, 6.5 / word.word.length);

  const speak = () => {
    setSpeaking(true);
    window.clearTimeout(speakTimer.current);
    speakTimer.current = window.setTimeout(() => setSpeaking(false), 1400);
    void playAudio(word.word);
  };

  useGSAP(() => {
    const root = shellRef.current;
    if (!root) return;

    const q = <T extends Element>(selector: string) => Array.from(root.querySelectorAll<T>(selector));
    const eagle = q<HTMLElement>('.board-eagle');
    const greet = q<HTMLElement>('.board-greet-line');
    const strokes = q<SVGPathElement>('.board-stroke');
    const fades = q<HTMLElement>('.board-fade');
    const form = q<HTMLElement>('.auth-form-content');
    const revealItems = q<HTMLElement>('[data-auth-reveal]');

    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      strokes.forEach((path) => {
        const len = path.getTotalLength();
        gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
      });
      gsap.set(eagle, { autoAlpha: 0, y: 26 });
      // 粉笔字从左往右「写」出来;不认 clip-path 的老浏览器直接显示,不影响看
      gsap.set(greet, { clipPath: 'inset(-20% 100% -20% 0)' });
      gsap.set(fades, { autoAlpha: 0, y: 8 });
      gsap.set(form, { autoAlpha: 0, y: 14 });
      gsap.set(revealItems, { autoAlpha: 0, y: 10 });

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.to(eagle, { autoAlpha: 1, y: 0, duration: 0.5 }, 0.05)
        .to(greet, { clipPath: 'inset(-20% 0% -20% 0)', duration: 0.62, ease: 'power2.inOut', stagger: 0.18 }, 0.12)
        .to(strokes, { strokeDashoffset: 0, duration: 0.55, ease: 'power2.inOut', stagger: 0.08 }, 0.42)
        .to(fades, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.06 }, 0.5)
        .to(form, { autoAlpha: 1, y: 0, duration: 0.42 }, 0.15)
        .to(revealItems, { autoAlpha: 1, y: 0, duration: 0.32, stagger: 0.045 }, 0.32);

      return () => tl.kill();
    });

    return () => mm.revert();
  }, { scope: shellRef });

  return (
    <div ref={shellRef} className={`auth-shell auth-shell-${mode}`}>
      <section className="board" aria-label="教室黑板">
        <picture className="board-surface" aria-hidden="true">
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
        <div className="board-shade" aria-hidden="true" />

        <div className="board-chalk">
          <div className="board-greet">
            <p className="board-greet-line board-greet-en chalk" lang="en">
              {greeting.en}
              <svg className="board-sparkle" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 17 L8 11 M10 9 L11 2 M13 11 L19 8" />
              </svg>
            </p>
            <svg className="board-underline" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true">
              <path className="board-stroke" d="M4 13 C 70 6, 170 3, 296 9" />
            </svg>
            <p className="board-greet-line board-greet-zh chalk">{greeting.zh}</p>
          </div>

          <p className="board-date board-fade chalk">
            <span className="board-date-en" lang="en">{date.weekdayEn}</span>
            <time dateTime={date.iso} className="board-date-zh">{date.zh}</time>
          </p>

          <section className="board-word" aria-label="今日单词" style={{ ['--word-scale' as string]: wordScale }}>
            <svg className="board-frame" viewBox="0 0 400 240" preserveAspectRatio="none" aria-hidden="true">
              <path
                className="board-stroke"
                d="M24 19 C 120 11, 280 13, 376 20 C 390 21, 393 33, 392 50 C 390 110, 395 168, 390 214 C 388 227, 378 229, 362 230 C 262 235, 132 232, 32 228 C 18 227, 11 218, 12 203 C 14 150, 9 92, 13 36 C 14 24, 20 20, 38 18"
              />
            </svg>
            <p className="board-word-tag board-fade chalk">
              <span>今日单词</span>
              <span lang="en" className="board-word-tag-en">word of the day</span>
            </p>
            <p className="board-word-text board-fade chalk" lang="en">{word.word}</p>
            <div className="board-word-meta board-fade">
              <button
                type="button"
                onClick={speak}
                className={`board-speak ${speaking ? 'is-speaking' : ''}`}
                aria-label={`听 ${word.word} 的发音`}
              >
                <Volume2 className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
              </button>
              <span className="board-ipa chalk" lang="en">/{word.ipa}/</span>
              <span className="board-meaning chalk">
                <span lang="en">{word.pos}</span> {word.meaning}
              </span>
            </div>
          </section>
        </div>

        <div className="board-ledge" aria-hidden="true">
          <picture>
            <source type="image/webp" srcSet="/board-art/board-ledge.webp" />
            <img src="/board-art/board-ledge.jpg" alt="" decoding="async" />
          </picture>
        </div>

        <div className={`board-eagle ${speaking ? 'is-speaking' : ''}`}>
          <picture>
            <source
              type="image/webp"
              srcSet="/board-art/eagle-480.webp 451w, /board-art/eagle-880.webp 827w"
              sizes="(min-width: 1024px) 24rem, 9rem"
            />
            <img src="/board-art/eagle-480.png" alt="戴眼镜的折纸小鹰站在黑板前" decoding="async" />
          </picture>
        </div>
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
