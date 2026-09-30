/**
 * 加盟资料中心 · 文档四:家长手册
 *
 * **直接给家长看的**(合作机构打印/发 PDF 给来咨询的家长),不是给咨询老师的话术本 ——
 * 所以通篇用「您」「孩子」,不出现成交、话术、转化这类字眼。
 * 主线是「让家长看得见」:看得见孩子怎么学、学完能到哪、每天学了什么。
 *
 * ⚠️ 口径红线与招商手册(FranchiseRecruitDoc)同一套,改文案前必读:
 *  1. **广告法第二十四条**:不承诺分数、升学、通过考试;个案必须紧跟「个体结果因人而异」
 *  2. 未成年人一律 A/B 同学,不放试卷照片
 *  3. 数据与招商手册第五章同源(2026-09-26 直营校区生产库实查),那边更新这里同步;
 *     学习路线图与招商手册共用 data/franchisePyramid.ts
 *  4. **机构自己的价格、课时、体验课、退费规定一律留空栏**,不替机构定价
 *  5. 机构名称统一用飞鹰品牌;校区名称/地址/电话留空由机构填
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

// 家长最常问的问题。答法:说实话,不承诺分数,落到「您看得见」
const FAQ: Array<[string, string]> = [
  [
    '报了飞鹰,成绩马上就能上去吗?',
    '不会马上。我们培养的是孩子学英语的能力,这是一辈子用得上的本事。学完第一阶段,孩子能自己读学校的单词和课文;但只会读、不把课本单词和知识点背熟,在校成绩一样上不去。所以需要您每天督促孩子完成作业,老师会记录并反馈每天的完成情况。',
  ],
  [
    '孩子基础很差,或者一直不喜欢英语,能学吗?',
    '能。我们从音标和背单词的方法教起,不是接着学校进度往下讲,零基础也能跟上。很多孩子不喜欢英语,是因为背了就忘、越学越没信心;当他自己读出一个没学过的单词,兴趣往往就是从这里来的。',
  ],
  [
    '我们工作忙,英语也不好,辅导不了怎么办?',
    '不需要您辅导,也不需要您会英语。背单词、听写、批改由系统完成,您只做一件事:每天督促孩子把作业做完。做没做、做对多少,手机上都看得到。',
  ],
  [
    '每天要学多久?会不会加重负担?',
    '每天用方法背 6 个新词,再读一篇绘本或短文,合计不超过 20 分钟。我们靠的是每天不断,而不是一次学很久。',
  ],
  [
    '和学校补课、其他培训班有什么不同?',
    '一般的补课是老师讲、孩子记,离开老师就不知道怎么学。我们课堂上老师不教孩子任何一个单词和句子,只教方法、做引导,目标是让孩子自己会学;课后每天在系统上练,不是一周只学上课那两小时。',
  ],
  [
    '孩子以后想走国际路线(雅思托福),适合吗?',
    '适合。我们走的是双路线:国内中高考和国际雅思托福的能力一起打底。学习路线的塔尖就是雅思托福、四六级 —— 走到那里时,孩子已经能自己阅读、高效背单词,可以自学,也可以选择继续深造。',
  ],
];

export default function FranchiseParentDoc() {
  return (
    <article className="text-[13.5px] leading-6 text-slate-800">
      {/* 封面头 */}
      <header className="border-b-4 border-[#FF6B35] pb-5 text-center">
        <p className="text-[13px] font-semibold tracking-[0.3em] text-[#FF6B35]">飞鹰英语 · 致家长</p>
        <h1 className="mt-2 text-[30px] font-black leading-tight text-slate-900">家长手册</h1>
        <p className="mt-3 text-[17px] font-black text-slate-900">
          不替孩子学,教孩子<span className="text-[#FF6B35]">会学</span>
        </p>
        <p className="mt-1.5 text-[14px] text-slate-600">
          授人以鱼,不如授人以渔。我们想给孩子的,是离开老师也能自己往前走的英语学习能力。
        </p>
        <StatRow
          items={[
            ['2014', '年起专注英语教学'],
            ['7000+', '累计服务学员'],
            ['90%+', '直营校区续费率'],
            ['20 分钟', '每天学习时长'],
          ]}
        />
      </header>

      {/* 一、痛点 */}
      <Section no="一" title="您是不是也遇到过这些情况">
        <CardPairs
          items={[
            { t: '单词背了就忘', d: '抄了几十遍、默写也过了,一个月后又不认识了。' },
            { t: '看到生词就不会读', d: '新单词必须等老师领读,离开课堂就不知道怎么学。' },
            { t: '学得怎么样,不知道', d: '孩子每天到底学没学、学会没有,只能等考试成绩。' },
            { t: '想管,但管不了', d: '工作忙,或者自己英语不好,孩子的作业没法辅导。' },
          ]}
        />
        <p className="mt-2.5">
          这些问题大多不是孩子不聪明、不努力,而是<strong>没有人教过他怎么学</strong>。
        </p>
      </Section>

      {/* 二、我们怎么教 */}
      <Section no="二" title="我们怎么教:不灌知识,教方法">
        <p>
          传统英语课是「老师讲、学生记」。飞鹰反过来做 ——
          <strong>课堂上教的是方法,老师不教孩子任何一个单词和句子,只做引导</strong>。
          这就是<strong>引导式学习:以结果为导向,反向推理</strong> —— 先让孩子看到要达成的结果,
          再由他自己一步步推出怎么做到。
        </p>
        <p className="mt-2.5 font-bold text-slate-900">孩子会学到四样方法</p>
        <CardPairs
          items={[
            { t: '看词会读,听音会写', d: '从音标入手,弄懂字母和发音的对应规律。新词不用等老师领读,自己就能拼、能读。' },
            { t: '会记,也会复习', d: '用词根、联想等记忆法把词记牢,再按记忆曲线安排复习,不再从头死背。' },
            { t: '会找自己的错', d: '拼错了系统指出错在哪个字母,孩子学会看自己的错,而不是抄十遍正确答案。' },
            { t: '会安排自己的学习', d: '每天有明确的任务清单,从「大人催着学」慢慢变成「自己知道要学什么」。' },
          ]}
        />
        <p className="mt-2.5">
          <strong>线上线下结合</strong>:线下课堂上,老师讲方法、带阅读、答疑;回家后,背单词、听写、批改交给系统,
          孩子每天都在练,不只是上课那几个小时。
        </p>
      </Section>

      {/* 三、学完能获得什么 */}
      <Section no="三" title="孩子能获得什么">
        <p>我们不承诺分数。我们努力让孩子获得的,是这三样能力:</p>
        <div className="mt-2 space-y-2">
          {[
            ['自主阅读能力', '能自己读懂英语绘本、短文和课文,阅读量一点点积累起来。'],
            ['技巧背单词', '掌握记单词的方法,背得快、忘得慢,新词自己就能学。'],
            ['双路线', '国内中高考 + 国际雅思托福能力打底,考试落地,夯实学术英语基础,完成能力过渡。'],
          ].map(([t, d], i) => (
            <div key={t} className="flex gap-2.5 rounded-lg border border-orange-200 bg-[#FFF8F0] p-2.5" style={{ breakInside: 'avoid' }}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FF6B35] text-[12px] font-bold text-white">{i + 1}</span>
              <p>
                <strong className="text-slate-900">{t}</strong>
                <span className="text-slate-600">:{d}</span>
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* 四、学习路线 */}
      <Section no="四" title="学习路线图:语素金字塔">
        <p>
          路线从最宽的塔基往上走:先用《单词记忆法》把背单词的方法练扎实,再通过三册语法学完初中语法主体,
          之后初高衔接、高中高考。走到塔尖时,孩子已经能自己有效阅读、高效背单词。
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
        <p className="mt-2 text-[12.5px] text-slate-600">
          孩子从哪一阶段开始,由老师根据入学测评决定。按每天 6 词的节奏,约半年学完小学词汇,三年学完初高中词汇。
        </p>
      </Section>

      {/* 五、看得见 */}
      <Section no="五" title="孩子学得怎么样,您每天都看得见">
        <p>报名后,您的手机可以绑定<strong>家长端</strong>,不用等期末成绩单:</p>
        <CardPairs
          items={[
            { t: '今日状态', d: '今天学没学、学了多少分钟、该复习的复习完没有。' },
            { t: '学习日历', d: '每天有没有坚持,一格一格看得清。' },
            { t: '薄弱词', d: '孩子总错的是哪些词,一目了然。' },
            { t: '学情周报', d: '这周学了多少、比上周进步在哪。' },
          ]}
        />
        <p className="mt-2.5">
          孩子这边,学得越多,系统里的宠物伙伴长得越大,还能和同学 PK 背单词 ——
          <strong>很多孩子是自己想打开的</strong>,不用您天天催。
        </p>
      </Section>

      {/* 六、数据与个案 */}
      <Section no="六" title="真实数据">
        <p>以下是飞鹰直营校区学员在系统上的学习数据,截至 2026 年 9 月:</p>
        <StatRow
          items={[
            ['744', '名学员在系统上学习'],
            ['86.4%', '拼写 / 选择 / 填空平均正确率'],
            ['97', '名学员掌握 500 词以上'],
            ['39', '名学员掌握 1000 词以上'],
          ]}
        />
        <p className="mt-2 text-[11px] leading-4 text-slate-400">
          「掌握」指同一单词在系统内多次答对、达到掌握标准,同一单词只计一次,不是练习次数。续费率以校区缴费数据为准。
        </p>
        <p className="mt-3 font-bold text-slate-900">往届学员个案</p>
        <CardPairs
          items={[
            { t: 'A 同学 · 零基础入学', d: '从零基础开始,完整学完五个阶段课程,目前英语水平已可直接备考雅思。' },
            { t: 'B 同学 · 初二暑假插班', d: '入学时学校英语成绩 25 分,暑假两个月集中学习,中考英语取得 98 分,现已出国深造。' },
          ]}
        />
        <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
          以上为往届学员个人情况,学习效果受学员基础、投入时间等多种因素影响,个体结果因人而异,
          不构成对学习效果或考试成绩的承诺。
        </p>
      </Section>

      {/* 七、家长的角色 */}
      <Section no="七" title="需要您做的,只有一件事">
        <p>
          「喂到嘴里的饭,要孩子自己咽下去。」学校课本孩子完全可以自学,但课本单词和知识点不背熟,成绩就上不去。
        </p>
        <p className="mt-2 rounded-lg border-l-4 border-[#FF6B35] bg-[#FFF8F0] px-3 py-2 font-bold text-slate-900">
          请您每天督促孩子完成老师布置的作业。老师会记录每天的完成情况,并及时反馈给您。
        </p>
        <p className="mt-2">英语您不需要会,也不需要辅导 —— 坚持,是孩子和您一起完成的事。</p>
      </Section>

      {/* 八、FAQ */}
      <Section no="八" title="家长常问的问题">
        <div className="space-y-2.5">
          {FAQ.map(([q, a]) => (
            <div key={q} style={{ breakInside: 'avoid' }}>
              <p className="font-bold text-slate-900">问:{q}</p>
              <p className="mt-0.5 text-slate-700">答:{a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 九、课程与报名 */}
      <Section no="九" title="课程与报名">
        <table className="mt-1 w-full border-collapse text-[12.5px]" style={{ breakInside: 'avoid' }}>
          <tbody>
            {[
              ['课程 / 阶段', '课时', '学费', '备注'],
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
        <p className="mt-3 font-bold text-slate-900">报名流程</p>
        <div className="mt-1.5 flex items-stretch gap-1.5 text-center text-[12px]" style={{ breakInside: 'avoid' }}>
          {[
            ['1', '免费测评', '了解孩子现在的英语水平'],
            ['2', '体验课', '孩子亲身感受怎么学'],
            ['3', '定学习方案', '老师建议从哪一阶段开始'],
            ['4', '报名开学', '开通账号、绑定家长端'],
          ].map(([n, t, d]) => (
            <div key={n} className="flex-1 rounded-lg border border-orange-200 bg-[#FFF8F0] px-1.5 py-2">
              <p className="text-[16px] font-black text-[#FF6B35]">{n}</p>
              <p className="font-bold text-slate-900">{t}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-600">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[12.5px]">
          体验课时间:<Blank w="12rem" />{'\u3000\u3000'}退费说明:<Blank w="14rem" />
        </p>

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px]" style={{ breakInside: 'avoid' }}>
          <p className="font-bold text-slate-900">欢迎来校区了解</p>
          <p className="mt-1">
            校区:<Blank w="12rem" />{'\u3000\u3000'}咨询电话:<Blank w="9rem" />
          </p>
          <p className="mt-1">
            地址:<Blank w="18rem" />{'\u3000\u3000'}微信:<Blank w="7rem" />
          </p>
        </div>
      </Section>

      <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400">
        飞鹰英语 —— 本手册所述数据与功能以系统实际情况为准
      </footer>
    </article>
  );
}
