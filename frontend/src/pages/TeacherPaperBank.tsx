/**
 * 教师端「试卷库」(2026-11-22): 传卷子 → 拆卷 AI 拆成一道道题 → 老师核对 → 进题库,孩子每天做专项小卷。
 * 规则见后端 services/paper_bank.py、services/paper_parse.py。
 *
 * 这一页: 传卷子、看每份拆到哪了(在拆的每 4 秒刷新一次)、去核对。
 * 核对在 /teacher/paper-bank/:docId,全班薄弱点和布置 / 打印小卷在 /teacher/paper-bank/class。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileStack, FileUp, LoaderCircle, RotateCcw, Trash2, Users } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import PaperBankAdminCard from '../components/admin/PaperBankAdminCard';
import { toast } from '../components/Toast';
import {
  deletePaperDoc, getPaperStatus, listPaperDocs, retryPaperDoc, uploadPaperDoc,
  type PaperDoc, type PaperStatus,
} from '../api/paperBank';
import { getErrorMessage } from '../utils/errorMessage';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.docx';

function statusChip(d: PaperDoc) {
  if (d.status === 'queued') return { text: '排队中', cls: 'bg-slate-100 text-slate-600' };
  if (d.status === 'parsing') {
    const n = d.pages ? ` ${d.pages_done}/${d.pages} 页` : '';
    return { text: `在拆${n}`, cls: 'bg-sky-100 text-sky-800' };
  }
  if (d.status === 'failed') return { text: '没拆出来', cls: 'bg-rose-100 text-rose-800' };
  if (d.pending > 0) return { text: `等核对 ${d.pending} 道`, cls: 'bg-amber-100 text-amber-900' };
  return { text: '核对完了', cls: 'bg-emerald-100 text-emerald-800' };
}

export default function TeacherPaperBank() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PaperStatus | null>(null);
  const [docs, setDocs] = useState<PaperDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [grade, setGrade] = useState('');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    try {
      setDocs((await listPaperDocs()).items);
    } catch (e) {
      toast.error(getErrorMessage(e, '卷子列表没加载出来'));
    }
  }, []);

  useEffect(() => {
    getPaperStatus().then((s) => {
      setStatus(s);
      if (s.enabled) return loadDocs();
      return undefined;
    }).catch((e) => toast.error(getErrorMessage(e, '加载失败'))).finally(() => setLoading(false));
  }, [loadDocs]);

  // 有在拆的: 每 4 秒刷新一次(页面在后台时不刷)
  const working = docs.some((d) => d.status === 'queued' || d.status === 'parsing');
  useEffect(() => {
    if (!working) return undefined;
    const t = window.setInterval(() => { if (!document.hidden) void loadDocs(); }, 4000);
    return () => window.clearInterval(t);
  }, [working, loadDocs]);

  const pickFile = (f: File | null) => {
    setFile(f);
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const tooBig = !!(file && status && file.size > status.max_mb * 1024 * 1024);
  const canUpload = !!file && !!grade && !tooBig && progress === null && !!status?.configured;

  const upload = async () => {
    if (!file || !canUpload) return;
    setProgress(0);
    try {
      await uploadPaperDoc(file, { title: title.trim(), grade, note: note.trim() }, setProgress);
      toast.success('传上去了,正在拆。拆完会在下面列出来');
      setFile(null);
      setTitle('');
      setNote('');
      if (inputRef.current) inputRef.current.value = '';
      await loadDocs();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: { code?: string; doc_id?: number } } } })?.response?.data?.detail;
      if (detail && typeof detail === 'object' && detail.code === 'duplicate' && detail.doc_id) {
        toast.error(getErrorMessage(e, '这份已经传过了'));
        navigate(`/teacher/paper-bank/${detail.doc_id}`);
      } else {
        toast.error(getErrorMessage(e, '没传上'));
      }
    } finally {
      setProgress(null);
    }
  };

  const retry = async (d: PaperDoc) => {
    setBusyId(d.id);
    try {
      await retryPaperDoc(d.id);
      toast.success('接着拆了,拆好的页不会重拆');
      await loadDocs();
    } catch (e) {
      toast.error(getErrorMessage(e, '没开始'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (d: PaperDoc) => {
    if (!window.confirm(`删掉「${d.title}」?\n\n删了以后这份卷子里的题不再出给孩子,孩子以前做过的记录还在。删了不能恢复。`)) return;
    setBusyId(d.id);
    try {
      await deletePaperDoc(d.id);
      toast.success('删掉了');
      await loadDocs();
    } catch (e) {
      toast.error(getErrorMessage(e, '没删掉'));
    } finally {
      setBusyId(null);
    }
  };

  const totals = useMemo(() => ({
    approved: docs.reduce((n, d) => n + d.approved, 0),
    pending: docs.reduce((n, d) => n + d.pending, 0),
  }), [docs]);

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title="试卷库" subtitle="传高频真题卷,系统按每个孩子的薄弱点出专项小卷"
        icon={FileStack} backTo="/teacher/dashboard"
        action={status?.enabled ? (
          <button type="button" onClick={() => navigate('/teacher/paper-bank/class')}
            className="teacher-focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#FF6B35] px-4 text-sm font-semibold text-white hover:bg-[#f05a24]">
            <Users className="h-4 w-4" /> 全班薄弱点 · 布置小卷
          </button>
        ) : undefined} />

      <main className="teacher-workspace-main mx-auto max-w-5xl space-y-5">
        {loading && <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> 加载中…</div>}

        {status && !status.enabled && (
          <section className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">{status.reason}</section>
        )}

        {status?.enabled && (
          <>
            <section className="rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm leading-6 text-orange-950">
              <p><b>怎么用:</b> 传一份卷子(PDF、手机拍的照片、Word 都行)→ 系统把<b>单项选择</b>和<b>填空题</b>拆成一道道题、标上考哪个知识点 →
                你核对一遍,通过的题进题库 → 每个孩子每天一份 {status.quiz_size} 道题的小卷,专挑他不会的点和没记牢的单词。</p>
              <p>卷面上标了答案的照抄;没标的 AI 自己做,会<span className="rounded bg-amber-200/70 px-1">标黄</span>让你重点看。
                答案页一起传(放在同一个文件里)最好,系统会自动对上题号。听力、完形、阅读、作文这一版先不拆。</p>
            </section>

            {status.is_admin && <PaperBankAdminCard compact />}

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900"><FileUp className="h-5 w-5 text-[#FF6B35]" /> 传一份卷子</h2>
              {!status.configured && (
                <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  拆卷用的 AI 还没配好(小鹰老师的 Key 没填或停用了),现在传不了。请平台管理员在管理端首页「AI 学习助手」里看一下。
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center text-sm text-slate-600 hover:border-orange-300 hover:bg-orange-50/40">
                  <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only"
                    onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                  {file ? (
                    <>
                      <span className="font-medium text-slate-900">{file.name}</span>
                      <span className={tooBig ? 'text-rose-700' : 'text-slate-500'}>
                        {(file.size / 1024 / 1024).toFixed(1)} MB{tooBig ? `,超过 ${status.max_mb} MB 了,拆成几份再传` : ''}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-slate-800">点这里选文件</span>
                      <span className="text-xs text-slate-500">PDF / 照片(jpg、png)/ Word(.docx),一次最多 {status.max_pages} 页、{status.max_mb} MB</span>
                    </>
                  )}
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-slate-600">卷子名字</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="比如: 七上 Unit 1–7 测评卷"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base outline-none focus:border-orange-400 sm:text-sm" />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-slate-600">几年级的卷子 <span className="text-rose-600">*</span></span>
                  <select value={grade} onChange={(e) => setGrade(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-orange-400 sm:text-sm">
                    <option value="">选年级(孩子只会做到不高于自己年级的题)</option>
                    {status.grades.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-slate-600">备注(可不填)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="比如: 2025 年期中真题"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base outline-none focus:border-orange-400 sm:text-sm" />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" disabled={!canUpload} onClick={upload}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#FF6B35] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                  {progress !== null ? <><LoaderCircle className="h-4 w-4 animate-spin" /> {progress < 100 ? `上传中 ${progress}%` : '准备拆卷…'}</> : '上传并拆卷'}
                </button>
                {!grade && file && <span className="text-sm text-slate-500">先选一下年级</span>}
                <span className="text-xs text-slate-500">一份十几页的卷子大概要 3–6 分钟,不用守着,关掉页面也会接着拆</span>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">传过的卷子</h2>
                <span className="text-sm text-slate-500">题库里已通过 {totals.approved} 道 · 还有 {totals.pending} 道等核对</span>
              </div>
              {docs.length === 0 && !loading && (
                <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">还没有传过卷子。传一份,孩子明天就能做专项小卷。</p>
              )}
              {docs.map((d) => {
                const chip = statusChip(d);
                const ready = d.status === 'review';
                return (
                  <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <div className="min-w-[12rem] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{d.title}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{d.grade}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${chip.cls}`}>{chip.text}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {d.pages} 页 · {d.uploaded_by_name || '—'} · {d.created_at ? new Date(`${d.created_at}Z`).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                        {ready && <> · 拆出 {d.item_count} 道 · 通过 {d.approved}{d.flagged ? ` · 标黄 ${d.flagged}` : ''}</>}
                      </p>
                      {d.reason && <p className={`mt-1 text-xs ${d.status === 'failed' ? 'text-rose-700' : 'text-amber-800'}`}>{d.reason}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {ready && (
                        <button type="button" onClick={() => navigate(`/teacher/paper-bank/${d.id}`)}
                          className="min-h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700">
                          {d.pending > 0 ? '去核对' : '看题'}
                        </button>
                      )}
                      {(d.status === 'failed' || (ready && d.reason.includes('接着拆'))) && (
                        <button type="button" disabled={busyId === d.id} onClick={() => retry(d)}
                          className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-white px-3 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                          <RotateCcw className="h-4 w-4" /> 接着拆
                        </button>
                      )}
                      {d.status !== 'queued' && d.status !== 'parsing' && (
                        <button type="button" disabled={busyId === d.id} onClick={() => remove(d)} aria-label={`删掉 ${d.title}`}
                          className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
