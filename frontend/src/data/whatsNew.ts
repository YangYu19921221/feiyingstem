/**
 * 新功能公告 —— 单一真源
 *
 * ⚠️ 开发规范:每上线一个用户能感知的新功能,必须在这里加一条,否则没人知道它存在。
 * 详见 CLAUDE.md「新功能必须同步公告」。
 *
 * 字段约定:
 * - id: 唯一且永不修改(它就是"已读"记录的键,改了会对全员重弹)
 * - date: 上线日期 YYYY-MM-DD。首次使用本机制的老用户只会看到近 30 天的条目,
 *   更早的自动标记已读,避免一次性弹一大堆历史功能
 * - roles: 谁该看到。学生功能别弹给管理员,反之亦然
 * - route: 「去看看」的落地页;留空则只做告知不跳转
 * - where: 一句话说清"在哪儿点得到"——公告最容易漏掉的恰恰是这句
 */
export interface WhatsNewEntry {
  id: string;
  date: string;
  title: string;
  desc: string;
  where: string;
  roles: Array<'student' | 'teacher' | 'admin' | 'org_admin'>;
  route?: string;
}

/** 新到旧排列 */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: 'franchise-kit-2026-08',
    date: '2026-08-07',
    title: '加盟资料:合作协议 + 提分方案,一键下载 PDF',
    desc: '两份排好版的对外文档:合作协议(1.2万/年含100名学生,超出100元/生/年,书本全开放)和系统功能提分方案。空栏可在页面上直接填写,点「下载 PDF」存成文件直接微信发给意向加盟商。',
    where: '管理端首页「运营工具箱 → 组织与人员 → 加盟资料」',
    roles: ['admin'],
    route: '/admin/franchise-kit',
  },
  {
    id: 'sheet-pdf-download-2026-08',
    date: '2026-08-07',
    title: '默写纸可以下载成 PDF 了',
    desc: '默写纸不再只能打印:点「下载 PDF」直接存成文件,发给爸爸妈妈或拿去打印店都方便(手机上也能存)。格线也换成了标准四线三格。',
    where: '单元里点「纸笔听写」→「打印默写纸」,右上角「下载 PDF」',
    roles: ['student'],
    route: '/student/handwriting',
  },
  {
    id: 'handwriting-dictation-2026-08',
    date: '2026-08-06',
    title: '纸笔听写:在纸上手写，拍照自动批改',
    desc: '考试考的是手写拼写。App 报词，你写在纸上，拍一张照 AI 逐词批改，写错的自动进薄弱词。也能打印四线三格默写纸。',
    where: '首页「纸笔听写」卡片，或单元列表里展开单元后的「纸笔听写」一组',
    roles: ['student'],
    route: '/student/handwriting',
  },
  {
    id: 'handwriting-dictation-teacher-2026-08',
    date: '2026-08-06',
    title: '学生可以练手写拼写了',
    desc: '学生在 App 里听词、写在纸上、拍照 AI 批改，成绩和错词与其他模式一样进入班级数据。学生也能自己打印四线三格默写纸，可直接用于课堂听写。',
    where: '学生端首页「纸笔听写」；成绩照常出现在班级学情与薄弱词统计里',
    roles: ['teacher'],
  },
  {
    id: 'ai-ocr-model-config-2026-08',
    date: '2026-08-06',
    title: '可配置手写批改模型',
    desc: '纸笔听写的拍照批改走视觉模型，型号现在可以在 AI 配置里改。留空时通义千问自动用 qwen3.5-ocr。',
    where: 'AI 配置管理 → 编辑服务 → 「手写批改模型 (视觉 OCR)」',
    roles: ['admin'],
    route: '/admin/ai-config',
  },
];

/** 老用户首次使用本机制时,只把这个天数内的条目当"新" */
export const WHATS_NEW_GRACE_DAYS = 30;
