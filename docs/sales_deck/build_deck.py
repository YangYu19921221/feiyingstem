#!/usr/bin/env python3
"""生成加盟商/学校销售演示 PPTX。渲染函数与内容分离,内容见 content.py。"""
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
import deck_lib as D
from deck_lib import (
    ORANGE, YELLOW, BLUE, SKY, GREEN, CREAM, INK, GRAY, WHITE, RED, DARK, IMG,
)

W, H = Inches(13.333), Inches(7.5)


def _img(name):
    return IMG / f"{name}.png"


def _footer(slide, page, label=""):
    D.rect(slide, 0, Inches(7.15), W, Inches(0.35), CREAM)
    D.text(slide, Inches(0.5), Inches(7.16), Inches(8), Inches(0.32),
           [[("飞鹰英语 · 智能学习系统", 9, GRAY, False)]], anchor=MSO_ANCHOR.MIDDLE)
    D.text(slide, Inches(11.5), Inches(7.16), Inches(1.3), Inches(0.32),
           [[(str(page), 9, GRAY, False)]], align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)
    if label:
        D.pill(slide, Inches(9.2), Inches(7.17), Inches(2.0), Inches(0.28), label, YELLOW, INK, size=9)


# ---------- 幻灯片类型 ----------

def slide_cover(prs, title, subtitle, tagline):
    s = D._blank(prs); D.bg(s, DARK)
    # 右侧主视觉
    D.pic_cover(s, _img("cover_hero"), Inches(6.9), 0, Inches(6.43), H)
    # 左侧深色遮罩块 + 橙色边条
    D.rect(s, 0, 0, Inches(7.35), H, DARK)
    D.rect(s, 0, 0, Inches(0.32), H, ORANGE)
    D.text(s, Inches(0.9), Inches(1.75), Inches(6.2), Inches(0.6),
           [[("智能英语学习系统", 19, SKY, True)]])
    # title: 每段一行,36pt
    title_runs = [[(ln, 36, WHITE, True)] for ln in title.split("\n")]
    D.text(s, Inches(0.9), Inches(2.45), Inches(6.4), Inches(1.9), title_runs, line_spacing=1.12)
    D.rect(s, Inches(0.92), Inches(4.55), Inches(1.0), Inches(0.06), YELLOW)
    D.text(s, Inches(0.9), Inches(4.75), Inches(6.2), Inches(0.6),
           [[(subtitle, 19, YELLOW, True)]])
    tag_runs = [[(ln, 14.5, D.RGBColor(0xC8, 0xCE, 0xDA), False)] for ln in tagline.split("\n")]
    D.text(s, Inches(0.9), Inches(5.5), Inches(6.1), Inches(1.2), tag_runs, line_spacing=1.35)
    return s


def slide_section(prs, kicker, title, subtitle, img_name):
    s = D._blank(prs); D.bg(s, DARK)
    D.pic_cover(s, _img(img_name), 0, 0, W, H)
    # 底部渐变条 + 文字
    D.rect(s, 0, Inches(4.6), W, Inches(2.9), DARK).fill.fore_color.rgb  # base
    ov = D.rect(s, 0, Inches(4.4), W, Inches(3.1), DARK)
    ov.fill.transparency = 0  # solid dark band
    D.rect(s, Inches(0.9), Inches(4.85), Inches(0.9), Inches(0.12), ORANGE)
    D.text(s, Inches(0.9), Inches(5.0), Inches(11), Inches(0.5),
           [[(kicker, 18, SKY, True)]])
    D.text(s, Inches(0.9), Inches(5.4), Inches(11.5), Inches(1.1),
           [[(title, 42, WHITE, True)]])
    D.text(s, Inches(0.9), Inches(6.55), Inches(11.5), Inches(0.6),
           [[(subtitle, 16, D.RGBColor(0xD8, 0xDC, 0xE4), False)]])
    return s


def slide_title_only(prs, kicker, title):
    s = D._blank(prs); D.bg(s, CREAM)
    D.rect(s, 0, 0, W, Inches(0.18), ORANGE)
    D.text(s, Inches(0.7), Inches(0.5), Inches(12), Inches(0.4),
           [[(kicker, 15, ORANGE, True)]])
    D.text(s, Inches(0.7), Inches(0.9), Inches(12), Inches(0.9),
           [[(title, 32, INK, True)]])
    return s


def slide_bullets_img(prs, kicker, title, bullets, img_name, page, label=""):
    s = slide_title_only(prs, kicker, title)
    # 左文右图
    y = Inches(2.0)
    for b in bullets:
        head, body = (b if isinstance(b, tuple) else (b, ""))
        D.round_rect(s, Inches(0.7), y, Inches(0.16), Inches(0.9), ORANGE, radius=0.5)
        runs = [[(head, 16, INK, True)]]
        if body:
            runs.append([(body, 12.5, GRAY, False)])
        D.text(s, Inches(1.05), y - Inches(0.02), Inches(6.0), Inches(1.0), runs, line_spacing=1.15)
        y += Inches(1.02)
    D.round_rect(s, Inches(7.25), Inches(1.95), Inches(5.35), Inches(4.9), WHITE, radius=0.05)
    D.pic_fit(s, _img(img_name), Inches(7.45), Inches(2.15), Inches(4.95), Inches(4.5))
    _footer(s, page, label)
    return s


def slide_feature_grid(prs, kicker, title, cards, page, label="", cols=3):
    s = slide_title_only(prs, kicker, title)
    gx, gy = Inches(0.7), Inches(1.95)
    gw = (Inches(12.6 / cols)) - Inches(0.2)
    gh = Inches(1.62)
    palette = [ORANGE, BLUE, GREEN, YELLOW, SKY, RED]
    for i, c in enumerate(cards):
        r, cidx = divmod(i, cols)
        x = gx + cidx * (gw + Inches(0.2))
        y = gy + r * (gh + Inches(0.18))
        col = palette[i % len(palette)]
        D.round_rect(s, x, y, gw, gh, WHITE, radius=0.08)
        D.rect(s, x, y, Inches(0.12), gh, col)
        icon, head, body = c
        D.text(s, x + Inches(0.28), y + Inches(0.12), gw - Inches(0.4), Inches(0.5),
               [[(f"{icon}  {head}", 15, INK, True)]])
        D.text(s, x + Inches(0.28), y + Inches(0.62), gw - Inches(0.45), gh - Inches(0.7),
               [[(body, 11.5, GRAY, False)]], line_spacing=1.12)
    _footer(s, page, label)
    return s


def _mark(cell_str):
    """把 'yes 数据库级...' 解析成 (✓/✗/~, note)。"""
    s = cell_str.strip()
    low = s.lower()
    if low.startswith("yes"):
        return "✓", s[3:].strip()
    if low.startswith("no"):
        return "✗", s[2:].strip()
    if low.startswith("partial"):
        return "~", s[7:].strip()
    if low.startswith("rare"):
        return "~", s[4:].strip()
    return "~", s


def slide_compare(prs, kicker, title, columns, rows, page):
    """columns: [本系统, 竞品1..4](5 列);每行 cells 与 columns 一一对应。
    本系统列(index 0)加宽并高亮,竞品列窄只显标记+短注。"""
    s = slide_title_only(prs, kicker, title)
    n = len(columns)                    # 5
    x0 = Inches(0.7)
    label_w = Inches(2.55)
    us_w = Inches(2.75)                 # 本系统列加宽
    comp_w = (Inches(12.63) - label_w - us_w) / (n - 1)   # 竞品列均分
    xs = [x0 + label_w]                 # 各数据列起点
    xs.append(xs[0] + us_w)
    for _ in range(n - 2):
        xs.append(xs[-1] + comp_w)
    widths = [us_w] + [comp_w] * (n - 1)
    y0 = Inches(1.9)
    row_h = Inches(0.48)
    gap = Inches(0.05)
    header_h = Inches(0.62)
    # 表头
    D.round_rect(s, x0, y0, label_w - Inches(0.08), header_h, INK, radius=0.14)
    D.text(s, x0, y0, label_w - Inches(0.08), header_h, [[("能力对比", 12.5, WHITE, True)]],
           align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    for j in range(n):
        is_us = (j == 0)
        D.round_rect(s, xs[j] + Inches(0.04), y0, widths[j] - Inches(0.08), header_h,
                     ORANGE if is_us else D.RGBColor(0x8A, 0x90, 0x9E), radius=0.14)
        D.text(s, xs[j] + Inches(0.04), y0, widths[j] - Inches(0.08), header_h,
               [[(columns[j], 12 if is_us else 10.5, WHITE, True)]],
               align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    # 行
    for i, row in enumerate(rows):
        y = y0 + header_h + Inches(0.09) + i * (row_h + gap)
        band = WHITE if i % 2 == 0 else D.RGBColor(0xFC, 0xF3, 0xE9)
        D.round_rect(s, x0, y, label_w - Inches(0.08), row_h, band, radius=0.12)
        D.text(s, x0 + Inches(0.14), y, label_w - Inches(0.24), row_h,
               [[(row["capability"], 11, INK, True)]], anchor=MSO_ANCHOR.MIDDLE, line_spacing=1.0)
        for j in range(n):
            is_us = (j == 0)
            fill = D.RGBColor(0xEA, 0xF7, 0xEA) if is_us else band
            D.round_rect(s, xs[j] + Inches(0.04), y, widths[j] - Inches(0.08), row_h, fill, radius=0.12)
            mark, note = row["cells"][j]
            mc = GREEN if mark == "✓" else (RED if mark == "✗" else D.RGBColor(0xE0, 0x9A, 0x2A))
            if is_us:
                D.text(s, xs[j] + Inches(0.12), y, widths[j] - Inches(0.2), row_h,
                       [[(f"{mark} ", 12.5, mc, True), (note, 9, D.INK, False)]],
                       align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.MIDDLE, line_spacing=1.0)
            else:
                D.text(s, xs[j] + Inches(0.04), y, widths[j] - Inches(0.08), row_h,
                       [[(mark, 14, mc, True)]] + ([[(note, 7.5, GRAY, False)]] if note else []),
                       align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, line_spacing=0.9, space_after=0)
    _footer(s, page)
    return s
