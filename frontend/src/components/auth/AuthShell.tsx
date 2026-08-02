import { useRef } from 'react';
import type { ReactNode } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import './AuthShell.css';

gsap.registerPlugin(useGSAP);

interface Props {
  children: ReactNode;
  mode?: 'login' | 'register';
}

const MODE_COPY = {
  login: {
    heading: ['展翅高飞，', '征服英语'],
    imageAlt: '飞鹰穿过晨光与云层',
  },
  register: {
    heading: ['让英语成为', '你的翅膀'],
    imageAlt: '飞鹰在晨空中向前翱翔',
  },
} as const;

export default function AuthShell({ children, mode = 'login' }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const copy = MODE_COPY[mode];

  useGSAP(() => {
    const root = shellRef.current;
    if (!root) return;

    const query = <T extends Element>(selector: string) => root.querySelector<T>(selector);
    const revealItems = Array.from(root.querySelectorAll<HTMLElement>('[data-auth-reveal]'));
    const scene = query<HTMLElement>('.auth-scene-media');
    const trail = query<SVGPathElement>('.auth-flight-trail path');
    const settle = query<HTMLElement>('.auth-flight-settle');
    const sun = query<HTMLElement>('.auth-sun-glow');
    const cloudOne = query<HTMLElement>('.auth-cloud-one');
    const cloudTwo = query<HTMLElement>('.auth-cloud-two');
    const form = query<HTMLElement>('.auth-form-content');
    const brand = query<HTMLElement>('.auth-scene-content');
    if (!scene || !trail || !settle || !sun || !cloudOne || !cloudTwo || !form || !brand) return;

    const mm = gsap.matchMedia();
    mm.add(
      {
        compact: '(max-width: 767px)',
        reduceMotion: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        const { compact, reduceMotion } = context.conditions as {
          compact: boolean;
          reduceMotion: boolean;
        };

        if (reduceMotion) {
          gsap.set([trail, settle], { autoAlpha: 0 });
          return;
        }

        gsap.set(scene, {
          scale: compact ? 1.16 : 1.28,
          xPercent: compact ? -12 : -22,
          yPercent: compact ? 2 : 6,
        });
        gsap.set(trail, { strokeDasharray: 540, strokeDashoffset: 540, autoAlpha: 0 });
        gsap.set(settle, { autoAlpha: 0, scale: 0.58 });
        gsap.set(brand, { autoAlpha: 0, y: 18 });
        gsap.set(form, { autoAlpha: 0, x: compact ? 0 : 26, y: compact ? 18 : 0 });
        gsap.set(revealItems, { autoAlpha: 0, y: 12 });

        const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });
        timeline
          .to(scene, {
            scale: 1,
            xPercent: 0,
            yPercent: 0,
            duration: compact ? 1.55 : 2.05,
            ease: 'power3.inOut',
          }, 0)
          .fromTo(sun,
            { autoAlpha: 0.12, scale: 0.72 },
            { autoAlpha: 1, scale: 1, duration: 1.35, ease: 'power2.out' },
            0.08,
          )
          .fromTo(cloudOne,
            { xPercent: -24, autoAlpha: 0 },
            { xPercent: 12, autoAlpha: 0.8, duration: 1.85, ease: 'power1.inOut' },
            0,
          )
          .fromTo(cloudTwo,
            { xPercent: 18, autoAlpha: 0 },
            { xPercent: -8, autoAlpha: 0.62, duration: 1.9, ease: 'power1.inOut' },
            0.05,
          )
          .to(trail, { autoAlpha: 0.76, duration: 0.14 }, 0.08)
          .to(trail, { strokeDashoffset: 0, duration: 0.98, ease: 'power1.inOut' }, 0.08)
          .to(trail, { autoAlpha: 0, duration: 0.34 }, 1.14)
          .to(settle, { autoAlpha: 0.9, scale: 1, duration: 0.3, ease: 'power2.out' }, 1.42)
          .to(settle, { autoAlpha: 0, scale: 1.16, duration: 0.56, ease: 'power1.out' }, 1.72)
          .to(brand, { autoAlpha: 1, y: 0, duration: 0.46 }, 0.26)
          .to(form, { autoAlpha: 1, x: 0, y: 0, duration: 0.42 }, 0.18)
          .to(revealItems, {
            autoAlpha: 1,
            y: 0,
            duration: 0.32,
            stagger: 0.045,
          }, 0.38);

        return () => timeline.kill();
      },
      root,
    );

    return () => mm.revert();
  }, { scope: shellRef });

  return (
    <div ref={shellRef} className={`auth-shell auth-shell-${mode}`}>
      <section className="auth-scene relative" aria-label="飞鹰 AI 英语品牌场景">
        <div className="auth-scene-media">
          <img
            src="/hero-login.jpeg"
            alt={copy.imageAlt}
            fetchPriority="high"
            className="auth-scene-image"
          />
        </div>
        <div className="auth-scene-shade" aria-hidden="true" />
        <div className="auth-sun-glow" aria-hidden="true" />
        <div className="auth-cloud auth-cloud-one" aria-hidden="true" />
        <div className="auth-cloud auth-cloud-two" aria-hidden="true" />
        <svg className="auth-flight-trail" viewBox="0 0 1000 760" preserveAspectRatio="none" aria-hidden="true">
          <path d="M -80 510 C 120 300, 250 610, 430 410 S 650 235, 770 305" />
        </svg>
        <div className="auth-flight-settle" aria-hidden="true">
          <span className="auth-flight-settle-core" />
        </div>

        <div className="auth-scene-content absolute inset-0 z-[1] flex flex-col justify-between p-5 text-white sm:p-8 lg:p-12">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#fbfaf7] shadow-[0_10px_30px_rgb(20_42_63/0.2)]">
              <img src="/favicon.svg" alt="" className="h-8 w-8" />
            </div>
            <div>
              <p className="font-display text-xl font-black tracking-[-0.02em] sm:text-2xl">飞鹰AI英语</p>
              <p className="mt-0.5 text-xs font-semibold text-white/[0.78]">AI 智能学习平台</p>
            </div>
          </div>

          <div className="max-w-[32rem] pb-1 sm:pb-2">
            <h1 className="font-display text-[clamp(1.72rem,4.2vw,4.5rem)] font-black leading-[1.04] tracking-[-0.035em] text-white">
              {copy.heading.map((line) => <span key={line} className="block">{line}</span>)}
            </h1>
            <div className="mt-4 h-1 w-16 rounded-full bg-[#ffd23f]" aria-hidden="true" />
          </div>
        </div>
      </section>

      <main className="auth-form-plane flex min-h-0 items-center justify-center px-5 py-9 sm:px-9 sm:py-12 lg:min-h-[100dvh] lg:px-12">
        <div className="auth-form-content w-full max-w-[420px]">
          {children}
        </div>
      </main>
    </div>
  );
}
