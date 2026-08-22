/**
 * 线上授课 API ——
 * 教师开播推流、课件上传(带水印渲染);学生进直播间拿播放地址、心跳打卡、看课件
 */
import api from './client';

// ========================================
// 类型
// ========================================

/** 教师侧直播会话(课堂) */
export interface TeacherLiveSession {
  id: number;
  title: string;
  description?: string | null;
  status: 'created' | 'live' | 'ended';
  scheduled_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  teacher_id: number;
  class_id?: number | null;
  replay_url?: string | null;
}

/** 学生侧看到的直播会话 */
export interface StudentLiveSession {
  id: number;
  title: string;
  description?: string | null;
  status: 'created' | 'live' | 'ended';
  scheduled_at?: string | null;
  teacher_name?: string | null;
  replay_available: boolean;
  replay_duration?: number | null;
}

/** 推流凭据(老师开播时服务端签发) */
export interface PushCredentials {
  session_id: number;
  whip_url: string;
  rtmp_url: string;
  stream_key: string;
  expires_at: number;
}

/** 播放地址(学生进直播间时服务端签发) */
export interface PlayUrls {
  flv: string;
  hls: string;
  webrtc: string;
}

/** 学生进间响应 */
export interface StudentJoinResponse {
  session_id: number;
  title: string;
  flv_url: string;
  hls_url: string;
  webrtc_url: string;
  expires_at: number;
  watermark: string;
}

/** 教师侧课件 */
export interface TeacherMaterial {
  id: number;
  title: string;
  kind: 'pdf' | 'image';
  page_count: number | null;
  render_ready: boolean;
  render_error?: string | null;
  is_published: boolean;
  file_size?: number | null;
  live_session_id?: number | null;
  uploader_id?: number | null;
  /** 后端算好的可操作标记(与服务端 guard 同源)。false 时灰掉发布/删除,
   *  别让老师点了才吃 403 —— 同机构课件列得出但只有上传者能动 */
  can_edit?: boolean;
}

/** 学生侧课件(不含任何原文件路径) */
export interface StudentMaterial {
  id: number;
  title: string;
  kind: 'pdf' | 'image';
  page_count: number;
  live_session_id: number | null;
}

/** 考勤一行 */
export interface AttendanceRecord {
  student_id: number;
  name: string;
  first_join_at?: string | null;
  watch_seconds: number;
  replay_seconds: number;
  blur_count: number;
}

/** 直播开通状态 */
export interface LiveConfig {
  enabled: boolean;
  watermark_text: string;
}

// ========================================
// 教师端
// ========================================
//
// ⚠️ client.ts 的响应拦截器已经 `return response.data`,
// 所以这里**直接 return api.get(...),不要再解 { data }** ——
// 二次解包会拿到 undefined,页面上表现为"连接服务器失败"而后端明明是 200。

export const liveApi = {
  /** 直播是否已开通(未配源站时前端隐藏入口) */
  getConfig: (): Promise<LiveConfig> =>
    api.get<LiveConfig>('/teacher/live/config'),

  listSessions: (status?: string): Promise<TeacherLiveSession[]> =>
    api.get<TeacherLiveSession[]>('/teacher/live/sessions', {
      params: status ? { status } : {},
    }),

  createSession: (payload: {
    title: string;
    description?: string;
    scheduled_at?: string | null;
    class_id?: number | null;
  }): Promise<TeacherLiveSession> =>
    api.post<TeacherLiveSession>('/teacher/live/sessions', payload),

  /** 开播,拿推流凭据。**凭据不要存进 state/localStorage** */
  startSession: (id: number): Promise<PushCredentials> =>
    api.post<PushCredentials>(`/teacher/live/sessions/${id}/start`),

  endSession: (id: number): Promise<{ ok: boolean }> =>
    api.post<{ ok: boolean }>(`/teacher/live/sessions/${id}/end`),

  deleteSession: (id: number): Promise<{ ok: boolean }> =>
    api.delete<{ ok: boolean }>(`/teacher/live/sessions/${id}`),

  getAttendance: (id: number): Promise<AttendanceRecord[]> =>
    api.get<AttendanceRecord[]>(`/teacher/live/sessions/${id}/attendance`),

  listMaterials: (sessionId?: number): Promise<TeacherMaterial[]> =>
    api.get<TeacherMaterial[]>('/teacher/live/materials', {
      params: sessionId != null ? { session_id: sessionId } : {},
    }),

  /**
   * 上传课件。**不要写死 Content-Type** —— 见 client.ts 注释,
   * 写死会把 FormData 序列化成 JSON,后端 UploadFile 收不到文件 → 422。
   * 留空让浏览器自己带 multipart 边界。
   */
  uploadMaterial: (
    file: File,
    opts: { title: string; session_id?: number | null; class_id?: number | null },
    onProgress?: (pct: number) => void
  ): Promise<TeacherMaterial> => {
    const form = new FormData();
    form.append('file', file);
    form.append('title', opts.title);
    if (opts.session_id != null) form.append('session_id', String(opts.session_id));
    if (opts.class_id != null) form.append('class_id', String(opts.class_id));
    return api.post<TeacherMaterial>('/teacher/live/materials', form, {
      // 课件可能上百 MB,默认 10s 超时不够
      timeout: 300000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  },

  publishMaterial: (id: number, isPublished: boolean): Promise<TeacherMaterial> => {
    const form = new FormData();
    form.append('is_published', String(isPublished));
    return api.post<TeacherMaterial>(`/teacher/live/materials/${id}/publish`, form);
  },

  deleteMaterial: (id: number): Promise<{ ok: boolean }> =>
    api.delete<{ ok: boolean }>(`/teacher/live/materials/${id}`),
};

// ========================================
// 学生端
// ========================================

export const studentLiveApi = {
  listSessions: (): Promise<StudentLiveSession[]> =>
    api.get<StudentLiveSession[]>('/student/live/sessions'),

  /** 进直播间。老师没开播时后端回 409,调用方要接住给"还没开始"的提示 */
  join: (id: number): Promise<StudentJoinResponse> =>
    api.post<StudentJoinResponse>(`/student/live/sessions/${id}/join`),

  /** 观看心跳。服务端对单次增量封顶,前端改数字刷不出时长 */
  heartbeat: (
    id: number,
    payload: { seconds: number; blurred?: boolean; is_replay?: boolean }
  ): Promise<{ ok: boolean }> =>
    api.post<{ ok: boolean }>(`/student/live/sessions/${id}/heartbeat`, payload),

  listMaterials: (sessionId?: number): Promise<StudentMaterial[]> =>
    api.get<StudentMaterial[]>('/student/live/materials', {
      params: sessionId != null ? { session_id: sessionId } : {},
    }),
};

/**
 * 取课件某页的水印图,返回 objectURL。
 *
 * 走 blob 而不是直接 <img src>:①能带 Authorization 头 ②不产生可分享的直链。
 * **用完必须 URL.revokeObjectURL** —— 翻几十页不释放会吃掉几百 MB。
 */
export async function fetchMaterialPage(
  materialId: number,
  pageNo: number
): Promise<string> {
  // 这里要拿原始 Blob,不能走上面被拦截器解包的 api 包装,所以显式声明 responseType
  const blob = await api.get<Blob>(
    `/student/live/materials/${materialId}/page/${pageNo}`,
    { responseType: 'blob', timeout: 30000 }
  );
  return URL.createObjectURL(blob);
}