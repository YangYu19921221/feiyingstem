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
  /** 串流端点的相对路径。前端不直接用它:播放要先 fetchVideoTicket 换票,再用票据里的 url */
  play_url: string;
  // 教师端列表额外带的字段
  is_active?: boolean;
  created_at?: string | null;
  /** 配了几份课件。列表上不显示的话,老师看不出哪个视频已经配过讲义 */
  material_count?: number;
  /** 平台预置(org_id 为空):机构只能看不能改,按钮要置灰 */
  is_preset?: boolean;
  can_edit?: boolean;
}

export interface PhoneticVideoPage {
  total: number;
  page: number;
  page_size: number;
  items: PhoneticVideo[];
}

/** 配套课件 — 教师端(带渲染状态,老师要能看出「传上去了但没渲染成」) */
export interface TeacherMaterial {
  id: number;
  video_id: number;
  title: string;
  /** pdf / ppt / pptx —— 存原始类型便于排查,PPT 在服务端已转成 PDF 渲染 */
  kind: string;
  page_count: number;
  render_ready: boolean;
  render_error?: string | null;
  file_size?: number | null;
  sort_order: number;
  is_active: boolean;
  /** 平台预置(org_id 为空):机构只能看不能改,按钮要置灰 */
  is_preset: boolean;
  can_edit: boolean;
}

/**
 * 配套课件 — 学生端。只给标题和页数,**拿不到原文件地址**。
 * (title 默认取上传文件名去掉后缀,老师可改 —— 它是给学生看的标题,不是文件路径)
 */
export interface StudentMaterial {
  id: number;
  title: string;
  page_count: number;
}

/** 短期播放票据:只对一个视频有效、两小时过期、拿它调任何 API 都是 401 */
export interface MediaTicket {
  /** `/api/v1/phonetics/videos/{id}/stream?t=...`,相对路径,用 mediaUrl() 拼绝对地址 */
  url: string;
  expires_at: number;
}

/**
 * 换一张播放票据。<video src> 是浏览器原生请求,**带不上 Authorization 头**,
 * 只能把凭证放 URL 上 —— 但放整站会话 token 等于谁抄走 URL 谁就拿走账号
 * (以前就是这么干的)。现在换成独立密钥签的短期票据:泄了也只能播这一个视频、
 * 两小时后作废、当 Bearer 用会直接签名失败。
 */
export const fetchVideoTicket = (videoId: number) =>
  api.get<MediaTicket>(`/phonetics/videos/${videoId}/ticket`);

/**
 * 相对媒体地址 → 绝对地址。后端给的是 `/api/v1/...`,生产同源没问题,
 * 但开发时前端 5173、后端另一个端口,相对路径会打到 dev server 上 500。
 */
export function mediaUrl(rel: string): string {
  if (rel.startsWith('http')) return rel;
  // API_BASE_URL 形如 http://host:port/api/v1
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  return `${origin}${rel}`;
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

  // ---- 配套课件(讲义 PDF / PPT)----

  listMaterials: (videoId: number) =>
    api.get<TeacherMaterial[]>(`/teacher/phonetics/videos/${videoId}/materials`),

  uploadMaterial: (
    videoId: number,
    file: File,
    title?: string,
    onProgress?: (percent: number) => void,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    if (title) fd.append('title', title);
    return api.post<TeacherMaterial>(
      `/teacher/phonetics/videos/${videoId}/materials`, fd,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
        // 上传完服务端还要转 PPT + 逐页渲染(几十页要几十秒),不能设超时
        timeout: 0,
      },
    );
  },

  updateMaterial: (id: number, body: Partial<{
    title: string; sort_order: number; is_active: boolean;
  }>) => api.put<TeacherMaterial>(`/teacher/phonetics/materials/${id}`, body),

  removeMaterial: (id: number) =>
    api.delete<void>(`/teacher/phonetics/materials/${id}`),
};

/** 学生端:某个视频的配套讲义(只列渲染好且上架的) */
export const listVideoMaterials = (videoId: number) =>
  api.get<StudentMaterial[]>(`/phonetics/videos/${videoId}/materials`);

/**
 * 取课件某一页的图,返回 object URL。
 *
 * 走 blob 而不是直接 <img src>:①能带 Authorization 头 ②不产生可分享的直链。
 * **用完必须 URL.revokeObjectURL** —— 翻几十页不释放会吃掉几百 MB。
 */
export async function fetchPhoneticMaterialPage(
  materialId: number,
  pageNo: number,
): Promise<string> {
  // 要拿原始 Blob,不能走被拦截器解包的默认路径,所以显式声明 responseType
  const blob = await api.get<Blob>(
    `/phonetics/materials/${materialId}/page/${pageNo}`,
    { responseType: 'blob', timeout: 30000 },
  );
  return URL.createObjectURL(blob);
}
