/**
 * 喇叭按钮(2026-11-08 重画,用户「喇叭图片你也从新设计下…有质感看着舒服」)
 *
 * 一枚暖橙色的圆形「按钮章」: 径向渐变 + 内高光 + 带偏移的软阴影,按下去有压感;
 * 喇叭和声波是自己画的 SVG(不用 emoji,各平台 🔊 长得不一样)。
 * 正在发音时声波一圈圈往外亮、外面扩一道波纹;减少动态效果时不动。
 * 「在不在响」读 useAudioPlaying(全局同一时刻只有一个发音)。
 */
import { useAudioPlaying } from '../../hooks/useAudio';

interface SpeakerButtonProps {
  onClick: () => void;
  /** lg 76px(听写主按钮)/ xl 92px(没有配图时放在声音台中间)/ sm 36px(小按钮里的图标) */
  size?: 'sm' | 'lg' | 'xl';
  label?: string;
  className?: string;
  /** 点的时候不抢输入框的焦点(听写时手机键盘不会收起再弹出来) */
  keepFocus?: boolean;
}

/** 只要图标(小按钮里用),颜色跟着文字走 */
export function SpeakerGlyph({ playing = false, className = '' }: { playing?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`speaker-glyph${playing ? ' is-playing' : ''} ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="speaker-body"
        d="M3.6 9.4h3.1l4.3-3.7c.62-.53 1.6-.09 1.6.73v11.14c0 .82-.98 1.26-1.6.73l-4.3-3.7H3.6c-.6 0-1.1-.5-1.1-1.1V10.5c0-.6.5-1.1 1.1-1.1z"
      />
      <path className="speaker-wave w1" d="M15.3 10.1a2.7 2.7 0 0 1 0 3.8" />
      <path className="speaker-wave w2" d="M17.5 7.9a5.8 5.8 0 0 1 0 8.2" />
      <path className="speaker-wave w3" d="M19.7 5.7a8.9 8.9 0 0 1 0 12.6" />
    </svg>
  );
}

export default function SpeakerButton({ onClick, size = 'lg', label = '再听一遍发音', className = '', keepFocus = false }: SpeakerButtonProps) {
  const playing = useAudioPlaying();
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
      aria-label={label}
      title="再听一遍"
      className={`speaker-medal speaker-${size}${playing ? ' is-playing' : ''} ${className}`}
    >
      <span className="speaker-ripple" aria-hidden="true" />
      <SpeakerGlyph playing={playing} className="speaker-medal-glyph" />
    </button>
  );
}
