/** 学习助手能传的文件类型(和后端 services/tutor_files.KINDS 同一份);不认识的返回空串 */
export function fileKindOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  return ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : ext === 'doc' ? 'doc' : ext === 'txt' ? 'txt' : '';
}
