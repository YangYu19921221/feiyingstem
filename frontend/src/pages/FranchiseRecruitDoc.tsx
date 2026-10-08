/**
 * 加盟资料中心 · 文档三:招商手册
 *
 * 与「提分方案」分工不同:提分方案讲系统能做什么,招商手册讲**为什么跟我们合作** ——
 * 我们是谁、市场在哪、真实跑出来的数据、钱怎么算、怎么开始。
 *
 * ⚠️ 口径红线(改文案前必读):
 *  1. **广告法第二十四条**:教育培训广告不得明示或暗示升学、通过考试、提分的保证性承诺。
 *     所以学员分数只能以「往届学员个案」出现,且紧跟「个体结果因人而异,不构成效果承诺」;
 *     也不用「颠覆」「最」「第一」这类绝对化用语
 *  2. **未成年人信息**:学员案例一律用「A 同学 / B 同学」,不写真名、不放试卷照片;
 *     老师证书照片上有身份证号,手册只写学历与证书名称
 *  3. **系统数据是生产库实查值**(2026-09-26,直营校区):掌握词数 = word_mastery
 *     mastery_level>=3 按 distinct lower(word) 计,不是 learning_records 行数(classify 会放大);
 *     更新数字要重跑同一口径的 SQL,别凭印象改
 *  4. **价格数字跟着 backend/app/services/card_pack.py 走**(2026-10-08 起新签约按卡包政策:
 *     标准包 ¥60,000 分 3 期 / 四种卡单价 / 赠送),提分方案第八章同口径,改价三处一起改
 *  5. 未核实的数字**留空栏现填**,不替用户编(续费率 90%+ 为用户 09-30 提供,口径=校区缴费数据)
 */

import { PYRAMID } from '../data/franchisePyramid';

/** 空栏:点击可直接输入;留空则打印出下划线供手写(与协议页同一写法) */
const Blank = ({ w = '6rem' }: { w?: string }) => (
  <span
    contentEditable
    suppressContentEditableWarning
    spellCheck={false}
    className="mx-0.5 inline-block min-h-[1.5em] border-b border-slate-600 px-1 text-center align-baseline outline-none focus:bg-amber-50"
    style={{ minWidth: w }}
  />
);

const Section = ({ no, title, children }: { no: string; title: string; children: React.ReactNode }) => (
  <section className="mt-7">
    <h2 className="flex items-center gap-2 text-[19px] font-black text-slate-900" style={{ breakAfter: 'avoid' }}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#FF6B35] text-[13px] font-bold text-white">{no}</span>
      {title}
    </h2>
    <div className="mt-2.5">{children}</div>
  </section>
);

/** 数字牌一行。刻意用 flex 不用 grid:html2pdf 的分页占位元素会挤占 grid 格子导致错位 */
const StatRow = ({ items }: { items: Array<[string, string]> }) => (
  <div className="mt-3 flex gap-2" style={{ breakInside: 'avoid' }}>
    {items.map(([big, small]) => (
      <div key={small} className="flex-1 rounded-lg border border-orange-200 bg-[#FFF8F0] px-2 py-2.5 text-center">
        <p className="text-[18px] font-black text-[#FF6B35]">{big}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-600">{small}</p>
      </div>
    ))}
  </div>
);

/** 两列卡片:一行一个 flex 装两张,不用 grid(理由同上) */
const CardPairs = ({ items }: { items: Array<{ t: string; d: React.ReactNode }> }) => {
  const rows: Array<typeof items> = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return (
    <div className="mt-2.5 space-y-2">
      {rows.map((row) => (
        <div key={row[0].t} className="flex gap-2" style={{ breakInside: 'avoid' }}>
          {row.map((c) => (
            <div key={c.t} className="flex-1 rounded-lg border border-slate-200 p-2.5">
              <p className="font-bold text-slate-900">{c.t}</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600">{c.d}</p>
            </div>
          ))}
          {row.length === 1 && <div className="flex-1" />}
        </div>
      ))}
    </div>
  );
};

const td = 'border border-orange-200 px-2 py-1.5';

const TEACHERS: Array<[string, string]> = [
  ['黄晓晶', '成都理工大学 应用语言学 研究生 · 英语专业八级'],
  ['赵威', '温州大学 英语专业本科 · 英语专业八级'],
  ['宋娟娥', '大理学院 英语专业本科 · 英语专业八级'],
  ['张菊莲', '云南财经大学 经贸英语专业'],
  ['吴姗珊', '新西兰 Unitec 理工学院 商务英语 · TESOL 国际英语教师资格'],
];


// 传统做法 vs 飞鹰做法:每一行都要能在系统里指出对应功能,不写说不出落点的口号
/** 方法课教材(2026-10-08 用户提供)。⚠️ 册次与 franchisePyramid 的「语法第一/二/三册」对应关系待用户确认,别自行合并 */
const METHOD_BOOKS: Array<[string, string, string]> = [
  ['第一册', '音标', '音、形、意结合:看到词会读,听到音会写,背单词不再靠死记硬背'],
  ['第二册', '语法', '覆盖初一(七年级)内容'],
  ['第三册', '语法', '覆盖初二(八年级)内容'],
  ['第四册', '语法', '覆盖初三(九年级)内容'],
];

const COMPARE: Array<[string, string, string]> = [
  ['学习方式', '老师讲、学生抄、考前背,离开老师就不会学', '教音标、拼读和记忆方法,孩子见词会读、听音会写,回家能自己学'],
  ['背单词', '抄写 + 默写,老师逐本批改', '记忆曲线自动排复习,拼写 / 听写 / 纸笔听写系统批改'],
  ['课后练习', '靠家长盯,做没做老师不知道', '作业按天布置,谁没做、做错哪个词老师端实时可见'],
  ['教研', '好老师一走,教法跟着走', '六阶段课程 + 单元测试卷 + 系统内容,新老师照着就能上课'],
  ['学习动力', '靠老师一张嘴', '宠物养成、PK 对战、晋级赛、金币兑换,孩子自己想来'],
  ['家长沟通', '期末一张成绩单', '家长端随时看学了多少、错在哪,续费有据可依'],
];

export default function FranchiseRecruitDoc() {
  return (
    <article className="text-[13.5px] leading-6 text-slate-800">
      {/* 封面头 */}
      <header className="border-b-4 border-[#FF6B35] pb-5 text-center">
        <p className="text-[13px] font-semibold tracking-[0.3em] text-[#FF6B35]">飞鹰英语 · 合作伙伴招募</p>
        <h1 className="mt-2 text-[30px] font-black leading-tight text-slate-900">招商手册</h1>
        <p className="mt-3 text-[17px] font-black text-slate-900">
          不替孩子学,教孩子<span className="text-[#FF6B35]">会学</span>
        </p>
        <p className="mt-1.5 text-[14px] text-slate-600">
          我们自己办了十二年英语校区,这套方法和系统先在自己的学生身上跑通,再交给你。
        </p>
        <StatRow
          items={[
            ['2014', '年起深耕英语教学'],
            ['3 个', '直营校区'],
            ['7000+', '累计服务学员'],
            ['700+', '学员正在系统上学'],
          ]}
        />
      </header>

      {/* 一、我们是谁 */}
      <Section no="一" title="我们是谁">
        <p>
          飞鹰英语前身为 2014 年成立的昆明飞鹰教育信息咨询有限公司,2019 年经昆明市五华区教育局审批,
          取得办学许可,正式成立<strong>昆明市五华区飞鹰教育培训学校</strong>。十二年来只做一件事:英语。
          目前有 3 个校区,累计服务学员 7000 余人。
        </p>
        <p className="mt-2">
          <strong>自有课程体系</strong>:从零基础到高级分六个阶段(1–3 阶段初级、4 阶段中级,5–6 阶段用「果树学」的框架学英语,培养英语思维),
          每阶段 126 课时,每次课 3 课时。每个单元都有配套测试卷,
          覆盖<strong>翻译、听力、语法、作文</strong>四类,老师逐份批改留痕 ——
          教学效果不靠感觉,靠一张张卷子。
        </p>
        <p className="mt-2 font-bold text-slate-900">教研团队(部分)</p>
        <ul className="mt-1 space-y-0.5 pl-5 text-[13px]" style={{ listStyle: 'disc' }}>
          {TEACHERS.map(([name, cv]) => (
            <li key={name}>
              <strong>{name}</strong>:{cv}
            </li>
          ))}
        </ul>
      </Section>

      {/* 二、为什么是现在 */}
      <Section no="二" title="为什么是现在:英语需求没有消失,只是换了做法">
        <p>
          「双减」之后,学科类培训收缩,但家长对孩子英语能力的投入没有停。能留下来的机构,
          靠的是<strong>合规的素质类定位 + 看得见的学习效果</strong>,而不是题海和课时堆砌。
        </p>
        <StatRow
          items={[
            ['6463 亿', '2024 年中国非学科类教育市场规模¹'],
            ['90.86%', '受访家长愿意为素质类课程付费²'],
            ['30 / 100', '云南中考英语中听说占分³'],
          ]}
        />
        <p className="mt-2.5">
          以云南为例,中考英语 100 分中有 30 分是听力和口语 —— 这部分靠刷题拿不到,靠的是
          <strong>词汇量和每天的听说积累</strong>,恰好是系统每天在做的事。县城里家长的需求一样真实,
          缺的是有体系、有工具、能长期带下去的机构。
        </p>
        <p className="mt-2 text-[11px] leading-4 text-slate-400">
          ¹ 艾瑞咨询 2025 年行业报告(咨询机构估算,仅供参考)
          ² 艾媒咨询素质教育行业调研
          ³ 云南省 2025 年初中学业水平考试方案:英语满分 100 分,笔试 70 分 + 听力口语 30 分
        </p>
      </Section>

      {/* 三、痛点 */}
      <Section no="三" title="开英语班,难在哪">
        <CardPairs
          items={[
            { t: '好老师难招,招来也难留', d: '县城专业英语老师少,一个骨干离职,一批学生跟着走。' },
            { t: '教研全靠个人', d: '每个老师一套教法,新老师上手慢,教学质量忽高忽低。' },
            { t: '课后没人管', d: '课上会了课后忘,家长看不到过程,只看期末分数。' },
            { t: '续费靠人情', d: '拿不出孩子进步的证据,续费全凭家长对老师的信任。' },
          ]}
        />
      </Section>

      {/* 四、我们的做法 —— 教学理念「教方法、培养自学能力」放在最前面(2026-09-27 用户要求)。
          措辞刻意不用「颠覆」这类绝对化用语(广告法第 9 条),每一种"方法"都要能在系统里指出落点 */}
      <Section no="四" title="我们不一样:不灌知识,教方法,引导式学习">
        <p>
          传统英语课是「老师讲、学生记」:单词靠抄,语法靠背,孩子离开课堂就不知道怎么学,
          成绩全押在上课那几个小时上。飞鹰这十二年反过来做 ——
          <strong>课堂上教的是方法,老师不教孩子任何一个单词和句子,只做引导</strong>,目标是让孩子自己会学。
          这就是<strong>引导式学习:以结果为导向,反向推理</strong> —— 先让孩子看到要达成的结果,
          再由他自己一步步推出怎么做到。一个会自学的孩子,
          离开老师照样能往前走,这才是家长真正愿意长期买单的东西。
        </p>
        <p className="mt-2.5 font-bold text-slate-900">我们教孩子四样方法</p>
        <CardPairs
          items={[
            { t: '看词会读,听音会写', d: '从音标入手,弄懂字母和发音的对应规律。新词不用等老师领读,自己就能拼、能读。' },
            { t: '会记,也会复习', d: '用词根、联想等记忆法把词记牢,再按记忆曲线安排复习 —— 孩子知道今天该复习哪些,不再从头死背。' },
            { t: '会找自己的错', d: '拼错了系统指出错在哪个字母、属于哪类错误,孩子学会看自己的错,而不是抄十遍正确答案。' },
            { t: '会安排自己的学习', d: '每天有明确的任务清单,做完、做对多少一目了然。从「老师催着学」慢慢变成「自己知道要学什么」。' },
          ]}
        />
        <p className="mt-4 font-bold text-slate-900">学习路线图:语素金字塔</p>
        <p className="mt-1">
          <strong>授人以鱼,不如授人以渔。</strong>
          路线从最宽的塔基往上走:先用《单词记忆法》把背单词的方法练扎实,再用飞鹰独创的「写作翻译式」教学,
          通过三册语法把初中语法主体学完,之后初高衔接、高中高考。走到塔尖时,孩子已经能自己有效阅读、高效背单词,
          考研、四六级、雅思托福可以自学,也可以选择继续深造。
        </p>
        <div className="mt-2.5 flex flex-col items-center gap-1" style={{ breakInside: 'avoid' }}>
          {PYRAMID.map((row, i) => (
            <div
              key={row.stage}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] ${row.top ? 'bg-[#FF6B35] text-white' : i < 3 ? 'bg-[#FFE3D3] text-slate-900' : 'bg-[#FFF3EC] text-slate-900'}`}
              style={{ width: `${58 + i * 7}%` }}
            >
              <span className="shrink-0 font-black">{row.stage}</span>
              <span className="min-w-0 flex-1 font-semibold">{row.name}</span>
              {row.note && <span className={`text-right text-[11px] leading-4 ${row.top ? 'text-white/90' : 'text-[#c2410c]'}`}>{row.note}</span>}
            </div>
          ))}
        </div>
        <CardPairs
          items={[
            { t: '每天的节奏', d: '每天用方法背 6 个新词,再读一篇绘本或短文,合计不超过 20 分钟。按这个规划,约半年学完小学词汇,三年学完初高中词汇 —— 靠的是每天不断,不是考前突击。' },
            { t: '家长的角色', d: '学校课本孩子完全可以自学,但「喂到嘴里的饭要自己咽下去」:课本单词和知识点不背熟,成绩就上不去。老师每天记录作业完成情况并及时反馈,家长负责督促孩子每天完成。' },
          ]}
        />
        {/* 方法课(2026-10-08 用户提供)。用户原话「背单词速度是 3–5 倍」无出处未采用(同「词汇量增长 90%」口径),
            「举一反百」改为「举一反三」;词汇目标写成规划而非承诺(广告法第 24 条) */}
        <p className="mt-4 font-bold text-slate-900">方法课:¥1,000,含四册教材</p>
        <p className="mt-1">
          方法课学费 ¥1,000,含下面四册教材,另<strong>赠送阅读绘本 2 本</strong>和<strong>必背绘本 1 本</strong>
          —— 读的用来养语感,背的用来打底子。
        </p>
        <table className="mt-2 w-full border-collapse text-[12.5px]" style={{ breakInside: 'avoid' }}>
          <thead>
            <tr className="bg-[#FFF3EC]">
              <th className={`${td} w-[16%] text-center font-bold`}>教材</th>
              <th className={`${td} w-[24%] text-center font-bold`}>内容</th>
              <th className={`${td} text-center font-bold`}>学什么</th>
            </tr>
          </thead>
          <tbody>
            {METHOD_BOOKS.map(([k, name, what]) => (
              <tr key={k}>
                <td className={`${td} text-center font-semibold`}>{k}</td>
                <td className={`${td} text-center`}>{name}</td>
                <td className={td}>{what}</td>
              </tr>
            ))}
            <tr>
              <td className={`${td} text-center font-semibold`}>赠送</td>
              <td className={`${td} text-center`}>绘本 3 本</td>
              <td className={td}>阅读绘本 2 本 + 必背绘本 1 本</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2">
          <strong>词汇目标</strong>:按课程规划,一年左右背完小学词汇,小升初前背完初中词汇和 3500 基础词汇,
          带着四千多词的词汇量进初中。语法也可以提前学,直营校区目前已有三年级的孩子在学第二册。
        </p>
        <p className="mt-2">
          <strong>为什么词汇量要先行</strong>:初高中的阅读理解,文章大多选自课外时文,课本里学过的词远远不够。
          词汇量上去了,孩子才听得懂老师讲课、读得进阅读理解。
        </p>
        <p className="mt-2">
          <strong>用学数学的思路学英语</strong>:归类、整合,把零散的知识点搭成框架。
          飞鹰教过的知识点,换到任何一版教材里孩子都认得、会用 —— 学一个,会一类,举一反三。
        </p>
        <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
          以上为课程规划进度,实际进度受孩子基础和每天投入时间影响,因人而异。
        </p>

        <p className="mt-2 text-[13px] text-slate-700">
          坚持 1 米的宽度、10 公里的深度 —— 我们不追求什么都教一点,而是把一条路走深。
        </p>

        <p className="mt-3 font-bold text-slate-900">同一件事,两种做法</p>
        <table className="mt-1 w-full border-collapse text-[12.5px]" style={{ breakInside: 'avoid' }}>
          <thead>
            <tr className="bg-[#FFF3EC]">
              <th className={`${td} w-[16%] text-center font-bold`}>环节</th>
              <th className={`${td} w-[38%] text-center font-bold`}>常见做法</th>
              <th className={`${td} text-center font-bold`}>飞鹰做法</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map(([k, old, now]) => (
              <tr key={k}>
                <td className={`${td} text-center font-semibold`}>{k}</td>
                <td className={`${td} text-slate-500`}>{old}</td>
                <td className={td}>{now}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2.5">
          一句话:<strong>老师教方法,系统陪孩子练,孩子学会自己学、自己读</strong>。线下课堂上,老师的时间花在讲方法、带阅读和答疑上;
          线上系统里,背单词、批作业、盯进度交给系统 —— <strong>线上线下结合</strong>,这也是一个县城机构两三位老师就能带起上百个学生的原因。
        </p>
      </Section>

      {/* 五、真实数据 */}
      <Section no="五" title="不讲故事,看数据">
        <p>
          以下是飞鹰直营校区学员在系统上的真实使用数据,截至 2026 年 9 月,<strong>全部可在系统后台查证</strong>:
        </p>
        <StatRow
          items={[
            ['744', '名学员在系统上学习'],
            ['3943', '份作业由老师在系统上布置'],
            ['86.4%', '拼写 / 选择 / 填空平均正确率'],
          ]}
        />
        <StatRow
          items={[
            ['7153', '个不同单词被学员掌握'],
            ['97', '名学员掌握 500 词以上'],
            ['39', '名学员掌握 1000 词以上'],
            ['2648', '单个学员最高掌握词数'],
          ]}
        />
        <p className="mt-2 text-[11px] leading-4 text-slate-400">
          「掌握」指同一单词在系统内多次答对、达到掌握标准,同一单词只计一次,不是练习次数。
        </p>

        <p className="mt-3 font-bold text-slate-900">往届学员个案</p>
        <CardPairs
          items={[
            {
              t: 'A 同学 · 零基础入学',
              d: '从零基础开始,完整学完飞鹰五个阶段课程,目前英语水平已可直接备考雅思。',
            },
            {
              t: 'B 同学 · 初二暑假插班',
              d: '入学时学校英语成绩 25 分,暑假两个月集中学习,中考英语取得 98 分,现已出国深造。',
            },
          ]}
        />
        <p className="mt-2">
          校区续费率:<strong>90% 以上</strong>(统计口径:以校区缴费数据为准)
        </p>
        <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
          以上为往届学员个人情况,学习效果受学员基础、投入时间等多种因素影响,个体结果因人而异,
          不构成对学习效果或考试成绩的承诺。
        </p>
      </Section>

      {/* 六、钱怎么算 */}
      <Section no="六" title="投入多少,怎么回本">
        {/* 2026-10-08 起新签约按卡包政策(真源 backend/app/services/card_pack.py,改价那边先改) */}
        <StatRow
          items={[
            ['¥60,000', '标准包 · 分 3 期,每期 ¥20,000'],
            ['450 张', '学生学习卡,每张半年'],
            ['送 10 张', '一次付清加送全通卡'],
          ]}
        />
        <p className="mt-2.5">
          标准包全部是学生学习卡,不收另外的加盟费。卡分四种,家长要什么你就发什么:
          <strong>入门卡</strong>(¥10,招生体验)、<strong>单册卡</strong>(¥60,一本课本)、
          <strong>学段卡</strong>(¥200,一个学段全套课本)、<strong>全通卡</strong>(¥400,小学到高中全套)。
          每张卡从学生兑换那天起有效半年,兑换码 5 年内有效,不用担心囤卡过期。
        </p>
        <p className="mt-2">
          <strong>分 3 期付,先拿卡先招生</strong>:签约付第 1 期 ¥20,000,拿到 100 张入门卡和 115 张正式卡;
          之后每 3 个月一期,每到账一期就开通这一期的卡。卡卖得快可以提前付下一期。
          3 期付完还要卡就按单价补货,每种 20 张起;考纲词汇等精品书另有精品卡(¥150)。
        </p>
        <p className="mt-2">
          <strong>终端收费由你自己定</strong>。按常见零售价测算(单册卡 ¥150、学段卡 ¥500、全通卡 ¥800),
          第 1 期的正式卡全部售出约对应 4.5 万元流水,高于当期投入。
        </p>
        <p className="mt-2">
          <strong>直营校区定价参考</strong>:每阶段 120 课时,学费 ¥11,880(第 1 阶段另收资料费 ¥280);
          初中学员按学情调整教学方案、按课时收费;小学《语法》免费上,作为引流课。你可以参照这个结构定自己的价。
        </p>
        <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
          测算仅供参考,不构成收益承诺。完整费用明细(飞鹰专属内容、配套教材、带教培训)见《功能详解与提分方案》第八章及合作协议。
        </p>
      </Section>

      {/* 七、支持 */}
      <Section no="七" title="签约之后,我们给你什么">
        <CardPairs
          items={[
            { t: '独立机构后台', d: '签约即开通,你的学员数据独立隔离,统一使用飞鹰品牌名称和 Logo。' },
            { t: '区域保护', d: '以合作点为中心,直线距离 3 公里内不再发展第二家合作点,写进协议,不是口头承诺。' },
            { t: '课程与内容', d: '小学到高中主流教材同步内容全开放;可选配飞鹰自研课程内容。' },
            { t: '带教培训', d: '到飞鹰直营校区跟岗学习,看我们的老师怎么排课、怎么用系统带班(自费)。' },
            { t: '招生工具', d: 'AI 英语测评、招生链接、兑换码,开班前就能先做一轮测评活动。' },
            { t: '持续升级', d: '系统每月更新,新功能、新内容在服务期内免费同步。' },
          ]}
        />
      </Section>

      {/* 八、适合谁 */}
      <Section no="八" title="我们在找什么样的伙伴">
        <ul className="list-disc space-y-1 pl-5">
          <li>已经有校区、有生源的英语或综合类培训机构,想把英语做深做稳;</li>
          <li>至少有 1–2 位能上英语课的老师,愿意按体系教、按数据管;</li>
          <li>认同「效果靠每天练出来」,不想靠压课时、刷题海留学生;</li>
          <li>打算在当地长期做下去,而不是赚一波就走。</li>
        </ul>
      </Section>

      {/* 九、流程 */}
      <Section no="九" title="合作流程">
        <div className="mt-1 flex items-stretch gap-1.5 text-center text-[12px]" style={{ breakInside: 'avoid' }}>
          {[
            ['1', '沟通咨询', '了解你的校区与生源'],
            ['2', '免费体验', '开通体验账号,老师学生先用起来'],
            ['3', '考察交流', '来直营校区看课,或线上演示'],
            ['4', '签约开通', '签协议、付款,当天开通后台'],
            ['5', '带教开课', '老师培训后开班招生'],
          ].map(([n, t, d]) => (
            <div key={n} className="flex-1 rounded-lg border border-orange-200 bg-[#FFF8F0] px-1.5 py-2">
              <p className="text-[16px] font-black text-[#FF6B35]">{n}</p>
              <p className="font-bold text-slate-900">{t}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 十、常见问题 */}
      <Section no="十" title="常见问题">
        <div className="space-y-2.5">
          {[
            [
              '我这边英语老师不强,能做吗?',
              '可以。单词、听写、作业批改由系统完成,老师主要负责组织课堂和答疑;带教培训会教你们怎么用系统带班。',
            ],
            [
              '能保证学生提分吗?',
              '我们不承诺分数,也不建议你对家长承诺分数。我们能保证的是:① 自主阅读能力;② 技巧背单词;③ 双路线 —— 国内中高考 + 国际雅思托福能力打底,考试落地,夯实学术英语基础,完成能力过渡。',
            ],
            [
              '家长问「报了飞鹰,成绩马上就能上去吗?」怎么答?',
              '照实说:不会马上。飞鹰培养的是孩子的英语学习能力,这是一辈子的技能;学完一阶课程,孩子能自己读学校的单词和课文,但只会读、不背熟课本单词和知识点,在校成绩一样考不好。所以需要家长每天督促孩子完成老师建议的作业,老师会记录并反馈每天的完成情况。',
            ],
            [
              '一年后不想续了怎么办?',
              '协议一年一签。到期不续即可,已售出的学习卡在有效期内照常使用,不会影响你的学员。',
            ],
            [
              '学员数据归谁?',
              '机构数据独立隔离存储,平台不会拿你的学员资料向学员直接招生。',
            ],
          ].map(([q, a]) => (
            <div key={q} style={{ breakInside: 'avoid' }}>
              <p className="font-bold text-slate-900">问:{q}</p>
              <p className="mt-0.5 text-slate-700">答:{a}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px]" style={{ breakInside: 'avoid' }}>
          <p className="font-bold text-slate-900">合作咨询</p>
          <p className="mt-1">
            联系人:<Blank w="7rem" />{'\u3000\u3000'}电话:<Blank w="9rem" />{'\u3000\u3000'}微信:<Blank w="9rem" />
          </p>
          <p className="mt-1">校区地址:<Blank w="24rem" /></p>
        </div>
      </Section>

      <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400">
        昆明市五华区飞鹰教育培训学校 · 飞鹰AI英语 —— 本手册所述数据与功能以系统实际情况为准
      </footer>
    </article>
  );
}
