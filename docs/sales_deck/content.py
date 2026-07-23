#!/usr/bin/env python3
"""内容装配 — 幻灯片拆成函数,可组装 完整版/加盟版/学校版。无商务数字。"""
import json
from pathlib import Path
import deck_lib as D
import build_deck as B

BP = json.loads((Path(__file__).parent / "blueprint.json").read_text())
W, H = B.W, B.H
DIR = Path(__file__).parent


def make_counter():
    pg = [0]

    def P():
        pg[0] += 1
        return pg[0]
    return P


# ---------- 各页构建函数 ----------

def cover(prs, P, title, subtitle, tagline):
    B.slide_cover(prs, title, subtitle, tagline)


def market(prs, P):
    s = B.slide_title_only(prs, "市场机会", "双减之后,这条赛道几乎没有正面强敌")
    cards = [
        ("🏫", "大厂各据一角", "讯飞/天学网抢公立校大单,百词斩/扇贝做C端订阅,飞象/一起作业做宽口径信息化 —— 都不在\"中小机构\"这条线上。"),
        ("🎯", "真空象限只有我们", "\"给中小机构做游戏化 + 加盟多租户的学习运营平台\",对手基本只是机构自研的简陋小程序。"),
        ("📈", "上云已是刚需", "2026 年绝大多数中小教培全面上云,SaaS 成标配;招生线索流失是行业生死线,谁接得住谁活。"),
    ]
    gx, gy = D.Inches(0.7), D.Inches(2.1)
    gw = D.Inches(3.9); gh = D.Inches(3.6)
    pal = [D.ORANGE, D.BLUE, D.GREEN]
    for i, (icon, head, body) in enumerate(cards):
        x = gx + i * (gw + D.Inches(0.35))
        D.round_rect(s, x, gy, gw, gh, D.WHITE, radius=0.06)
        D.rect(s, x, gy, gw, D.Inches(0.14), pal[i])
        D.text(s, x + D.Inches(0.35), gy + D.Inches(0.45), gw - D.Inches(0.7), D.Inches(1.2),
               [[(icon, 40, pal[i], True)]])
        D.text(s, x + D.Inches(0.35), gy + D.Inches(1.5), gw - D.Inches(0.7), D.Inches(0.6),
               [[(head, 18, D.INK, True)]])
        D.text(s, x + D.Inches(0.35), gy + D.Inches(2.15), gw - D.Inches(0.7), gh - D.Inches(2.3),
               [[(body, 12.5, D.GRAY, False)]], line_spacing=1.25)
    B._footer(s, P())

def product_divider(prs, P):
    B.slide_section(prs, "PRODUCT OVERVIEW", "一套系统,四层角色,全教学闭环",
                    "平台 → 机构老板 → 老师 → 学生,外加家长端,四大支柱撑起完整运营", "divider_product")


def pillars(prs, P):
    s = B.slide_title_only(prs, "产品全景", "四大支柱:学习引擎 · 游戏化 · 教学闭环 · 加盟基础设施")
    items = [
        ("📚", "学习引擎", "分类/听写/拼写/填空/选择/例句/句子背诵/单元考试/阅读理解 —— 9 大模式全覆盖,5 阶段自适应掌握闭环。", D.ORANGE),
        ("🎮", "游戏化留存", "实时 PK 竞技场 + 全自动晋级赛 + 宠物养成 + 金币实物兑换 + 段位光荣榜 —— 让孩子天天想来。", D.BLUE),
        ("👩‍🏫", "教学闭环", "实时课堂监控 + 教室大屏 + AI 组卷 + 作业追踪 + 学情看板 + AI 周报 —— 老师少加班,效果看得见。", D.GREEN),
        ("🏢", "加盟基础设施", "数据库级租户隔离 + 白标品牌 + 席位配额 + 到期停机 + 招生漏斗 —— 总部管得住,门店开箱用。", D.RED),
    ]
    gy = D.Inches(2.0); gh = D.Inches(2.35); gw = D.Inches(6.0)
    for i, (icon, head, body, col) in enumerate(items):
        r, c = divmod(i, 2)
        x = D.Inches(0.7) + c * (gw + D.Inches(0.3))
        y = gy + r * (gh + D.Inches(0.2))
        D.round_rect(s, x, y, gw, gh, D.WHITE, radius=0.06)
        D.rect(s, x, y, D.Inches(0.16), gh, col)
        D.text(s, x + D.Inches(0.4), y + D.Inches(0.3), D.Inches(1.2), D.Inches(1.0), [[(icon, 34, col, True)]])
        D.text(s, x + D.Inches(1.5), y + D.Inches(0.38), gw - D.Inches(1.8), D.Inches(0.6), [[(head, 20, D.INK, True)]])
        D.text(s, x + D.Inches(1.5), y + D.Inches(1.05), gw - D.Inches(1.9), gh - D.Inches(1.2),
               [[(body, 13, D.GRAY, False)]], line_spacing=1.25)
    B._footer(s, P())


def teach_depth(prs, P):
    B.slide_bullets_img(prs, "教学深度", "5 阶段自适应单词掌握闭环 —— 内建教学法,不是闪卡玩具",
        [("① 自评分类 → ② 语音校验", "三态自评(熟悉/夹生/陌生)循环到全部掌握,本地 Whisper 校验发音"),
         ("③ 循环听写 → ④ 自动过关考", "错词强制 3 遍重写才过,首次输入留作 AI 错因诊断数据源"),
         ("⑤ 拖拽速记收尾", "快闪 TTS + 物理拖拽卡池,把新词从「陌生」一路送到「毕业」"),
         ("读懂孩子的状态", "连错弹「消化卡」放慢节奏,连对弹「确认卡」提速 —— 自适应微节奏")],
        "feat_modes", P(), label="全员通用")


def speaking(prs, P):
    B.slide_bullets_img(prs, "口语评测", "双引擎口语评测:讯飞 ISE + 本地 Whisper",
        [("讯飞 ISE 专业测评", "正式测评走中高考听说机考同源引擎,给准确度/流利度/完整度四维分 —— 「中考同款」即信任"),
         ("本地 Whisper 兜底", "高频跟读走服务器本地识别,零按次调用费 —— 敢放开练,不被用量费吃掉毛利"),
         ("三源英式发音", "Edge 神经女声 → 剑桥真人 → 讯飞 TTS 自动降级,全平台缓存,同一词全校只生成一次")],
        "feat_pronunciation", P(), label="全员通用")


def memory(prs, P):
    B.slide_bullets_img(prs, "科学记忆", "9 阶记忆曲线 + AI 记忆钩子 + 错因诊断",
        [("9 阶艾宾浩斯 SRS", "5 分钟 → 30 天 → 毕业,答错回退 2 阶不清零;智能每日任务防孩子只挑新词逃避复习"),
         ("AI 记忆钩子", "谐音/词根/联想助记,全平台一词只生成一次;记忆保持率用真实行为分组对比"),
         ("错因诊断到病根", "从真实键盘输入聚类系统性错误(如 ei/ie 混淆),从「刷错题」升级到「诊断病根」")],
        "feat_memory", P(), label="全员通用")

def compare(prs, P):
    mtx = BP["comparison_matrix"]
    cols = mtx["columns"]
    want = ["多租户加盟连锁隔离", "实时PK竞技场(多人实时对战)", "全自动晋级赛+段位养成",
            "宠物养成/对战留存", "教师实时课堂监控+大屏", "防划水/切屏防作弊",
            "AI测评招生漏斗+渠道战报", "配额/有效期/兑换码(加盟经济)"]
    rowmap = {r["capability"]: r for r in mtx["rows"]}
    rows = []
    for cap in want:
        r = rowmap.get(cap)
        if r:
            rows.append({"capability": cap.split("(")[0], "cells": [B._mark(c) for c in r["cells"]]})
    B.slide_compare(prs, "竞品格局", "差异化能力矩阵 —— 我们赢在哪,诚实标清", cols, rows, P())


def diff_anchor(prs, P):
    s = B.slide_title_only(prs, "一句话说清差异", "百词斩是给自学者的,我们是给机构的")
    D.round_rect(s, D.Inches(0.7), D.Inches(2.0), D.Inches(11.9), D.Inches(1.5), D.RGBColor(0xFC,0xF3,0xE9), radius=0.06)
    D.text(s, D.Inches(1.1), D.Inches(2.15), D.Inches(11.2), D.Inches(1.2),
           [[("“老师能实时看、能开班 PK、能靠宠物金币留人续费、能防划水,总部还能一键管全部加盟校 —— 这些 C 端背单词 App 一个都给不了。”", 17, D.INK, True)]],
           anchor=D.MSO_ANCHOR.MIDDLE, line_spacing=1.3)
    honest = [
        ("✓ 我们全面领先", "多租户加盟隔离、实时 PK、全自动晋级赛、宠物留存、防作弊、金币兑换、加盟经济模型 —— 对手大多没有。", D.GREEN),
        ("~ 诚实正视两处差距", "词库内容权威(百词斩体验/词达人外研社)与私有化合规资质 —— 不硬拼,按需走定制路线补齐。", D.RGBColor(0xE0,0x9A,0x2A)),
    ]
    y = D.Inches(3.9)
    for head, body, col in honest:
        D.round_rect(s, D.Inches(0.7), y, D.Inches(11.9), D.Inches(1.25), D.WHITE, radius=0.06)
        D.rect(s, D.Inches(0.7), y, D.Inches(0.16), D.Inches(1.25), col)
        D.text(s, D.Inches(1.1), y + D.Inches(0.18), D.Inches(11.2), D.Inches(0.5), [[(head, 16, col, True)]])
        D.text(s, D.Inches(1.1), y + D.Inches(0.66), D.Inches(11.2), D.Inches(0.5), [[(body, 13, D.GRAY, False)]])
        y += D.Inches(1.4)
    B._footer(s, P())


def franchise_divider(prs, P):
    B.slide_section(prs, "FRANCHISE TRACK · 加盟专线", "加盟经济学:你的门店账本",
                    "加盟商真正的痛不是缺系统,是「不懂怎么把学生教好、留住、招进来」", "divider_franchise")


def f_enroll(prs, P):
    B.slide_bullets_img(prs, "① 招生引擎", "AI 测评漏斗 → 手机线索 → 渠道战报",
        [("一条链接免登录测评", "进直播间/家长群,免登录测 6 词 → 讯飞打分报告 → 短信验证手机号解锁深度 AI 报告"),
         ("每条线索自动归属本店", "链接带渠道与机构码,按抖音/视频号/老带新算真实转化 ROI,线索进本机构池不跑别家"),
         ("家长即渠道", "家长转发成绩海报 = 把转介绍工程化,压低获客成本(CAC)")],
        "feat_pronunciation", P(), label="加盟专线")


def f_renew(prs, P):
    B.slide_bullets_img(prs, "② 续费引擎", "让孩子天天想来 —— 直击到课率与续费",
        [("实时 PK + 全自动晋级赛", "带黑马安慰赛,弱生也有球打;六段位赛季持续给目标感"),
         ("宠物养成留存闭环", "几天不来宠物就受伤,唯一解药是回来答对单词题 —— 把愧疚转成学习时长"),
         ("金币 → 实物兑换", "完成作业/单词王发币,老师用对账级流水给学生兑换真实奖品,持续制造到店理由")],
        "feat_pet", P(), label="加盟专线")


def f_teacher(prs, P):
    B.slide_bullets_img(prs, "③ 师资去依赖化", "新手老师也能带出好效果 —— 治加盟商最深的恐惧",
        [("AI 个性化组卷", "按每个孩子的错题出打印级满分卷,标准化教学内容"),
         ("AI 记忆钩子 + 自动批改诊断", "把品牌方教研能力产品化,交付给不懂教研的门店"),
         ("老师离职不带走教学质量", "教学能力沉淀在系统里,错题下钻到词级 + AI 分级预警主动点名该关注谁")],
        "feat_ai_exam", P(), label="加盟专线")


def f_infra(prs, P):
    B.slide_bullets_img(prs, "④ 加盟基础设施", "隔离 · 白标 · 配额 · 有效期 —— 放权不失控",
        [("数据库级租户隔离 + 白标", "读写双安全网,新接口默认漏不出去;机构自定义名称/Logo,像自己的分校"),
         ("席位制 + 到期自动停机", "活跃学生去重计费,服务到期当天自动停,续费即刻恢复"),
         ("防超卖 · 防提权", "发码上限 = 配额,机构管理员从架构上无法给自己提权 —— 总部核心资产攥牢")],
        "feat_saas", P(), label="加盟专线")

def school_divider(prs, P):
    B.slide_section(prs, "SCHOOL TRACK · 学校专线", "学校要的不是招生,是合规 · 减负 · 稳定",
                    "决策链长(采购/信息中心/教务/校长),买的是过验收、不出事、老师少加班", "divider_school")


def s_relief(prs, P):
    B.slide_bullets_img(prs, "① 教师减负", "AI 组卷 · 自动批改 · 学情自动汇总 —— 契合减负主旋律",
        [("AI 个性化组卷 + A4 PDF", "出打印级满分卷,阅读理解客观题自动判、主观题匹配可接受答案列表"),
         ("作业批量下发 · 一屏看全班", "2000+ 作业不卡;错题本/学情看板/AI 周报自动生成"),
         ("可量化「每周省 X 小时」", "把节省的时间讲成数字,打动教务与校长")],
        "feat_ai_exam", P(), label="学校专线")


def s_screen(prs, P):
    B.slide_bullets_img(prs, "② 大屏教学", "教室大屏 + 实时课堂监控 —— 硬件已铺开,软件即插即用",
        [("EKG 专注波投大屏", "全班专注度画成流动心电波 + 段位战力榜,支持课堂互动"),
         ("四态实时监控", "学习中/走神/切出/离线,切屏走神原子累加落库,一眼看清谁在摸鱼"),
         ("只读投屏账号", "display 账号投屏不暴露教师登录;面向学校竞技/排名可克制关闭")],
        "feat_classroom", P(), label="学校专线")


def s_trust(prs, P):
    B.slide_bullets_img(prs, "③ 可信与合规", "数据可信 · 防作弊 · 未成年人隐私 —— 硬资质,非口号",
        [("防划水学习质量分", "节奏统计识别机械点击/疲劳划水;全模式防作弊(答案不下发、切屏落库、禁联想)"),
         ("统计口径治虚高", "净活跃时长 + distinct 去重,项目已有专门治理经验 = 可信度背书"),
         ("未成年人隐私保护", "直播打码一键把真名换「杨同学」;敏感文件架构级禁入公开无鉴权目录")],
        "feat_reliability", P(), label="学校专线")


def s_adapt(prs, P):
    B.slide_bullets_img(prs, "④ 适配与可靠", "教材版本适配 · 数据不丢 · 部署合规",
        [("人教/外研/译林版本适配", "series 隔离 + 新课标对齐,整本 Excel 一键建库(失败整体回滚)"),
         ("离线优先幂等提交队列", "部署重启/断网不丢学习记录,服务端去重不重复计分 + 版本更新提示条不打断"),
         ("私有化按需定制", "当前为多租户云端隔离,私有化部署/等保合规资质按学校需求走定制路线")],
        "feat_parent", P(), label="学校专线")


def trust(prs, P):
    s = B.slide_title_only(prs, "信任背书", "你可以信任这套系统 —— 孩子的努力永不丢失")
    items = [
        ("🛡️", "提交幂等不丢数据", "断网/重启/关电脑都不丢学习记录,服务端去重不重复计分"),
        ("⚖️", "审计级金币流水", "完成作业/单词王发币,双记账余额可对账,发放靠幂等键防重复"),
        ("🏆", "竞技防作弊闸门", "每用户风险分保护排行榜与竞技公信力,数据都是真的"),
    ]
    gy = D.Inches(2.2); gw = D.Inches(3.9); gh = D.Inches(3.4)
    pal = [D.BLUE, D.ORANGE, D.GREEN]
    for i, (icon, head, body) in enumerate(items):
        x = D.Inches(0.7) + i * (gw + D.Inches(0.35))
        D.round_rect(s, x, gy, gw, gh, D.WHITE, radius=0.06)
        D.rect(s, x, gy, gw, D.Inches(0.14), pal[i])
        D.text(s, x + D.Inches(0.35), gy + D.Inches(0.5), gw - D.Inches(0.7), D.Inches(1.1), [[(icon, 44, pal[i], True)]])
        D.text(s, x + D.Inches(0.35), gy + D.Inches(1.7), gw - D.Inches(0.7), D.Inches(0.6), [[(head, 17, D.INK, True)]])
        D.text(s, x + D.Inches(0.35), gy + D.Inches(2.3), gw - D.Inches(0.7), gh - D.Inches(2.4),
               [[(body, 12.5, D.GRAY, False)]], line_spacing=1.25)
    B._footer(s, P())

def appendix(prs, P):
    s = B.slide_title_only(prs, "附录", "全功能清单 —— 均为已上线功能,非路线图")
    data = [
        ("学习引擎", D.ORANGE, [
            "5 阶段自适应掌握闭环(分类→语音→听写→过关→速记)",
            "本地 Whisper 语音校验(自动录音、编辑距离打分)",
            "循环听写 · 错词强制 3 遍重写",
            "自动过关考(混合题型、切屏暂停)",
            "拖拽速记 · 选词填空 · 句子背诵",
            "阅读理解自动批改 · 彩色 IPA 音标染色"]),
        ("游戏化", D.BLUE, [
            "全自动晋级赛(蛇形分组→淘汰→黑马安慰赛)",
            "实时 PK 竞技场(20 人对战 + 30 观战)",
            "宠物养成 + 对战(受伤靠学习治愈)",
            "金币系统 + 教师实物兑换(对账级流水)",
            "单词王每日冠军 👑 · 多维光荣榜",
            "六段位赛季 · 每日签到 · 成就称号"]),
        ("教学闭环", D.GREEN, [
            "实时课堂专注度监控(四态状态机)",
            "教室大屏投屏(EKG 专注波 + 战力榜)",
            "AI 个性化组卷 + A4 PDF 导出",
            "作业批量下发追踪 · 学情看板",
            "书/单元/组三级分配(分配即权限)",
            "整本 Excel 一键导入 · AI 学习周报"]),
        ("AI 与语音", D.RED, [
            "讯飞 ISE 专业发音评测(中高考同源)",
            "三源英式发音(Edge/剑桥/讯飞降级)",
            "AI 记忆钩子(谐音/词根,全平台缓存)",
            "拼写错误模式诊断(真实输入聚类)",
            "9 阶艾宾浩斯 SRS + 每日智能任务",
            "双层缓存 + 每日限额 + 多模型可切换"]),
        ("加盟基础设施", D.RGBColor(0x8A,0x5A,0xC8), [
            "数据库级租户隔离(读写双安全网)",
            "三级管理(平台→机构→老师→学生)",
            "学生名额配额(活跃去重计费)",
            "服务到期自动停机(续费即恢复)",
            "机构兑换码 + 招生链接 + 白标品牌",
            "防提权统一裁决 · 路由级只读守卫"]),
        ("可靠性与获客", D.RGBColor(0x2A,0x9D,0x8F), [
            "AI 口语体检获客漏斗 + 渠道战报",
            "离线优先幂等提交队列(不丢数据)",
            "竞技防作弊闸门 + 每用户风险分",
            "禁输入法联想答题框(防偷答案)",
            "专注力提醒 + 走神落库",
            "家长端(绑定码 + AI 周报 + 归属校验)"]),
    ]
    gy = D.Inches(1.8); gw = D.Inches(4.0); ch = D.Inches(2.5)
    for i, (key, col, its) in enumerate(data):
        r, c = divmod(i, 3)
        x = D.Inches(0.7) + c * (gw + D.Inches(0.1))
        y = gy + r * (ch + D.Inches(0.12))
        D.round_rect(s, x, y, gw, ch, D.WHITE, radius=0.05)
        D.rect(s, x, y, gw, D.Inches(0.46), col)
        D.text(s, x + D.Inches(0.22), y + D.Inches(0.04), gw - D.Inches(0.3), D.Inches(0.38),
               [[(key, 13, D.WHITE, True)]], anchor=D.MSO_ANCHOR.MIDDLE)
        runs = [[("· ", 9, col, True), (it, 9, D.RGBColor(0x50,0x50,0x5A), False)] for it in its]
        D.text(s, x + D.Inches(0.22), y + D.Inches(0.56), gw - D.Inches(0.4), ch - D.Inches(0.65),
               runs, line_spacing=1.1, space_after=2.5)
    B._footer(s, P())


def closing(prs, P, title, subtitle):
    s = D._blank(prs); D.bg(s, D.DARK)
    D.pic_cover(s, B._img("closing"), 0, 0, W, H)
    D.rect(s, 0, D.Inches(4.3), W, D.Inches(3.2), D.DARK)
    D.rect(s, D.Inches(0.9), D.Inches(4.7), D.Inches(0.9), D.Inches(0.12), D.ORANGE)
    D.text(s, D.Inches(0.9), D.Inches(4.85), W - D.Inches(1.8), D.Inches(0.9),
           [[(title, 40, D.WHITE, True)]])
    D.text(s, D.Inches(0.9), D.Inches(5.85), W - D.Inches(1.8), D.Inches(0.7),
           [[(subtitle, 15, D.RGBColor(0xD8,0xDC,0xE4), False)]], line_spacing=1.3)
    D.text(s, D.Inches(0.9), D.Inches(6.7), W - D.Inches(1.8), D.Inches(0.5),
           [[("飞鹰英语 · 智能学习系统    |    联系方式 / 开通入口:____________", 13, D.YELLOW, True)]])

# ---------- 变体装配 ----------

CTA_FULL = ("现在就体验招生漏斗",
            "扫码做一次 AI 口语测评,亲身走一遍家长看到的报告 —— 一套会招生、留得住、教得好的连锁校运营平台。")
CTA_FRAN = ("算清你的门店账本",
            "扫码体验招生漏斗:一条链接测口语出报告 —— 会招生、留得住、教得好,一套系统三件事全接住。")
CTA_SCH = ("一次演示,看清减负与合规",
           "预约到校演示:AI 组卷、实时课堂、防作弊质量分,现场跑一遍 —— 过验收、不出事、老师少加班。")


def build(out_name, steps):
    prs = D.new_deck()
    P = make_counter()
    for fn in steps:
        fn(prs, P)
    out = DIR / out_name
    prs.save(str(out))
    print("SAVED", out.name, "slides:", len(prs.slides._sldIdLst))


FULL_STEPS = [
    lambda prs, P: cover(prs, P, "会招生 · 留得住\n教得好的连锁英语校",
                         "一套系统 · 四层角色 · 全教学闭环",
                         "给中小英语教培机构与学校的智能学习运营平台\n加盟商开箱即用,总部一键管控。"),
    market, product_divider, pillars, teach_depth, speaking, memory, compare, diff_anchor,
    franchise_divider, f_enroll, f_renew, f_teacher, f_infra,
    school_divider, s_relief, s_screen, s_trust, s_adapt,
    trust, appendix,
    lambda prs, P: closing(prs, P, *CTA_FULL),
]

# 加盟版:主打赚钱(招生/续费/师资/基础设施),砍掉学校专线
FRAN_STEPS = [
    lambda prs, P: cover(prs, P, "会招生 · 留得住\n教得好的加盟英语校",
                         "开箱即用 · 总部一键管控 · 门店专注经营",
                         "给中小英语教培加盟连锁的智能学习运营平台\n把「教好、留住、招进来」交给系统。"),
    market, product_divider, pillars, teach_depth, speaking, compare, diff_anchor,
    franchise_divider, f_enroll, f_renew, f_teacher, f_infra,
    trust, appendix,
    lambda prs, P: closing(prs, P, *CTA_FRAN),
]

# 学校版:主打合规减负稳定,砍掉市场/竞品/加盟经济
SCH_STEPS = [
    lambda prs, P: cover(prs, P, "合规 · 减负 · 稳定\n学校的智能英语学习系统",
                         "AI 组卷 · 实时课堂 · 数据可信",
                         "给中小学与公立校的英语学习平台\n过验收、不出事、老师少加班。"),
    product_divider, pillars, teach_depth, speaking, memory,
    school_divider, s_relief, s_screen, s_trust, s_adapt,
    trust, appendix,
    lambda prs, P: closing(prs, P, *CTA_SCH),
]


if __name__ == "__main__":
    build("英语学习系统_加盟与学校版.pptx", FULL_STEPS)
    build("英语学习系统_加盟版.pptx", FRAN_STEPS)
    build("英语学习系统_学校版.pptx", SCH_STEPS)





