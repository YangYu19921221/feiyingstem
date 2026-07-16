/**
 * 直播打码模式 - 未成年人隐私保护
 * 直播镜头对着大屏/排行榜时,学生全名 → "杨同学",开关持久化在本机(投屏设备开一次即可)。
 * 合规依据: 未成年人出镜/姓名公开展示需家长授权,直播场景一律打码兜底。
 */

const KEY = 'live_privacy_mode';

// 常见复姓,打码时保留完整姓氏("欧阳同学"而不是"欧同学")
const COMPOUND_SURNAMES = [
  '欧阳', '司马', '上官', '诸葛', '慕容', '司徒', '令狐', '皇甫',
  '长孙', '宇文', '东方', '尉迟', '公孙', '夏侯', '申屠', '呼延', '轩辕',
];

export const isLivePrivacyOn = (): boolean => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
};

export const setLivePrivacy = (on: boolean): void => {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 隐私模式失败不阻塞页面 */ }
};

/** 全名 → "杨同学";拼音/英文名取首字母("W同学");空名兜底"同学" */
export const maskName = (name?: string | null): string => {
  const n = (name || '').trim();
  if (!n) return '同学';
  if (/[一-龥]/.test(n)) {
    const compound = COMPOUND_SURNAMES.find(s => n.startsWith(s));
    return `${compound || n[0]}同学`;
  }
  return `${n[0].toUpperCase()}同学`;
};
