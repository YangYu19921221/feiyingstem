/**
 * 自适应字号单词展示
 * 按 maxPx 理想字号渲染,实测溢出容器宽度就等比缩小到正好放下。
 * 解决固定 text-4xl 下长单词/短语(firefighter、police officer)被裁切或挤压换行的问题:
 * 短词大而醒目,长词自动缩小但【始终保持单行】——minPx 是期望下限,
 * 超长短语允许继续缩小到 10px 硬底,绝不换行(产品要求:单词卡一行显示)。
 */
import { useRef, useLayoutEffect, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 理想(最大)字号 px */
  maxPx?: number;
  /** 期望最小字号 px;超长内容可继续缩小(硬底 10px),但绝不换行 */
  minPx?: number;
  className?: string;
  /** 触发重新测量的键(通常传单词本身) */
  fitKey?: string | number;
}

const HARD_FLOOR_PX = 10;

export default function AutoFitText({ children, maxPx = 44, minPx = 20, className = '', fitKey }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxPx);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;

    let size = maxPx;
    inner.style.fontSize = `${size}px`;
    if (inner.scrollWidth > box.clientWidth) {
      // 一步等比缩放到接近正好放下,再微调修正字体渲染的非线性
      size = Math.max(HARD_FLOOR_PX, Math.floor(size * box.clientWidth / inner.scrollWidth));
      inner.style.fontSize = `${size}px`;
      for (let i = 0; i < 8 && inner.scrollWidth > box.clientWidth && size > HARD_FLOOR_PX; i++) {
        size -= 1;
        inner.style.fontSize = `${size}px`;
      }
    }
    setFontSize(size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, maxPx, minPx]);

  return (
    <div ref={boxRef} className={`w-full min-w-0 ${className}`}>
      <span
        ref={innerRef}
        className="inline-block max-w-full leading-tight whitespace-nowrap"
        style={{ fontSize: `${fontSize}px` }}
      >
        {children}
      </span>
    </div>
  );
}
