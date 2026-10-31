/**
 * 离开记录 / 摄像头看在不在 / 家长「今天」(2026-10-31)
 * 规则真源 backend services/focus_watch.py 文件头;告知文字也由后端给(家长端和纸质同意书同一份)。
 */
import client from './client';

export interface AwayEpisode { at: string; minutes: number; seconds: number }
export interface AwayPart {
  count: number;
  minutes: number;
  seconds: number;
  longest_minutes: number;
  longest_seconds: number;
  episodes: AwayEpisode[];
}

/** 离开时长: 不满 1 分钟写秒(8 秒写成「1 分钟」会夸大) */
export const fmtAway = (seconds: number) =>
  seconds < 60 ? `${Math.max(1, Math.round(seconds))} 秒` : `${Math.round(seconds / 60)} 分钟`;

export interface CameraConsentInfo {
  status: 'granted' | 'revoked';
  method: 'parent' | 'paper';
  granted_by_name: string | null;
  granted_at: string | null;
  revoked_by_name: string | null;
  revoked_at: string | null;
}

export type CameraStatus = 'on' | 'denied' | 'unavailable' | 'error';

export interface LiveStatus {
  status: 'studying' | 'distracted' | 'away';
  unit_name: string | null;
  away_seconds: number;
  no_face: boolean;
  last_seen_ago: number;
}

export interface ParentToday {
  date: string;
  tasks_total: number;
  tasks_done: number;
  all_done: boolean;
  tasks: { title: string; status: string; completed_time: string | null; is_today: boolean }[];
  study_minutes: number;
  words_learned: number;
  switch: AwayPart;
  no_face: AwayPart;
  distracted_count: number;
  stuck_words: { word: string; seconds: number; outcome: 'correct' | 'wrong' | 'gave_up' }[];
  camera: { consent: CameraConsentInfo | null; active: boolean; status_today: CameraStatus | null };
  live: LiveStatus | null;
}

export interface CameraNotice {
  version: string;
  title: string;
  sections: { h: string; p: string }[];
}

export const focusWatchApi = {
  // 学生
  myCamera: (): Promise<{ enabled: boolean; no_face_ms: number }> =>
    client.get('/student/presence/camera'),
  reportCameraStatus: (status: CameraStatus): Promise<{ ok: boolean }> =>
    client.post('/student/presence/camera-status', { status }),

  // 家长
  today: (studentId: number): Promise<ParentToday> =>
    client.get(`/parent/children/${studentId}/today`),
  camera: (studentId: number): Promise<{ consent: CameraConsentInfo | null; notice: CameraNotice }> =>
    client.get(`/parent/children/${studentId}/camera`),
  setCamera: (studentId: number, enabled: boolean, agree = false): Promise<{ consent: CameraConsentInfo | null }> =>
    client.put(`/parent/children/${studentId}/camera`, { enabled, agree }),
  deleteCameraRecords: (studentId: number): Promise<{ deleted: number }> =>
    client.delete(`/parent/children/${studentId}/camera/records`),

  // 老师
  teacherSetCamera: (studentId: number, enabled: boolean, paperSigned = false): Promise<{ consent: CameraConsentInfo | null }> =>
    client.put(`/teacher/camera-consents/${studentId}`, { enabled, paper_signed: paperSigned }),
  teacherNotice: (): Promise<CameraNotice> =>
    client.get('/teacher/camera-consent-notice'),
};
