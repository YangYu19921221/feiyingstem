/**
 * 加盟资料中心(平台 admin 专用,org_admin 不可见)
 *
 * 两份对外标准文档,页面内直接排好版:
 *  1. 合作协议 —— 参照行业同类协议改写为本系统计费口径:
 *     年度服务费 ¥12,000 含 100 个学生名额,超出按 ¥100/生/年,全托授权书本全开放
 *  2. 功能详解与提分方案 —— 给加盟商看的系统能力说明,围绕"怎么帮学生提分"展开
 *
 * 导出方式与打印默写纸同一套路:纯前端 window.print(),打印对话框里选"另存为 PDF"
 * 即完成下载,文档不经服务器、不落盘(UPLOAD_DIR 公开无鉴权,敏感资料禁止走那条路)。
 * 协议里的空栏是 contentEditable,可先在页面上填好乙方信息再打印。
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FileSignature, LoaderCircle, Printer, Sparkles } from 'lucide-react';
import { downloadElementAsPdf } from '../utils/downloadPdf';

type DocKey = 'contract' | 'pitch';

/** 协议空栏:点击可直接输入,打印保留手填内容;留空则打印出下划线供手写 */
const Blank = ({ w = '8rem' }: { w?: string }) => (
  <span
    contentEditable
    suppressContentEditableWarning
    spellCheck={false}
    className="mx-0.5 inline-block min-h-[1.5em] border-b border-slate-600 px-1 text-center align-baseline outline-none focus:bg-amber-50"
    style={{ minWidth: w }}
  />
);

/**
 * 协议条款。刻意不给整条加 break-inside: avoid —— 长条款(如费用条含表格)
 * 整块躲开分页会在页底留下半页空白。改为只保证「标题不与正文分离」
 * (breakAfter: avoid),条款正文允许跨页,表格自己带 avoid 不被劈开。
 */
const Clause = ({ no, title, children }: { no: string; title: string; children: React.ReactNode }) => (
  <section className="mt-5">
    <h3 className="text-[15px] font-bold" style={{ breakAfter: 'avoid' }}>第{no}条 {title}</h3>
    <div className="mt-1.5 space-y-1.5 text-justify leading-7">{children}</div>
  </section>
);

/** ============ 文档一:合作协议 ============ */
function ContractDoc() {
  return (
    <article className="fk-serif text-[14px] leading-7 text-slate-900">
      <header className="text-center">
        <h1 className="text-[26px] font-bold tracking-wide">「飞鹰AI英语」智能学习系统合作协议</h1>
        <p className="mt-1 text-[13px] text-slate-600">(全托授权 · 单校区版)</p>
        <p className="mt-3 text-right text-[13px]">协议编号:<Blank w="10rem" /></p>
      </header>

      <div className="mt-4 space-y-2">
        <p>甲方:<Blank w="22rem" />(以下简称"甲方")</p>
        <p className="pl-[3em] text-[13px] text-slate-700">统一社会信用代码:<Blank w="16rem" /></p>
        <p>乙方:<Blank w="22rem" />(以下简称"乙方")</p>
        <p className="pl-[3em] text-[13px] text-slate-700">证件号码 / 信用代码:<Blank w="16rem" /></p>
      </div>

      <p className="mt-4 indent-8">
        经甲乙双方平等友好协商,就乙方在<Blank w="4.5rem" />省<Blank w="4.5rem" />市<Blank w="4.5rem" />县(区)
        (经营场所详细地址:<Blank w="18rem" />)推广运营甲方「飞鹰AI英语」智能英语学习系统
        (以下简称"本系统")事宜,达成如下协议:
      </p>

      <Clause no="一" title="产品与知识产权">
        <p>
          1. 甲方保证本系统为甲方合法拥有或获得合法授权运营的知识产权产品,符合国家有关政策法规,有利于使用者英语学习。
        </p>
        <p>
          2. 本系统包含学生端、教师端、机构管理端与家长端。协议生效后,甲方为乙方开通独立机构后台,
          乙方数据独立隔离存储,并支持乙方在系统内使用自己的机构名称与 Logo。
        </p>
      </Clause>

      <Clause no="二" title="授权内容(全托模式)">
        <p>
          1. 服务期内,甲方向乙方<strong>全量开放系统内全部单词本、句型本、阅读理解及配套学习内容</strong>
          (覆盖小学、初中、高中各年级主流教材同步内容),乙方无需按册另行付费;
          服务期内甲方新增的内容与功能升级,乙方免费同步享有。
        </p>
        <p>
          2. 本协议基础服务含 <strong>100 个学生账号名额</strong>;教师账号与机构管理账号不另行收费,
          数量以乙方正常教学使用为限。
        </p>
      </Clause>

      <Clause no="三" title="合作费用与结算">
        <p>
          1. 年度服务费:人民币 <strong>12,000 元 / 年</strong>(大写:<strong>壹万贰仟元整</strong>),
          包含第二条约定的全部授权内容及 100 个学生账号名额。
        </p>
        <p>
          2. 超额名额:学生账号超过 100 个的部分,按<strong>每生每年人民币 100 元</strong>(壹佰元整)计费,
          按实际开通数量结算,与本协议服务期同步计算。
        </p>
        <p>
          3. 付款方式:本协议签订后<Blank w="3rem" />日内,乙方一次性向甲方支付当年度服务费;
          甲方收到款项后<Blank w="3rem" />个工作日内完成系统开通与账号交付。
        </p>
        <p>
          4. 系统开通后,当年度服务费不予退还。因不可抗力(如疫情停课等)导致乙方连续停课三十日以上的,
          乙方可书面申请服务期相应顺延。
        </p>
        <p>5. 甲方对乙方向其学员的终端收费价格与招生政策不予干涉。</p>
        <table className="mt-3 w-full border-collapse text-[13px]" style={{ breakInside: 'avoid' }}>
          <thead>
            <tr>
              <th className="border border-slate-500 px-2 py-1.5 text-center font-bold">项目</th>
              <th className="border border-slate-500 px-2 py-1.5 text-center font-bold">标准</th>
              <th className="border border-slate-500 px-2 py-1.5 text-center font-bold">说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-slate-500 px-2 py-1.5 text-center">年度服务费</td>
              <td className="border border-slate-500 px-2 py-1.5 text-center font-semibold">¥12,000 / 年</td>
              <td className="border border-slate-500 px-2 py-1.5">含 100 个学生账号名额;系统内全部书本内容开放;教师、管理账号不另收费</td>
            </tr>
            <tr>
              <td className="border border-slate-500 px-2 py-1.5 text-center">超额学生账号</td>
              <td className="border border-slate-500 px-2 py-1.5 text-center font-semibold">¥100 / 生 / 年</td>
              <td className="border border-slate-500 px-2 py-1.5">自第 101 名起,按实际开通数量计费</td>
            </tr>
            <tr>
              <td className="border border-slate-500 px-2 py-1.5 text-center">系统升级</td>
              <td className="border border-slate-500 px-2 py-1.5 text-center font-semibold">免费</td>
              <td className="border border-slate-500 px-2 py-1.5">服务期内新功能、新内容自动同步</td>
            </tr>
            <tr>
              <td className="border border-slate-500 px-2 py-1.5 text-center">使用培训</td>
              <td className="border border-slate-500 px-2 py-1.5 text-center font-semibold">免费</td>
              <td className="border border-slate-500 px-2 py-1.5">教师全员使用方法培训(差旅费用自理)</td>
            </tr>
          </tbody>
        </table>
      </Clause>

      <Clause no="四" title="区域保护">
        <p>
          自本协议生效之日起,甲方在乙方上述经营场所导航距离<strong>三公里</strong>范围内,不再发展其他合作点。
        </p>
      </Clause>

      <Clause no="五" title="乙方义务与经营规范">
        <p>
          1. 协议期内,乙方不得代理、销售或合作推广与本系统同类的英语单词记忆 / 学习软件,
          否则应向甲方支付违约金人民币贰万元整(¥20,000)。
        </p>
        <p>
          2. 乙方在推广运营期间不得夸大产品效果宣传;因乙方夸大或虚假宣传导致使用者投诉、赔偿或行政处罚的,
          相关责任由乙方自行承担。
        </p>
        <p>
          3. 乙方的学生账号仅限乙方招收的学员本人使用,严禁将账号转售、出借给其他机构或销售点使用;
          违者甲方有权取消其合作资格并关停相关账号,已支付费用不予退还。
        </p>
        <p>4. 乙方应妥善保管管理账号及学员信息,遵守《个人信息保护法》等相关法律法规。</p>
      </Clause>

      <Clause no="六" title="甲方服务与支持">
        <p>1. 甲方负责本系统的日常维护、故障处理与持续升级,保障系统正常可用。</p>
        <p>
          2. 甲方对乙方教师进行免费使用方法培训(差旅自理);寒暑假等招生旺季,甲方提供相关运营方法指导,
          乙方开展的招生活动及其收费由乙方全权负责。
        </p>
        <p>
          3. 系统为每位学员提供家长端监督入口,乙方应确保学员及其家长知悉,便于家长监督学习进度与学习效果。
        </p>
        <p>4. 甲方向乙方交付机构管理后台账号,便于乙方管理教师、学员并查看学情数据。</p>
      </Clause>

      <Clause no="七" title="数据与保密">
        <p>
          1. 乙方学员数据在系统内按机构隔离存储;未经乙方同意,甲方不将乙方学员信息用于向其直接招生,
          亦不向第三方提供(法律法规另有规定的除外)。
        </p>
        <p>2. 双方对本协议合作价格及知悉的对方商业信息负有保密义务,协议终止后仍然有效。</p>
      </Clause>

      <Clause no="八" title="协议期限与续签">
        <p>
          1. 本协议有效期壹年,自<Blank w="4rem" />年<Blank w="2.5rem" />月<Blank w="2.5rem" />日起,
          至<Blank w="4rem" />年<Blank w="2.5rem" />月<Blank w="2.5rem" />日止。
        </p>
        <p>2. 本协议一年一签。协议期内乙方正常履约的,享有同等条件下的优先续签权。</p>
        <p>
          3. 协议到期未续签的,甲方有权关停乙方管理账号及学员账号服务;乙方数据自到期之日起保留九十日,
          期内续签的予以恢复。
        </p>
      </Clause>

      <Clause no="九" title="违约责任">
        <p>
          任何一方违反本协议约定给对方造成损失的,应承担相应赔偿责任;本协议对违约金另有约定的,从其约定。
        </p>
      </Clause>

      <Clause no="十" title="争议解决">
        <p>本协议履行中发生争议,双方应友好协商解决;协商不成的,提交甲方所在地人民法院裁决。</p>
      </Clause>

      <Clause no="十一" title="其他">
        <p>1. 本协议一式贰份,甲乙双方各执壹份,具有同等法律效力。</p>
        <p>2. 本协议自双方签字盖章之日起生效;未尽事宜,双方另行签订补充协议。</p>
      </Clause>

      <section className="mt-10 grid grid-cols-2 gap-8 text-[14px]" style={{ breakInside: 'avoid' }}>
        <div className="space-y-6">
          <p>甲方(盖章):</p>
          <p>代表签字:<Blank w="8rem" /></p>
          <p>联系电话:<Blank w="8rem" /></p>
          <p>日期:<Blank w="4rem" />年<Blank w="2.5rem" />月<Blank w="2.5rem" />日</p>
        </div>
        <div className="space-y-6">
          <p>乙方(签章):</p>
          <p>代表签字:<Blank w="8rem" /></p>
          <p>联系电话:<Blank w="8rem" /></p>
          <p>日期:<Blank w="4rem" />年<Blank w="2.5rem" />月<Blank w="2.5rem" />日</p>
        </div>
      </section>
    </article>
  );
}

/** ============ 文档二:功能详解与提分方案 ============ */

const LEARNING_MODES = [
  { name: '① 分类认知', desc: '学习新单元前,先把"认识的"和"不认识的"快速分开,后续学习时间只花在真正的生词上。', gain: '不做无效重复,同样一小时学到的生词多一倍。' },
  { name: '② 选择练习', desc: '词义辨析选择题,干扰项由 AI 按易混词生成,专治"看着眼熟、一选就错"。', gain: '把"大概认识"逼成"精确记忆",直接对应卷面选择题。' },
  { name: '③ 听写练习', desc: '真人发音报词,听音辨词写词,训练耳朵对单词的第一反应。', gain: '听力提分的地基:单词听不出来,句子必然听不懂。' },
  { name: '④ 拼写练习', desc: '逐字母键入拼写,系统记录学生每一次真实的错误写法,精确到错在哪个字母。', gain: '拼写是中高考硬要求,错误写法留档才能针对性纠正。' },
  { name: '⑤ 填空练习', desc: '在句子语境中补全单词,把孤立的词放回真实用法里。', gain: '对应完形填空、语法填空题型,词不再是死记的。' },
  { name: '⑥ 例句学习', desc: 'AI 生成适龄例句,难度贴合学段,理解单词的真实用法。', gain: '积累句感,阅读速度和写作表达同步受益。' },
  { name: '⑦ 句子背诵 / 句子填空', desc: '从词到句:整句背诵与关键词填空,配套句型本训练。', gain: '句型内化后,书面表达有现成的"模板库"。' },
  { name: '⑧ 单元考试', desc: '学完即测,多题型混合组卷,成绩自动进入学情档案与薄弱词库。', gain: '每单元当堂闭环,问题不过夜、不积压。' },
];

const MEMORY_ENGINE = [
  { name: '今日智能任务', desc: '学生打开 App 就知道今天学什么:新词、到期复习词、薄弱词自动排程,不需要老师每天手动安排。' },
  { name: '记忆曲线复习(SRS)', desc: '按艾宾浩斯遗忘规律,在"快忘还没忘"的最佳时点安排复习;系统还提供保持率对比,复习效果看得见。' },
  { name: 'AI 记忆钩子', desc: '难记的词自动生成词根、联想、谐音等记忆线索,把死记硬背变成有抓手的记忆。' },
  { name: '拼写错误诊断', desc: '保存学生每次真实错误写法,定位错误模式(如 ei/ie 混淆、双写漏写),复习直击病灶。' },
  { name: '连错消化卡', desc: '连续答错的词不再机械重复,系统切换讲解角度重新学,避免"越错越烦、越烦越错"。' },
  { name: '薄弱词三档', desc: '精确区分"没学过 / 不熟 / 易错"三档,复习火力集中在真正的薄弱词,不浪费在已掌握的词上。' },
];

const GAMIFICATION = [
  { name: '宠物养成 + 宠物对战', desc: '学习养宠物,对战题目优先从自己的薄弱词里出——孩子以为在玩,其实在补弱项。' },
  { name: '真人实时 PK 竞技场', desc: '同题同序公平对战,拼正确率和速度;赢的想再赢,输的想翻盘,练习量自己涨上去。' },
  { name: '全自动晋级赛', desc: '机构一键办赛:蛇形分组→小组循环→出线→淘汰赛→冠军,系统全自动推进,天然的机构活动。' },
  { name: '段位 · 成就 · 连续打卡', desc: '天天有小目标,周周有里程碑;"单词王"标识让努力的孩子被看见。' },
  { name: '金币商城', desc: '完成作业、当上单词王赚金币,兑换机构自设的实物奖品——线上激励接到线下,兑奖日就是机构的家长到店日。' },
  { name: '防划水监控', desc: '切屏、挂机、乱点实时识别,学习质量分把"刷时长"和"真学习"分开——游戏化不等于放羊。' },
];

const TEACHING_LOOP = [
  { name: '实时课堂监控', desc: '谁在学、学到哪、谁卡住、谁切屏,一屏尽收,老师当堂干预。' },
  { name: '课堂大屏', desc: '学习实况投屏教室大屏,比学赶超的氛围现成就有。' },
  { name: '作业系统', desc: '一键布置、自动批改、完成情况一目了然,老师不再收本子对答案。' },
  { name: 'AI 智能组卷', desc: '按范围出卷、按错题千人千卷,备课出题的时间省一大半。' },
  { name: '学情分析 + AI 错因讲解', desc: '每个学生的掌握度、薄弱词、学习质量分随时可查;学生答错,AI 当场讲清为什么错。' },
  { name: '精细化分配', desc: '分配即权限:学生只学老师划定的书和单元,节奏完全在老师手里。' },
];

const OPERATION = [
  { name: 'AI 测评招生漏斗', desc: '家长扫码免费测评 → 自动生成专业水平报告 → 进入机构线索池跟进转化。地推、家长会、朋友圈都能用,自带获客。' },
  { name: '机构码招生链接', desc: '专属注册链接 / 机构码,扫码注册自动归入机构名下,招生动线一步到位。' },
  { name: '机构品牌', desc: '系统内展示机构自己的名称与 Logo,家长看到的是"你的系统",品牌沉淀在机构自己身上。' },
  { name: '机构内排行榜 + 竞赛', desc: '排行榜、单词比赛、晋级赛都在机构内部进行,运营活动素材现成,月月有话题。' },
  { name: '家长端 + 学习周报', desc: '家长绑定孩子看学习看板与周报,数据防划水、不掺水——续费谈判时,机构手里有真凭据。' },
  { name: '兑换码体系', desc: '学生账号用兑换码开通,发多少、给谁用,机构自主掌握,收费节奏自己定。' },
];

function PitchDoc() {
  return (
    <article className="text-[13.5px] leading-6 text-slate-800">
      {/* 封面头 */}
      <header className="border-b-4 border-[#FF6B35] pb-5 text-center">
        <p className="text-[13px] font-semibold tracking-[0.3em] text-[#FF6B35]">飞鹰AI英语 · 智能英语学习系统</p>
        <h1 className="mt-2 text-[30px] font-black leading-tight text-slate-900">功能详解与提分方案</h1>
        <p className="mt-2 text-[14px] text-slate-500">教 · 学 · 测 · 评 · 赛 完整闭环 | 加盟合作版</p>
        <div className="mx-auto mt-5 grid max-w-xl grid-cols-4 gap-2 text-center">
          {[
            ['8+', '种学习模式'],
            ['全托', '书本全开放'],
            ['AI', '批改与出题'],
            ['闭环', '教学测评赛'],
          ].map(([big, small]) => (
            <div key={small} className="rounded-lg border border-orange-200 bg-[#FFF8F0] px-2 py-2.5">
              <p className="text-[18px] font-black text-[#FF6B35]">{big}</p>
              <p className="mt-0.5 text-[11px] text-slate-600">{small}</p>
            </div>
          ))}
        </div>
      </header>

      {/* 一、提分逻辑 */}
      <PitchSection no="一" title="提分的逻辑:为什么从单词入手">
        <p>
          英语成绩的地基是词汇:听力听不懂、阅读读不快、写作写不出,追根到底大多是<strong>词汇量不够、拼写不熟</strong>。
          而中高考对词汇的要求是"会写"——不是"看着眼熟"。
        </p>
        <p className="mt-2">大多数孩子的问题不是不学,而是卡在三个断点上:</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[
            ['记了就忘', '不按遗忘规律复习,背 10 个忘 7 个,努力白费'],
            ['会认不会写', '在手机上点选正确≠卷面上手写正确,考试丢的正是这几分'],
            ['错了不知为何错', '没有错因分析,同一个错误重复到考场上'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <p className="font-bold text-slate-900">{t}</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-2.5">
          本系统针对这三个断点逐一给出解法——这正是它区别于普通"背单词 App"的地方:
          <strong>科学记忆引擎解决"忘"、纸笔听写解决"写"、AI 错因诊断解决"错"</strong>,再用游戏化解决"不想学"。
        </p>
      </PitchSection>

      {/* 二、八种学习模式 */}
      <PitchSection no="二" title="八种学习模式:一个单词从「眼熟」练到「会用」">
        <p>
          每个单词按"认 → 听 → 拼 → 用 → 考"的完整链条训练,配合阅读理解与真人发音口语评测,
          覆盖从记单词到出成绩的每一步:
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {LEARNING_MODES.map((m) => (
            <div key={m.name} className="rounded-lg border border-slate-200 p-2.5" style={{ breakInside: 'avoid' }}>
              <p className="font-bold text-slate-900">{m.name}</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600">{m.desc}</p>
              <p className="mt-1 text-[12px] leading-5"><span className="font-semibold text-[#FF6B35]">提分点:</span>{m.gain}</p>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[12.5px] text-slate-600">
          另有:<strong>阅读理解训练</strong>(篇章 + 竞赛题库,词汇量落到阅读分)、
          <strong>真人发音与口语评测跟读</strong>(不请外教也能练发音)、
          <strong>自然拼读启蒙</strong>(零基础学员的拼读入门)。
        </p>
      </PitchSection>

      {/* 三、科学记忆引擎 */}
      <PitchSection no="三" title="科学记忆引擎:记得住,才有分">
        <p>
          普通 App 只管"学过",本系统管"记住"。六个机制协同,把有限的学习时间全部花在刀刃上:
        </p>
        <FeatureList items={MEMORY_ENGINE} />
      </PitchSection>

      {/* 四、纸笔听写(高亮) */}
      <section className="mt-6 rounded-xl border-2 border-[#FF6B35] bg-[#FFF8F0] p-4" style={{ breakInside: 'avoid' }}>
        <p className="text-[12px] font-bold tracking-widest text-[#FF6B35]">核心亮点</p>
        <h2 className="mt-1 text-[19px] font-black text-slate-900">四、纸笔听写:打通提分的「最后一公里」</h2>
        <p className="mt-2">
          考试是纸笔手写的,App 里点对了不等于卷面上写得出。本系统把线上学习直接接到纸面上:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>App 自动报词(真人发音,可调语速与遍数),学生<strong>写在纸上</strong>;</li>
          <li>写完<strong>拍一张照</strong>,AI 视觉模型逐词识别批改,对错立判;</li>
          <li>写错的词自动进入薄弱词循环,下次任务优先复习;成绩与其他模式一样计入学情档案。</li>
        </ol>
        <p className="mt-2">
          还可一键打印<strong>标准四线三格默写纸</strong>(听写版 / 看中文默写版),页眉自动印上学生名字,
          课堂听写、家庭默写直接用。<strong>这是把线上练习真正变成卷面分数的关键一步,也是同类产品普遍没有的能力。</strong>
        </p>
      </section>

      {/* 五、游戏化 */}
      <PitchSection no="五" title="让孩子主动学:游戏化激励体系">
        <p>
          提分的前提是"练够量",游戏化解决的是孩子<strong>愿不愿意练</strong>的问题——同时用防划水机制保证练的是真量:
        </p>
        <FeatureList items={GAMIFICATION} />
      </PitchSection>

      {/* 六、教学闭环 */}
      <PitchSection no="六" title="老师教得准、教得省:教学管理闭环">
        <p>
          机构不用自建技术团队,开箱就有大机构级别的数字化教学能力;一个老师能带的学生数明显提升:
        </p>
        <FeatureList items={TEACHING_LOOP} />
      </PitchSection>

      {/* 七、机构经营赋能 */}
      <PitchSection no="七" title="帮机构招生与续费:经营赋能">
        <p>机构老板最关心的三件事——招得来、留得住、教得省,系统对着这三点逐一配了工具:</p>
        <FeatureList items={OPERATION} />
      </PitchSection>

      {/* 八、合作方案 */}
      <PitchSection no="八" title="合作方案:一笔算得清的账">
        <table className="mt-1 w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-[#FFF3EC]">
              <th className="border border-orange-200 px-2 py-1.5 text-center font-bold">项目</th>
              <th className="border border-orange-200 px-2 py-1.5 text-center font-bold">标准</th>
              <th className="border border-orange-200 px-2 py-1.5 text-center font-bold">说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-orange-200 px-2 py-1.5 text-center">年度服务费</td>
              <td className="border border-orange-200 px-2 py-1.5 text-center font-bold text-[#FF6B35]">¥12,000 / 年</td>
              <td className="border border-orange-200 px-2 py-1.5">含 100 个学生账号,<strong>系统内全部书本内容开放</strong>,教师 / 管理账号不限</td>
            </tr>
            <tr>
              <td className="border border-orange-200 px-2 py-1.5 text-center">超出 100 名</td>
              <td className="border border-orange-200 px-2 py-1.5 text-center font-bold text-[#FF6B35]">¥100 / 生 / 年</td>
              <td className="border border-orange-200 px-2 py-1.5">按实际开通数量计费,招得越多,均摊越低</td>
            </tr>
            <tr>
              <td className="border border-orange-200 px-2 py-1.5 text-center">升级与培训</td>
              <td className="border border-orange-200 px-2 py-1.5 text-center font-bold text-[#FF6B35]">免费</td>
              <td className="border border-orange-200 px-2 py-1.5">新功能自动同步;教师全员使用培训</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ['¥120', '每生每年(100 人满员时)'],
            ['¥10', '折合每生每月'],
            ['不到 4 毛', '折合每生每天'],
          ].map(([big, small]) => (
            <div key={small} className="rounded-lg border border-orange-200 bg-[#FFF8F0] px-2 py-2.5">
              <p className="text-[18px] font-black text-[#FF6B35]">{big}</p>
              <p className="mt-0.5 text-[11px] text-slate-600">{small}</p>
            </div>
          ))}
        </div>
        <p className="mt-3">
          <strong>投入产出参考</strong>(仅供测算,终端定价由机构完全自主,平台不干涉,亦不构成收益承诺):
          机构若将系统打包进课程、或按 200–300 元 / 本向学员收取智能学习服务费,100 名学生学一本书即对应
          2–3 万元流水,一年多本滚动开课、按本数叠加;系统成本 1.2 万元 / 年,摊到每个学生约 120 元,
          不到一本书服务费的一半。
        </p>
      </PitchSection>

      {/* 九、合作保障 */}
      <PitchSection no="九" title="为什么可以放心合作">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>区域保护</strong>:经营场所导航三公里内不再发展第二家合作点,写进协议。</li>
          <li><strong>一年一签</strong>:先跑通再续签,机构风险可控;正常履约享同等条件优先续签权。</li>
          <li><strong>数据隔离</strong>:机构学员数据独立隔离,平台不用于向机构学员直接招生。</li>
          <li><strong>品牌归你</strong>:系统内展示机构自己的名称与 Logo,口碑沉淀在机构自己身上。</li>
          <li><strong>持续迭代</strong>:系统每月都在更新(近期上线:纸笔听写 AI 批改、书本全托开放),服务期内全部免费同步。</li>
        </ul>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px]" style={{ breakInside: 'avoid' }}>
          <p className="font-bold text-slate-900">合作咨询</p>
          <p className="mt-1">联系人:<Blank w="8rem" />　　电话:<Blank w="10rem" />　　微信:<Blank w="10rem" /></p>
        </div>
      </PitchSection>

      <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400">
        飞鹰AI英语 · 智能英语学习系统 —— 本资料所述功能以系统实际版本为准
      </footer>
    </article>
  );
}

const PitchSection = ({ no, title, children }: { no: string; title: string; children: React.ReactNode }) => (
  <section className="mt-6">
    <h2 className="flex items-center gap-2 text-[19px] font-black text-slate-900">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#FF6B35] text-[13px] font-bold text-white">{no}</span>
      {title}
    </h2>
    <div className="mt-2.5">{children}</div>
  </section>
);

const FeatureList = ({ items }: { items: Array<{ name: string; desc: string }> }) => (
  <div className="mt-2.5 grid grid-cols-2 gap-2">
    {items.map((f) => (
      <div key={f.name} className="rounded-lg border border-slate-200 p-2.5" style={{ breakInside: 'avoid' }}>
        <p className="font-bold text-slate-900">{f.name}</p>
        <p className="mt-1 text-[12px] leading-5 text-slate-600">{f.desc}</p>
      </div>
    ))}
  </div>
);

/** ============ 页面壳 ============ */
export default function AdminFranchiseKit() {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocKey>('pitch');
  const sheetRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  // 导出 PDF:加盟商要的是一个能微信发出去的文件,不是打印对话框。
  // 文件名带文档类型,发出去对方一眼知道是什么
  const handleDownload = async () => {
    if (!sheetRef.current) return;
    setDownloading(true);
    try {
      await downloadElementAsPdf(sheetRef.current, {
        filename: doc === 'contract' ? '飞鹰AI英语-合作协议' : '飞鹰AI英语-功能详解与提分方案',
      });
    } catch {
      // downloadElementAsPdf 已 toast 提示
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <style>{`
        @page { size: A4; margin: 14mm 13mm; }
        .fk-serif { font-family: 'Songti SC', 'STSong', 'SimSun', serif; }
        .fk-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          body { background: #fff !important; }
          .fk-chrome { display: none !important; }
          .fk-wrap { padding: 0 !important; }
          .fk-sheet { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 !important; max-width: none !important; padding: 0 !important; }
        }
      `}</style>

      {/* 屏幕操作条(打印隐藏) */}
      <div className="fk-chrome sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[880px] flex-wrap items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" /> 返回
          </button>
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setDoc('pitch')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold transition ${doc === 'pitch' ? 'bg-[#FF6B35] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              <Sparkles className="h-4 w-4" /> 提分方案
            </button>
            <button
              type="button"
              onClick={() => setDoc('contract')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold transition ${doc === 'contract' ? 'bg-[#FF6B35] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              <FileSignature className="h-4 w-4" /> 合作协议
            </button>
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-[#FF6B35] px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {downloading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {downloading ? '生成中…' : '下载 PDF'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <Printer className="h-4 w-4" /> 打印
          </button>
        </div>
        <div className="mx-auto max-w-[880px] px-4 pb-2.5 text-xs text-slate-500">
          带下划线的空栏可以直接点击填写,填完再下载,PDF 里会带上填好的内容。「下载 PDF」直接存成文件(可微信发给加盟商);「打印」走浏览器打印对话框。
        </div>
      </div>

      {/* A4 文档区 */}
      <div className="fk-wrap px-3 py-6">
        <div ref={sheetRef} className="fk-sheet mx-auto max-w-[820px] rounded-xl border border-slate-200 bg-white p-10 shadow-sm sm:p-12">
          {doc === 'contract' ? <ContractDoc /> : <PitchDoc />}
        </div>
      </div>
    </div>
  );
}
