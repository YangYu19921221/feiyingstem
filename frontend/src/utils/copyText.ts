import { toast } from '../components/Toast';

/** 复制文字。微信内置浏览器常不给剪贴板权限: 退回系统输入框,长按全选复制 */
export async function copyText(text: string, okMsg = '已复制'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMsg);
  } catch {
    window.prompt('长按下面的文字复制', text);
  }
}
