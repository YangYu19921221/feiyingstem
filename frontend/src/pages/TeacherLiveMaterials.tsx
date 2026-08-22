/**
 * 教师端 - 课件资料管理
 *
 * 上传的原文件落服务端私有目录,学生**永远拿不到原文件**,只能看逐页渲染+
 * 烧了本人姓名/ID/时间水印的图。老师这边也不提供下载 —— 要原件走线下。
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { liveApi, type TeacherMaterial } from '../api/live';

export default function TeacherLiveMaterials() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const sid = sessionId ? Number(sessionId) : undefined;
  const fileRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<TeacherMaterial[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState('');

  const reload = () => liveApi.listMaterials(sid).then(setItems).catch(() => {});
  useEffect(() => { reload(); }, [sessionId]);

  const onPick = async (file: File | null) => {
    if (!file) return;
    setErr('');
    setUploading(true);
    setPct(0);
    try {
      await liveApi.uploadMaterial(
        file,
        { title: file.name.replace(/\.[^.]+$/, ''), session_id: sid ?? null },
        setPct
      );
      await reload();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || '上传失败,请重试');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const del = async (m: TeacherMaterial) => {
    if (!window.confirm(`删除「${m.title}」?学生将立即看不到这份资料。`)) return;
    await liveApi.deleteMaterial(m.id);
    await reload();
  };

  const togglePublish = async (m: TeacherMaterial) => {
    await liveApi.publishMaterial(m.id, !m.is_published);
    await reload();
  };

  return (
    <div className="min-h-screen bg-[#FFF8F0] pb-16">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => navigate(-1)} className="text-2xl" aria-label="返回">⬅️</button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-800">📄 课件资料</h1>
            <p className="text-sm text-gray-500 mt-1">
              学生在线看,不能下载,每页自动打「飞鹰教育 + 学生姓名」水印
            </p>
          </div>
        </div>

        {err && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {err}
          </div>
        )}

        <div className="bg-white rounded-2xl p-5 shadow mb-5">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full py-4 rounded-xl border-2 border-dashed border-orange-300 text-[#FF6B35] font-bold disabled:opacity-50"
          >
            {uploading ? `上传中 ${pct}%…` : '➕ 上传课件(PDF 或图片)'}
          </button>
          <p className="text-xs text-gray-400 mt-2 text-center">
            PDF 会逐页转成图片,页数多的大文件处理需要几秒
          </p>
        </div>

        <div className="space-y-3">
          {items.length === 0 && (
            <div className="bg-white rounded-2xl p-8 text-center shadow">
              <div className="text-4xl mb-2">📚</div>
              <p className="text-gray-600">还没有课件,上传一份线下同步的资料吧</p>
            </div>
          )}
          {items.map((m) => (
            <div key={m.id} className="bg-white rounded-2xl p-4 shadow flex flex-wrap items-center gap-3">
              <div className="text-2xl">{m.kind === 'pdf' ? '📕' : '🖼'}</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-800 truncate">{m.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {m.render_ready
                    ? `${m.page_count ?? 0} 页`
                    : m.render_error
                      ? <span className="text-red-500">处理失败:{m.render_error}</span>
                      : '处理中…'}
                  {m.file_size ? ` · ${(m.file_size / 1024 / 1024).toFixed(1)}MB` : ''}
                  {!m.is_published && ' · 未对学生开放'}
                  {m.can_edit === false && ' · 同事上传'}
                </div>
              </div>
              {/* can_edit=false 时灰掉两个按钮:课件在机构内共享可见,但只有上传者
                  (和管理员)能发布/删除——撤销发布会让正在看的学生当场断档 */}
              <button
                onClick={() => togglePublish(m)}
                disabled={m.can_edit === false}
                title={m.can_edit === false ? '这份课件不是你上传的' : undefined}
                className={`px-3 py-2 rounded-xl text-sm font-bold ${
                  m.can_edit === false
                    ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                    : m.is_published
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                }`}
              >
                {m.is_published ? '✓ 已开放' : '开放'}
              </button>
              <button
                onClick={() => del(m)}
                disabled={m.can_edit === false}
                title={m.can_edit === false ? '这份课件不是你上传的' : undefined}
                className={`px-3 py-2 rounded-xl text-sm font-bold ${
                  m.can_edit === false
                    ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                    : 'bg-red-50 text-red-600'
                }`}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
