/**
 * 音标视频走 CDN 的开关(2026-10-25)。规则见后端 services/cos_video.py
 *
 * 开着: 播放时跳 CDN 地址(media.feiyingsteam.com);关着: 跳 COS 签名地址(原来的方式)。
 * 打开前后端会先实测一次 CDN,测不过不让开;关闭随时可以。
 */
import client from './client';

export interface VideoCdnState {
  enabled: boolean;
  updated_at: string | null;
  updated_by: string | null;
  cdn_domain: string | null;
  cdn_configured: boolean;
  cos_configured: boolean;
  /** off = COS 跳转没开,视频全从服务器本机放,这个开关不起作用 */
  redirect_mode: 'all' | 'some' | 'off';
  video_dir_exists: boolean;
  message?: string | null;
}

export const getVideoCdn = () => client.get<VideoCdnState>('/admin/system/video-cdn');

export const setVideoCdn = (enabled: boolean) =>
  client.put<VideoCdnState>('/admin/system/video-cdn', { enabled }, { timeout: 30000 });

export const testVideoCdn = () =>
  client.post<{ ok: boolean; message: string }>('/admin/system/video-cdn/test', undefined, { timeout: 30000 });
