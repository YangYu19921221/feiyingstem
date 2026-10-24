/**
 * 体验卡正面缩略图: 去掉价格的底图 + 按机构体验价现画的价格(SVG,跟印刷文件同一套排版 utils/promoPrice)。
 * 用户 10-24「设置里改了价格,卡片图上的价格可以实时改吗」—— 改了价格,所有卡面缩略图、预览、印刷文件都跟着变。
 * viewBox 用原图 1536×1024 坐标,slice = object-cover,外面给 3:2 的框就和原来的 <img> 一样。
 */
import { memo } from 'react';
import { templateImg, templateOf } from '../../data/promoTemplates';
import { PRICE_FONT, priceLayout } from '../../utils/promoPrice';

interface Props {
  templateId: string;
  price: number;
  className?: string;
}

function PromoCardThumb({ templateId, price, className }: Props) {
  const tpl = templateOf(templateId);
  const p = tpl.price;
  const L = priceLayout(p, price);
  const stroke = p.stroke && p.sw ? { stroke: p.stroke, strokeWidth: p.sw * 2, strokeLinejoin: 'round' as const, paintOrder: 'stroke' } : {};
  return (
    <svg viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true" focusable="false">
      <image href={templateImg(tpl.id, 'thumb')} x={0} y={0} width={1536} height={1024} preserveAspectRatio="none" />
      <g fontFamily={PRICE_FONT} fontWeight={800} fill={p.fill} {...stroke}>
        <text x={L.yenLeft} y={L.baseline} fontSize={L.yenSize}>¥</text>
        <text x={L.digitsLeft} y={L.baseline} fontSize={L.size}>{L.digits}</text>
      </g>
    </svg>
  );
}

export default memo(PromoCardThumb);
