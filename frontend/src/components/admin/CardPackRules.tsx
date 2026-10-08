/**
 * 卡包规则说明(2026-10-08)—— 给开卡的老师/机构管理员看,一屏看懂。
 * 所有数字来自后端 catalog,这里只负责把它们讲清楚。
 */
import type { PackCatalog } from '../../api/cardPack';

const yuan = (n: number) => `¥${n.toLocaleString('zh-CN')}`;

export default function CardPackRules({ catalog, compact = false }: { catalog: PackCatalog; compact?: boolean }) {
  const labelOf = Object.fromEntries(catalog.kinds.map(k => [k.kind, k.label]));
  const packKinds = catalog.kinds.filter(k => k.kind !== 'premium');
  const premium = catalog.kinds.find(k => k.kind === 'premium');

  return (
    <div className="space-y-4 text-sm leading-6 text-slate-700">
      <section>
        <h3 className="font-bold text-slate-900">一、五种卡,各开什么书</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-amber-50 text-left">
                <th className="border border-amber-200 px-2 py-1.5">卡</th>
                <th className="border border-amber-200 px-2 py-1.5">开哪些书</th>
                {/* 单价是机构进货价,老师版(compact)不显示,免得传到家长那里 */}
                {!compact && <th className="border border-amber-200 px-2 py-1.5 text-right">单价</th>}
              </tr>
            </thead>
            <tbody>
              {catalog.kinds.map(k => (
                <tr key={k.kind}>
                  <td className="border border-amber-200 px-2 py-1.5 font-semibold">{k.label}</td>
                  <td className="border border-amber-200 px-2 py-1.5">{k.covers}</td>
                  {!compact && <td className="border border-amber-200 px-2 py-1.5 text-right">{yuan(k.price)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          <li><strong>每张卡都是半年</strong>:学生兑换那天开始算,{catalog.card_days} 天后到期。</li>
          <li><strong>兑换码 {catalog.code_valid_years} 年内有效</strong>:码发出去没兑换不算时间,放着不会作废。</li>
          <li>学生学满半年还要学:再给他兑一张<strong>同种同范围</strong>的卡,到期日接着往后加 {catalog.card_days} 天,不断档。</li>
        </ul>
      </section>

      <section>
        <h3 className="font-bold text-slate-900">二、发哪种卡,看家长要什么</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>来试听、做招生活动 → <strong>{labelOf.trial}</strong></li>
          <li>只想跟学校这一本课本 → <strong>{labelOf.single}</strong>(发码时选那一本)</li>
          <li>这个学段的书都要(最常见) → <strong>{labelOf.stage}</strong>(选版本 + 学段,如「人教版 · 小学」)</li>
          <li>小升初、初升高衔接,要往前补往后学 → <strong>{labelOf.full}</strong>(选版本)</li>
          <li>考纲词汇这类精品书 → <strong>{premium?.label}</strong>(选那一本)</li>
        </ul>
        <p className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[13px]">
          版本选孩子学校用的那一版,别多开 —— 书一多,孩子反而找不到自己那本。
          转学换了版本,给他发一张新版本的卡。
        </p>
      </section>

      <section>
        <h3 className="font-bold text-slate-900">三、以后上了新书怎么办</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li><strong>{labelOf.stage}、{labelOf.full}会自动拿到新书</strong>:有效期内,同版本同学段新上架的课本自动出现在学生书架上,到期日跟卡一样。不用补发,也不用找平台。</li>
          <li>{labelOf.single}、{premium?.label}永远只是发码时选的那一本。</li>
          <li>精品书和飞鹰校本教材(语法、音标)不会进学段卡和全通卡。</li>
        </ul>
      </section>

      <section>
        <h3 className="font-bold text-slate-900">四、老师布置作业要注意</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li><strong>课本和精品书只能用兑换码开</strong>,老师不能在后台直接分配给学生。</li>
          <li>布置这些书的作业前,先确认学生已经兑换了卡;没兑换的学生打开作业会提示「要先兑换学习卡」。</li>
          <li>入门课和本机构自己建的书不受限制,老师照常直接分配、布置作业。</li>
        </ul>
      </section>

      {!compact && (
        <section>
          <h3 className="font-bold text-slate-900">五、额度怎么来</h3>
          <p className="mt-1">
            标准包 {yuan(catalog.pack_price)},分 {catalog.installments.length} 期付,每期{' '}
            {yuan(catalog.installments[0]?.value ?? 0)}。平台每确认到账一期,你这边就多出这一期的卡:
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-amber-50">
                  <th className="border border-amber-200 px-2 py-1.5 text-left">期</th>
                  {packKinds.map(k => <th key={k.kind} className="border border-amber-200 px-2 py-1.5">{k.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {catalog.installments.map(ins => (
                  <tr key={ins.no}>
                    <td className="border border-amber-200 px-2 py-1.5">
                      第 {ins.no} 期{ins.due_month === 0 ? '(签约时)' : `(第 ${ins.due_month} 个月)`}
                    </td>
                    {packKinds.map(k => (
                      <td key={k.kind} className="border border-amber-200 px-2 py-1.5 text-center">
                        {ins.cards[k.kind] ?? '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            <li>每种卡的额度<strong>分开算</strong>:{labelOf.trial}用完了,不能拿{labelOf.full}的额度去发。</li>
            <li>卡用得快可以<strong>提前付下一期</strong>;一次付清 {catalog.installments.length} 期送 {catalog.bonus_full_pay} 张{labelOf.full},
              付完第 1 期后把剩下两期一次结清送 {catalog.bonus_early_settle} 张。</li>
            <li>付完 {catalog.installments.length} 期还要卡就<strong>补货</strong>,按上面单价,每种 {catalog.restock_min} 张起。{premium?.label}只通过补货买。</li>
            <li>码生成错了:没兑换的删掉或禁用,额度退回来。已兑换的不退。</li>
          </ul>
        </section>
      )}
    </div>
  );
}
