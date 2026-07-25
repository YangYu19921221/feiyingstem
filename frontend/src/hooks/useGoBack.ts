import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * 安全返回上一页。
 *
 * 直接用 navigate(-1) 有个坑:当本页是这个标签页的第一个历史条目时(刷新、
 * 收藏夹/新标签直接打开、被 replace 跳转进来),没有上一页可回,点了没反应。
 * 这里用 history 长度 + location.key 判断能否真的后退,不能则回退到 fallback 路由。
 *
 * @param fallback 无法后退时要去的路由,默认学生首页
 */
export function useGoBack(fallback: string = '/student/dashboard') {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(() => {
    // location.key === 'default' 表示这是首个条目(React Router 未记录过跳转);
    // window.history.length <= 1 兜底覆盖部分浏览器/内嵌 WebView 的情况。
    const canGoBack = location.key !== 'default' && window.history.length > 1;
    if (canGoBack) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  }, [navigate, location.key, fallback]);
}

export default useGoBack;
