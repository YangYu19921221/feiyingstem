"""知识点地图(唯一真源,2026-11-22)

试卷库给每道题标知识点、孩子的把握度按知识点记、组卷按知识点挑,都用这一份。
语法带学(句子积木,backend/app/grammar)的「一般现在时」10 节课挂在 lessons 上 —— 以后孩子哪个点不会,
直接接上讲这个点的那节小课。

第一版的点是照 2026-11-22 试拆的人教版七上测评卷(9 套、180 道单选和填空)里真出现过的点整理的,
加上一般现在时那条线拆细(be → be 和动作词别混 → 三单 / 用原形 → 否定和疑问)。
- prereq: 这个点要先会哪几个点(孩子这个点总错,先查前面的点)
- contrast: 要和哪个点对比着练(只练「加 s」的题,一律加 s 的孩子也全对;混着出才看得出是不是真会)
- codes: 这个点常见的几种错法。拆卷时每个错选项 / 常见填错挂一种,孩子选了哪个就知道他是哪种错
- diagnose=False: 不考英语知识(常识、计算、看表),不算进孩子的把握度,也不拿来组卷

改这里要注意: id 一旦有孩子的作答记录就别改(paper_kp_mastery 按 id 存);要拆细就加新 id。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

OTHER = "other"


@dataclass(frozen=True)
class Point:
    id: str
    name: str                     # 老师看的名字
    kid: str                      # 孩子看的说法(不出现「弱」字,不用术语)
    group: str                    # grammar 语法 / vocab 词汇 / talk 交际 / other 其它
    stage: str                    # 小学 / 初中
    codes: dict = field(default_factory=dict)
    prereq: tuple = ()
    contrast: Optional[str] = None
    lessons: tuple = ()           # 句子积木的课号(backend/app/grammar/lessons_present.py)
    diagnose: bool = True


POINTS: tuple[Point, ...] = (
    # ---------------- 一般现在时这条线(句子积木第 1 期)
    Point("be", "be 动词(am / is / are)", "am、is、are 跟谁用", "grammar", "小学",
          {"be.person": "主语和 am / is / are 对不上(I is / They is)",
           "be.plural": "两个人或复数当主语却用了 is",
           "be.base": "直接用了 be 原形当谓语"},
          lessons=(101, 102, 103)),
    Point("be_neg_q", "be 动词的否定、疑问和简略回答", "带 am、is、are 的句子怎么说不、怎么问", "grammar", "小学",
          {"beq.not": "not 放错了位置",
           "beq.move": "问句没把 am / is / are 放到最前面",
           "beq.answer": "简略回答和问句对不上(Are those …? Yes, he is)"},
          prereq=("be",), lessons=(104, 105)),
    Point("be_vs_do", "be 和动作词别混用", "有了动作词,就不要 am、is、are", "grammar", "小学",
          {"bedo.both": "be 和动作词连着用(He is play)",
           "bedo.q": "动作词的句子用 is / are 来问(Is he like …?)"},
          prereq=("be",), lessons=(106,)),
    Point("pres_3sg", "一般现在时·三单", "他、她、它做事,动作词加 s", "grammar", "小学",
          {"3sg.missing": "主语是他、她、它(一个人、一样东西),动词漏了 s",
           "3sg.spelling": "加 s 的写法错了(studys / gos / haves)"},
          prereq=("be_vs_do",), contrast="pres_base", lessons=(107, 108)),
    Point("pres_base", "动词用原形", "什么时候动作词不加 s", "grammar", "小学",
          {"base.extra_s": "不该加 s 的加了(They likes / can cooks / doesn't likes)",
           "base.ing": "该用原形的用了 -ing 或别的形式"},
          prereq=("be_vs_do",), contrast="pres_3sg", lessons=(107, 109)),
    Point("do_neg_q", "一般现在时的否定和疑问(do / does)", "动作词的句子怎么说不、怎么问", "grammar", "小学",
          {"doq.helper": "don't 和 doesn't、do 和 does 用反了",
           "doq.verb_s": "doesn't / does 后面的动词又加了 s",
           "doq.be": "动作词的句子用 be 来否定或提问"},
          prereq=("pres_3sg", "pres_base"), lessons=(109, 110)),
    Point("there_be", "there be 句型", "There is / There are 怎么用", "grammar", "小学",
          {"there.have": "there be 和 have / has 混用(中文都说「有」)",
           "there.number": "is / are 和后面的东西单复数对不上",
           "there.uncount": "不可数的东西(milk、chicken)用了 are"},
          prereq=("be",)),
    # ---------------- 其它时态和动词
    Point("pres_cont", "现在进行时", "正在做的事怎么说", "grammar", "小学",
          {"cont.no_be": "少了 am / is / are", "cont.ing": "-ing 写法错了", "cont.signal": "看到 now、Look! 没用进行时"},
          prereq=("be",)),
    Point("past", "一般过去时", "过去的事怎么说", "grammar", "小学",
          {"past.form": "过去式写错了", "past.signal": "看到 yesterday、last … 没用过去时",
           "past.did": "didn't / did 后面没用原形"},
          prereq=("pres_base",)),
    Point("future", "一般将来时(will / be going to)", "以后要做的事怎么说", "grammar", "小学",
          {"fut.form": "will / be going to 后面没用原形", "fut.signal": "看到 tomorrow、next … 没用将来时"},
          prereq=("pres_base",)),
    Point("clause_tense", "从句的时态(主将从现)", "if、when 后面用什么时态", "grammar", "初中",
          {"ct.future": "if / when / as soon as 后面用了将来时"},
          prereq=("future", "pres_3sg")),
    Point("modal", "情态动词(can / must / should …)", "can、must、should 的意思和用法", "grammar", "小学",
          {"modal.meaning": "情态动词意思选错了(mustn't 是「禁止」)", "modal.base": "情态动词后面没用原形"},
          contrast="pres_3sg"),
    Point("nonfinite", "动词的 to do / doing / 原形", "动词后面接 to do 还是 doing", "grammar", "初中",
          {"nf.to_ing": "to do 和 doing 用混了(enjoy、finish、spend time 后面接 doing)",
           "nf.base": "该用 to do 或 doing 的用了原形", "nf.finite": "该用 to do / doing 的用了带 s 或过去式的"},
          prereq=("pres_base",)),
    # ---------------- 名词、代词、冠词、数词
    Point("noun_plural", "名词单复数(可数 / 不可数)", "一个还是好几个,单词要不要变", "grammar", "小学",
          {"pl.missing": "该用复数的没变", "pl.extra": "该用单数的用了复数",
           "pl.spelling": "复数写法错了(classs / boxs / childs)", "pl.uncount": "不可数的东西当成可数"}),
    Point("possessive_noun", "名词所有格('s)", "「谁的」怎么写", "grammar", "小学",
          {"poss.share": "各自的和共同的弄混了(Jim's and Sally's 是各自的)", "poss.missing": "该用 's 没用"}),
    Point("pronoun_case", "人称代词(主格 / 宾格)", "I 和 me、they 和 them 什么时候用", "grammar", "小学",
          {"pc.swap": "主格和宾格用反了(help they / Him likes)"}),
    Point("pronoun_poss", "物主代词(my / mine …)", "my 和 mine、our 和 ours", "grammar", "小学",
          {"pp.noun": "名词前面用了主格或宾格(we family / you classmates)",
           "pp.alone": "my、your 单独用了(Is it my?)", "pp.person": "人称对不上(说别人用了 my)"}),
    Point("demonstrative", "指示代词(this / that / these / those)", "this、that、these、those", "grammar", "小学",
          {"dem.number": "单复数和后面对不上(These is / This are)", "dem.near_far": "远近用反了"}),
    Point("indef_pronoun", "不定代词(some / any / every- / each other …)", "some、any、everyone 这类词", "grammar", "初中",
          {"ind.some_any": "some 和 any 用混了", "ind.meaning": "意思选错了(everyone / nobody / each other)"}),
    Point("article", "冠词(a / an / the)", "a、an、the 怎么用", "grammar", "小学",
          {"art.a_an": "a 和 an 用反了(看开头的读音)", "art.the": "该用 the 没用,或者不该用的用了"}),
    Point("numeral", "数词(基数词 / 序数词)", "one 和 first、twelve 和 twelfth", "grammar", "小学",
          {"num.ord": "该用序数词(第几)的用了基数词", "num.spelling": "序数词写错了(twelveth / fiveth)"}),
    # ---------------- 介词、连词、疑问词、词性
    Point("prep_time", "介词·时间(at / on / in)", "at、on、in 放在时间前面", "grammar", "小学",
          {"pt.mix": "at、on、in 用混了(钟点 at、哪一天 on、月份年份 in)"}),
    Point("prep_place", "介词·方位(in front of / behind / next to …)", "在前面、后面、旁边、对面", "grammar", "小学",
          {"pplace.meaning": "方位意思弄反了"}),
    Point("prep_phrase", "固定搭配(good at / interested in / thank … for)", "固定搭配里用哪个小词", "grammar", "小学",
          {"phr.prep": "搭配里的介词用错了"}),
    Point("conjunction", "连词(and / but / or / so / because)", "and、but、so、because 连两句话", "grammar", "小学",
          {"conj.cause": "原因和结果用反了(because 引出原因、so 引出结果)", "conj.turn": "前后意思相反却没用 but"}),
    Point("wh_word", "特殊疑问词(what / who / when / how …)", "问什么用什么疑问词", "grammar", "小学",
          {"wh.wrong": "疑问词选错了(看答语问的是什么)"}),
    Point("adj_adv", "词性转换(形容词 / 副词 / 构词)", "good 和 well,词要变成什么样", "grammar", "初中",
          {"aa.form": "词性没变对(good / well、meaning / meaningful)"}),
    Point("comparison", "比较级和最高级", "比一比: -er、-est、more、most", "grammar", "小学",
          {"cmp.form": "比较级、最高级写错了", "cmp.signal": "看到 than / of all 没用比较级 / 最高级"}),
    Point("linking_verb", "感官系动词(sound / look / taste …)", "sound、look、taste 后面接什么", "grammar", "初中",
          {"lv.adv": "系动词后面用了副词", "lv.meaning": "选错了是哪种感觉"}),
    Point("sentence_type", "句型和句子成分(祈使句 / 感叹句 / 主谓宾)", "句子里哪个是主语、怎么感叹", "grammar", "初中",
          {"st.part": "句子成分判断错了", "st.exclaim": "感叹句 What 和 How 用混了"}),
    # ---------------- 词汇、交际
    Point("vocab_meaning", "词义辨析", "在句子里选意思对的词", "vocab", "小学",
          {"vm.meaning": "意思选错了"}),
    Point("verb_phrase", "动词短语(put up / work out / get up …)", "动词短语的意思", "vocab", "小学",
          {"vp.meaning": "短语意思选错了"}),
    Point("names_titles", "称呼、姓名和班级年级的写法", "Mr Brown、first name、Class Three 怎么写", "vocab", "小学",
          {"nt.order": "姓和名弄反了", "nt.capital": "大小写或先后写错了(Class Three)", "nt.title": "称呼用错了(Mr / Mrs / Miss)"}),
    Point("situational", "情景交际", "在这个场合该说哪句话", "talk", "小学",
          {"sit.reply": "回答和场合对不上"}),
    Point("phonics", "音标和发音", "字母组合怎么读", "vocab", "小学",
          {"ph.sound": "读音选错了"}),
    Point("common_sense", "常识、计算、看图表", "看图看表算一算", "other", "小学",
          {}, diagnose=False),
)

BY_ID: dict[str, Point] = {p.id: p for p in POINTS}
IDS: tuple[str, ...] = tuple(p.id for p in POINTS)
# 所有错法 code(拆卷工具里给模型选的范围)
ALL_CODES: tuple[str, ...] = tuple([c for p in POINTS for c in p.codes] + [OTHER])
GROUP_LABEL = {"grammar": "语法", "vocab": "词汇", "talk": "交际", "other": "其它"}

assert len(BY_ID) == len(POINTS), "知识点 id 重复了"
for _p in POINTS:
    for _r in _p.prereq:
        assert _r in BY_ID, f"{_p.id} 的前置 {_r} 不存在"
    assert _p.contrast is None or _p.contrast in BY_ID, f"{_p.id} 的对比点不存在"
    for _c in _p.codes:
        assert _c.split(".")[0], _c
assert len(set(ALL_CODES)) == len(ALL_CODES), "错法 code 重复了"


def clean_kps(raw) -> list[str]:
    """模型 / 老师给的知识点 → 认识的 id,去重,最多 3 个,顺序保留(第一个是最主要的)"""
    out: list[str] = []
    for k in raw or []:
        k = str(k).strip()
        if k in BY_ID and k not in out:
            out.append(k)
    return out[:3]


def clean_code(code, kps: list[str]) -> str:
    """错法 code 必须属于这题的某个知识点;不属于的当 other(模型偶尔会挂到别的点上)"""
    c = str(code or "").strip()
    for k in kps:
        if c in BY_ID[k].codes:
            return c
    return OTHER


def code_label(code: Optional[str]) -> str:
    for p in POINTS:
        if code in p.codes:
            return p.codes[code]
    return "其它错误"


def diagnostic(kps) -> list[str]:
    """这题里算进把握度的知识点(去掉常识 / 计算这类)"""
    return [k for k in (kps or []) if k in BY_ID and BY_ID[k].diagnose]


def prompt_table() -> str:
    """给拆卷模型看的知识点表: id、名字、错法"""
    lines = []
    for p in POINTS:
        codes = ";".join(f"{c}={d}" for c, d in p.codes.items()) or "(没有错法,不拿来诊断)"
        lines.append(f"- {p.id}: {p.name}。错法: {codes}")
    lines.append(f"- 错法都不贴时写 {OTHER}")
    return "\n".join(lines)


def public_map() -> list[dict]:
    """老师页: 知识点表(改知识点的下拉、显示名字)"""
    return [{"id": p.id, "name": p.name, "kid": p.kid, "group": p.group, "group_label": GROUP_LABEL[p.group],
             "stage": p.stage, "prereq": list(p.prereq), "contrast": p.contrast, "lessons": list(p.lessons),
             "diagnose": p.diagnose, "codes": [{"code": c, "label": d} for c, d in p.codes.items()]}
            for p in POINTS]
