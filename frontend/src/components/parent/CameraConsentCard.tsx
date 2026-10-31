/**
 * 家长端: 用摄像头看孩子在不在座位前 —— 先看说明(后端给的告知),勾同意才能打开;随时能关、能删记录。
 * 规则真源 backend services/focus_watch.py 第 2、3、4 条。
 */
import { useEffect, useState } from 'react';
import { focusWatchApi, type CameraConsentInfo, type CameraNotice } from '../../api/focusWatch';
import { toast } from '../Toast';

export default function CameraConsentCard({ studentId, childName }: { studentId: number; childName: string }) {
  const [consent, setConsent] = useState<CameraConsentInfo | null>(null);
  const [notice, setNotice] = useState<CameraNotice | null>(null);
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setConsent(null); setNotice(null); setAgree(false); setOpen(false);
    focusWatchApi.camera(studentId)
      .then(r => { setConsent(r.consent); setNotice(r.notice); })
      .catch(() => {});
  }, [studentId]);

  if (!notice) return null;
  const on = consent?.status === 'granted';

  const save = async (enabled: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await focusWatchApi.setCamera(studentId, enabled, agree);
      setConsent(r.consent);
      setAgree(false);
      toast(enabled ? '已打开。孩子下次打开学习页面时会用上' : '已关掉,孩子的学习页面不会再开摄像头', 'success');
    } catch {
      toast('没保存成功,请稍后再试', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeRecords = async () => {
    if (!window.confirm('删掉摄像头记下的所有「离开座位」记录?切屏记录不受影响。')) return;
    try {
      const r = await focusWatchApi.deleteCameraRecords(studentId);
      toast(`已删掉 ${r.deleted} 条`, 'success');
    } catch {
      toast('没删成功,请稍后再试', 'error');
    }
  };

  return (
    <section className="card-soft mb-6 rounded-2xl p-5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 text-left"
        aria-expanded={open}
      >
        <span className="text-2xl" aria-hidden>📷</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">用摄像头看{childName}在不在座位前</span>
          <span className="mt-0.5 block text-xs text-ink-mute">
            {on
              ? `已打开(${consent?.granted_by_name || ''} ${consent?.granted_at || ''})`
              : '没打开。打开后孩子离开座位会被提醒,您也能看到离开了几次'}
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${on ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {on ? '开着' : '关着'}
        </span>
      </button>

      {open && (
        <div className="mt-4 border-t border-black/[0.06] pt-4">
          <dl className="space-y-2.5">
            {notice.sections.map(s => (
              <div key={s.h}>
                <dt className="text-sm font-semibold text-ink">{s.h}</dt>
                <dd className="mt-0.5 text-sm leading-6 text-ink-soft">{s.p}</dd>
              </div>
            ))}
          </dl>
          {on ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => save(false)}
                disabled={saving}
                className="min-h-11 rounded-xl bg-gray-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                关掉摄像头
              </button>
              <button
                type="button"
                onClick={removeRecords}
                className="min-h-11 rounded-xl border border-gray-300 bg-white px-4 text-sm text-ink-soft"
              >
                删掉摄像头的离开记录
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={agree}
                  onChange={e => setAgree(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span>我是{childName}的父母或其他监护人,看过上面的说明,同意打开。</span>
              </label>
              <button
                type="button"
                onClick={() => save(true)}
                disabled={!agree || saving}
                className="mt-3 min-h-11 rounded-xl bg-accent-warm px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                同意并打开
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
