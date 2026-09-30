/**
 * 加盟资料中心 · 文档四:家长招生成交手册
 *
 * 给**合作机构的招生/咨询老师**用的,讲怎么把一个来咨询的家长谈成报名 —— 不是给家长的宣传单。
 * 核心思路:家长买单不是因为听到承诺,而是因为**看见**(看见孩子的问题、看见方法、看见每天的进度),
 * 所以整套流程围绕「测评报告 → 体验课 → 家长端演示」三次让家长看见来排。
 *
 * ⚠️ 口径红线与招商手册(FranchiseRecruitDoc)同一套,改文案前必读:
 *  1. **广告法第二十四条**:不承诺分数、升学、通过考试;个案必须带「个体结果因人而异」。
 *     第八章「哪些话不能说」就是把这条翻译成咨询老师的日常用语,机构违规宣传的风险在机构,
 *     但砸的是飞鹰的牌子
 *  2. 未成年人一律 A/B 同学,不放试卷照片
 *  3. 数据与招商手册第五章同源(2026-09-26 直营校区生产库实查),那边更新这里同步
 *  4. **机构自己的价格、课时、体验课安排一律留空栏**,不替机构定价
 *  5. 不写「成交率提升 N%」这类没有数据的数字
 */

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

/** 话术框:引号里的是可以直接对家长说的原话 */
const Say = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-2 rounded-lg border-l-4 border-[#FF6B35] bg-[#FFF8F0] px-3 py-2 text-[13px] leading-6 text-slate-800" style={{ breakInside: 'avoid' }}>
    {children}
  </div>
);

const td = 'border border-orange-200 px-2 py-1.5';

// 成交五步:每一步都要让家长「看见」一样东西,看不见的步骤家长会跳过或流失
const STEPS: Array<{ n: string; t: string; see: string; tool: string; goal: string }> = [
  { n: '1', t: '引流', see: '一个免费、有用的东西', tool: 'AI 英语测评链接 / 小学语法免费课 / 机构招生码', goal: '留下联系方式,约到测评或试听' },
  { n: '2', t: '测评', see: '孩子的真实问题', tool: 'AI 英语测评,当场出报告', goal: '家长认同「问题在方法,不在孩子笨」' },
  { n: '3', t: '体验', see: '孩子当场学会一个方法', tool: '体验课 + 学生端现场练', goal: '孩子愿意来,家长看到变化' },
  { n: '4', t: '面谈', see: '报名后每天能看到什么', tool: '家长端演示 + 学习路线图', goal: '家长明白学什么、多久、怎么配合' },
  { n: '5', t: '报名', see: '第一周的学习安排', tool: '开学习卡 + 当场绑定家长端', goal: '当天开学,不留「回去再想想」' },
];

// 家长常见顾虑。答法原则:先认同,再给事实,最后落到「您可以看得见」
const FAQ: Array<[string, string]> = [
  [
    '报了能提多少分?',
    '分数我们不承诺,谁承诺谁不靠谱。我们能给孩子的是三样能力:自己能读英语、有技巧地背单词、国内中高考和雅思托福两条路都打好底。能力上来了,分数是跟着走的 —— 而且每天学了什么、对了多少,您在手机上都看得到。',
  ],
  [
    '多久能见效?',
    '看孩子基础和每天坚持的程度。按我们的节奏每天用方法背 6 个词、读一篇短文,不超过 20 分钟,约半年能把小学词汇学完。成绩不会马上上去,但孩子会不会自己读单词、背得快不快,一两周您就能看出来。',
  ],
  [
    '孩子基础很差 / 一直不喜欢英语,能学吗?',
    '基础差的孩子反而最适合,我们是从音标和背单词的方法教起的,不是接着学校进度往下讲。至于喜不喜欢 —— 刚才体验课您也看到了,孩子学会一个方法、自己读出一个新词,兴趣是这么来的。',
  ],
  [
    '我们工作忙,没时间辅导怎么办?',
    '不用您辅导,英语您也不需要会。您只做一件事:每天督促孩子把老师的作业做完。做没做、做对多少,系统会记下来,老师也会反馈给您,您看手机就行。',
  ],
  [
    '和其他机构 / 学校补课有什么不同?',
    '一般补课是老师讲、孩子记,离开老师就不会学。我们课堂上老师不教孩子任何一个单词和句子,只教方法、做引导,让孩子自己学会;课后的背单词、听写、批改交给系统,每天都在练,不是一周只学上课那两小时。',
  ],
  [
    '价格有点高,我回去考虑一下。',
    '可以理解。您可以算一笔账:一个阶段 ¥____,折合每天 ¥____,孩子每天都在练、您每天都看得到。今天报名我们当场开卡、帮您绑好家长端,孩子今晚就能开始第一次练习。(若仍犹豫:约定具体回访时间,不要只说「等您消息」)',
  ],
  [
    '学不好能退吗?',
    '按本校区退费规定执行:____(机构填写,报名前书面告知家长)。',
  ],
];

// 广告法第 24 条翻译成咨询老师的日常用语
const REDLINE: Array<[string, string]> = [
  ['保证提 20 分 / 包过 / 考不上退钱', '不承诺分数;可以说「我们培养的是自主阅读、技巧背单词的能力」'],
  ['上了我们的课能考上 ×× 中学', '不承诺升学;可以介绍学习路线图每个阶段学什么'],
  ['全县最好 / 第一 / 最专业', '不用绝对化用语;说具体的:「2014 年起只做英语」'],
  ['某某同学(真名)中考考了 98', '个案用 A/B 同学,说完必须加「每个孩子情况不同,因人而异」'],
  ['发试卷照片 / 成绩单截图到朋友圈', '不发;可以发孩子学习时长、掌握词数这类学习过程数据(征得家长同意、隐去姓名)'],
];

export default function FranchiseParentDoc() {
  return (
    <article className="text-[13.5px] leading-6 text-slate-800">
      {/* 封面头 */}
      <header className="border-b-4 border-[#FF6B35] pb-5 text-center">
        <p className="text-[13px] font-semibold tracking-[0.3em] text-[#FF6B35]">飞鹰英语 · 合作机构招生工具</p>
        <h1 className="mt-2 text-[30px] font-black leading-tight text-slate-900">家长招生成交手册</h1>
        <p className="mt-3 text-[17px] font-black text-slate-900">
          家长买单,不是因为听到承诺,是因为<span className="text-[#FF6B35]">看见</span>
        </p>
        <p className="mt-1.5 text-[14px] text-slate-600">
          给校区招生、咨询老师用:从家长第一次咨询到报名开学,每一步做什么、说什么、给家长看什么。
        </p>
      </header>

      {/* 一、家长在担心什么 */}
      <Section no="一" title="先想清楚:家长在担心什么">
        <p>
          来咨询的家长,嘴上问的是「多少钱」「能提多少分」,心里担心的通常是这三件事。
          咨询的全部工作,就是把这三件事<strong>一件件让家长亲眼看到解决办法</strong>:
        </p>
        <CardPairs
          items={[
            { t: '「背了就忘,白花钱」', d: '以前报过班,单词抄了几十遍,一个月后全忘了。→ 让家长看到:我们教的是记单词的方法,系统按记忆曲线自动排复习。' },
            { t: '「学得怎么样,我不知道」', d: '钱交了,孩子到底学没学、学会没有,只能等期末成绩。→ 让家长看到:家长端每天的学习记录、错词和周报。' },
            { t: '「我没时间,也辅导不了」', d: '父母英语不好或工作忙,作业没人管。→ 让家长看到:背单词、听写、批改由系统完成,家长只需要督促。' },
            { t: '「孩子不愿意去」', d: '报了班孩子不想去,最后不了了之。→ 让家长看到:体验课上孩子自己学会了一个方法,以及宠物、PK 这些孩子自己想玩的东西。' },
          ]}
        />
        <p className="mt-2.5">
          <strong>一条原则:少讲,多给看。</strong>讲十分钟方法论,不如让孩子当场自己读出一个没学过的单词。
        </p>
      </Section>

      {/* 二、成交五步 */}
      <Section no="二" title="成交五步:每一步让家长看见一样东西">
        <table className="mt-1 w-full border-collapse text-[12.5px]" style={{ breakInside: 'avoid' }}>
          <thead>
            <tr className="bg-[#FFF3EC]">
              <th className={`${td} w-[11%] text-center font-bold`}>步骤</th>
              <th className={`${td} w-[22%] text-center font-bold`}>让家长看见</th>
              <th className={`${td} w-[36%] text-center font-bold`}>用什么</th>
              <th className={`${td} text-center font-bold`}>这一步的目标</th>
            </tr>
          </thead>
          <tbody>
            {STEPS.map((s) => (
              <tr key={s.n}>
                <td className={`${td} text-center font-semibold`}>
                  <span className="text-[#FF6B35]">{s.n}</span> {s.t}
                </td>
                <td className={td}>{s.see}</td>
                <td className={`${td} text-slate-600`}>{s.tool}</td>
                <td className={td}>{s.goal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2.5 font-bold text-slate-900">第 1 步 引流:先给有用的东西,再谈报名</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li><strong>AI 英语测评</strong>:把测评链接发到家长群、朋友圈,孩子手机上做完即出报告,家长留手机号查看完整报告 —— 线索自动进后台「测评线索」,不用手抄。</li>
          <li><strong>小学语法免费课</strong>:直营校区的做法是小学《语法》免费上,作为引流课,家长先看到效果再谈付费课程。</li>
          <li><strong>老学员转介绍</strong>:最便宜、成交率最高的来源,做法见第七章。</li>
        </ul>
        <p className="mt-2.5 font-bold text-slate-900">第 2 步 测评:让家长认同「问题在方法」</p>
        <p className="mt-1">
          拿着报告跟家长一起看,指出<strong>具体</strong>的问题(比如:认识的单词会选、但拼不出来;看到生词完全不会读),
          然后告诉家长:这不是孩子笨,是没人教过方法。
        </p>
        <Say>
          「您看,孩子认识这些单词,但一拼就错 —— 说明他是靠死记字母顺序在背,背得慢、忘得快。
          我们第一阶段先教的就是这个:看到单词会读、听到发音会写。」
        </Say>
        <p className="mt-2.5 font-bold text-slate-900">第 3 步 体验课:让孩子当场学会一个方法</p>
        <p className="mt-1">
          体验课不讲知识点,只做一件事:教一个方法,让孩子<strong>自己</strong>用它读出、记住几个没学过的单词,
          再在学生端上练一轮,系统当场判对错。下课时家长问孩子「学会了吗」,孩子能自己演示给家长看,这节课就成功了。
        </p>
        <p className="mt-1 text-[12.5px] text-slate-600">
          本校区体验课安排:时长 <Blank w="4rem" /> 分钟,授课老师 <Blank w="5rem" />,预约方式 <Blank w="10rem" />
        </p>
      </Section>

      {/* 三、三分钟讲清飞鹰 */}
      <Section no="三" title="面谈:三分钟讲清我们教什么">
        <p>面谈时按这个顺序讲,每段一两句,讲完立刻进入第四章的演示:</p>
        <Say>
          <strong>① 学方法,不灌知识。</strong>「我们课堂上老师不教孩子任何一个单词和句子,只教方法、做引导。
          孩子学会自己背单词、自己读,离开老师也能往前走。」
        </Say>
        <Say>
          <strong>② 线上线下结合,每天都在练。</strong>「线下课老师讲方法、带阅读、答疑;回家每天用系统背 6 个词、读一篇短文,
          不超过 20 分钟。系统按记忆曲线安排复习,听写、批改都是自动的。」
        </Say>
        <Say>
          <strong>③ 我们能给孩子的三样能力。</strong>「自主阅读能力、有技巧地背单词,还有双路线 ——
          国内中高考和国际雅思托福的能力一起打底。」
        </Say>
        <Say>
          <strong>④ 您每天都看得见。</strong>「孩子今天学没学、学了多少、错在哪,您手机上随时能看,每周还有一份学情周报。」
        </Say>
        <p className="mt-3 font-bold text-slate-900">给家长看学习路线(语素金字塔)</p>
        <p className="mt-1">
          家长最想知道「学完能到什么程度」。用招商手册第四章的路线图,从第 1 阶段《单词记忆法》讲起,
          指给家长看孩子现在该从哪一阶开始、每一阶学什么。<strong>只讲每个阶段学什么内容,不讲考多少分。</strong>
        </p>
        <p className="mt-3 font-bold text-slate-900">可以引用的真实数据</p>
        <StatRow
          items={[
            ['2014', '年起只做英语'],
            ['7000+', '累计服务学员'],
            ['90%+', '直营校区续费率'],
            ['7153', '个不同单词被学员掌握'],
          ]}
        />
        <p className="mt-2">
          往届个案(只能这样讲):A 同学零基础入学,学完五个阶段,目前可直接备考雅思;B 同学初二暑假插班,入学时学校英语 25 分,
          暑假集中学习两个月,中考英语 98 分。<strong>讲完必须加一句:「每个孩子基础和投入不一样,结果因人而异。」</strong>
        </p>
        <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
          数据来源:飞鹰直营校区,截至 2026 年 9 月;续费率以校区缴费数据为准。个案为往届学员个人情况,不构成效果承诺。
        </p>
      </Section>

      {/* 四、现场演示 */}
      <Section no="四" title="现场演示:把手机递给家长">
        <p>
          这一步最容易被省略,却最决定成交。准备一个<strong>演示用的学生账号</strong>(有一两周学习记录的),
          把手机或平板直接递到家长手里,让家长自己点:
        </p>
        <CardPairs
          items={[
            { t: '家长端 · 今日状态', d: '今天学没学、学了多少分钟、复习完没有 —— 「您下班路上打开看一眼就知道。」' },
            { t: '家长端 · 学习日历', d: '每天有没有坚持,一格一格看得清 —— 「断了哪天,一眼就看出来。」' },
            { t: '家长端 · 薄弱词 / 学情周报', d: '孩子错在哪些词、这周比上周进步在哪 —— 「不用等期末成绩单。」' },
            { t: '学生端 · 背单词和听写', d: '拼错了系统指出错在哪个字母,听写自动批改 —— 「这些不用您管。」' },
            { t: '学生端 · 宠物与 PK', d: '学得越多宠物长得越大,和同学 PK 背单词 —— 「孩子愿意自己打开,您不用天天催。」' },
            { t: '老师端 · 作业完成情况', d: '(可选)给家长看老师这边谁没交、错在哪都看得到 —— 「老师会及时反馈给您。」' },
          ]}
        />
        <p className="mt-2 text-[12.5px] text-slate-600">
          演示前检查:演示账号有近期学习记录;网络通畅;不要用真实学员账号演示(涉及他人孩子信息)。
        </p>
      </Section>

      {/* 五、顾虑 */}
      <Section no="五" title="家长常见顾虑,这样回答">
        <p className="text-[12.5px] text-slate-600">答法原则:先认同家长的担心,再给事实,最后落到「您可以看得见」。</p>
        <div className="mt-2 space-y-2.5">
          {FAQ.map(([q, a]) => (
            <div key={q} style={{ breakInside: 'avoid' }}>
              <p className="font-bold text-slate-900">家长:{q}</p>
              <p className="mt-0.5 text-slate-700">答:{a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 六、价格与报名 */}
      <Section no="六" title="报价与报名当天">
        <p className="font-bold text-slate-900">本校区收费(机构填写)</p>
        <table className="mt-1 w-full border-collapse text-[12.5px]" style={{ breakInside: 'avoid' }}>
          <tbody>
            {[
              ['课程 / 阶段', '课时', '学费', '其他费用'],
              ['', '', '', ''],
              ['', '', '', ''],
              ['', '', '', ''],
            ].map((row, i) => (
              <tr key={i} className={i === 0 ? 'bg-[#FFF3EC] font-bold' : ''}>
                {row.map((c, j) => (
                  <td key={j} className={`${td} ${i === 0 ? 'text-center' : ''} h-8`}>{i === 0 ? c : <Blank w="100%" />}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[12px] text-slate-500">
          参考:直营校区每阶段 120 课时,学费 ¥11,880(第 1 阶段另收资料费 ¥280),小学《语法》免费作引流课。
        </p>
        <p className="mt-2.5">
          <strong>报价时把总价换算成「每天」</strong>,并说清楚这笔钱买到的是每天的练习和每天的反馈,而不只是上课那几个小时。
        </p>
        <p className="mt-2.5 font-bold text-slate-900">报名当天必做的三件事(别让家长「回去再说」)</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li><strong>当场开卡</strong>:给孩子开通学习卡,登录学生端。</li>
          <li><strong>当场绑定家长端</strong>:孩子在学生端生成绑定码,家长手机注册家长端输入绑定码 —— 不当场绑,多数家长回去就不会绑了,后面的「看得见」全都落空。</li>
          <li><strong>当场布置第一次任务</strong>:告诉家长今晚孩子要完成什么、大概几分钟,并约好第一周结束时老师反馈一次。</li>
        </ol>
      </Section>

      {/* 七、续费和转介绍 */}
      <Section no="七" title="报名只是开始:续费和转介绍从第一天做起">
        <p>
          直营校区续费率能到 90% 以上,靠的不是续费前的推销,而是<strong>家长每天都看得见</strong>。报名后头 30 天按这个节奏来:
        </p>
        <div className="mt-2 flex items-stretch gap-1.5 text-center text-[12px]" style={{ breakInside: 'avoid' }}>
          {[
            ['第 1 天', '开卡 + 绑定家长端', '确认家长手机能看到孩子的学习记录'],
            ['第 1 周', '老师第一次反馈', '告诉家长孩子学会了什么、哪里要督促'],
            ['每周', '学情周报', '提醒家长看周报,有问题及时沟通'],
            ['第 4 周', '阶段小结', '单元测试或家长会,给家长看一个月的变化'],
          ].map(([n, t, d]) => (
            <div key={n} className="flex-1 rounded-lg border border-orange-200 bg-[#FFF8F0] px-1.5 py-2">
              <p className="text-[14px] font-black text-[#FF6B35]">{n}</p>
              <p className="font-bold text-slate-900">{t}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-600">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-2.5 font-bold text-slate-900">转介绍</p>
        <p className="mt-1">
          最好的时机是家长<strong>刚看到变化</strong>的时候(第一次阶段小结、孩子宠物进化、掌握词数过百)。
          请家长把 AI 测评链接转给身边有同龄孩子的朋友,来测评的新家长自动进入本校区线索。
          本校区转介绍政策:<Blank w="16rem" />
        </p>
      </Section>

      {/* 八、红线 */}
      <Section no="八" title="哪些话不能说">
        <p>
          教育培训广告不得承诺提分、升学、通过考试(《广告法》第二十四条)。违规宣传会被处罚,也会砸掉家长的信任 ——
          承诺了做不到的分数,续费和口碑一起没了。
        </p>
        <table className="mt-2 w-full border-collapse text-[12.5px]" style={{ breakInside: 'avoid' }}>
          <thead>
            <tr className="bg-[#FFF3EC]">
              <th className={`${td} w-[42%] text-center font-bold`}>不能说 / 不能做</th>
              <th className={`${td} text-center font-bold`}>可以这样说</th>
            </tr>
          </thead>
          <tbody>
            {REDLINE.map(([no, yes]) => (
              <tr key={no}>
                <td className={`${td} text-slate-500`}>✗ {no}</td>
                <td className={td}>✓ {yes}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px]" style={{ breakInside: 'avoid' }}>
          <p className="font-bold text-slate-900">本校区信息</p>
          <p className="mt-1">
            校区名称:<Blank w="12rem" />{'\u3000\u3000'}咨询电话:<Blank w="9rem" />
          </p>
          <p className="mt-1">
            校区地址:<Blank w="18rem" />{'\u3000\u3000'}微信:<Blank w="7rem" />
          </p>
        </div>
      </Section>

      <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400">
        昆明市五华区飞鹰教育培训学校 · 飞鹰AI英语 —— 仅供合作机构内部使用,所述数据与功能以系统实际情况为准
      </footer>
    </article>
  );
}
