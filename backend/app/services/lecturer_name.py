"""音标视频的「讲师」名字 —— 归一与消歧的唯一真源

讲师是**自由文本**(上传时老师自己敲),不是系统里的教师账号:实际讲课的常是
外聘老师、助教,他们没有账号,而有账号的老师也不一定是视频里讲课的那个人。
代价就是同一个人可能被敲成好几种写法,而学生端是**按这个字符串分组**的 ——
「王老师」「王老师 」「王 老师」「wang老师」会在学生眼里变成四位老师。

所以归一规则必须只有一份(照 phonetic_tokenize.py 的先例:在两处各写一份
归一规则 = 学生那边的死数据)。两道防线:

1. `normalize()` —— 洗掉看不见的差异(零宽字符、首尾空白、全角空格、重复空格)。
   这类差异老师自己在输入框里根本看不出来,靠提醒是没用的。
2. `resolve()` —— **向已有写法靠拢**:库里已经有「王老师」时,再敲
   「王 老师」「WANG老师」「Ｗang老师」都归到已有那一个。比较键做 NFKC 折叠 +
   去空白 + casefold,但**存的是已有的那个写法**,不是归一键 ——
   显示要保留老师原本的排版(「Miss Lucy」不该被存成「misslucy」)。

⚠️ `resolve()` 只在**写入路径**调用(上传 / 改讲师 / 批量设讲师)。
读取路径按字符串原样分组,不做二次归一 —— 否则同一份数据在两处算出不同的组。

⚠️ 本文件里所有不可见字符**一律写成 \\uXXXX 转义,禁止写字面量**:
字面量的零宽字符在编辑器里看不见、review 看不出、连按文本匹配去改都会失败
(2026-09-17 实测: 用字面量写的那版,自己再去改都匹配不上)。
"""
import re
import unicodedata
from typing import Iterable, Optional

# 讲师名长度上限,与 phonetic_videos.lecturer 列宽一致
MAX_LEN = 50

# 「未指定讲师 / 全校通用」在筛选参数里的哨兵值。
# 为什么不用空串:空串在筛选语义里已经是「不筛,全部都要」。
# 前导空格让它永不可能与真实讲师名相撞 —— normalize() 会削掉首尾空白,
# 所以任何入库的名字都不可能等于 ' none'。
# ⚠️ 前端 api/phonetics.ts 的 NO_LECTURER 必须同值(两端各写一份就会静默失配,
# 表现是「未指定讲师」筛出来永远是空的 —— 不报错,所以只能靠测试守,
# 见 tests/test_phonetic_lecturer.py::test_sentinel_matches_frontend_constant)
NO_LECTURER = " none"

# 空白:含全角空格 U+3000 与不换行空格 U+00A0(从 Word/PPT 里复制名字时常带)
_WS = re.compile(r"[\s\u3000\u00a0]+")

# 零宽字符:从 Word/PPT/网页复制讲师名时常夹带,屏幕上**完全看不见**。
# 不删的话「王<200B>老师」入库后与「王老师」是两位老师,而两个 chip 长得一模一样,
# 老师自己也永远查不出为什么多了一位。U+FEFF 是 BOM(粘贴整行时会带)
def _strip_invisible(s: str) -> str:
    """删掉**所有**不可见字符 —— 按 Unicode 分类判,不列黑名单。

    Cf(格式字符)+ Cc(控制字符)在姓名里没有任何合法用途,而它们**一个像素都不占**:
    留着就是「屏幕上一模一样、字符串却不相等」,正是本模块要消灭的东西。

    ⚠️ **必须按分类判而不是列举**(2026-09-17 评审实测): 原先只列了 5 个零宽字符,
    而整个码空间里有 2176 个不可见码点能同时躲过 normalize 和 match_key。
    现实里最常撞上的恰恰不在那 5 个里:
      U+00AD 软连字符(Word 自动断字塞的)、U+200E/200F 双向标记(从网页复制常带)、
      U+FE0F 变体选择符(跟在 emoji 后面)、U+202A..202E 双向嵌入。
    列举法还有个结构性问题: Unicode 每年新增码点,注定漏。
    顺带把 NUL 也挡在门外(它属 Cc)—— 存进去 SQLite 的 length() 会数错。
    """
    return "".join(ch for ch in s
                   if unicodedata.category(ch) not in ("Cf", "Cc"))


def normalize(raw: Optional[str]) -> Optional[str]:
    """洗掉看不见的差异。空 / 纯空白 / **纯不可见字符** → None(= 「全校通用」)。

    做四件事:删不可见字符、首尾去空白、内部连续空白压成一个半角空格、超长截断。
    **不删内部空格** —— 「Miss Lucy」「张 Amy」删了就成了另一个名字;
    要跨空格消歧是 `resolve()` 的事(它只用来比较,不改存储形态)。

    ⚠️ 截断后要**再 strip 一次**:正好切在空格上会留下尾随空格,
    而尾随空格恰恰是这个模块存在的理由(它在输入框里看不见)。

    ⚠️ 「全是不可见字符」必须落到 None(实测复现过): 否则会入库成一位
    **没有字形的讲师** —— 学生端 chip 上是一片空白,还会因为"有两位讲师"
    而触发首次选老师弹层。先删不可见字符再判空,这一条就自然成立了。
    """
    if raw is None:
        return None
    s = _strip_invisible(str(raw))
    s = _WS.sub(" ", s).strip()
    if not s:
        return None
    # 先截断再 strip:切在空格上时不留尾随空格
    return s[:MAX_LEN].strip() or None


def match_key(name: Optional[str]) -> str:
    """消歧用的比较键:NFKC 折叠 + 删不可见字符与组合记号 + 去空白 + casefold。

    只用于「这两个写法是不是同一个人」,永不入库、永不展示。

    四件事都必须做,少一件就会有一个人分裂成两位老师(都实测复现过):
    - **NFKC**: 中文输入法全角状态下敲出的是「Ｍiss Ｌucy」(U+FF2D 全角 M),
      与「Miss Lucy」逐字节不同、casefold 也折不到一起,而屏幕上几乎看不出差别
    - **不可见字符**: 见 _strip_invisible(按 Unicode 分类判,不列黑名单)
    - **组合记号 Mn/Me**: 落单的组合记号(如汉字后跟一个 U+0301)不与前字合成,
      屏幕上几乎看不出来却让字符串不等。
      ⚠️ 只在**比较键**里删,**不在 normalize 里删** —— 存储要保留老师原本的写法。
      它不会把不同的人并成一个: NFKC 已把 é 这类**预组合**字符合成回单码点,
      所以「René / Rene」「Zoë / Zoe」「Lǐ / Lí」仍是不同的键(已验);
      被并到一起的只有同一个名字的 NFD / NFC 两种写法,那正是想要的。
    - **casefold** 而不是 lower(对非英文字母更彻底)
    """
    if not name:
        return ""
    s = unicodedata.normalize("NFKC", str(name))
    s = "".join(ch for ch in s
                if unicodedata.category(ch) not in ("Cf", "Cc", "Mn", "Me"))
    return _WS.sub("", s).casefold()


def resolve(raw: Optional[str], existing: Iterable[Optional[str]]) -> Optional[str]:
    """归一 + 向已有写法靠拢,返回**该入库的那个字符串**。

    existing 传该机构当前可见的讲师名,顺序不敏感:命中已有写法就返回
    **已有的那一个**,让新旧视频落进同一组;命中不了才作为新讲师返回新名字。

    ⚠️ 调用方要挑对 existing 的范围,这个函数只认它拿到的那份:
    - 必须按**目标视频的归属**取,不能按调用者(平台 admin 的 current_org_id
      是 None → 全平台讲师名都成了归一权威 → 把别家机构的姓名写法写进本机构);
    - 要排除「名下视频被本次全覆盖」的讲师,否则改写法时被自己的旧名字挡回去;
    - **要排除机构改不动的那些**(平台预置):否则预置视频恰好同名时,
      机构永远改不了自己的写法,而界面只会说「已保存」。
    详见 api/v1/teacher/phonetics.py 的 _existing_lecturers。
    """
    name = normalize(raw)
    if name is None:
        return None
    key = match_key(name)
    for e in existing:
        if e and match_key(e) == key:
            return e
    return name
