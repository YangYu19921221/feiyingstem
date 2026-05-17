import type { ImgHTMLAttributes } from 'react';

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  /** webp 路径，组件自动派生同名 .jpg 作为 fallback */
  src: string;
}

/**
 * 图片兜底：现代浏览器走 webp（小、清），老 Safari/iOS 12 走同名 jpg。
 * 用法：传 `src="/foo/bar.webp"`，组件自动加 `<picture><source webp/><img jpg/></picture>`。
 * 其它属性（className/draggable/onError/...）原样透传给 <img>。
 */
export default function PictureFallback({ src, ...rest }: Props) {
  const jpgSrc = src.endsWith('.webp') ? src.slice(0, -5) + '.jpg' : src;
  return (
    <picture>
      {src.endsWith('.webp') && <source srcSet={src} type="image/webp" />}
      <img src={jpgSrc} {...rest} />
    </picture>
  );
}
