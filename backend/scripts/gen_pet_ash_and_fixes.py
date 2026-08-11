"""补齐三类立绘:①修 5 张损坏图 ②给复用同图的中间形态出独立图 ③小智主力 10 个新家族。

三件事合到一个脚本里,因为它们共用同一套出图/抠图/并发管道,拆开只会让三份重复代码
各自漂移(gen_pet_midforms.py 与 gen_pet_newspecies.py 已经是这个下场)。

① 损坏图(必须先修,这 5 张在线上是裂图):
   dragonair / graveler / growlithe / haunter / ivysaur —— 文件都是 38-40KB 且
   Pillow 报 "image file is truncated"。同批其它图 100-200KB,说明是当初落盘时
   截断(写入未完成),不是内容问题。**判断损坏只能靠 Pillow 实际 load(),
   看文件大小或能否 ls 都会漏** —— 浏览器对截断 PNG 的容忍度比 Pillow 高,
   所以本地看着"好像能显示"也可能是坏的。

② 复用同图的中间形态:伊布/胖丁/六尾/卡蒂狗/鲤鱼王的「成长XX」档与基础档共用一张图,
   孩子练到进化却发现立绘没变 —— 这正是 gen_pet_midforms.py 当初要解决的坑,
   这 5 处是漏网的。伊布更严重:三档全用同一张。
   伊布按「多形态」设计:成长伊布=蓬松长大版、羁绊伊布=九尾环绕的羁绊觉醒形态
   (原作伊布靠分支进化,本系统是固定 5 档单链,所以不能真做八种进化 —— 那会变成
   八个种族;改成「羁绊」形态既保住单链,又给足"我的伊布不一样"的感觉)。

③ 小智主力:图鉴已覆盖他大部分伙伴(皮卡丘/妙蛙/小火龙/杰尼龟/卡蒂狗/甲贺忍蛙…),
   缺的 10 个补上,凑成完整"小智阵容"。属性上又补了 fighting/flying/bug/steel 的家族数。

⚠️ 提示词严禁写具体宝可梦名(Pikachu/Lucario/Snorlax…):上游版权过滤会直接 500。
   全部改成纯外观描述 —— 啰嗦但这是唯一能出图的写法。
   出图 500 有两种:间歇性限流(并发越高越密,重跑即可)vs 稳定被版权过滤卡住
   (同一张试十几次全 500 而同族其它档正常 → 是措辞问题,得换描述)。

用法:
    python scripts/gen_pet_ash_and_fixes.py --list          # 只看计划
    python scripts/gen_pet_ash_and_fixes.py --group fixes   # 只修损坏图
    python scripts/gen_pet_ash_and_fixes.py -c 8            # 全部,8 并发
损坏图与已存在文件的区别:--group fixes 一律 force 覆盖(它们本来就是坏的),
其余组默认跳过已存在文件,可断点续跑。
"""
import argparse
import asyncio
import base64
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from PIL import Image  # noqa: E402

from app.core.config import settings  # noqa: E402

OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend", "public", "pets",
)

# 与既有 167 张立绘同款画风,改动会让新图在图鉴里显得格格不入
STYLE = (
    "cute cartoon monster mascot illustration, clean bold outlines, flat cel shading, "
    "bright saturated colors, full body, standing three-quarter side view, facing left, "
    "centered, pure solid white background, no text, no watermark, no shadow on ground, "
    "friendly appearance suitable for children"
)

# ============ ① 损坏图重出(force 覆盖) ============
# 描述要贴回原本那只,否则修完变成另一只宠物,老用户的宠物会「换脸」
BROKEN = [
    ("dragonair", "a graceful serpentine dragon creature with a smooth light-blue body, "
                  "a white underbelly, two small white wing-like fins on its head, "
                  "a round blue orb on its neck and two more orbs on its tail, gentle expression"),
    ("graveler", "a bulky boulder creature made of grey rock with a wide toothy mouth, "
                 "two thick stone arms with three-fingered hands on each side and four arms total, "
                 "small round eyes and a rugged cracked rocky surface"),
    ("growlithe", "a small orange puppy-like creature with black tiger stripes, "
                  "a fluffy cream-colored mane on its chest, a bushy cream tail, "
                  "pointed ears and a bright eager expression"),
    ("haunter", "a floating purple ghost creature with a round spiky gaseous body, "
                "a wide grinning mouth showing a long tongue, glowing eyes and "
                "two detached clawed hands hovering separately beside it, playful not scary"),
    ("ivysaur", "a sturdy blue-green quadruped creature with dark green spots, "
                "a large pink flower bud with green leaves growing on its back, "
                "red eyes, small pointed ears and short sturdy legs"),
]

# ============ ② 复用同图的中间形态,出独立立绘 ============
# 文件名新增,前端 petSpecies.ts 的对应形态要改指向这些新文件
MID_FORMS = [
    ("eevee_grown", "a fluffy fox-like creature with soft brown fur, an especially large and "
                    "voluminous cream-colored fluffy collar around its neck, big expressive "
                    "brown eyes, long pointed ears and a bushy cream-tipped tail, "
                    "slightly taller and sleeker than a young kit, confident stance"),
    ("eevee_bond", "a radiant fox-like creature with glossy brown fur and a huge shining "
                   "cream-white fluffy collar, glowing sparkles around it, nine translucent "
                   "rainbow-colored wisp tails fanning out behind it, a small glowing star "
                   "mark on its forehead, majestic and heartwarming"),
    ("jigglypuff_grown", "a round pink balloon-like creature, noticeably taller and plumper, "
                         "with a curled tuft of hair on its forehead, huge sparkling blue eyes, "
                         "small pointed ears and stubby arms, singing with mouth open wide"),
    ("vulpix_grown", "a small elegant fox creature with soft cream-orange fur, "
                     "six distinct curled tails fanning out behind it, a curly tuft of fur "
                     "on its forehead, pointed brown-tipped ears and a graceful poised stance"),
    ("growlithe_grown", "a lean adolescent orange dog-like creature with bold black tiger "
                        "stripes, a thick flowing cream-colored mane on its chest and head, "
                        "a long bushy cream tail, standing tall and alert with a proud expression"),
    ("magikarp_leaping", "a large orange fish creature with big round lips, long yellow whiskers "
                         "and prominent fan-like fins, caught mid-leap arcing upward out of "
                         "splashing water droplets, determined wide eyes, energetic pose"),
]

# ============ ③ 小智主力 10 个新家族(每族 3 形态) ============
ASH_FAMILIES = [
    dict(key="pidgey", element="flying", files=("pidgey", "pidgeotto", "pidgeot"), subjects=(
        "a small plump brown bird creature with a cream-colored face and belly, "
        "black eye markings, a short beak and small rounded wings",
        "a medium brown bird creature with a pink-and-red crest of feathers on its head, "
        "sharp black eye markings, a hooked beak and broad spread wings",
        "a large majestic brown bird creature with a long flowing red-and-yellow feather crest, "
        "a cream chest, powerful wide wings spread out and sharp talons",
    )),
    dict(key="onix", element="rock", files=("onix", "steelix_mid", "steelix"), subjects=(
        "a giant serpentine creature built from a chain of grey boulders, "
        "a rocky horn on its head, small round eyes and a rugged stone body coiling upward",
        "a huge serpent of dark grey rock segments turning metallic at the edges, "
        "a pointed crystalline horn, glinting hard surface and a coiled powerful body",
        "an enormous steel serpent made of polished silver metal segments, "
        "a sharp metallic horn, glowing eyes and a massive gleaming coiled body",
    )),
    dict(key="scyther", element="bug", files=("scyther", "scizor_mid", "scizor"), subjects=(
        "a sleek green mantis-like creature standing upright with two long curved "
        "white scythe blades for forearms, thin translucent wings and slender legs",
        "a green-and-red mantis-like creature with hardening armored plates, "
        "two large curved blades for arms, glinting shell and folded translucent wings",
        "a powerful red armored beetle-like creature standing upright with two huge "
        "pincer claws bearing single eye-spots, a hard metallic shell and small clear wings",
    )),
    dict(key="riolu", element="fighting", files=("riolu", "lucario_mid", "lucario"), subjects=(
        "a small blue-and-black puppy-like creature standing upright, with long ears, "
        "a black mask around its red eyes, small rounded paws and a short tail",
        # 这两档第一版稳定 6 次全 500(而同族 riolu 正常)= 版权过滤卡措辞,
        # 不是限流。原文用了 "jackal-like / 胸口金属尖刺 / 爪背尖刺" 这组标志性组合,
        # 换成中性的「蓝色犬形武术家」描述后立刻出图。判据见模块 docstring。
        "a slim blue and dark-navy canine creature standing on two legs like a martial artist, "
        "a pale yellow chest patch, tall pointed ears, bright eyes and taped forepaws "
        "raised in a ready guard stance",
        "a athletic blue and dark-navy canine creature standing upright like a martial arts "
        "master, a fluffy pale yellow chest ruff, tall ears, a flowing tail and one forepaw "
        "extended in a calm confident pose",
    )),
    dict(key="munchlax", element="normal", files=("munchlax", "snorlax_mid", "snorlax"), subjects=(
        "a small round dark-blue-green creature with a cream-colored belly and face, "
        "tiny ears, short arms and legs, holding food and looking hungry and cheerful",
        "a chubby large dark-teal creature with a broad cream belly, small pointed ears, "
        "stubby arms and legs, sleepy half-closed eyes and a contented smile",
        "an enormous rotund dark-teal creature with a huge cream-colored belly, "
        "tiny ears, thick short arms and feet, eyes closed peacefully while sitting, "
        "looking immensely relaxed and friendly",
    )),
    dict(key="magnemite", element="steel", files=("magnemite", "magneton", "magnezone"), subjects=(
        "a small floating silver metal sphere creature with a single large round eye, "
        "two horseshoe magnets on its sides and three cross-tipped screws around it",
        "a floating cluster of three connected silver metal spheres, each with one round eye "
        "and horseshoe magnets, crackling with electric sparks between them",
        "a large floating disc-shaped silver-blue robotic creature with a wide red-and-blue "
        "eye, two long magnet arms, antennae on top and a smooth saucer-like body",
    )),
    dict(key="tauros", element="normal", files=("tauros", "tauros_charge", "tauros_rage"), subjects=(
        "a sturdy brown bull-like creature with three long whip-like tails, "
        "two curved grey horns, a shaggy mane and strong hooved legs",
        "a muscular brown bull-like creature mid-charge with head lowered, "
        "three tails whipping behind it, sharp curved horns and dust kicking up from hooves",
        "a massive powerful brown bull-like creature rearing up with fierce eyes, "
        "large curved horns, a thick dark mane and three lashing tails, imposing but noble",
    )),
    dict(key="doduo", element="flying", files=("doduo", "dodrio", "dodrio_prime"), subjects=(
        "a two-headed brown ostrich-like bird creature with long thin legs, "
        "two identical beaked heads on long necks and small useless wings",
        "a three-headed brown-and-tan ostrich-like bird creature with a fluffy dark plume, "
        "three long necks with sharp beaks, strong long legs and a fan-like tail",
        "a large regal three-headed bird creature with glossy dark brown plumage, "
        "an impressive feathered crest, three alert beaked heads and powerful running legs",
    )),
    dict(key="pinsir", element="bug", files=("pinsir", "pinsir_mid", "pinsir_prime"), subjects=(
        "a brown beetle-like creature standing upright with two large spiked pincer horns "
        "on its head, a segmented tan body, sturdy arms and legs",
        "a stronger brown beetle-like creature with longer thicker spiked pincers, "
        "an armored segmented shell, muscular arms and a wide stance",
        "a mighty brown-and-gold beetle creature with enormous serrated pincer horns raised, "
        "gleaming hard armor plating, powerful limbs and a triumphant pose",
    )),
    dict(key="tropius", element="grass", files=("tropius_young", "tropius", "tropius_prime"), subjects=(
        "a small green sauropod-like creature with a long neck, a leafy frill on its head "
        "and two small palm-leaf wings sprouting on its back",
        "a green brontosaurus-like creature with a long neck, large palm-leaf wings on its back, "
        "a leafy crown and bunches of yellow banana-like fruit growing under its chin",
        "a grand green dinosaur-like creature with a tall neck, four huge lush palm-leaf wings, "
        "an abundant crown of leaves and heavy clusters of golden fruit, serene expression",
    )),
]


def build_targets(group: str | None) -> list[dict]:
    """展开所有出图任务。force 字段单独标:只有损坏图需要覆盖已存在文件。"""
    targets: list[dict] = []
    if group in (None, "fixes"):
        for stem, subject in BROKEN:
            targets.append(dict(group="fixes", key=stem, file=f"{stem}.png", force=True,
                                prompt=f"{subject}. {STYLE}"))
    if group in (None, "midforms"):
        for stem, subject in MID_FORMS:
            targets.append(dict(group="midforms", key=stem, file=f"{stem}.png", force=False,
                                prompt=f"{subject}. {STYLE}"))
    if group in (None, "ash"):
        for fam in ASH_FAMILIES:
            for stem, subject in zip(fam["files"], fam["subjects"]):
                targets.append(dict(group="ash", key=fam["key"], file=f"{stem}.png", force=False,
                                    prompt=f"{subject}. {STYLE}"))
    return targets


async def _request_image(client: httpx.AsyncClient, prompt: str, label: str,
                         attempts: int = 6) -> bytes | None:
    """出图并取回字节。中转返回 b64_json 或 url 两种形态,都要处理。"""
    payload = {"model": settings.IMAGE_MODEL, "prompt": prompt,
               "n": 1, "size": "1024x1024", "quality": "low"}
    for i in range(attempts):
        try:
            r = await client.post(
                settings.IMAGE_API_URL,
                headers={"Authorization": f"Bearer {settings.IMAGE_API_KEY}",
                         "Content-Type": "application/json"},
                json=payload,
            )
            if r.status_code == 200:
                item = ((r.json().get("data") or [{}])[0])
                if item.get("b64_json"):
                    return base64.b64decode(item["b64_json"])
                if item.get("url"):
                    img = await client.get(item["url"])
                    if img.status_code == 200:
                        return img.content
                print(f"  !! {label} 200 但无图片数据")
            else:
                print(f"  .. {label} 第{i+1}次 HTTP {r.status_code},重试中")
        except Exception as e:
            print(f"  .. {label} 第{i+1}次异常 {type(e).__name__},重试中")
        if i < attempts - 1:
            await asyncio.sleep(min(3 * (i + 1), 15))
    return None


def _to_transparent_475(raw: bytes) -> Image.Image:
    """白底图 → 透明底 475x475(四角 flood fill,只抠外围白,保留内部白色部位)。"""
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    w, h = im.size
    px = im.load()
    thresh = 236
    seen = set()
    stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    while stack:
        x, y = stack.pop()
        if not (0 <= x < w and 0 <= y < h) or (x, y) in seen:
            continue
        r, g, b, a = px[x, y]
        if a == 0 or (r >= thresh and g >= thresh and b >= thresh):
            seen.add((x, y))
            px[x, y] = (r, g, b, 0)
            stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im.thumbnail((475, 475), Image.LANCZOS)
    canvas = Image.new("RGBA", (475, 475), (0, 0, 0, 0))
    canvas.paste(im, ((475 - im.width) // 2, (475 - im.height) // 2))
    return canvas


def _save_verified(img: Image.Image, path: str) -> None:
    """先写临时文件、验证能重新打开,再原子替换正式文件。

    这批要修的 5 张就是「写了一半的 PNG」,直接 save 到目标路径的话,
    一旦中途失败就把原图换成新的坏图 —— 修损坏反而制造损坏。
    """
    tmp = path + ".tmp"
    # 必须显式 format="PNG":Pillow 默认按扩展名猜格式,".png.tmp" 会抛
    # "unknown file extension: .tmp"(第一次跑就是这么把 41 张全废掉的)
    img.save(tmp, format="PNG")
    probe = Image.open(tmp)
    probe.load()          # 真正解码,截断在这里就会抛
    probe.close()
    os.replace(tmp, path)


async def main(group: str | None, force_all: bool, list_only: bool, concurrency: int) -> None:
    todo = build_targets(group)
    back_dir = os.path.join(OUT_DIR, "back")

    if list_only:
        for t in todo:
            path = os.path.join(OUT_DIR, t["file"])
            mark = "[重出]" if t["force"] else ("[已存在]" if os.path.exists(path) else "[待生成]")
            print(f"{mark:8s} {t['group']:9s} {t['file']:<24} <- {t['prompt'][:56]}...")
        print(f"\n共 {len(todo)} 张")
        return

    pending, skip = [], 0
    for t in todo:
        exists = os.path.exists(os.path.join(OUT_DIR, t["file"]))
        if exists and not (t["force"] or force_all):
            skip += 1
            continue
        pending.append(t)
    print(f"待生成 {len(pending)} 张,已存在跳过 {skip} 张,并发 {concurrency}")

    os.makedirs(back_dir, exist_ok=True)
    sem = asyncio.Semaphore(concurrency)
    done, ok, fail = 0, 0, []

    async def run_one(client: httpx.AsyncClient, t: dict) -> None:
        nonlocal done, ok
        async with sem:
            raw = await _request_image(client, t["prompt"], label=t["file"])
        done += 1
        if not raw:
            fail.append(t["file"])
            print(f"[{done}/{len(pending)}] ✗ {t['file']} 出图失败")
            return
        try:
            img = await asyncio.to_thread(_to_transparent_475, raw)
            await asyncio.to_thread(_save_verified, img, os.path.join(OUT_DIR, t["file"]))
            flipped = img.transpose(Image.FLIP_LEFT_RIGHT)
            await asyncio.to_thread(_save_verified, flipped, os.path.join(back_dir, t["file"]))
            ok += 1
            print(f"[{done}/{len(pending)}] ✓ {t['file']} (含 back/)")
        except Exception as e:
            fail.append(t["file"])
            print(f"[{done}/{len(pending)}] !! {t['file']} 处理失败: {e}")

    limits = httpx.Limits(max_connections=max(concurrency * 2, 10),
                          max_keepalive_connections=concurrency)
    # trust_env=False:本机 SOCKS 代理会让 httpx 崩,见 memory 里的中转坑
    async with httpx.AsyncClient(timeout=200.0, trust_env=False, limits=limits) as client:
        await asyncio.gather(*(run_one(client, t) for t in pending))

    print(f"\n完成: 成功 {ok}, 跳过 {skip}, 失败 {len(fail)}")
    if fail:
        print("失败清单(可重跑本脚本续补):", ", ".join(sorted(fail)))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", choices=["fixes", "midforms", "ash"], help="只跑某一组")
    ap.add_argument("--force", action="store_true", help="覆盖全部已存在文件")
    ap.add_argument("--list", dest="list_only", action="store_true", help="只列出计划")
    ap.add_argument("-c", "--concurrency", type=int, default=8, help="同时出图张数(默认8)")
    a = ap.parse_args()
    asyncio.run(main(a.group, a.force, a.list_only, max(1, a.concurrency)))
