/**
 * 把后端错误响应安全转成可显示的字符串。
 *
 * 关键背景：FastAPI 验证失败（422）时返回的 detail 是数组：
 *   [{ type, loc, msg, input, ctx }, ...]
 * 直接 setError(detail) 后渲染 {error} 会触发 React #31（对象不能作为 children）。
 *
 * 业务异常（HTTPException）的 detail 是字符串，正常显示即可。
 */
export function getErrorMessage(error: unknown, fallback = '操作失败'): string {
  const detail = (error as any)?.response?.data?.detail;

  if (typeof detail === 'string' && detail.trim()) return detail;

  if (Array.isArray(detail)) {
    // FastAPI 422 校验错误数组
    const msgs = detail
      .map((d: any) => {
        if (typeof d === 'string') return d;
        if (d && typeof d === 'object' && typeof d.msg === 'string') {
          // 取出字段路径方便定位（loc 通常是 ['body', 'phone'] 这样的数组）
          const field = Array.isArray(d.loc) ? d.loc.slice(-1)[0] : '';
          return field ? `${field}: ${d.msg}` : d.msg;
        }
        return '';
      })
      .filter(Boolean);
    if (msgs.length) return msgs.join('；');
  }

  if (typeof detail === 'object' && detail !== null) {
    if (typeof (detail as any).msg === 'string') return (detail as any).msg;
  }

  if (typeof (error as any)?.message === 'string') return (error as any).message;

  return fallback;
}
