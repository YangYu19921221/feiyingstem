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
    id: 'coin-auto-rules-2026-08-student',
    date: '2026-08-08',
    title: '金币自动到账:任务全做完 +1,单词王再 +1',
    desc: '把老师当天布置的任务全部做完,金币立刻 +1(老师当天又加的任务做完不再额外给)。老师取消的任务不算,剩下的做完照样得。当天班上学词最多的是单词王,额外 +1 —— 但要等 24 点结算,白天领先只是暂列第一,随时可能被同学超越。首页金币卡现在会显示今天的任务进度和单词王战况。',
    where: '学生端首页金色金币卡:看「今日任务 x/y」和单词王提示,点右下「规则」看完整说明',
    roles: ['student'],
  },
  {
    id: 'coin-auto-rules-2026-08-teacher',
    date: '2026-08-08',
    title: '金币恢复自动发放,可一键切回手动',
    desc: '学生完成当天布置的全部任务自动 +1(当天追加的任务不再多给;您取消或关闭的任务不进分母,剩下的做完照样给);当日单词王额外 +1,次日 0 点自动结算。想回到「老师核实后手动加」的,管理员在金币管理页一键切换即可,已发的金币不会收回。',
    where: '教师端「金币管理」页顶部横幅:看当前模式与规则,管理员可点「改为教师手动加」切换',
    roles: ['teacher', 'org_admin', 'admin'],
    route: '/teacher/coins',
  },
  {
    id: 'homework-schedule-2026-08',
    date: '2026-08-07',
    title: '当日任务:按日期布置,一次排好一周',
    desc: '创建作业时选「开始日期」就是当日任务:学生当天 0 点才能看到,当天 24 点自动截止——只能当天完成,提前做不了、拖着也不行。多选单元勾「按天依次排期」,每个单元顺延一天,一次把一周任务排满。还没开放的任务列表里可以一键「✖ 取消」。',
    where: '作业管理 → 创建新作业 → 「📅 开始日期(当日任务)」;多选单元后出现「按天依次排期」;未开放任务在列表操作列点「✖ 取消」',
    roles: ['teacher'],
    route: '/teacher/homework',
  },
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
