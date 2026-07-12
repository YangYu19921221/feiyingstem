/**
 * 自适应字号单词展示
 * 按 maxPx 理想字号渲染,实测溢出容器宽度就等比缩小到正好放下(最小 minPx)。
 * 解决固定 text-4xl 下长单词/短语(firefighter、police officer)被裁切或挤压换行的问题:
 * 短词大而醒目,长词自动缩小但保持单行完整可读。
 */
import { useRef, useLayoutEffect, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 理想(最大)字号 px */
  maxPx?: number;
  /** 最小字号 px,再小可读性差,低于此值允许换行兜底 */
  minPx?: number;
  className?: string;
  /** 触发重新测量的键(通常传单词本身) */
  fitKey?: string | number;
}

export default function AutoFitText({ children, maxPx = 44, minPx = 20, className = '', fitKey }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxPx);
  const [allowWrap, setAllowWrap] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;

    // 从理想字号开始逐步收缩,直到内容宽度放得下
    let size = maxPx;
    setAllowWrap(false);
    inner.style.fontSize = `${size}px`;
    // 循环上限防御:44→20 每次 -2 最多 12 轮
    for (let i = 0; i < 24 && inner.scrollWidth > box.clientWidth && size > minPx; i++) {
      size = Math.max(minPx, size - 2);
      inner.style.fontSize = `${size}px`;
    }
    // 缩到最小仍放不下(超长短语)→ 允许换行兜底,绝不裁切
    if (inner.scrollWidth > box.clientWidth) setAllowWrap(true);
    setFontSize(size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, maxPx, minPx]);

  return (
    <div ref={boxRef} className={`w-full min-w-0 ${className}`}>
      <span
        ref={innerRef}
        className={`inline-block max-w-full leading-tight ${allowWrap ? 'break-words whitespace-normal' : 'whitespace-nowrap'}`}
        style={{ fontSize: `${fontSize}px` }}
      >
        {children}
      </span>
    </div>
  );
}
