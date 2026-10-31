/**
 * 摄像头看在不在的当前状态(CameraPresence 写,usePresence 心跳读)。
 * active=false = 这个页面没开摄像头,心跳不带 no_face(服务器也就不会显示「看不到人」)。
 */
const state = { active: false, noFace: false };
const listeners = new Set<() => void>();

export const cameraPresenceStore = {
  get: () => state,
  set(next: Partial<typeof state>) {
    const changed = next.noFace !== undefined && next.noFace !== state.noFace;
    Object.assign(state, next);
    // 看不到人 / 人回来了: 马上补一次心跳,家长端的「现在」不用等下一个 15 秒
    if (changed) listeners.forEach(fn => fn());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
