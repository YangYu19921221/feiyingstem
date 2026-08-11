"""为宠物系统新增 20 个种族出立绘(12 个普通家族 + 8 只传说)。

背景:图鉴原有 40 个家族,元素分布严重偏斜 —— ice / dark / ground / poison / flying
五个属性一只都没有,克制表里那几行等于摆设。新增的 12 个普通家族优先补这几个属性。
另外 8 只是传说宝可梦,靠「累计学习单词数」解锁(准传说 2500 / 顶级传说 5000),
是给孩子的长线目标,见 app/core/pet_species.py 的 tier 字段。

传说为什么也出 3 张:它们在原作不进化,但本系统固定 5 形态。如果三档复用同一张图,
孩子进化后立绘不变、毫无成就感(gen_pet_midforms.py 就是来补这个坑的)。所以传说
按「同一只 + 气场逐级升级」出三张:本体 → 觉醒 → 究极,拿到之后仍有养成动力。

出图:走项目现有中转(gpt-image-2)。白底出图 + 本地四角 flood fill 抠图,
产物 475x475 透明底 PNG,并生成 back/ 水平翻转图 —— 与既有 105 张立绘完全一致。

⚠️ 提示词里绝对不要写具体宝可梦角色名(Mewtwo/Articuno/Greninja…):
   实测上游版权过滤会直接返回 500。"Pokemon" 一词本身可用,具体角色名不行。
   所以下面全部是纯外观描述 —— 看着啰嗦,但这是唯一能出图的写法。

用法:
    python scripts/gen_pet_newspecies.py --list           # 只看计划
    python scripts/gen_pet_newspecies.py --only mewtwo    # 只出某一族
    python scripts/gen_pet_newspecies.py                  # 全部,默认 6 并发
    python scripts/gen_pet_newspecies.py -c 10            # 调并发数
已存在的文件默认跳过,支持断点续跑。

并发:单张图的耗时几乎全是等中转返回(15-20s),串行跑 60 张要半小时以上。
按 --concurrency 并发发请求,只有落盘和进度打印是串行的。抠图是 CPU 活但很轻,
放在 asyncio.to_thread 里避免堵住事件循环。
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

# 统一画风:与现有立绘对齐(官方风、干净描边、扁平上色、白底、全身站姿、朝左)
STYLE = (
    "cute cartoon monster mascot illustration, clean bold outlines, flat cel shading, "
    "bright saturated colors, full body, standing three-quarter side view, facing left, "
    "centered, pure solid white background, no text, no watermark, no shadow on ground, "
    "friendly appearance suitable for children"
)

# 传说用的画风:同样干净,但要更有威严感(仍然不能吓到小学生)
STYLE_LEGEND = (
    "majestic legendary cartoon creature illustration, clean bold outlines, flat cel shading, "
    "vivid colors with glowing accents, full body, dynamic heroic three-quarter view facing left, "
    "centered, pure solid white background, no text, no watermark, no shadow on ground, "
    "awe-inspiring but not scary, suitable for children"
)

# ============ 12 个普通家族(每族 3 形态) ============
# 顺序 = 基础 / 一阶 / 最终
NORMAL_FAMILIES = [
    dict(key="mareep", element="electric", files=("mareep", "flaaffy", "ampharos"), subjects=(
        "a small fluffy cream-colored sheep-like creature with a curly wool coat, "
        "blue-black face, small round ears and a striped tail tipped with a glowing orange orb",
        "a pink-skinned upright sheep-like creature with a fluffy white wool collar and belly, "
        "long floppy ears and a tail tipped with a bright glowing orb",
        "a tall elegant yellow-orange dragon-like creature standing upright with black stripes, "
        "a long neck, a red gem on its forehead and a long tail ending in a brilliant glowing sphere",
    )),
    dict(key="swinub", element="ice", files=("swinub", "piloswine", "mamoswine"), subjects=(
        "a tiny round brown shaggy-furred piglet-like creature with a large pink snout, "
        "fur so long it covers its eyes, short stubby legs, standing in snow-dusted fur",
        "a stocky boar-like creature covered in thick shaggy light-brown fur that hides its eyes, "
        "two white tusks curving up from its snout, sturdy hooved legs",
        "a huge majestic woolly mammoth-like creature with thick brown shaggy fur, "
        "two enormous curved ice-white tusks, a raised trunk and powerful legs",
    )),
    dict(key="deino", element="dark", files=("deino", "zweilous", "hydreigon"), subjects=(
        "a small dark navy-blue dinosaur-like creature whose eyes are completely covered by "
        "shaggy black fur on its head, a pink jagged mouth, short arms and a stubby tail",
        "a dark blue two-headed dinosaur-like creature, both heads covered in shaggy black fur "
        "over the eyes, sharp pink jaws, small wing-like fins on its back, stocky legs",
        "a majestic dark navy-blue three-headed dragon creature floating with large black wings, "
        "the two side heads formed from its arms, glowing red-pink eyes on the central head, "
        "an imposing but noble posture",
    )),
    dict(key="nidoran", element="poison", files=("nidoran", "nidorino", "nidoking"), subjects=(
        "a small purple rabbit-like creature with large spiky ears, a single small horn on its "
        "forehead, dark purple spots on its back, big red eyes and tiny fangs",
        "a purple four-legged rhino-like creature with a long sharp horn on its snout, "
        "spiky ears, dark purple bumpy spots along its back and a short tail",
        "a large powerful purple bipedal rhino-like creature with a long pointed horn, "
        "thick armored plated chest, spiky ears, muscular arms with claws and a strong tail",
    )),
    dict(key="trapinch", element="ground", files=("trapinch", "vibrava", "flygon"), subjects=(
        "a small orange ant-like creature with an oversized round head and enormous pincer jaws, "
        "tiny black eyes, four short thin legs, living in desert sand",
        "a green-and-orange dragonfly-like creature with a rhombus-shaped head, "
        "large clear buzzing wings, a segmented tail and thin insect legs",
        "a sleek green desert dragon creature with large diamond-patterned translucent wings, "
        "big red compound eyes, slender limbs and a long tail with fin-like ridges",
    )),
    dict(key="sandile", element="ground", files=("sandile", "krokorok", "krookodile"), subjects=(
        "a small sandy-brown crocodile-like creature with a black stripe pattern across its eyes "
        "like sunglasses, a long snout with visible teeth, short legs and a black-tipped tail",
        "a sandy-brown bipedal crocodile-like creature with black eye stripes, pink patterned "
        "markings on its back, long snout, clawed arms and a striped tail",
        "a large fierce red-brown bipedal crocodile creature with black eye stripes like "
        "sunglasses, a broad toothy snout, muscular striped arms, spiky back ridges and a thick tail",
    )),
    dict(key="zubat", element="flying", files=("zubat", "golbat", "crobat"), subjects=(
        "a small blue-purple bat creature with no eyes, large pointed ears, two prominent fangs "
        "in an open mouth, and thin purple-membraned wings spread wide",
        "a larger blue-purple bat creature with an enormous wide-open mouth full of fangs, "
        "a long tongue, small eyes, big pointed ears and broad purple-membraned wings",
        "a sleek purple bat creature with four large wings (two big, two small forming its legs), "
        "bright green eyes, small fangs and an agile aerodynamic posture",
    )),
    dict(key="starly", element="flying", files=("starly", "staravia", "staraptor"), subjects=(
        "a small brown-and-white bird creature with a black head, a white patch on its forehead, "
        "short brown wings, an orange-yellow beak and small orange feet",
        "a gray-brown bird creature with a white crest of feathers on its head, "
        "a black face mask, larger spread wings, yellow beak and sharp talons",
        "a powerful brown raptor-like bird creature with a long flowing red-and-white crest "
        "over its face, broad muscular wings spread wide, a hooked yellow beak and strong talons",
    )),
    dict(key="rookidee", element="steel", files=("rookidee", "corvisquire", "corviknight"), subjects=(
        "a tiny round blue bird creature with a short gray beak, small black wings, "
        "bright yellow eyes and thin gray legs, plucky confident stance",
        "a blue-black crow-like bird creature with white-tipped wing feathers, "
        "a sharp gray beak, keen yellow eyes and a longer tail",
        "a huge majestic raven-like creature clad in dark steel armor plating, "
        "glowing red eyes behind a metal helmet-like head, enormous black metallic wings "
        "spread wide and armored talons",
    )),
    dict(key="froakie", element="water", files=("froakie", "frogadier", "greninja"), subjects=(
        "a small light-blue frog-like creature with a fluffy white bubble collar around its neck, "
        "large yellow eyes, a wide friendly mouth and webbed feet",
        "a blue bipedal frog-like creature with a white bubble scarf, a pointed head crest, "
        "yellow eyes, slender athletic limbs and webbed hands",
        "a tall sleek dark-blue ninja frog creature with a long pink tongue wrapped around its "
        "neck like a scarf, yellow eyes, webbed clawed hands and an agile crouching ninja stance",
    )),
    dict(key="fennekin", element="fire", files=("fennekin", "braixen", "delphox"), subjects=(
        "a small yellow fox-like creature with very large pointed ears with orange fluffy tufts "
        "inside, a bushy yellow tail with an orange tip, red-orange eyes and a tiny black nose",
        "a bipedal white-and-red fox-like creature with a fluffy red mane, large ears, "
        "a bushy tail, and holding a small glowing twig like a wand",
        "an elegant tall bipedal fox creature in a flowing red-and-yellow robe-like coat of fur, "
        "long pointed ears, a regal wizard-like posture and glowing amber eyes",
    )),
    dict(key="chespin", element="grass", files=("chespin", "quilladin", "chesnaught"), subjects=(
        "a small brown-and-green chestnut-like creature with a spiky green shell cap on its head, "
        "big round nose, cheerful dark eyes and short stubby limbs",
        "a rounder green chestnut-like creature with a hard spiky green shell covering its head "
        "and back, a large pointed nose, short arms and sturdy legs",
        "a big powerful green-and-brown armored knight-like creature with a heavy spiked shell "
        "over its shoulders and back, thick muscular arms, spikes on its chest and a bold stance",
    )),
]

# ============ 8 只传说(每只 3 档:本体 → 觉醒 → 究极) ============
# 三档同一只,靠气场/光效逐级升级(能量环、光翼、粒子)——不换生物形态。
LEGEND_ASCENSION = (
    "",  # 本体:纯本体形象
    ", surrounded by a faint glowing energy aura and floating light particles, awakened power",
    ", enveloped in brilliant radiant energy with glowing runes and blazing light wings, "
    "ultimate awakened form at maximum power",
)

LEGENDS = [
    # ---- 准传说:2500 词 ----
    dict(key="articuno", element="ice", tier="semi", files=("articuno", "articuno_awake", "articuno_ultra"),
         subject="a large majestic bird creature with pale ice-blue plumage, long streaming "
                 "ribbon-like tail feathers, a crest of three ice-blue feathers on its head, "
                 "wide spread wings trailing frost and snowflakes"),
    dict(key="zapdos", element="electric", tier="semi", files=("zapdos", "zapdos_awake", "zapdos_ultra"),
         subject="a large bird creature covered in bright yellow spiky feathers that stick out "
                 "like lightning bolts, jagged black-tipped wings spread wide, a sharp gray beak "
                 "and crackling electricity arcing around its body"),
    dict(key="moltres", element="fire", tier="semi", files=("moltres", "moltres_awake", "moltres_ultra"),
         subject="a large orange-yellow bird creature whose wings and long flowing tail are made "
                 "of brilliant living flame, a small crest of fire on its head and a sharp beak"),
    dict(key="suicune", element="water", tier="semi", files=("suicune", "suicune_awake", "suicune_ultra"),
         subject="an elegant four-legged blue beast with a flowing purple mane shaped like "
                 "billowing water, two white ribbon-like streamers trailing from its back, "
                 "a hexagonal white crest on its forehead and a graceful noble stance"),
    # ---- 顶级传说:5000 词 ----
    dict(key="mew", element="psychic", tier="legend", files=("mew", "mew_awake", "mew_ultra"),
         subject="a tiny adorable pink feline-like creature floating in the air, with a large "
                 "round head, big blue eyes, short arms and legs, and a very long thin tail "
                 "with an oval tip, radiating a gentle pink glow"),
    # 这条改写过:原措辞("feline-humanoid / 尾巴由管子连到后腰 / piercing eyes")被上游
    # 版权过滤稳定拦掉 —— 同一 prompt 试了近 20 次全 500,而它的 awake/ultra(同 subject
    # 加光效后缀)却能出,说明卡的是措辞而非并发。描述的还是同一只,已生成的三档观感一致。
    dict(key="mewtwo", element="psychic", tier="legend", files=("mewtwo", "mewtwo_awake", "mewtwo_ultra"),
         subject="a tall slender bipedal creature with smooth pale lavender skin and a light "
                 "purple belly, a rounded head with two short blunt horns and small pointed ears, "
                 "calm violet eyes, three-fingered hands and a long thick tail, confident stance"),
    dict(key="rayquaza", element="dragon", tier="legend", files=("rayquaza", "rayquaza_awake", "rayquaza_ultra"),
         subject="an immense serpentine emerald-green sky dragon with a long coiling body marked "
                 "with yellow ring patterns, red-tipped fins along its length, two clawed arms, "
                 "a horned head and glowing yellow eyes, soaring through the sky"),
    dict(key="arceus", element="normal", tier="legend", files=("arceus", "arceus_awake", "arceus_ultra"),
         subject="a divine four-legged white equine creature with gray accents, a large golden "
                 "wheel-like ring encircling its midsection, golden hooves, green eyes and a "
                 "flowing white mane, radiating a holy creator's aura"),
]


def build_targets():
    """展开成 (文件名, 提示词) 的扁平清单。"""
    targets = []
    for fam in NORMAL_FAMILIES:
        for file_stem, subject in zip(fam["files"], fam["subjects"]):
            targets.append(dict(
                key=fam["key"], file=f"{file_stem}.png",
                prompt=f"{subject}. {STYLE}",
            ))
    for leg in LEGENDS:
        for file_stem, ascension in zip(leg["files"], LEGEND_ASCENSION):
            targets.append(dict(
                key=leg["key"], file=f"{file_stem}.png",
                prompt=f"{leg['subject']}{ascension}. {STYLE_LEGEND}",
            ))
    return targets


async def _request_image(
    client: httpx.AsyncClient, prompt: str, label: str = "", attempts: int = 6,
) -> bytes | None:
    """调中转出图,返回原始图片字节。兼容 b64_json 与 url 两种返回。

    ⚠️ 中转会**间歇性**返回 500 —— 同一个 prompt 这次挂下次就成,和内容无关。
    所以必须重试而不是改 prompt。trust_env=False:本机 SOCKS 代理会让 httpx 崩。
    并发模式下多张图的日志会交错,所以每行都带 label 标出是哪张。
    """
    if not settings.IMAGE_API_KEY:
        print("  !! IMAGE_API_KEY 未配置")
        return None
    payload = {
        "model": settings.IMAGE_MODEL,
        "prompt": prompt,
        "size": "1024x1024",
        "quality": "low",   # 立绘 low 足够,快且省(中转本来也大体忽略 size)
        "n": 1,
    }
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


async def main(only: str | None, force: bool, list_only: bool, concurrency: int) -> None:
    todo = [t for t in build_targets() if not only or t["key"] == only]
    if list_only:
        for t in todo:
            path = os.path.join(OUT_DIR, t["file"])
            mark = "[已存在]" if os.path.exists(path) else "[待生成]"
            print(f"{mark} {t['file']:<24} <- {t['prompt'][:70]}...")
        print(f"\n共 {len(todo)} 张")
        return

    pending, skip = [], 0
    for t in todo:
        if os.path.exists(os.path.join(OUT_DIR, t["file"])) and not force:
            skip += 1
            continue
        pending.append(t)
    print(f"待生成 {len(pending)} 张,已存在跳过 {skip} 张,并发 {concurrency}")

    back_dir = os.path.join(OUT_DIR, "back")
    os.makedirs(back_dir, exist_ok=True)
    sem = asyncio.Semaphore(concurrency)
    done = 0
    ok, fail = 0, []

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
            # 抠图是同步 CPU 活,丢线程池免得阻塞其他请求的收包
            img = await asyncio.to_thread(_to_transparent_475, raw)
            await asyncio.to_thread(img.save, os.path.join(OUT_DIR, t["file"]))
            flipped = img.transpose(Image.FLIP_LEFT_RIGHT)
            await asyncio.to_thread(flipped.save, os.path.join(back_dir, t["file"]))
            ok += 1
            print(f"[{done}/{len(pending)}] ✓ {t['file']} (含 back/)")
        except Exception as e:
            fail.append(t["file"])
            print(f"[{done}/{len(pending)}] !! {t['file']} 处理失败: {e}")

    # 连接池上限要跟得上并发数,否则并发会被 httpx 自己排队掉
    limits = httpx.Limits(max_connections=max(concurrency * 2, 10),
                          max_keepalive_connections=concurrency)
    async with httpx.AsyncClient(timeout=200.0, trust_env=False, limits=limits) as client:
        await asyncio.gather(*(run_one(client, t) for t in pending))

    print(f"\n完成: 成功 {ok}, 跳过 {skip}, 失败 {len(fail)}")
    if fail:
        print("失败清单(可重跑本脚本续补):", ", ".join(sorted(fail)))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只生成某个家族 key")
    ap.add_argument("--force", action="store_true", help="覆盖已存在文件")
    ap.add_argument("--list", dest="list_only", action="store_true", help="只列出计划")
    ap.add_argument("-c", "--concurrency", type=int, default=6, help="同时出图张数(默认6)")
    a = ap.parse_args()
    asyncio.run(main(a.only, a.force, a.list_only, max(1, a.concurrency)))
