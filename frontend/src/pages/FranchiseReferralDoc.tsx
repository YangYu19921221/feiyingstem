/**
 * 加盟资料中心 · 文档五:家长推荐运营方案(老带新)
 *
 * **给机构老板和老师看的**操作手册(不是给家长看的;给家长的话术在第五章,可直接复制)。
 * 系统功能见 pages/ReferralLeads.tsx + services/referral.py,本文的规则必须与之一致:
 *  - 奖励只在老师点「确认报名」后才发,只留电话不发
 *  - 同一机构同一手机号只认第一个推荐人
 *  - 手机号已是本机构账号的默认不发,老师勾选才发
 *  - 推荐奖励金币 0–50(MAX_REWARD_COINS),一次确认只发一次
 *
 * ⚠️ 口径红线(与家长手册、招商手册同一套,改文案前必读):
 *  1. **微信诱导分享**: 不做「转发得奖励 / 集赞 / 分享后才能看」。奖励挂在「朋友到店报名」上,
 *     海报上只写新朋友能得到什么,不写老生奖励。被判诱导分享封的是整个域名,学生端会一起打不开
 *  2. **广告法第二十四条**: 话术、海报不承诺分数和升学
 *  3. **未成年人信息**: 海报只露孩子的姓,不出全名、学校、照片;推荐榜不在公开场合贴全名
 *  4. **不做多级分销**: 只奖励直接推荐的那一家,不给「推荐人的推荐人」任何奖励
 *  5. 奖励力度、活动时间、赠课规则一律**留空栏由机构填**,不替机构定价;
 *     建议值只写成区间和「参考」
 */

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

/** 两列卡片:一行一个 flex 装两张,不用 grid(html2pdf 分页占位元素会挤占 grid 格子导致错位) */
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

/** 话术框:老师直接照着复制。一段一框,不跨页 */
const Script = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mt-2.5 rounded-lg border-l-4 border-[#FF6B35] bg-[#FFF8F0] px-3 py-2.5" style={{ breakInside: 'avoid' }}>
    <p className="text-[12px] font-bold text-[#FF6B35]">{title}</p>
    <div className="mt-1 text-[13px] leading-6 text-slate-700">{children}</div>
  </div>
);

export default function FranchiseReferralDoc() {
  return (
    <article className="text-[13.5px] leading-6 text-slate-800">
      <header className="border-b-4 border-[#FF6B35] pb-5 text-center">
        <p className="text-[13px] font-semibold tracking-[0.3em] text-[#FF6B35]">飞鹰英语 · 合作机构运营手册</p>
        <h1 className="mt-2 text-[30px] font-black leading-tight text-slate-900">家长推荐运营方案</h1>
        <p className="mt-3 text-[16px] font-bold text-slate-900">
          让满意的家长,把孩子的进步讲给身边的朋友听
        </p>
        <p className="mt-1.5 text-[13px] text-slate-600">
          系统负责「谁推荐的、来了没有、该奖励谁」,机构负责「把孩子教好、把电话打好」
        </p>
      </header>

      {/* 一、为什么做 */}
      <Section no="一" title="为什么做家长推荐">
        <CardPairs
          items={[
            { t: '最信得过的渠道', d: '家长给孩子选英语课,最听的是身边朋友的话。朋友的孩子学得好、天天在学,比任何广告都有说服力。' },
            { t: '学科类不好投广告', d: '面向中小学生的学科类培训,在公共媒体和公共场所做宣传有严格限制。家长之间的口碑是最稳妥的招生方式。' },
            { t: '系统里有「看得见的进步」', d: '学会了多少词、连续学了多少天、每周学情报告,家长手机上都看得见 —— 家长愿意分享,是因为有东西可讲。' },
            { t: '成本可控、可追踪', d: '只给真正报名的推荐发奖励。谁推荐了谁、来了几个、奖励兑现了没有,后台一目了然。' },
          ]}
        />
      </Section>

      {/* 二、系统怎么运转 */}
      <Section no="二" title="系统里是怎么运转的">
        <div className="mt-1.5 flex items-stretch gap-1.5 text-center text-[12px]" style={{ breakInside: 'avoid' }}>
          {[
            ['1', '生成邀请', '老师给学生生成,或家长在家长端自己生成;每个孩子一个专属二维码'],
            ['2', '朋友扫码', '看到「X同学的家长邀请您」和新朋友福利,留电话预约'],
            ['3', '老师跟进', '「推荐线索」里出现一条待联系,写清是哪个孩子推荐的'],
            ['4', '确认报名', '到店交费后老师点确认,系统给推荐的孩子发金币'],
            ['5', '兑现奖励', '线下奖励(如赠课)兑现后点「已兑现」,方便对账'],
          ].map(([n, t, d]) => (
            <div key={n} className="flex-1 rounded-lg border border-orange-200 bg-[#FFF8F0] px-1.5 py-2">
              <p className="text-[16px] font-black text-[#FF6B35]">{n}</p>
              <p className="font-bold text-slate-900">{t}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-600">{d}</p>
            </div>
          ))}
        </div>
        <table className="mt-3 w-full border-collapse text-[12.5px]" style={{ breakInside: 'avoid' }}>
          <tbody>
            <tr className="bg-[#FFF3EC] font-bold"><td className={`${td} w-[22%]`}>谁</td><td className={td}>在哪里操作</td></tr>
            <tr><td className={td}>机构管理员</td><td className={td}>机构管理首页 → 管理 →「家长推荐」→ 右上「推荐设置」:定奖励、写新朋友福利、开关推荐;下方看全机构线索和推荐榜</td></tr>
            <tr><td className={td}>老师</td><td className={td}>教师工作台 → 激励与复盘 →「家长推荐」→「给学生家长发邀请」选学生,复制话术或保存海报发给家长;只看本班学生推荐来的线索</td></tr>
            <tr><td className={td}>老生家长</td><td className={td}>家长端首页「邀请朋友来免费体验」→ 生成海报 → 长按保存或复制文字发微信</td></tr>
            <tr><td className={td}>新朋友家长</td><td className={td}>扫码或点链接 → 留手机号和孩子年级,不用注册、不用验证码</td></tr>
          </tbody>
        </table>
      </Section>

      {/* 三、四条规则 */}
      <Section no="三" title="四条规则(系统自动执行)">
        <ol className="mt-1 list-decimal space-y-1.5 pl-5">
          <li style={{ breakInside: 'avoid' }}><strong>报名了才奖励,留电话不算。</strong>防止为了奖励拉亲戚凑数、编假号码;也不会出现「白给了奖励、人没来」。</li>
          <li style={{ breakInside: 'avoid' }}><strong>同一个手机号只认第一个推荐人。</strong>两位家长都推荐了同一家,先留电话的那位算。</li>
          <li style={{ breakInside: 'avoid' }}><strong>老客户不算拉新。</strong>手机号已经是本校账号的,列表里会标出来,确认报名时默认不发奖励;如果确实是给弟弟妹妹新报名,老师勾选后照常发。</li>
          <li style={{ breakInside: 'avoid' }}><strong>一次报名只奖励一次。</strong>确认报名后不能撤销、不能重复确认;线下奖励兑现也只能点一次。所有确认操作都进「操作记录」,可追溯是哪位老师点的。</li>
        </ol>
      </Section>

      {/* 四、奖励怎么设 */}
      <Section no="四" title="奖励怎么设">
        <p>奖励分两头:<strong>给新朋友的</strong>(吸引他来)和<strong>给老生家庭的</strong>(感谢他推荐)。建议以「课」为主、金币为辅 —— 课是机构自己的服务,成本低、还能顺带多留住老生一段时间。</p>
        <table className="mt-3 w-full border-collapse text-[12.5px]" style={{ breakInside: 'avoid' }}>
          <tbody>
            <tr className="bg-[#FFF3EC] font-bold">
              <td className={`${td} w-[18%]`}>对象</td><td className={`${td} w-[42%]`}>参考做法</td><td className={td}>本校区定为</td>
            </tr>
            <tr>
              <td className={td}>新朋友</td>
              <td className={td}>免费测评 1 次 + 体验课 1–2 节;报名首期可送教材或学习用品</td>
              <td className={td}><Blank w="100%" /></td>
            </tr>
            <tr>
              <td className={td}>老生家庭</td>
              <td className={td}>朋友报名后赠课 1–2 节,或续费时抵扣一部分学费</td>
              <td className={td}><Blank w="100%" /></td>
            </tr>
            <tr>
              <td className={td}>老生孩子</td>
              <td className={td}>系统金币 5–20 枚(可在本校金币商城换奖品);金币是给孩子的,不是给家长的</td>
              <td className={td}><Blank w="4rem" /> 金币</td>
            </tr>
            <tr>
              <td className={td}>推荐之星</td>
              <td className={td}>每学期按「报名人数」评一次,颁奖状和一份小礼物,在家长会上表扬</td>
              <td className={td}><Blank w="100%" /></td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[12.5px] text-slate-600">
          不建议: 给现金或红包、按「转发次数」「点赞数」发奖励、给「推荐人的推荐人」再发一层奖励。
          前两种在微信里会被判诱导分享,第三种是多级分销,都有封号或合规风险。
        </p>
      </Section>

      {/* 五、老师话术 */}
      <Section no="五" title="老师怎么跟家长开口(可直接复制)">
        <p>
          <strong>开口的时机比话术更重要。</strong>挑家长最满意的时候:孩子单元过关满分、当上单词王、
          学会的词数过了 100/500/1000、家长在群里夸孩子进步的那天。
        </p>
        <Script title="① 私聊老生家长(最常用)">
          X 同学家长您好!孩子这段时间学得特别认真,系统里已经学会 ___ 个单词了,真替他高兴。
          如果身边有朋友家的孩子也想把英语单词学扎实,可以把下面这张海报转给他们,朋友能来做一次免费测评和体验课。
          朋友报名的话,我们也给您家准备了一份感谢:___。
        </Script>
        <Script title="② 家长会 / 结课时当面说">
          很多家长问我们怎么招生,其实我们最大的生源就是各位家长的朋友。今天每位家长手机上都能生成一张自己孩子的邀请海报,
          (现场演示:家长端首页 → 生成海报)。朋友扫码留个电话就行,我们会打电话约时间,不会反复打扰。
        </Script>
        <Script title="③ 电话联系新朋友(收到线索 24 小时内打)">
          您好,我是 ___ 校区的 ___ 老师。您的朋友 ___ 家长推荐您来了解我们的英语课。
          孩子现在几年级?平时英语主要是哪一块比较吃力?我们这周 ___ 有免费测评,大概 20 分钟,
          测完老师当面讲孩子的情况和适合的学法,您看哪天方便?
        </Script>
        <p className="mt-2 text-[12.5px] text-slate-600">
          话术里不说「保证提分」「包过」「一定考上」;成绩个案只说「往届个案、因人而异」。
        </p>
      </Section>

      {/* 六、月度节奏 */}
      <Section no="六" title="一个月怎么推(参考节奏)">
        <table className="mt-1 w-full border-collapse text-[12.5px]" style={{ breakInside: 'avoid' }}>
          <tbody>
            <tr className="bg-[#FFF3EC] font-bold">
              <td className={`${td} w-[16%]`}>时间</td><td className={`${td} w-[44%]`}>做什么</td><td className={td}>谁负责 / 完成情况</td>
            </tr>
            {[
              ['第 1 周', '机构管理员设好奖励和新朋友福利;老师在教师群里过一遍流程,每人先给 5 位最满意的家长发邀请'],
              ['第 2 周', '借单元过关、单词王等时机,每天私聊 2–3 位家长;收到线索 24 小时内回电'],
              ['第 3 周', '开一次家长会或线上分享会,现场演示家长端生成海报;安排集中体验课'],
              ['第 4 周', '复盘:看推荐榜和每位老师的线索转化,兑现本月奖励,表扬推荐之星'],
            ].map(([w, d]) => (
              <tr key={w}><td className={td}>{w}</td><td className={td}>{d}</td><td className={td}><Blank w="100%" /></td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2">适合集中推的时间:开学前两周、期中/期末成绩出来后、寒暑假报名季。</p>
      </Section>

      {/* 七、看哪些数 */}
      <Section no="七" title="每周看三个数">
        <CardPairs
          items={[
            { t: '发出邀请的家长数', d: '推荐榜里能看到哪些孩子带来了线索。没人推荐,说明家长没收到邀请或时机不对,先查老师有没有发。' },
            { t: '线索 → 到店率', d: '「已试听」占全部线索的比例。偏低说明回电慢或话术要改,先看「待联系」是不是堆着没人打。' },
            { t: '到店 → 报名率', d: '「已报名」占「已试听」的比例。偏低要看体验课本身,和推荐活动关系不大。' },
            { t: '奖励待兑现', d: '列表顶部「奖励待兑现」不为 0 时及时兑现。答应家长的奖励拖着不给,下一次就没人推荐了。' },
          ]}
        />
      </Section>

      {/* 八、常见问题 */}
      <Section no="八" title="常见问题">
        {[
          ['家长没有家长端账号怎么办?', '老师在「家长推荐」里给这个孩子生成邀请,把海报或话术直接发给家长即可。家长端和老师端拿到的是同一个链接,推荐都记在这个孩子名下。'],
          ['朋友留了电话但说不清是谁推荐的?', '不用问。每条线索都写着是哪个孩子的邀请链接带来的。'],
          ['推荐的孩子毕业或停课了,奖励还发吗?', '孩子账号停用后,他的邀请链接会失效;已经留下的线索照常跟进,金币只发给仍在本校的孩子。'],
          ['奖励设错了能改吗?', '随时可以在「推荐设置」里改,改完只影响之后确认的报名;已经确认过的那一条按当时的规则记录,不会变。'],
          ['想暂停活动?', '「推荐设置」里关掉推荐,所有邀请链接立即打不开;已有的线索照常可以跟进。'],
        ].map(([q, a]) => (
          <div key={q} className="mt-2.5" style={{ breakInside: 'avoid' }}>
            <p className="font-bold text-slate-900">问:{q}</p>
            <p className="text-slate-700">答:{a}</p>
          </div>
        ))}
      </Section>

      {/* 结尾栏与免责声明并成一块: 单独一行 footer 会被挤到下一页,孤零零占一整页 */}
      <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px]" style={{ breakInside: 'avoid' }}>
        <p className="font-bold text-slate-900">本校区活动安排</p>
        <p className="mt-1">活动时间:<Blank w="12rem" />{'　　'}负责人:<Blank w="7rem" /></p>
        <p className="mt-1">本月目标:新增线索 <Blank w="3rem" /> 条,到店 <Blank w="3rem" /> 人,报名 <Blank w="3rem" /> 人</p>
        <p className="mt-2 border-t border-slate-200 pt-2 text-center text-[11px] text-slate-400">
          飞鹰英语 —— 本方案所述功能以系统实际情况为准,奖励规则由各校区自行确定
        </p>
      </div>
    </article>
  );
}
