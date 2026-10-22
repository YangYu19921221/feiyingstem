/**
 * 加盟资料中心 · 文档六:抖音直播招生方案(每日陪跑)
 *
 * 给**平台自己的员工和主播**培训用(AdminFranchiseKit 的 DOC_TABS.partner=false,合作机构看不到):
 * 第四章有用人成本和利润测算。要开放给加盟商,把那一行 partner 改成 true,
 * 但先让对方把第四章的成本参数换成自己的(默认值是飞鹰直营的: 高级老师 8,000/月)。
 *
 * 卖的是「看得见的督学」不是「提分」: 每天任务 + 每日复习 20 词、老师每天点评、没来当天提醒、学习报告,
 * 全是系统里已有、能当场演示、每天能交付的(services/coach.py、daily_review.py、today_report.py)。
 *
 * ⚠️ 红线(与家长手册/招商手册/推荐方案同一套,改文案前必读):
 *  1. 广告法第 24 条 + 湖南省市场监管局 2026-09-23《教育培训(含涉考培训)广告合规提示》:
 *     不承诺效果(「保提分」「包过」)、不用受益者(家长/学员)名义或形象作证明、
 *     不用「输在起跑线」「弯道超车」「分水岭」渲染焦虑、引流广告标「广告」、优惠写明品种/期限/数量
 *  2. 双减: 义务教育阶段学科类不能在网络平台投广告 → 定位「背单词软件 + 督学服务」,直播不讲课。
 *     抖音类目与资质**没核实**(平台规则页打不开),第十一章留了待确认栏,不替用户下结论
 *  3. 未成年人: 直播只用演示账号,不露真实孩子姓名/成绩/报告
 *  4. 价格: 不写虚构原价划线;名额、截止时间必须真实
 *
 * 价格和成本只在 DEFAULT_PARAMS 一处定,第四章改参数,整份文档的价格、利润、保本单量、话术里的数字跟着变。
 * 参数用 <input>: 按 HTML 规范 cloneNode 会带上 input 的当前值,html2canvas 也画 input 的值,
 * 所以导出的 PDF 里是改过的数(utils/downloadPdf 截的是克隆)。
 * 默认「每个孩子每天 1.5 分钟」是估的(2026-10-22 陪跑上线时生产一条点评都还没有),第一期要计时实测后替换。
 */
import { useMemo, useState } from 'react';

const DEFAULT_PARAMS = {
  // 价格
  trialPrice: '9.9',
  price30: '780',
  price90: '1680',
  price180: '2980',
  priceRenew: '1480',
  price1v1: '3980',
  earlyOff: '100',
  // 人
  seniorSalary: '8000',
  assistantSalary: '4500',
  opsSalary: '5000',
  costFactor: '1.3',
  monthHours: '150',
  // 时间
  minPerKidDay: '1.5',
  callMinPerMonth: '10',
  trialMin: '30',
  kidsPerAssistant: '120',
  assistantsPerSenior: '3',
  superviseShare: '40',
  liveShare: '30',
  min1v1Month: '135',
  // 扣点
  platformFee: '5',
  refundRate: '10',
  commission: '8',
  // 实测(空 = 还没有)
  actualAd: '',
  actualConv: '',
};
type Params = typeof DEFAULT_PARAMS;
type Key = keyof Params;

/** 投流费和转化率没有数据前,按三种情况看 */
const SCENARIOS = [
  { key: 'good', label: '乐观', ad: 30, conv: 25 },
  { key: 'mid', label: '中等', ad: 60, conv: 15 },
  { key: 'bad', label: '保守', ad: 100, conv: 8 },
];

const num = (s: string) => {
  const t = String(s ?? '').trim();
  if (!t) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const yuan = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString('zh-CN') : '—');

function calc(p: Params) {
  const n = (k: Key) => num(p[k]);
  const sMonth = n('seniorSalary') * n('costFactor');
  const aHour = (n('assistantSalary') * n('costFactor')) / n('monthHours');
  const sHour = sMonth / n('monthHours');
  const kidMin = n('minPerKidDay') * 30 + n('callMinPerMonth');
  const supervise = (sMonth * n('superviseShare')) / 100 / (n('assistantsPerSenior') * n('kidsPerAssistant'));
  const laborMonth = (kidMin / 60) * aHour + supervise;
  const trialLabor = (n('trialMin') / 60) * aHour;
  const keep = 1 - (n('platformFee') + n('refundRate') + n('commission')) / 100;
  const fixed = n('opsSalary') * n('costFactor') + (sMonth * n('liveShare')) / 100;
  const assistantHoursUsed = (n('kidsPerAssistant') * kidMin) / 60;

  const tiers = [
    { key: '30', name: '陪跑 30 天', paid: n('price30'), labor: laborMonth, cac: true },
    { key: '90', name: '陪跑 90 天(主推)', paid: n('price90') - n('earlyOff'), labor: laborMonth * 3, cac: true },
    { key: '180', name: '陪跑 180 天', paid: n('price180') - n('earlyOff'), labor: laborMonth * 6, cac: true },
    { key: 'renew', name: '老学员续 90 天', paid: n('priceRenew'), labor: laborMonth * 3, cac: false },
    { key: '1v1', name: '一对一 90 天', paid: n('price1v1'), labor: (n('min1v1Month') / 60) * sHour * 3, cac: true },
  ];

  const actual = Number.isFinite(n('actualAd')) && Number.isFinite(n('actualConv'))
    ? [{ key: 'actual', label: '实测', ad: n('actualAd'), conv: n('actualConv') }] : [];
  const scenarios = [...SCENARIOS, ...actual].map((s) => {
    const cac = (s.ad + trialLabor - n('trialPrice')) / (s.conv / 100);
    const profit = Object.fromEntries(tiers.map((t) => [t.key, t.paid * keep - t.labor - (t.cac ? cac : 0)]));
    const p90 = profit['90'];
    return { ...s, cac, profit, breakeven: p90 > 0 ? Math.ceil(fixed / p90) : null };
  });

  return { aHour, sHour, kidMin, supervise, laborMonth, trialLabor, keep, fixed, assistantHoursUsed, tiers, scenarios };
}

/* ============ 排版小件(与推荐方案同一套;两列用 flex 不用 grid,html2pdf 分页占位会挤错 grid 格子) ============ */

const Blank = ({ w = '6rem', children }: { w?: string; children?: React.ReactNode }) => (
  <span
    contentEditable
    suppressContentEditableWarning
    spellCheck={false}
    className="mx-0.5 inline-block min-h-[1.5em] border-b border-slate-600 px-1 text-center align-baseline outline-none focus:bg-amber-50"
    style={{ minWidth: w }}
  >
    {children}
  </span>
);

const Section = ({ no, title, children }: { no: string; title: string; children: React.ReactNode }) => (
  <section className="mt-7">
    <h2 className="flex items-center gap-2 text-[19px] font-black text-slate-900" style={{ breakAfter: 'avoid' }}>
      <span className="flex h-7 shrink-0 items-center justify-center rounded-md bg-[#FF6B35] px-1.5 text-[13px] font-bold text-white" style={{ minWidth: '1.75rem' }}>{no}</span>
      {title}
    </h2>
    <div className="mt-2.5">{children}</div>
  </section>
);

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

const td = 'border border-orange-200 px-2 py-1.5 align-top';
const th = `${td} bg-[#FFF3EC] font-bold`;

/** 话术框: 主播/班主任照着说。一段一框,不跨页 */
const Script = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mt-2.5 rounded-lg border-l-4 border-[#FF6B35] bg-[#FFF8F0] px-3 py-2.5" style={{ breakInside: 'avoid' }}>
    <p className="text-[12px] font-bold text-[#FF6B35]">{title}</p>
    <div className="mt-1 space-y-1.5 text-[13px] leading-6 text-slate-700">{children}</div>
  </div>
);

/** 内部提示: 只给员工看,直播里不说 */
const Inner = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-2.5 rounded-lg border border-dashed border-slate-400 bg-slate-50 px-3 py-2 text-[12.5px] leading-6 text-slate-700" style={{ breakInside: 'avoid' }}>
    <span className="mr-1 rounded bg-slate-700 px-1.5 py-0.5 text-[11px] font-bold text-white">内部</span>
    {children}
  </div>
);

/* ============ 一 ~ 三 ============ */

function RedLines() {
  return (
    <Section no="一" title="先守住的四条红线">
      <p>直播间说的每一句话都按广告管。下面四条是底线,培训时第一个讲,主播背下来。</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5">
        <li style={{ breakInside: 'avoid' }}>
          <strong>不承诺效果。</strong>不说「提分」「保过」「包会」「几天背完 3500 词」。
          我们卖的是每天有任务、每天有人看、没来当天提醒,这些能保证;分数不能。
        </li>
        <li style={{ breakInside: 'avoid' }}>
          <strong>不用家长、学员做证明。</strong>不念家长好评、不晒学员成绩单和报告截图、不请老学员连麦说效果。
          演示一律用演示账号。
        </li>
        <li style={{ breakInside: 'avoid' }}>
          <strong>不制造焦虑。</strong>不说「输在起跑线」「弯道超车」「分水岭」「最后一年」「再不学就晚了」。
        </li>
        <li style={{ breakInside: 'avoid' }}>
          <strong>价格和名额说真话。</strong>不写从没卖过的原价当划线价;优惠写清内容、期限、数量;
          「只剩 N 个」必须是真的。
        </li>
      </ol>
      <Inner>
        <strong>双减定位:</strong>小学、初中英语属于学科类,学科类校外培训不能在网络平台投广告。
        所以直播间卖的是「背单词学习软件 + 每日督学服务」,<strong>直播里不讲课、不做学科辅导</strong>。
        抖音能用哪个类目、要什么资质,上线前必须向平台和当地教育部门确认(见第十一章),这份方案没替你下结论。
      </Inner>
    </Section>
  );
}

function Positioning() {
  return (
    <Section no="二" title="卖给谁、卖什么">
      <p>
        <strong>卖给谁:</strong>小学高年级到初中的家长,家里多半有这三种情况之一:
        没人盯,孩子学两天就停;背了就忘,没人管复习;家长不知道孩子到底学了什么。
      </p>
      <Inner>
        这是从我们自己的学习数据里看出来的(只给员工看,直播里不说):近 28 天学过的 143 个孩子里,
        78 个只学了 1–2 天;在家做的作业完成率 55%,在电教室是 68%。孩子缺的是<strong>有人管着坚持</strong>,
        不是缺方法 —— 这正是陪跑要解决的,也是主播讲痛点的底气。
      </Inner>
      <p className="mt-3"><strong>卖什么:</strong>三件能当场演示、每天能交付的事。</p>
      <CardPairs
        items={[
          { t: '① 每天一份,做完就是做完', d: '每天的单词任务 + 系统挑好的 20 个复习词(先挑最近学过、快要忘的)。不会越背越多,孩子知道今天干到哪算完。' },
          { t: '② 老师每天看,每天说一句', d: '老师每晚看完成情况,给孩子写一句点评,孩子首页和家长端同时看得到。' },
          { t: '③ 没来,当天就提醒家长', d: '谁没来、谁还差几份,老师看板上一眼就有,当天把提醒发给家长,不等到周末才发现。' },
          { t: '④ 家长看得见', d: '做完当天的任务就能生成一张学习报告:学了哪些词、哪些还要多练,家长手机上直接看。' },
        ]}
      />
      <p className="mt-2 text-[12.5px] text-slate-600">
        一句话讲给家长听:<strong>「软件是工具,我们多了一个每天替你盯着的老师。」</strong>
      </p>
    </Section>
  );
}

function Products({ p }: { p: Params }) {
  const n = (k: Key) => num(p[k]);
  const perDay = (price: number, days: number) => (Number.isFinite(price) ? `约 ${Math.ceil(price / days)} 元/天` : '—');
  const rows: Array<[string, string, string, React.ReactNode]> = [
    ['体验营 7 天', `¥${p.trialPrice}`, '—', <>7 天每天任务 + 每日复习、每天点评、没来当天提醒,第 7 天给家长一份 7 天总结。<strong>引流用,不指望赚钱</strong></>],
    ['陪跑 30 天', `¥${p.price30}`, perDay(n('price30'), 30), '给犹豫的家长。单日价最贵,把人往 90 天推'],
    ['陪跑 90 天(主推)', `¥${p.price90}`, perDay(n('price90'), 90), <>体验营学满 5 天、结束后 3 天内报名<strong>立减 {p.earlyOff} 元</strong>;含每周一次线上家长会【待确认】</>],
    ['陪跑 180 天', `¥${p.price180}`, perDay(n('price180'), 180), `同样立减 ${p.earlyOff} 元,给认可的家长`],
    ['一对一 90 天', `¥${p.price1v1}`, perDay(n('price1v1'), 90), '高级老师亲自每天点评,每两周和家长沟通一次学习安排(15 分钟);每位高级老师限 20 人'],
    ['老学员续 90 天', `¥${p.priceRenew}`, perDay(n('priceRenew'), 90), '没有获客成本,让一点利给老客户'],
  ];
  return (
    <Section no="三" title="产品和价格">
      <p>正式陪跑每一档的服务内容一样:每天任务 + 每日复习、每天点评、没来当天提醒、学习报告、每月一次家长电话(10 分钟)。区别只在天数和谁来带。</p>
      <div style={{ breakInside: 'avoid' }}><table className="mt-2.5 w-full border-collapse text-[12.5px]">
        <tbody>
          <tr><td className={`${th} w-[20%]`}>档位</td><td className={`${th} w-[12%]`}>价格</td><td className={`${th} w-[14%]`}>折合</td><td className={th}>说明</td></tr>
          {rows.map(([a, b, c, d]) => (
            <tr key={a}><td className={`${td} font-semibold`}>{a}</td><td className={td}>{b}</td><td className={td}>{c}</td><td className={td}>{d}</td></tr>
          ))}
        </tbody>
      </table></div>
      <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[12.5px] text-slate-700">
        <li><strong>立减只给 90 天及以上</strong>,目的是把家长往主推档推;条件和期限在直播间、商品页都要写清。</li>
        <li><strong>和线下比:</strong>直营线下一个阶段 ¥11,880,线上 90 天约是它的七分之一。家长能接受,也不会觉得廉价。</li>
        <li><strong>真正赚钱的是续费和老带新</strong>(没有投流成本)。正价家长从第 30 天起就可以邀请朋友,系统里有「家长推荐」。</li>
        <li><strong>退款:</strong>正式陪跑开始后 <Blank w="2.5rem">7</Blank> 天内不满意可退 <Blank w="5rem" />,必须真的执行。</li>
      </ul>
    </Section>
  );
}

/* ============ 四、成本与定价测算(可改参数) ============ */

const PARAM_GROUPS: Array<{ title: string; items: Array<{ k: Key; label: string; unit: string; hint?: string }> }> = [
  {
    title: '价格',
    items: [
      { k: 'trialPrice', label: '体验营', unit: '元' },
      { k: 'price30', label: '30 天', unit: '元' },
      { k: 'price90', label: '90 天', unit: '元' },
      { k: 'price180', label: '180 天', unit: '元' },
      { k: 'price1v1', label: '一对一 90 天', unit: '元' },
      { k: 'priceRenew', label: '续 90 天', unit: '元' },
      { k: 'earlyOff', label: '学满 5 天立减', unit: '元' },
    ],
  },
  {
    title: '人员成本',
    items: [
      { k: 'seniorSalary', label: '高级老师月薪', unit: '元' },
      { k: 'assistantSalary', label: '陪跑助教月薪', unit: '元', hint: '假设' },
      { k: 'opsSalary', label: '运营/场控月薪', unit: '元', hint: '假设' },
      { k: 'costFactor', label: '用人成本系数', unit: '倍', hint: '含社保等' },
      { k: 'monthHours', label: '每月有效工时', unit: '小时' },
    ],
  },
  {
    title: '时间',
    items: [
      { k: 'minPerKidDay', label: '每个孩子每天', unit: '分钟', hint: '估的,要实测' },
      { k: 'callMinPerMonth', label: '每月家长电话', unit: '分钟' },
      { k: 'trialMin', label: '体验孩子 7 天合计', unit: '分钟' },
      { k: 'kidsPerAssistant', label: '每个助教带', unit: '人' },
      { k: 'assistantsPerSenior', label: '每位高级老师带助教', unit: '人' },
      { k: 'superviseShare', label: '高级老师督导占比', unit: '%' },
      { k: 'liveShare', label: '高级老师直播占比', unit: '%' },
      { k: 'min1v1Month', label: '一对一每人每月', unit: '分钟' },
    ],
  },
  {
    title: '扣点',
    items: [
      { k: 'platformFee', label: '平台扣点', unit: '%', hint: '以实际类目费率为准' },
      { k: 'refundRate', label: '退款率', unit: '%' },
      { k: 'commission', label: '成交提成', unit: '%' },
    ],
  },
  {
    title: '实测(量出来就填,下面多算一列「实测」)',
    items: [
      { k: 'actualAd', label: '每单体验营投流费', unit: '元' },
      { k: 'actualConv', label: '体验转正价', unit: '%' },
    ],
  },
];

const Money = ({ v }: { v: number }) => (
  <span className={v < 0 ? 'font-bold text-red-600' : 'font-semibold text-slate-900'}>{yuan(v)}</span>
);

function CostModel({ p, set, onReset }: { p: Params; set: (k: Key, v: string) => void; onReset: () => void }) {
  const c = useMemo(() => calc(p), [p]);
  const n = (k: Key) => num(p[k]);
  const hoursLeft = n('monthHours') - c.assistantHoursUsed;
  const trialsLeft = Math.floor((hoursLeft * 60) / n('trialMin'));
  return (
    <Section no="四" title="成本与定价测算">
      <p>
        下面带底色的数字都能直接改,改完整份文档的价格、利润、话术里的数字跟着变,导出的 PDF 里也是改过的数。
        <strong>「每个孩子每天 1.5 分钟」是估的</strong>,它决定一个助教能带多少孩子,第一期让老师计时实测后换掉。
      </p>
      <div className="mt-2.5 space-y-2 rounded-lg border border-slate-200 p-3 text-[12.5px]">
        {PARAM_GROUPS.map((g) => (
          <div key={g.title} style={{ breakInside: 'avoid' }}>
            <p className="font-bold text-slate-900">{g.title}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
              {g.items.map((it) => (
                <label key={it.k} className="inline-flex items-baseline gap-1 text-slate-700">
                  {it.label}
                  <input
                    value={p[it.k]}
                    onChange={(e) => set(it.k, e.target.value)}
                    inputMode="decimal"
                    aria-label={it.label}
                    className="w-16 rounded-sm border-b border-slate-500 bg-amber-50 px-1 text-center font-semibold text-slate-900 outline-none focus:bg-amber-100"
                  />
                  {it.unit}
                  {it.hint && <span className="text-[11px] text-slate-400">({it.hint})</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="fk-chrome pt-1" data-html2canvas-ignore="true">
          <button type="button" onClick={onReset}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">
            恢复默认值
          </button>
          <span className="ml-2 text-[11px] text-slate-400">改过的数只存在这台电脑的浏览器里</span>
        </div>
      </div>

      <CardPairs
        items={[
          {
            t: `每个正价孩子每月人工 ¥${yuan(c.laborMonth)}`,
            d: `助教每月花 ${yuan(c.kidMin)} 分钟(每天 ${p.minPerKidDay} 分钟 × 30 + 电话 ${p.callMinPerMonth} 分钟),助教约 ${yuan(c.aHour)} 元/小时;另加高级老师督导分摊 ${yuan(c.supervise)} 元。`,
          },
          {
            t: `每个体验孩子人工 ¥${yuan(c.trialLabor)}`,
            d: `开通、7 天点评、第 7 天沟通合计 ${p.trialMin} 分钟。报了名不学的也照样花,所以不学的孩子不打电话。`,
          },
          {
            t: `收入到手 ${yuan(c.keep * 100)}%`,
            d: `扣掉平台 ${p.platformFee}%、退款 ${p.refundRate}%、成交提成 ${p.commission}%。`,
          },
          {
            t: `每月固定开销 ¥${yuan(c.fixed)}`,
            d: `运营/场控一人,加高级老师 ${p.liveShare}% 的时间出镜直播、开家长会。不管成交多少都要花。`,
          },
          {
            t: `一个助教带 ${p.kidsPerAssistant} 人要 ${yuan(c.assistantHoursUsed)} 小时/月`,
            d: hoursLeft >= 0
              ? `每月 ${p.monthHours} 小时还剩约 ${yuan(hoursLeft)} 小时,能再接约 ${trialsLeft} 个体验孩子。`
              : `超出每月工时 ${yuan(-hoursLeft)} 小时 —— 带不过来,要么少带人,要么每个孩子的时间压下来。`,
          },
          {
            t: '高级老师不做每天点评',
            d: `她的时间按 督导 ${p.superviseShare}% / 直播 ${p.liveShare}% / 一对一 其余 来排。让 8,000 的老师写每天点评,每个孩子的人工会多出不少,还占掉直播时间。`,
          },
        ]}
      />

      <p className="mt-3"><strong>每成交一个正价客户的获客成本</strong> =(每单体验营投流费 + 体验人工 − 体验营收入)÷ 体验转正价比例</p>
      <div style={{ breakInside: 'avoid' }}><table className="mt-2 w-full border-collapse text-[12.5px]">
        <tbody>
          <tr>
            <td className={th}>情况</td><td className={th}>每单投流费</td><td className={th}>体验转正价</td><td className={th}>每个正价客户获客成本</td>
          </tr>
          {c.scenarios.map((s) => (
            <tr key={s.key}>
              <td className={`${td} font-semibold`}>{s.label}</td><td className={td}>{yuan(s.ad)} 元</td>
              <td className={td}>{s.conv}%</td><td className={td}><Money v={s.cac} /> 元</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <p className="mt-3"><strong>每个客户能赚多少</strong> = 实收 × {yuan(c.keep * 100)}% − 人工 − 获客成本(续费客户不算获客成本)</p>
      <div style={{ breakInside: 'avoid' }}><table className="mt-2 w-full border-collapse text-[12.5px]">
        <tbody>
          <tr>
            <td className={`${th} w-[24%]`}>档位</td><td className={th}>实收</td><td className={th}>人工</td>
            {c.scenarios.map((s) => <td key={s.key} className={th}>{s.label}</td>)}
          </tr>
          {c.tiers.map((t) => (
            <tr key={t.key}>
              <td className={`${td} font-semibold`}>{t.name}</td><td className={td}>{yuan(t.paid)}</td><td className={td}>{yuan(t.labor)}</td>
              {c.scenarios.map((s) => <td key={s.key} className={td}><Money v={s.profit[t.key]} /></td>)}
            </tr>
          ))}
          <tr>
            <td className={`${td} font-semibold`}>保本要多少个 90 天客户/月</td><td className={td} colSpan={2}>固定开销 ÷ 每个 90 天客户的利润</td>
            {c.scenarios.map((s) => (
              <td key={s.key} className={`${td} font-bold`}>{s.breakeven == null ? <span className="text-red-600">怎么卖都亏</span> : `${s.breakeven} 个`}</td>
            ))}
          </tr>
        </tbody>
      </table></div>
      <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[12.5px] text-slate-700">
        <li><strong>最大的风险在投流费和转化率,不在价格。</strong>保守那一列不赚钱时,先改转化(第八章交付、第六章第 7 天话术),不要先降价。</li>
        <li><strong>体验营价格可以隔场对比:</strong>9.9 和 19.9 各测几场,比的是「每个正价客户获客成本」谁低,不是谁下单多。19.9 来的人通常更认真。</li>
        <li>中等情况下每个 90 天客户能赚 500 元以上,价格就不用动;赚不到,先查交付和转化。</li>
      </ul>
    </Section>
  );
}

/* ============ 五、直播间玩法 ============ */

function LiveRoom({ p }: { p: Params }) {
  return (
    <Section no="五" title="直播间怎么播">
      <div style={{ breakInside: 'avoid' }}><table className="w-full border-collapse text-[12.5px]">
        <tbody>
          <tr><td className={`${th} w-[18%]`}>岗位</td><td className={th}>做什么</td></tr>
          <tr><td className={td}>主播</td><td className={td}>真老师出镜,自我介绍就说「飞鹰英语的 × 老师」。讲痛点、演示、讲体验营。不说「名师」「专家推荐」</td></tr>
          <tr><td className={td}>助播</td><td className={td}>手机/平板投屏,按主播的节奏切三个画面(第六章);念评论里的问题给主播</td></tr>
          <tr><td className={td}>场控</td><td className={td}>回评论、回私信、上下链接、记每轮名额;下播后把订单交给班主任</td></tr>
        </tbody>
      </table></div>

      <p className="mt-3"><strong>时段:</strong>先试工作日晚上 <Blank w="5rem">20:00–21:30</Blank>(家长吃完饭、孩子写作业前后),
        午间 <Blank w="5rem">12:00–13:00</Blank> 做一组对比。每周固定几场,让家长知道什么时候能找到你。</p>
      <p className="mt-1.5"><strong>演示用什么:</strong>平台准备好的演示学生、演示老师、演示家长三个账号(平台「机构管理 → 一键开体验账号」能开一套)。
        <strong>绝不展示真实孩子的姓名、成绩、报告</strong>。</p>

      <p className="mt-3"><strong>15 分钟一轮,一场循环 5–6 轮</strong>(新进来的家长随时能接上):</p>
      <div className="mt-1.5 flex items-stretch gap-1.5 text-center text-[12px]" style={{ breakInside: 'avoid' }}>
        {[
          ['0–2 分', '留人', '一句话说今天看什么'],
          ['2–5 分', '痛点', '记不住 / 坚持不了 / 看不见'],
          ['5–10 分', '演示', '孩子端 → 老师端 → 家长端'],
          ['10–13 分', '讲体验营', `内容、期限、数量逐条说,上链接`],
          ['13–15 分', '答疑促单', '回评论,报名额'],
        ].map(([t, a, d]) => (
          <div key={t} className="flex-1 rounded-lg border border-orange-200 bg-[#FFF8F0] px-1.5 py-2">
            <p className="text-[12px] font-black text-[#FF6B35]">{t}</p>
            <p className="font-bold text-slate-900">{a}</p>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-600">{d}</p>
          </div>
        ))}
      </div>

      <p className="mt-3"><strong>互动(只演示,不讲课):</strong></p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        <li>「评论区打孩子几年级,我现场用演示账号给你看他这个年级的课本词」</li>
        <li>「打出孩子最头疼的一个单词,我演示一下系统怎么让他反复复习这个词」</li>
      </ul>
      <p className="mt-2"><strong>名额怎么算:</strong>每场放的体验营名额 = 陪跑助教人数 × 每人还能接的体验孩子数(第四章算出来的),
        必须是真实数字。正式陪跑名额 = 助教人数 × {p.kidsPerAssistant} − 现有在读人数。</p>
    </Section>
  );
}

/* ============ 六、话术 ============ */

function Scripts({ p }: { p: Params }) {
  const n = (k: Key) => num(p[k]);
  const per90 = Number.isFinite(n('price90')) ? Math.ceil(n('price90') / 90) : '—';
  return (
    <Section no="六" title="话术(主播、班主任照着说)">
      <Script title="① 开场留人(前 30 秒)">
        <p>家长晚上好,我是飞鹰英语的 × 老师。今天不讲课,就给大家看一样东西:孩子在家背单词,家长在手机上能看到什么。</p>
        <p>孩子背了总忘的家长先别走,三分钟你就知道问题出在哪。</p>
      </Script>
      <Script title="② 讲痛点(说事实,不吓人)">
        <p>很多家长跟我说,单词背了,过两天就忘。大部分孩子不是记不住,是背完没人管复习。</p>
        <p>第二个是坚持不下来。头两天很积极,第三天开始找理由,家长下班回来也不知道他今天背没背。</p>
        <p>第三个是看不见。孩子说背完了,背了哪些、错了哪些,家长都不知道。</p>
      </Script>
      <Script title="③ 演示(三个画面,助播依次切屏)">
        <p><strong>第一屏,孩子端:</strong>打开就是「今天这一份」,20 个词,都是他最近学过、快要忘的。做完就是做完,不会越背越多。</p>
        <p><strong>第二屏,老师端:</strong>这是我们老师每天晚上看的页面。谁今天没来、谁还差几份、谁错得多,一眼就看到。没来的孩子,老师当天就提醒家长。</p>
        <p><strong>第三屏,家长端:</strong>老师今天对孩子说的一句话,还有这张学习报告:学了哪些词、哪些还要多练,都在上面。</p>
      </Script>
      <Script title="④ 讲体验营(内容、期限、数量逐条说清)">
        <p>今天直播间开的是 7 天陪跑体验营,{p.trialPrice} 元,我一条一条说清楚:</p>
        <p>一,7 天,每天一份单词任务加 20 个复习词,手机或平板做,每天 15 到 20 分钟;</p>
        <p>二,每天老师看完成情况,给孩子写一句点评,家长端同步看得到;</p>
        <p>三,孩子当天没学,老师当天提醒家长;</p>
        <p>四,第 7 天给家长一份 7 天学习总结。</p>
        <p>这一场放 × 个名额。7 天里学满 5 天,报 90 天正式陪跑立减 {p.earlyOff} 元。</p>
      </Script>
      <Script title="⑤ 促单">
        <p>名额是按老师人数定的。一个老师每天要看几十个孩子,人再多,点评就写不过来了。</p>
        <p>下单之后,班主任今天就联系你,帮孩子开好账号、把家长端绑上。</p>
        <p>{p.trialPrice} 元就是让你先看 7 天:孩子愿不愿意学、老师管不管、你能不能看得到。看完觉得不值,不用报正式的。</p>
      </Script>

      <p className="mt-3 font-bold text-slate-900">⑥ 常被问的问题</p>
      {[
        ['能提多少分?', '分数我们不承诺,也没有人能替孩子承诺。我能保证的是:每天有任务,每天有人看,没来当天提醒你,你随时能看到他学了什么、错了什么。7 天后你自己看报告判断。'],
        [`${p.price90} 太贵了。`, `算下来一天 ${per90} 块钱左右,买的不是一套题,是每天有个老师替你盯着。你可以先花 ${p.trialPrice} 看 7 天。`],
        ['孩子不配合。', '所以才要有人盯。没来,老师当天提醒;做完了,老师在他首页留一句话。家长催十句,不如老师夸一句,试 7 天就知道。'],
        ['跟普通背单词软件有什么区别?', '软件是工具,孩子用不用、用了多少,没人管。我们多了一个人:老师每天看、每天说、没来就提醒你。(不点名别家,不说别家不好。)'],
        ['我没时间陪。', '不用家长陪。你每天看一眼手机,老师提醒了你就催一句。'],
        ['几年级能学?', '小学到高中都有对应课本的词表。告诉我孩子用的是哪个版本的教材,我们按课本来。'],
        ['你们讲课吗?', '直播间不讲课。我们做的是每天的背单词和复习督学,孩子学校学的内容,我们帮他把单词每天落实。'],
      ].map(([q, a]) => (
        <div key={q} className="mt-2" style={{ breakInside: 'avoid' }}>
          <p className="font-bold text-slate-900">问:{q}</p>
          <p className="text-slate-700">答:{a}</p>
        </div>
      ))}

      <Script title="⑦ 下单后私信(场控/班主任,当天发)">
        <p>× 家长您好,我是飞鹰英语的班主任 ×。孩子的体验营明天开始,麻烦回复一下孩子的年级和用的英语课本版本,我今天就帮他开好账号。</p>
      </Script>
      <Script title="⑧ 第 6–7 天转正价(只讲看板上的事实)">
        <p>× 家长,这 7 天孩子学了 × 天,背了 × 个词,复习做完了 × 天,老出错的是 A、B、C。</p>
        <p>正式陪跑 90 天,每天还是这样有人看着。学满 5 天的,报名立减 {p.earlyOff} 元,截止到 × 月 × 日 24 点。</p>
        <p className="text-[12px] text-slate-500">(截止时间必须是真的;数字从「每日陪跑」看板那一行抄)</p>
      </Script>

      <p className="mt-3 font-bold text-slate-900">⑨ 不能说 → 换成</p>
      <div style={{ breakInside: 'avoid' }}><table className="mt-1.5 w-full border-collapse text-[12.5px]">
        <tbody>
          <tr><td className={`${th} w-1/2`}>别说</td><td className={th}>换成</td></tr>
          {[
            ['提分、保过、包会、几天背完 3500 词', '每天 20 个词,每天有人看'],
            ['输在起跑线、弯道超车、分水岭、最后一年', '早点养成每天复习的习惯'],
            ['最好、第一、唯一、顶级、名师', '我们的做法是……'],
            ['念家长好评、晒学员成绩单/报告截图', '演示账号里的真实页面'],
            ['加微信、加 V、评论区留号', '直播间链接、平台私信'],
            ['从没卖过的原价划线', `直接报 ${p.trialPrice}`],
            ['假的「最后 3 个」', '这一场放 × 个(真实数字)'],
          ].map(([a, b]) => <tr key={a}><td className={td}>{a}</td><td className={td}>{b}</td></tr>)}
        </tbody>
      </table></div>
    </Section>
  );
}

/* ============ 七、短视频引流 ============ */

function ShortVideos() {
  return (
    <Section no="七" title="短视频怎么配合直播">
      <p>短视频的任务只有一个:让家长知道「今晚几点开播、能看到什么」。每天 1–2 条,开播前 2 小时发一条预告。</p>
      <CardPairs
        items={[
          { t: '录屏:老师的一晚', d: '演示账号录「每日陪跑」看板 30 秒:谁没来、谁还差几份、点一下就发点评。配一句「每天晚上 9 点,我们老师在做的事」。' },
          { t: '录屏:孩子的一份', d: '演示账号做完「今天这一份」20 个词的过程,快进,结尾停在「今天的复习完成了」。' },
          { t: '老师口播:一个记单词的小办法', d: '比如「隔一天复习一次比一次背很多更记得住」。讲习惯和方法,不讲课本知识点、不讲题。' },
          { t: '开播预告', d: '「今晚 8 点直播间,给你看孩子背单词时家长手机上能看到什么」。不写优惠、不写名额(优惠只在直播间和商品页讲清)。' },
        ]}
      />
      <p className="mt-2 text-[12.5px] text-slate-600">
        同样的红线:不出现真实孩子、不晒成绩、不写「提分」;视频里要是讲到价格和优惠,标题或画面带「广告」字样,写清内容和期限。
      </p>
    </Section>
  );
}

/* ============ 八、体验营 7 天交付 ============ */

function Delivery() {
  return (
    <Section no="八" title="体验营 7 天怎么交付(真正决定成交的地方)">
      <p>家长花 9.9 买的是「看 7 天」。这 7 天老师管得好不好,决定了第 7 天成不成交。每一步都在系统里有入口:</p>
      <table className="mt-2 w-full border-collapse text-[12.5px]">
        <tbody>
          <tr><td className={`${th} w-[14%]`}>时间</td><td className={`${th} w-[46%]`}>做什么</td><td className={th}>在系统哪里</td></tr>
          {[
            ['下单当天', '开学生账号;分配课本单词本(不分配孩子看不到词);发家长绑定链接(一人一条,别发群);布置连续 7 天的「每日复习」作业', '机构管理「用户管理」;教师工作台「分配单词本」「家长绑定」「作业管理 → 布置句子 / 音标 / 复习作业 → 每日复习」'],
            ['第 1–6 天每晚 21 点前', '打开「要跟进」:合适的草稿直接发送,不合适点「改一改」;没来的孩子点「复制提醒」发家长', '教师工作台「课堂推进 → 每日陪跑」'],
            ['第 3 天', '给家长打 5 分钟电话,只讲三件事:学了几天、几个词、哪几个词老错', '「每日陪跑」那一行就有这些数'],
            ['第 5–6 天', '提醒孩子做完当天任务后生成「今日学习报告」发给家长', '学生端首页,任务全做完后出现绿色卡片'],
            ['第 7 天', '发 7 天总结,按第六章 ⑧ 的话术沟通转正价', '「每日陪跑」+ 家长端'],
          ].map(([a, b, c]) => <tr key={a} style={{ breakInside: 'avoid' }}><td className={`${td} font-semibold`}>{a}</td><td className={td}>{b}</td><td className={td}>{c}</td></tr>)}
        </tbody>
      </table>
      <p className="mt-2 text-[12.5px] text-slate-600">
        学满 5 天的孩子才值得打转化电话。7 天里只来了一两天的,第 7 天发一句「这期体验营结束了,下期开营还欢迎来」就够,不追。
      </p>
    </Section>
  );
}

/* ============ 九、岗位分工与绩效 ============ */

function Roles({ p }: { p: Params }) {
  return (
    <Section no="九" title="岗位分工与发钱方式">
      <div style={{ breakInside: 'avoid' }}><table className="w-full border-collapse text-[12.5px]">
        <tbody>
          <tr><td className={`${th} w-[18%]`}>岗位</td><td className={`${th} w-[46%]`}>职责</td><td className={th}>绩效看什么</td></tr>
          <tr>
            <td className={td}>高级老师<br /><span className="text-slate-500">{p.seniorSalary} 元/月</span></td>
            <td className={td}>{p.superviseShare}% 带助教、抽查点评质量;{p.liveShare}% 出镜直播、开每周家长会;其余带一对一(限 20 人)。<strong>不做每天的普通点评</strong></td>
            <td className={td}>名下助教班级的「学满 5 天比例」和续费率;一对一续费率</td>
          </tr>
          <tr>
            <td className={td}>陪跑助教<br /><span className="text-slate-500">{p.assistantSalary} 元/月</span></td>
            <td className={td}>每人带 {p.kidsPerAssistant} 个在读孩子 + 新进的体验孩子;每晚点评、提醒;每月给每个家长打一次电话</td>
            <td className={td}>本周学满 5 天的孩子比例、续费率。<strong>不按卖了多少发</strong>(按成交额发,人会只管卖不管交付)</td>
          </tr>
          <tr>
            <td className={td}>主播</td>
            <td className={td}>直播、短视频口播</td>
            <td className={td}>正价成交提成 {Math.round(num(p.commission) * 3 / 8)}%;另按「学满 5 天的体验孩子人数」给奖励,<strong>不按 9.9 的单数</strong>(否则会拉凑数的单)</td>
          </tr>
          <tr>
            <td className={td}>班主任 / 场控</td>
            <td className={td}>下单当天开通、第 7 天转化沟通、回私信</td>
            <td className={td}>正价成交提成 {num(p.commission) - Math.round(num(p.commission) * 3 / 8)}%;开通及时率(下单当天开好账号)</td>
          </tr>
        </tbody>
      </table></div>
      <p className="mt-2 text-[12.5px] text-slate-600">提成合计 {p.commission}%,已算进第四章的成本。具体比例按你们的薪酬制度定:主播 <Blank w="3rem" />%,班主任 <Blank w="3rem" />%。</p>
    </Section>
  );
}

/* ============ 十、漏斗复盘 ============ */

function Funnel() {
  return (
    <Section no="十" title="每周复盘看这条漏斗">
      <div style={{ breakInside: 'avoid' }}><table className="w-full border-collapse text-[12.5px]">
        <tbody>
          <tr><td className={`${th} w-[30%]`}>环节</td><td className={`${th} w-[16%]`}>负责</td><td className={`${th} w-[28%]`}>在哪看</td><td className={th}>本周</td></tr>
          {[
            ['进直播间 → 停留 → 下单体验营', '主播', '抖音后台'],
            ['下单 → 当天开通(账号 + 家长绑定)', '班主任', '「家长绑定」页'],
            ['开通 → 7 天学满 5 天', '陪跑助教', '「每日陪跑」近 7 天学了几天'],
            ['学满 5 天 → 转正价', '班主任', '订单'],
            ['正价 → 续费', '陪跑助教', '订单'],
          ].map(([a, b, c]) => <tr key={a}><td className={td}>{a}</td><td className={td}>{b}</td><td className={td}>{c}</td><td className={td}><Blank w="100%" /></td></tr>)}
        </tbody>
      </table></div>
      <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[12.5px] text-slate-700">
        <li>下单少:改开场和演示(第六章 ①–③)。</li>
        <li>学满 5 天的少:改交付,多半是提醒不及时、账号没当天开好。</li>
        <li>学满 5 天的多但转正价少:改第 7 天话术,或看价格(第四章)。</li>
        <li>前两周最要紧的是量出四个数:每个孩子每天实际几分钟、每单投流费、学满 5 天比例、体验转正价比例,填回第四章「实测」。</li>
      </ul>
    </Section>
  );
}

/* ============ 十一、上线前确认 ============ */

function Checklist() {
  const items = [
    '抖音能用哪个类目卖「背单词软件 + 督学服务」、要哪些资质(向平台确认)',
    '是否属于需要审批的线上学科类培训(向当地教育部门确认)',
    '商品页写清:服务内容、天数、立减条件与截止时间、退款规则',
    '正式陪跑里的每周家长会做不做;做的话只讲班级整体情况和下周安排,不讲课',
    '演示学生、老师、家长三个账号准备好,演示数据里没有真实孩子',
    '助教人数和每人能接的体验名额算好,直播间只按这个数放名额',
  ];
  return (
    <Section no="十一" title="上线前要确认的事">
      <div style={{ breakInside: 'avoid' }}><table className="w-full border-collapse text-[12.5px]">
        <tbody>
          <tr><td className={th}>事项</td><td className={`${th} w-[22%]`}>结论</td><td className={`${th} w-[14%]`}>负责人</td></tr>
          {items.map((t) => <tr key={t}><td className={td}>{t}</td><td className={td}><Blank w="100%" /></td><td className={td}><Blank w="100%" /></td></tr>)}
        </tbody>
      </table></div>
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[12.5px]" style={{ breakInside: 'avoid' }}>
        <p className="text-slate-600">
          依据:《中华人民共和国广告法》第二十四条;《互联网广告管理办法》(2023);湖南省市场监督管理局《教育培训(含涉考培训)广告合规提示》(2026-09-23)。
          抖音平台规则以抖音规则中心最新版为准。
        </p>
        <p className="mt-2 border-t border-slate-200 pt-2 text-center text-[11px] text-slate-400">
          飞鹰英语 —— 内部培训资料,成本与利润测算仅供内部决策,请勿外传
        </p>
      </div>
    </Section>
  );
}

/* ============ 文档 ============ */

const STORE_KEY = 'fk_douyin_params_v1';

function loadParams(): Params {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const out = { ...DEFAULT_PARAMS };
      for (const k of Object.keys(DEFAULT_PARAMS) as Key[]) {
        if (typeof saved[k] === 'string') out[k] = saved[k];
      }
      return out;
    }
  } catch { /* 读不到就用默认值 */ }
  return { ...DEFAULT_PARAMS };
}

export default function FranchiseDouyinDoc() {
  const [p, setP] = useState<Params>(loadParams);
  const set = (k: Key, v: string) => setP((prev) => {
    const next = { ...prev, [k]: v.slice(0, 12) };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
    return next;
  });
  const reset = () => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* 忽略 */ }
    setP({ ...DEFAULT_PARAMS });
  };
  return (
    <article className="text-[13.5px] leading-6 text-slate-800">
      <header className="border-b-4 border-[#FF6B35] pb-5 text-center">
        <p className="text-[13px] font-semibold tracking-[0.3em] text-[#FF6B35]">飞鹰英语 · 员工与主播培训手册</p>
        <h1 className="mt-2 text-[30px] font-black leading-tight text-slate-900">抖音直播招生方案</h1>
        <p className="mt-3 text-[16px] font-bold text-slate-900">卖「看得见的督学」,不卖「提分」</p>
        <p className="mt-1.5 text-[13px] text-slate-600">
          9.9 体验营引流 → 7 天让家长亲眼看到每天有人管 → 第 7 天按看板上的事实转正式陪跑
        </p>
      </header>
      <RedLines />
      <Positioning />
      <Products p={p} />
      <CostModel p={p} set={set} onReset={reset} />
      <LiveRoom p={p} />
      <Scripts p={p} />
      <ShortVideos />
      <Delivery />
      <Roles p={p} />
      <Funnel />
      <Checklist />
    </article>
  );
}
