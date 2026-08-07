/**
 * 网页元素导出 PDF —— 打印之外的第二条路
 *
 * 为什么需要它:window.print() 在手机浏览器上普遍没有"另存为 PDF",
 * 学生想把默写纸存下来发给家长打印就没办法;加盟商要的合同/介绍也一样,
 * 用户要的是一个能直接发出去的文件,不是一个打印对话框。
 *
 * 走前端 html2pdf.js(html2canvas 截图 + jsPDF 排版),与教师端 AI 试卷
 * 下载同一套依赖,不新增包、不经服务器 —— 文档不落盘(UPLOAD_DIR 公开无鉴权,
 * 合同这类资料绝不能进那个目录)。
 *
 * 两个已知坑,都在这里一次性处理掉:
 * 1. html2canvas 不认 oklch()/lab() 等新色彩函数(项目 index.css 用了 oklch),
 *    遇到会直接抛错整个导出失败 → 截图前把这些声明降级成等效 rgb。
 * 2. 手机屏幕窄,截图拿到的是移动端单列布局,存出来的 PDF 和打印件不一样
 *    → 导出期间给容器强制一个 A4 内容宽度(desktopWidth),截完恢复。
 */
import { toast } from '../components/Toast';

interface DownloadPdfOptions {
  /** 文件名,不含 .pdf 后缀 */
  filename: string;
  /**
   * 导出时强制的内容宽度(px)。默认 794 ≈ A4 纸 210mm 在 96dpi 下的像素宽,
   * 这样手机上导出的 PDF 与电脑打印件版式一致。
   */
  desktopWidth?: number;
  /** 页边距 mm,顺序 [上, 右, 下, 左] */
  margin?: [number, number, number, number];
}

/** oklch/oklab/lab/lch 一律降级:html2canvas 解析不了会直接抛错 */
const MODERN_COLOR_FN = /\b(oklch|oklab|lab|lch)\(/i;

/**
 * 把文档里用到新色彩函数的 CSS 声明临时替换成 rgb。
 * 用 getComputedStyle 拿浏览器已算好的 rgb 值,不自己做色彩空间换算。
 * 返回恢复函数。
 */
function patchModernColors(root: HTMLElement): () => void {
  const touched: Array<{ el: HTMLElement; prop: string; prev: string }> = [];
  const props = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'backgroundImage', 'outlineColor'];

  const walk = (el: HTMLElement) => {
    const computed = window.getComputedStyle(el);
    for (const prop of props) {
      const raw = el.style.getPropertyValue(prop);
      const value = computed.getPropertyValue(prop as any);
      // 计算值里没有新色彩函数就不用管;有的话写回计算出的 rgb(浏览器已解析)
      if (value && MODERN_COLOR_FN.test(value)) {
        touched.push({ el, prop, prev: raw });
        // 渐变/阴影里嵌了 oklch 时无法逐段换算,直接去掉这层装饰(导出件不需要光晕)
        el.style.setProperty(prop, prop === 'boxShadow' || prop === 'backgroundImage' ? 'none' : 'rgb(100, 100, 100)');
      }
    }
    for (const child of Array.from(el.children)) walk(child as HTMLElement);
  };
  walk(root);

  return () => {
    for (const { el, prop, prev } of touched) {
      if (prev) el.style.setProperty(prop, prev);
      else el.style.removeProperty(prop);
    }
  };
}

/**
 * 把一个 DOM 元素导出成 PDF 并触发下载。
 * 失败时给用户 toast 提示并抛出,调用方负责恢复 loading 状态。
 */
export async function downloadElementAsPdf(
  element: HTMLElement,
  { filename, desktopWidth = 794, margin = [12, 10, 12, 10] }: DownloadPdfOptions
): Promise<void> {
  // 动态 import:html2pdf 连带 html2canvas + jspdf 有 700KB+,
  // 只有真的点下载才加载,不拖慢首屏
  const { default: html2pdf } = await import('html2pdf.js');

  // 关键:不能只给原元素设宽度 —— 它的祖先容器在手机上只有 390px,
  // 元素撑到 794px 会溢出父级,html2canvas 截出来右边被切掉。
  // 改为把元素深拷贝进一个屏幕外的固定宽容器再截图:
  // 拷贝件不受页面布局约束,原页面也完全不闪动。
  // cloneNode(true) 会带上 contentEditable 里已填的文字(填好的合同能进 PDF)。
  const stage = document.createElement('div');
  stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${desktopWidth}px;background:#fff;z-index:-1;`;
  const clone = element.cloneNode(true) as HTMLElement;
  // 屏幕上的卡片样式(圆角/阴影/外边框)在纸上没意义,去掉更像正式文件
  clone.style.width = '100%';
  clone.style.maxWidth = 'none';
  clone.style.margin = '0';
  clone.style.borderRadius = '0';
  clone.style.boxShadow = 'none';
  clone.style.border = 'none';
  stage.appendChild(clone);
  document.body.appendChild(stage);

  const restoreColors = patchModernColors(clone);

  try {
    await html2pdf()
      .set({
        margin,
        filename: `${filename}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          // 让 html2canvas 内部克隆用桌面宽度评估媒体查询,
          // 这样手机上导出的也是双列 A4 版式,与电脑打印件一致
          windowWidth: desktopWidth,
          width: desktopWidth,
          scrollX: 0,
          scrollY: 0,
        },
        jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const, compress: true },
        // 只认 CSS 的 break-inside: avoid(页面里该保护的块已逐个标了),
        // 不用 avoid-all —— 那会把大段落整块顶到下一页,页底留出成片空白
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(clone)
      .save();
  } catch (e) {
    console.error('导出PDF失败:', e);
    toast.error('导出 PDF 失败,可以试试用「打印」保存');
    throw e;
  } finally {
    restoreColors();
    stage.remove();
  }
}
