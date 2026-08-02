import api from './client';
import { API_BASE_URL } from '../config/env';

/** 音标视频分类:学生端按这个顺序分组展示 */
export type PhoneticCategory = 'basic' | 'vowel' | 'consonant' | 'other';

export const CATEGORY_LABELS: Record<PhoneticCategory, string> = {
  basic: '入门总览',
  vowel: '元音',
  consonant: '辅音',
  other: '其他',
};

export interface PhoneticVideo {
  id: number;
  title: string;
  description?: string | null;
  phonetic_symbol?: string | null;
  category: PhoneticCategory;
  category_label: string;
  cover_image?: string | null;
  duration_seconds?: number | null;
  file_size?: number | null;
  view_count: number;
  /** 播放地址:鉴权串流端点(需带 token,见 playableUrl) */
  play_url: string;
  // 教师端列表额外带的字段
  is_active?: boolean;
  created_at?: string | null;
}

export interface PhoneticVideoPage {
  total: number;
  page: number;
  page_size: number;
  items: PhoneticVideo[];
}

/**
 * 拼出 <video> 能用的播放地址。
 *
 * 两个要点:
 * 1. token 放 query 上 —— <video src> 是浏览器原生请求,**带不上 Authorization 头**
 *    (也不过 axios 拦截器),鉴权串流只能这样取。
 * 2. 必须拼成**绝对地址**(API_BASE_URL):后端给的 play_url 是 `/api/v1/...` 相对路径,
 *    生产同源没问题,但开发时前端 5173、后端另一个端口,相对路径会打到 dev server 上 500。
 */
export function playableUrl(v: PhoneticVideo): string {
  const token = localStorage.getItem('access_token') || '';
  // API_BASE_URL 形如 http://host:port/api/v1;play_url 形如 /api/v1/phonetics/...
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  const abs = v.play_url.startsWith('http') ? v.play_url : `${origin}${v.play_url}`;
  const sep = abs.includes('?') ? '&' : '?';
  return `${abs}${sep}token=${encodeURIComponent(token)}`;
}

/** 人类可读的文件大小 */
export function formatSize(bytes?: number | null): string {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export const phoneticsApi = {
  // ---- 学生端 ----
  list: (params?: { category?: string; q?: string }) =>
    api.get<PhoneticVideo[]>('/phonetics/videos', { params }),
  detail: (id: number) => api.get<PhoneticVideo>(`/phonetics/videos/${id}`),

  // ---- 教师端 ----
  teacherList: (params: { q?: string; category?: string; page: number; page_size: number }) =>
    api.get<PhoneticVideoPage>('/teacher/phonetics/videos', { params }),

  /** 上传视频。不传 title 时后端默认用文件名(去扩展名) */
  upload: (
    file: File,
    meta: { title?: string; description?: string; phonetic_symbol?: string; category?: string; sort_order?: number },
    onProgress?: (percent: number) => void,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    if (meta.title) fd.append('title', meta.title);
    if (meta.description) fd.append('description', meta.description);
    if (meta.phonetic_symbol) fd.append('phonetic_symbol', meta.phonetic_symbol);
    fd.append('category', meta.category || 'basic');
    fd.append('sort_order', String(meta.sort_order ?? 0));
    return api.post<PhoneticVideo>('/teacher/phonetics/videos/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // 视频大,必须给进度条:否则老师以为页面卡死会反复点
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
      timeout: 0,  // 大文件上传不设超时
    });
  },


  update: (id: number, body: Partial<{
    title: string; description: string; phonetic_symbol: string;
    category: string; sort_order: number; is_active: boolean;
  }>) => api.put<PhoneticVideo>(`/teacher/phonetics/videos/${id}`, body),

  remove: (id: number) => api.delete<void>(`/teacher/phonetics/videos/${id}`),

  /** 批量删除(勾选多条)。走 POST:DELETE 带 body 会被某些代理丢掉 */
  batchRemove: (ids: number[]) =>
    api.post<{ deleted: number; requested: number }>('/teacher/phonetics/videos/batch-delete', { ids }),
};
