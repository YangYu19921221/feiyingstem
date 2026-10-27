/**
 * 音标视频走 CDN 的开关(2026-10-25)。规则见后端 services/cos_video.py
 *
 * 开着: 播放时跳 CDN 地址(media.feiyingsteam.com);关着: 跳 COS 签名地址(原来的方式)。
 * 打开前后端会先实测一次 CDN,测不过不让开;关闭随时可以。
 *
 * 10-27 加 COS 线路(cos): 走腾讯云 COS / 改回服务器本机播放。欠费时系统自动改回本机,充值后自动切回 COS;
 * 也能手动切(切回 COS 前先实测)。events 是最近几次切换,卡片上写「几点切回 COS 了」。
 */
import client from './client';

export interface VideoCdnState {
  enabled: boolean;
  updated_at: string | null;
  updated_by: string | null;
  /** 系统自动关闭时的原因(CDN 连续测不通);手动开关为 null */
  auto_off_reason: string | null;
  cdn_domain: string | null;
  cdn_configured: boolean;
  cos_configured: boolean;
  /** off = COS 跳转没开,视频全从服务器本机放,这个开关不起作用 */
  redirect_mode: 'all' | 'some' | 'off';
  video_dir_exists: boolean;
  message?: string | null;
  cos: VideoCosState;
}

export interface VideoCosEvent { at: string; enabled: boolean; by: string | null; auto: boolean; reason: string | null }
export interface VideoCosState {
  /** file = 管理端开关在管;env = 还没用过开关,照旧看服务器 .env */
  source: 'file' | 'env';
  /** true = 学生看视频走腾讯云 COS;false = 从服务器本机播放 */
  enabled: boolean;
  updated_at: string | null;
  updated_by: string | null;
  /** 系统自动切的(欠费自动改回本机 / 恢复后自动切回) */
  auto: boolean;
  reason: string | null;
  /** 最近几次切换,新的在前 */
  events: VideoCosEvent[];
  /** 最近一次自动检查 */
  last_check: { at: string; ok: boolean; message: string } | null;
}

export const getVideoCdn = () => client.get<VideoCdnState>('/admin/system/video-cdn');

export const setVideoCdn = (enabled: boolean) =>
  client.put<VideoCdnState>('/admin/system/video-cdn', { enabled }, { timeout: 30000 });

export const setVideoCos = (enabled: boolean) =>
  client.put<VideoCdnState>('/admin/system/video-cos', { enabled }, { timeout: 30000 });

export const testVideoCos = () =>
  client.post<{ ok: boolean; message: string }>('/admin/system/video-cos/test', undefined, { timeout: 30000 });

export const testVideoCdn = () =>
  client.post<{ ok: boolean; message: string }>('/admin/system/video-cdn/test', undefined, { timeout: 30000 });
