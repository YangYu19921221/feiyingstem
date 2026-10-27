/**
 * 学习助手里的「文件」小卡片(2026-10-27,后端 services/tutor_files)。
 *
 * 两处用: 输入框上面(选好了、还没发,右上角叉可以去掉)和孩子自己的消息气泡里(发过的)。
 * 只显示文件名、类型、页数 —— 文件内容服务器不存,刷新以后也看不到原文件。
 */
import { memo } from 'react';
import { FileText, X } from 'lucide-react';

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word', doc: 'Word', txt: '文本' };

function sizeText(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function FileChip({ name, kind, pages, size, onRemove, tone = 'light' }: {
  name: string;
  kind: string;
  pages?: number | null;
  size?: number;
  /** 有就显示右上角叉(还没发的) */
  onRemove?: () => void;
  /** light = 白底(输入框上面);onWarm = 在橙色气泡里 */
  tone?: 'light' | 'onWarm';
}) {
  const meta = [KIND_LABEL[kind] || '文件', pages ? `${pages} 页` : '', sizeText(size)].filter(Boolean).join(' · ');
  const box = tone === 'onWarm'
    ? 'bg-white/15 text-white ring-1 ring-white/30'
    : 'bg-white text-ink shadow-sm ring-1 ring-black/10';
  return (
    <span className={`relative inline-flex max-w-full items-center gap-2 rounded-xl px-3 py-2 ${box}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone === 'onWarm' ? 'bg-white/20' : 'bg-orange-50 text-orange-600'}`}>
        <FileText className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block max-w-[14rem] truncate text-sm font-medium sm:max-w-[18rem]" title={name}>{name}</span>
        <span className={`block text-xs ${tone === 'onWarm' ? 'text-white/80' : 'text-ink-mute'}`}>{meta}</span>
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove}
          className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-white shadow ring-2 ring-white hover:bg-slate-800"
          aria-label={`不发 ${name}`}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

export default memo(FileChip);
