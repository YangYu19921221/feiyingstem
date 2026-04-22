import { useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';

export interface LampPalette {
  hue: number;
  sat: number;
  light: number;
  name: string;
}

export const LAMP_PALETTES: LampPalette[] = [
  { hue: 38,  sat: 92, light: 62, name: 'amber' },
  { hue: 18,  sat: 88, light: 60, name: 'coral' },
  { hue: 350, sat: 78, light: 64, name: 'rose'  },
  { hue: 168, sat: 72, light: 52, name: 'teal'  },
  { hue: 198, sat: 85, light: 60, name: 'sky'   },
  { hue: 258, sat: 72, light: 68, name: 'lilac' },
  { hue: 88,  sat: 62, light: 58, name: 'lime'  },
];

export const pickNextPaletteIndex = (prev: number): number => {
  const n = LAMP_PALETTES.length;
  let i = Math.floor(Math.random() * (n - 1));
  if (i >= prev) i += 1;
  return i;
};

interface Props {
  on: boolean;
  palette: LampPalette;
  onToggle: () => void;
}

const THRESHOLD = 50;

export default function DeskLamp({ on, palette, onToggle }: Props) {
  const y = useMotionValue(0);
  const [dragging, setDragging] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playClick = () => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio('/sounds/click.mp3');
        audioRef.current.volume = 0.5;
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } catch {}
  };

  const triggerToggle = () => {
    playClick();
    onToggle();
  };

  // 绳身 Q 控制点随 y 弹动（近似 MorphSVG）
  const cordD = useTransform(y, (yv) => {
    const cx = 0;
    const mid = Math.max(0, yv) / 2;
    const bow = Math.min(10, Math.abs(yv) * 0.08);
    return `M ${cx} 0 Q ${cx + bow} ${mid} ${cx} ${Math.max(0, yv) + 120}`;
  });

  const lampHsl = `hsl(${palette.hue} ${palette.sat}% ${palette.light}%)`;
  const shadeHsl = `hsl(${palette.hue} ${Math.max(20, palette.sat - 12)}% ${Math.max(20, palette.light - 8)}%)`;
  const coneTop = `hsl(${palette.hue} 100% 78% / ${on ? 0.55 : 0})`;
  const coneBot = `hsl(${palette.hue} 100% 60% / 0)`;

  return (
    <div
      role="button"
      aria-pressed={on}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerToggle();
        }
      }}
      className="select-none outline-none"
      style={{ width: 280, maxWidth: '100%' }}
    >
      <svg viewBox="-150 -20 300 480" width="100%" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="coneGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={coneTop} />
            <stop offset="100%" stopColor={coneBot} />
          </linearGradient>
          <radialGradient id="bulbGrad" cx="50%" cy="60%" r="50%">
            <stop offset="0%" stopColor={`hsl(${palette.hue} 100% 85% / ${on ? 1 : 0.15})`} />
            <stop offset="100%" stopColor={`hsl(${palette.hue} 100% 60% / ${on ? 0.6 : 0})`} />
          </radialGradient>
          <filter id="lampGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={on ? 8 : 0} />
          </filter>
        </defs>

        {/* 光锥 */}
        <motion.path
          d="M -120 130 L 120 130 L 200 460 L -200 460 Z"
          fill="url(#coneGrad)"
          animate={{ opacity: on ? 0.6 : 0 }}
          transition={{ duration: 0.5 }}
          style={{ mixBlendMode: 'screen' }}
        />

        {/* 底座 */}
        <ellipse cx="0" cy="430" rx="90" ry="14" fill="#0a1119" />
        <rect x="-70" y="410" width="140" height="22" rx="10" fill="#1f2a38" />
        <rect x="-70" y="410" width="140" height="6" rx="3" fill={on ? lampHsl : '#2a3442'} opacity={on ? 0.35 : 0.5} />

        {/* 灯杆 */}
        <line x1="0" y1="410" x2="0" y2="150" stroke="#2a3442" strokeWidth="5" strokeLinecap="round" />
        {/* 杆上的转轴小球 */}
        <circle cx="0" cy="150" r="7" fill="#3a4656" />

        {/* 灯罩（含眼睛） */}
        <motion.g
          style={{ originX: 0, originY: 110 }}
          animate={{ rotate: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 12 }}
        >
          {/* 灯罩 */}
          <g filter="url(#lampGlow)">
            <path
              d="M -95 130 L -55 40 L 55 40 L 95 130 Z"
              fill={shadeHsl}
              stroke={on ? lampHsl : '#2a3442'}
              strokeWidth="2"
              style={{
                filter: on ? 'none' : 'grayscale(0.6) brightness(0.55)',
                transition: 'filter .5s ease',
              }}
            />
            {/* 灯罩顶盖 */}
            <rect x="-18" y="32" width="36" height="12" rx="3" fill="#2a3442" />
          </g>

          {/* 灯罩口内里的灯泡 */}
          <ellipse cx="0" cy="125" rx="60" ry="10" fill="url(#bulbGrad)" />

          {/* 眼睛（开灯朝上 rotate:0，关灯朝下 rotate:180） */}
          <motion.g
            style={{ originX: 0, originY: 85 }}
            animate={{ rotate: on ? 0 : 180 }}
            transition={{ type: 'spring', stiffness: 140, damping: 14 }}
          >
            <g fill="#0a1119">
              <ellipse cx="-22" cy="80" rx="6" ry="9" />
              <ellipse cx="22" cy="80" rx="6" ry="9" />
            </g>
            <g fill="#e8edf3">
              <circle cx="-22" cy={on ? 76 : 84} r="2" />
              <circle cx="22" cy={on ? 76 : 84} r="2" />
            </g>
          </motion.g>
        </motion.g>

        {/* 拉绳（从灯罩右上挂下） */}
        <g transform="translate(70 44)">
          <motion.path
            d={cordD as unknown as string}
            stroke={on ? lampHsl : '#5a6778'}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            style={{ opacity: 0.9 }}
          />
          <motion.g
            drag="y"
            dragConstraints={{ top: 0, bottom: 140 }}
            dragElastic={0.2}
            dragMomentum={false}
            style={{ y, cursor: dragging ? 'grabbing' : 'grab' }}
            onDragStart={() => setDragging(true)}
            onDragEnd={(_, info) => {
              setDragging(false);
              const dy = info.offset.y;
              if (Math.abs(dy) >= THRESHOLD) triggerToggle();
              animate(y, 0, { type: 'spring', stiffness: 420, damping: 10 });
            }}
          >
            <circle
              cx="0"
              cy="120"
              r="10"
              fill={on ? lampHsl : '#5a6778'}
              stroke="#0a1119"
              strokeWidth="1.5"
            />
          </motion.g>
        </g>
      </svg>
    </div>
  );
}
