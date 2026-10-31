/**
 * 每日签到(2026-10-31): 签到才能做作业,小鹰老师排的每一步也要先签到。
 * 后端拦截在 api/v1/checkin.require_checkin(作业开始 / 再来一份),学习入口 /units/{id}/start 本来就拦。
 * 这里给首页、作业页、小鹰老师那张卡共用: 查今天签没签、签到、认出后端的 need_checkin。
 */
import apiClient from '../api/client';
import { getErrorCode } from './errorMessage';

export interface CheckinState {
  checked_in: boolean;
  checkin_time: string | null;
}

export const getTodayCheckin = () => apiClient.get<CheckinState>('/student/checkin/today');

export const checkInToday = () =>
  apiClient.post<CheckinState & { already?: boolean; autopilot?: string | null }>('/student/checkin', {});

/** 后端说「今天还没签到」(作业开始 / 再来一份 回的 need_checkin;学习入口那句老文案也认) */
export function isNeedCheckin(error: unknown): boolean {
  if (getErrorCode(error) === 'need_checkin') return true;
  const d = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' && d.includes('签到');
}

export const NEED_CHECKIN_TIP = '今天还没签到,签到后才能做作业';
