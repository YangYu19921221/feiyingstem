/** 学习助手能传的文件类型(和后端 services/tutor_files.KINDS 同一份);不认识的返回空串 */
export function fileKindOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  return ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : ext === 'doc' ? 'doc' : ext === 'txt' ? 'txt' : '';
}

/**
 * 老版 Word(.doc)服务器不读(10-27 用户定不装 LibreOffice Writer),选到了当场提示、不上传。
 * 和后端 services/tutor_files.DOC_HINT 同一句话(测试比对)
 */
export const DOC_HINT = '老版 Word(.doc)读不了。在 Word 里点「文件 → 另存为」,选 .docx 或 PDF 再发给我';
