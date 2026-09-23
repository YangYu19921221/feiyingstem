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

/** 「全校通用」在筛选状态里的取值。空串已被「全部」占用,所以另用一个哨兵值 */
export const NO_LECTURER = ' none';

export interface PhoneticVideo {
  id: number;
  title: string;
  description?: string | null;
  phonetic_symbol?: string | null;
  category: PhoneticCategory;
  category_label: string;
  /**
   * 讲师姓名 —— **自由文本,不是系统里的教师账号**(讲课的常是外聘老师/助教)。
   * null / 空 = 不归属任何讲师 = 学生端的「全校通用」。
   * 学生端按这个字符串分组,归一在后端写入时做(services/lecturer_name),
   * 前端不再洗一遍 —— 两处各洗一遍会算出不同的分组。
   */
  lecturer?: string | null;
  cover_image?: string | null;
  duration_seconds?: number | null;
  file_size?: number | null;
  /**
   * ⚠️ **这是打开次数,不是人数**(每次打开详情 +1,同一个学生刷十次就是 10)。
   * 要显示「多少人」一律用 `viewers` —— 拿这个字段配「人」字就是一句假话。
   * 名字在生产用着不好改,所以把警告留在这里。
   */
  view_count: number;

  // ===== 观看统计(2026-09-23)。口径真源 backend/app/services/video_watch.py =====
  /** 看过的**人**数(去重;只数本机构的人) */
  viewers?: number;
  /** 此刻还在看的人数(90 秒内有心跳) */
  watching_now?: number;
  /** 我上次停在哪(秒)—— **续播用这个** */
  my_position_seconds?: number;
  /**
   * 我看到过的最远处(秒)—— **显示「看到几成」用这个**。
   * 拿 my_position_seconds 去显示进度的话,孩子看完后往回拖一下再退出,
   * 卡片就会显示「看到 5%」
   */
  my_max_position_seconds?: number;
  my_watch_seconds?: number;
  my_completed?: boolean;

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
  // 教师端统计列
  /** 打开次数(所有人相加)。与 viewers 是「次」和「人」的区别 */
  plays?: number;
  completed_count?: number;
  /**
   * 完看率 0~1。**null = 还没有人看过,界面必须显示「—」不能显示 0%** ——
   * 「还没人看」和「看了但没人看完」是两句不同的话,后者才该去找学生谈
   */
  completion_rate?: number | null;
  avg_watch_seconds?: number;
  viewers_today?: number;
}

/** 一个学生在某个视频上的观看情况(教师端名单) */
export interface VideoViewer {
  student_id: number;
  name: string;
  play_count: number;
  watch_seconds: number;
  max_position_seconds: number;
  completed: boolean;
  watching_now: boolean;
  last_viewed_at?: string | null;
}

export interface VideoViewerReport {
  video_id: number;
  title: string;
  duration_seconds?: number | null;
  /** my_classes = 只统计我班上的学生;all = 平台 admin 看全部 */
  scope: 'my_classes' | 'all';
  /** 我班上有多少学生(admin 为 null:没有班级范围) */
  roster_size?: number | null;
  stats: {
    viewers: number;
    plays: number;
    completed: number;
    completion_rate: number | null;
    avg_watch_seconds: number;
    total_watch_seconds: number;
    watching_now: number;
    viewers_today: number;
  };
  watched: VideoViewer[];
  /**
   * 还没看的学生。**null = 算不出**(admin 没有班级范围),
   * 空数组 = 确实所有人都看了 —— 两者在界面上必须是两句不同的话
   */
  not_watched: { student_id: number; name: string }[] | null;
}

export interface PhoneticVideoPage {
  total: number;
  page: number;
  page_size: number;
  items: PhoneticVideo[];
}

/** 一位讲师 + 名下视频数(教师端:含已下架的) */
export interface LecturerStat {
  name: string;
  video_count: number;
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

/** 心跳周期(秒)。**与后端 video_watch.HEARTBEAT_SEC 同值** —— 后端拿它算
 * 「还算在看吗」的窗口(3 倍周期),这边调快了那个数就会一直闪 */
export const WATCH_HEARTBEAT_SEC = 30;

export const phoneticsApi = {
  // ---- 学生端 ----
  list: (params?: { category?: string; q?: string }) =>
    api.get<PhoneticVideo[]>('/phonetics/videos', { params }),
  detail: (id: number) => api.get<PhoneticVideo>(`/phonetics/videos/${id}`),

  /**
   * 上报观看进度。播放中每 WATCH_HEARTBEAT_SEC 一次 + 暂停/离开时补一次。
   *
   * `seconds` 报的是**真的在播的秒数**(暂停不算),服务端还会再封顶一次 ——
   * 所以这个数不必也不该由前端"算准",它只是个上限内的申报。
   * 失败一律静默:统计不重要到可以打断孩子看视频(网络抖一下弹个红条很蠢)。
   */
  reportProgress: (
    id: number,
    body: { seconds: number; position: number; duration?: number | null },
  ) => api.post<{ ok: boolean; counted: boolean; watch_seconds: number; completed: boolean }>(
    `/phonetics/videos/${id}/progress`, body),

  // ---- 教师端 ----
  teacherList: (params: {
    q?: string; category?: string;
    /** 精确筛讲师;NO_LECTURER = 只看未指定讲师的(补归属时用) */
    lecturer?: string;
    page: number; page_size: number;
  }) => api.get<PhoneticVideoPage>('/teacher/phonetics/videos', { params }),

  /** 上传视频。不传 title 时后端默认用文件名(去扩展名) */
  upload: (
    file: File,
    meta: {
      title?: string; description?: string; phonetic_symbol?: string;
      category?: string; lecturer?: string; sort_order?: number;
    },
    onProgress?: (percent: number) => void,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    if (meta.title) fd.append('title', meta.title);
    if (meta.description) fd.append('description', meta.description);
    if (meta.phonetic_symbol) fd.append('phonetic_symbol', meta.phonetic_symbol);
    fd.append('category', meta.category || 'basic');
    // 讲师留空就不传(后端存 NULL = 全校通用),别传空串上去当"改成空"
    if (meta.lecturer?.trim()) fd.append('lecturer', meta.lecturer.trim());
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
    category: string;
    /** 讲师姓名。**传空串 = 取消归属改回「全校通用」**(有意义的操作,不是"没填") */
    lecturer: string;
    sort_order: number; is_active: boolean;
  }>) => api.put<PhoneticVideo>(`/teacher/phonetics/videos/${id}`, body),

  /**
   * 本机构已有的讲师名单(上传时自动补全 / 批量设讲师的候选)。
   * 由现有视频聚合而来,不是 users 表 —— 讲师是自由文本,可能是没有账号的外聘老师。
   */
  lecturers: () => api.get<LecturerStat[]>('/teacher/phonetics/lecturers'),

  /**
   * 某个视频的观看名单 —— 谁看了、看了多久,以及**谁还没看**。
   * 后者才是老师真正要的动作项:聚合数字只说"8 个人看了",
   * 他要做的是把没看的那几个点出来催一下。
   */
  viewers: (id: number) =>
    api.get<VideoViewerReport>(`/teacher/phonetics/videos/${id}/viewers`),

  /**
   * 批量设讲师(勾选多条一起改)。存量视频讲师全是空的,靠这个补归属,
   * 否则老师得逐个点「编辑」改几十遍。传空串 = 整批改回「全校通用」。
   */
  batchSetLecturer: (ids: number[], lecturer: string) =>
    api.post<{ updated: number; requested: number; lecturer: string | null }>(
      '/teacher/phonetics/videos/batch-lecturer', { ids, lecturer }),

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
