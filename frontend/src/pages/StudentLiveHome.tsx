/**
 * 学生端 - 线上课堂首页
 *
 * 一页两块:正在/即将上的直播课 + 可看的课件资料。
 * 这是学生进入直播和课件的**唯一入口**,首页 quickTools 第一张卡指到这里。
 *
 * 直播中的课要一眼看出来(红点 + 排最前),否则孩子进来不知道现在能不能看。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  studentLiveApi,
  type StudentLiveSession,
  type StudentMaterial,
} from '../api/live';

export default function StudentLiveHome() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<StudentLiveSession[]>([]);
  const [materials, setMaterials] = useState<StudentMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      studentLiveApi.listSessions().catch(() => [] as StudentLiveSession[]),
      studentLiveApi.listMaterials().catch(() => [] as StudentMaterial[]),
    ])
      .then(([s, m]) => { setSessions(s); setMaterials(m); })
      .catch(() => setErr('加载失败,请下拉刷新重试'))
      .finally(() => setLoading(false));
  }, []);

  const fmtTime = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const living = sessions.filter((s) => s.status === 'live');
  const upcoming = sessions.filter((s) => s.status === 'created');
  const replayable = sessions.filter((s) => s.status === 'ended' && s.replay_available);

  return (
    <div className="min-h-screen bg-[#FFF8F0] pb-24">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/student/dashboard')} className="text-2xl" aria-label="返回">
            ⬅️
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">📺 线上课堂</h1>
            <p className="text-sm text-gray-500 mt-0.5">老师的直播课和课件都在这里</p>
          </div>
        </div>

        {loading && (
          <div className="bg-white rounded-2xl p-10 text-center shadow">
            <div className="text-4xl mb-2 animate-bounce">📺</div>
            <p className="text-gray-500 text-sm">加载中…</p>
          </div>
        )}

        {!loading && err && (
          <div className="bg-white rounded-2xl p-8 text-center shadow">
            <div className="text-4xl mb-2">😕</div>
            <p className="text-gray-600 mb-4">{err}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold"
            >
              重试
            </button>
          </div>
        )}

        {!loading && !err && (
          <>
            {/* 正在直播 —— 必须最显眼 */}
            {living.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-bold text-gray-500 mb-2 px-1">正在上课</h2>
                {living.map((s) => (
                  <motion.button
                    key={s.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => navigate(`/student/live/${s.id}`)}
                    className="w-full text-left bg-white rounded-2xl p-5 shadow border-2 border-red-300 mb-3"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-xs font-bold text-red-500">直播中</span>
                    </div>
                    <div className="font-bold text-gray-800 text-lg">{s.title}</div>
                    {s.description && (
                      <p className="text-sm text-gray-500 mt-1">{s.description}</p>
                    )}
                    <div className="mt-3 inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-[#FF6B35] text-white text-sm font-bold">
                      进入课堂 →
                    </div>
                  </motion.button>
                ))}
              </section>
            )}

            {/* 即将开课 */}
            {upcoming.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-bold text-gray-500 mb-2 px-1">还没开始</h2>
                {upcoming.map((s) => (
                  <div key={s.id} className="bg-white rounded-2xl p-4 shadow mb-2 opacity-80">
                    <div className="font-bold text-gray-700">{s.title}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {s.scheduled_at ? `预计 ${fmtTime(s.scheduled_at)} 开始` : '等老师开课'}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* 回放 */}
            {replayable.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-bold text-gray-500 mb-2 px-1">可以回看</h2>
                {replayable.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/student/live/${s.id}`)}
                    className="w-full text-left bg-white rounded-2xl p-4 shadow mb-2"
                  >
                    <div className="font-bold text-gray-700">{s.title}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      🎬 回放
                      {s.replay_duration ? ` · ${Math.round(s.replay_duration / 60)} 分钟` : ''}
                    </div>
                  </button>
                ))}
              </section>
            )}

            {/* 课件 */}
            <section>
              <h2 className="text-sm font-bold text-gray-500 mb-2 px-1">课件资料</h2>
              {materials.length === 0 ? (
                <div className="bg-white rounded-2xl p-6 text-center shadow">
                  <div className="text-3xl mb-2">📚</div>
                  <p className="text-gray-500 text-sm">老师还没上传课件</p>
                </div>
              ) : (
                materials.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/student/materials/${m.id}`)}
                    className="w-full text-left bg-white rounded-2xl p-4 shadow mb-2 flex items-center gap-3"
                  >
                    <span className="text-2xl">{m.kind === 'pdf' ? '📕' : '🖼'}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-gray-800 truncate">{m.title}</span>
                      <span className="block text-xs text-gray-400 mt-0.5">
                        {m.page_count} 页 · 只能在线看
                      </span>
                    </span>
                    <span className="text-gray-300">›</span>
                  </button>
                ))
              )}
            </section>

            {sessions.length === 0 && materials.length === 0 && (
              <div className="bg-white rounded-2xl p-10 text-center shadow mt-4">
                <div className="text-4xl mb-2">🌤</div>
                <p className="text-gray-600 font-medium">还没有线上课</p>
                <p className="text-gray-400 text-sm mt-1">老师开课后这里会出现</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
