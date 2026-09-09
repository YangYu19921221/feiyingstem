#!/usr/bin/env python3
"""在现有加盟版 PPTX 的加盟专线页与收尾页补入销售分成信息。"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

src = Path(__file__).parent / "英语学习系统_加盟版.pptx"
dst = Path(__file__).parent / "英语学习系统_加盟版_销售分成版.pptx"

replacements = {
    "隔离 · 白标 · 配额 · 有效期 —— 放权不失控": "隔离 · 白标 · 配额 · 有效期 · 销售分成 —— 放权不失控",
    "防超卖 · 防提权": "防超卖 · 防提权 · 50% 分成",
    "发码上限 = 配额,机构管理员从架构上无法给自己提权 —— 总部核心资产攥牢": "发码上限 = 配额,机构管理员从架构上无法给自己提权 —— 总部核心资产攥牢;销售端按加盟实收净额享 50% 分成",
    "扫码体验招生漏斗:一条链接测口语出报告 —— 会招生、留得住、教得好,一套系统三件事全接住。": "扫码体验招生漏斗:一条链接测口语出报告 —— 会招生、留得住、教得好;销售端成交可享 50% 分成。",
}

with ZipFile(src, "r") as zin, ZipFile(dst, "w", ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename.startswith("ppt/slides/") and item.filename.endswith(".xml"):
            text = data.decode("utf-8")
            for old, new in replacements.items():
                text = text.replace(old, new)
            data = text.encode("utf-8")
        zout.writestr(item, data)
print(dst)
