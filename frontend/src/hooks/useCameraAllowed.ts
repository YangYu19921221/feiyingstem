/**
 * 家长同意了用摄像头看孩子在不在没有(GET /student/presence/camera)。
 * 按账号缓存 10 分钟(sessionStorage): 学习页来回切不用每次都问;家长关掉后最多 10 分钟内生效,
 * 重新打开学习页(刷新)马上生效。只有学生才问,老师备课进学习页不开摄像头。
 */
import { useEffect, useState } from 'react';
import { focusWatchApi } from '../api/focusWatch';

const TTL_MS = 10 * 60 * 1000;

function currentStudentId(): number | null {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return u && u.role === 'student' && typeof u.id === 'number' ? u.id : null;
  } catch {
    return null;
  }
}

function readCache(uid: number | null): boolean | null {
  if (uid === null) return null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(`eh_camera_allowed_${uid}`) || 'null');
    if (cached && Date.now() - cached.at < TTL_MS) return !!cached.enabled;
  } catch { /* 缓存坏了就重新问 */ }
  return null;
}

export function useCameraAllowed(): boolean {
  const [uid] = useState(currentStudentId);
  const [cached] = useState(() => readCache(uid));
  const [fetched, setFetched] = useState<boolean | null>(null);
  useEffect(() => {
    if (uid === null || cached !== null) return;
    let alive = true;
    focusWatchApi.myCamera()
      .then(r => {
        sessionStorage.setItem(`eh_camera_allowed_${uid}`, JSON.stringify({ enabled: !!r.enabled, at: Date.now() }));
        if (alive) setFetched(!!r.enabled);
      })
      .catch(() => { /* 问不到就不开 */ });
    return () => { alive = false; };
  }, [uid, cached]);
  return (cached ?? fetched) === true;
}
