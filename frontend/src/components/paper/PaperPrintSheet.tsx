/**
 * 打印全班今天的专项小卷(2026-11-22): 每个孩子一份,学生版只有题,教师版每题带答案、为什么出给他。
 * 和孩子在网页上看到的是同一份(纸上做完也能在网页上点答案)。导出走 utils/downloadPdf(和默写纸同一套)。
 * 要看图的题把原题图一起印上(图要带登录取,先取成 blob)。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, LoaderCircle, X } from 'lucide-react';
import { paperItemImageUrl, type PrintPaper } from '../../api/paperBank';
import { downloadElementAsPdf } from '../../utils/downloadPdf';
import { toast } from '../Toast';

const LETTERS = 'ABCDEF';

function Stem({ text }: { text: string }) {
  const parts = text.split('___');
  return (
    <span>
      {parts.map((p, i) => (
        <span key={i}>{p}{i < parts.length - 1 && <span style={{ display: 'inline-block', minWidth: 72, borderBottom: '1.5px solid #222', margin: '0 4px' }}>&nbsp;</span>}</span>
      ))}
    </span>
  );
}

function Sheet({ paper, variant, images, first }: {
  paper: PrintPaper; variant: 'student' | 'teacher'; images: Record<number, string>; first: boolean;
}) {
  return (
    <div style={{ pageBreakBefore: first ? 'auto' : 'always', padding: '8px 4px', fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif', color: '#111' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid #111', paddingBottom: 6, marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>专项小卷 {variant === 'teacher' && <span style={{ fontSize: 13, color: '#c2410c' }}>(教师版 · 带答案)</span>}</div>
        <div style={{ fontSize: 13 }}>{paper.date} · 姓名 <b>{paper.student.name}</b> · 得分 ______ / {paper.items.length}</div>
      </div>
      {paper.items.map((it) => (
        <div key={it.id} style={{ breakInside: 'avoid', pageBreakInside: 'avoid', marginBottom: 12, fontSize: 15, lineHeight: 1.9 }}>
          <div><b>{it.no}.</b> <Stem text={it.stem} />{it.base_word ? <span style={{ color: '#444' }}>({it.base_word})</span> : null}</div>
          {it.has_image && images[it.id] && <img src={images[it.id]} alt="" style={{ maxWidth: 360, display: 'block', margin: '4px 0 4px 18px' }} />}
          {it.kind === 'mc' && (
            <div style={{ display: 'grid', gridTemplateColumns: (it.options || []).some((o) => o.length > 18) ? '1fr' : '1fr 1fr', paddingLeft: 18 }}>
              {(it.options || []).map((o, i) => <div key={i}>{LETTERS[i]}. {o}</div>)}
            </div>
          )}
          {variant === 'teacher' && (
            <div style={{ paddingLeft: 18, fontSize: 13, color: '#b45309', lineHeight: 1.6 }}>
              答案: <b>{it.answer_text}</b>{it.label ? ` · ${it.label}${it.kp ? `(${it.kp})` : ''}` : ''}{it.note ? ` · 词: ${it.note}` : ''}
              {it.explain ? <div style={{ color: '#555' }}>{it.explain}</div> : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function PaperPrintSheet({ papers, onClose }: { papers: PrintPaper[]; onClose: () => void }) {
  const [variant, setVariant] = useState<'student' | 'teacher'>('student');
  const [images, setImages] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const ids = Array.from(new Set(papers.flatMap((p) => p.items.filter((i) => i.has_image).map((i) => i.id))));
    const made: string[] = [];
    let alive = true;
    void Promise.all(ids.map((id) => paperItemImageUrl(id).then((u) => { made.push(u); return [id, u] as const; }).catch(() => null)))
      .then((pairs) => {
        if (!alive) return;
        const m: Record<number, string> = {};
        for (const p of pairs) if (p) m[p[0]] = p[1];
        setImages(m);
      });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.removeEventListener('keydown', onKey); made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [papers]);

  const download = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      await downloadElementAsPdf(ref.current, { filename: `专项小卷_${papers[0]?.date || ''}_${variant === 'teacher' ? '教师版' : '学生版'}` });
    } catch {
      toast.error('PDF 没生成出来,再试一次');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-900/70" role="dialog" aria-modal="true" aria-label="打印专项小卷">
      <div className="flex flex-wrap items-center gap-2 bg-white px-4 py-3 shadow">
        <b className="text-slate-900">打印今天的小卷({papers.length} 份)</b>
        <div className="flex rounded-lg bg-slate-100 p-1">
          {(['student', 'teacher'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVariant(v)} aria-pressed={variant === v}
              className={`min-h-9 rounded-md px-3 text-sm ${variant === v ? 'bg-white font-semibold shadow' : 'text-slate-600'}`}>
              {v === 'student' ? '学生版' : '教师版(带答案)'}
            </button>
          ))}
        </div>
        <button type="button" disabled={busy} onClick={download}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FF6B35] px-4 text-sm font-semibold text-white disabled:bg-slate-300">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} 下载 PDF
        </button>
        <span className="text-xs text-slate-500">一人一页起;纸上做完,孩子在网页上打开「今日小卷」把答案点进去就记上了</span>
        <button type="button" onClick={onClose} className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="关闭"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div ref={ref} className="mx-auto max-w-[794px] bg-white p-6">
          {papers.map((p, i) => <Sheet key={p.quiz_id} paper={p} variant={variant} images={images} first={i === 0} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
