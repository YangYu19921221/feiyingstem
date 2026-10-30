import { useEffect } from 'react';
import { classroomNetApi } from '../api/classroomNet';
import { clearClassroomDeviceKey, getClassroomDeviceKey } from '../utils/classroomDevice';
import { getErrorCode } from '../utils/errorMessage';

const EVERY_MS = 5 * 60 * 1000;

/**
 * 电教室电脑报到(2026-10-30)。只在登记过的电脑上做事(本机存着设备码),别的设备什么都不发。
 *
 * 为什么要单独报到: 学校出网 IP 几天一换,电教室电脑哪怕停在登录页、没人登录,
 * 也要把新 IP 报上去,这样同一网络的学生平板才认得出是在电教室。
 * 开页面报一次,之后每 5 分钟一次(页面在后台时不报)。后端说这台已被移除 → 删掉本机的设备码。
 */
export default function ClassroomPing() {
  useEffect(() => {
    if (!getClassroomDeviceKey()) return;
    let alive = true;
    const beat = () => {
      if (!alive || document.visibilityState === 'hidden' || !getClassroomDeviceKey()) return;
      classroomNetApi.ping().catch((e) => {
        if (getErrorCode(e) === 'device_gone') clearClassroomDeviceKey();
      });
    };
    beat();
    const t = window.setInterval(beat, EVERY_MS);
    const onVis = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return null;
}
