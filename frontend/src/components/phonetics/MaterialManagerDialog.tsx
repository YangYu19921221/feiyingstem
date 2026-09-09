/**
 * 音标视频的配套课件管理 — 教师端弹层
 *
 * 老师讲音标时手上那份 PPT,学生看完视频想回看讲义 —— 视频与讲义本来是配套的。
 * 传上来的 PDF/PPT 服务端逐页渲染成图,**学生只能看图,拿不到原文件**。
 *
 * 两件事必须在界面上说清楚,否则老师会反复传:
 * 1. **渲染失败要显眼**(而不是静静躺一行):失败的课件学生端根本看不到,
 *    老师若不知道就会以为传成功了,学生那边一直是空的。
 * 2. **PPT 要转换,慢**。几十页要几十秒,上传进度条走完只是文件传完了,
 *    后面还有服务端转换 —— 不说明白老师会以为卡死。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, Loader2, Trash2, Upload, X } from 'lucide-react';
import { phoneticsApi, formatSize, type TeacherMaterial } from '../../api/phonetics';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

interface Props {
  videoId: number;
  videoTitle: string;
  /** 平台预置视频对机构只读:能看不能改(后端也会拒,这里只是别让老师白点) */
  readOnly?: boolean;
  onClose: () => void;
}

const ACCEPT = '.pdf,.ppt,.pptx';

export default function MaterialManagerDialog({
  videoId, videoTitle, readOnly = false, onClose,
}: Props) {
  const [rows, setRows] = useState<TeacherMaterial[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  /** 文件传完、服务端还在转换渲染的那段 —— 必须单独提示,否则看着像卡死 */
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setRows(await phoneticsApi.listMaterials(videoId));
    } catch (e) {
      toast.error(getErrorMessage(e, '课件列表加载失败'));
      setRows([]);
    }
  }, [videoId]);

  useEffect(() => { void load(); }, [load]);

  // Esc 关闭:弹层里手在键盘上,伸手去点右上角的 × 是多余动作
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doUpload = async (file: File) => {
    setUploading(true);
    setPercent(0);
    setProcessing(false);
    try {
      await phoneticsApi.uploadMaterial(videoId, file, undefined, (p) => {
        setPercent(p);
        // 到 100% 只代表文件传完,服务端还要转 PPT + 逐页渲染
        if (p >= 100) setProcessing(true);
      });
      toast.success('课件已上传');
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '上传失败'));
    } finally {
      setUploading(false);
      setProcessing(false);
      setPercent(0);
      if (fileRef.current) fileRef.current.value = '';   // 同一个文件能再选一次
    }
  };

  const remove = async (m: TeacherMaterial) => {
    if (!window.confirm(`删除课件「${m.title}」?学生将看不到这份讲义。`)) return;
    try {
      await phoneticsApi.removeMaterial(m.id);
      toast.success('已删除');
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '删除失败'));
    }
  };

  const toggleActive = async (m: TeacherMaterial) => {
    try {
      await phoneticsApi.updateMaterial(m.id, { is_active: !m.is_active });
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '操作失败'));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${videoTitle} 的配套课件`}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-bold text-ink">配套课件</p>
            <p className="truncate text-xs text-ink-soft">{videoTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 mt-2 rounded-xl bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
          学生在视频页可以看到这里的讲义(<b>只能看图,下载不了原文件</b>)。
          支持 PDF 和 PPT,PPT 会自动转换。
        </p>

        {!readOnly && (
          <div className="mb-4">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doUpload(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-glow flex w-full items-center justify-center gap-2 rounded-xl py-2.5
                         text-sm font-semibold text-white disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? (processing ? '正在转换渲染…' : `上传中 ${percent}%`) : '上传课件(PDF / PPT)'}
            </button>

            {uploading && (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${processing ? 100 : percent}%` }}
                  />
                </div>
                {/* 转换阶段没有进度可报,只能说清"在干什么、要等" */}
                {processing && (
                  <p className="mt-1.5 text-center text-xs text-ink-soft">
                    文件已传完,服务器正在逐页渲染。几十页的课件要等十几秒,请别关窗口。
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {readOnly && (
          <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            这是平台预置视频,课件只能查看。需要调整请联系平台管理员。
          </p>
        )}

        {rows === null ? (
          <p className="py-8 text-center text-sm text-ink-soft">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">
            还没有课件。{!readOnly && '传一份讲义,学生看完视频就能回看。'}
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((m) => (
              <div
                key={m.id}
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  m.render_ready ? 'border-gray-100' : 'border-red-200 bg-red-50'
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    m.render_ready ? 'bg-orange-50 text-orange-500' : 'bg-red-100 text-red-500'
                  }`}
                >
                  {m.render_ready
                    ? <FileText className="h-5 w-5" />
                    : <AlertTriangle className="h-5 w-5" />}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{m.title}</p>
                  {m.render_ready ? (
                    <p className="text-xs text-ink-soft">
                      {m.page_count} 页 · {m.kind.toUpperCase()}
                      {m.file_size ? ` · ${formatSize(m.file_size)}` : ''}
                      {!m.is_active && <span className="ml-1 text-amber-600">· 已下架</span>}
                    </p>
                  ) : (
                    // 失败原因要直接写出来:老师看不到就只会一遍遍重传同一个坏文件
                    <p className="text-xs leading-relaxed text-red-600">
                      渲染失败,学生看不到这份课件。{m.render_error || '请删除后重新上传'}
                    </p>
                  )}
                </div>

                {m.can_edit && (
                  <div className="flex shrink-0 items-center gap-1">
                    {m.render_ready && (
                      <button
                        onClick={() => void toggleActive(m)}
                        className="rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-gray-100"
                      >
                        {m.is_active ? '下架' : '上架'}
                      </button>
                    )}
                    <button
                      onClick={() => void remove(m)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      aria-label={`删除 ${m.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
