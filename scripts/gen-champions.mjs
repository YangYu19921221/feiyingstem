#!/usr/bin/env node
// 生成 9 张冠军卡牌：3 榜种 × 3 段位
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://pikachu.claudecode.love/v1/images/generations';
const KEY = 'sk-54936f745ee385e62e6f6b304c988928faead2a727dc4cd8bcbc2fc45912533f';

const STYLE_TAIL =
  'Full-body RPG game card portrait illustration, low-poly paper-craft aesthetic with soft cinematic rim light, ' +
  'subtle warm cream paper background (oklch warm beige), no text on the image, no watermark, no logo, ' +
  'painterly but clean, friendly and inspiring face suitable for elementary school students, ' +
  'NOT chibi, NOT anime cliché, NOT cartoon Saturday-morning style, original character not based on any existing IP. ' +
  'Square 1:1 composition, character centered with breathing room.';

const TIER_DECOR = {
  gold:   'Wearing a gleaming gold laurel wreath; majestic stance; warm golden rim lighting; rich amber accents; subtle floating gold particles in background.',
  silver: 'Wearing a silver laurel wreath; calm confident stance; cool silver-blue rim light; soft pearly highlights.',
  bronze: 'Wearing a bronze laurel wreath; humble determined stance; warm copper rim light; earthy reddish-brown accents.',
};

const KIND_BASE = {
  vocabulary:
    'A young scholar hero character holding a glowing magical quill pen; an open enchanted book floating beside them with letters drifting upward like fireflies; deep blue scholar robes with gold trim.',
  diligence:
    'A young athletic hero character holding a tall flaming torch; energetic running pose; orange-red flame casting warm glow; banner streaming behind them; warrior-runner outfit.',
  accuracy:
    'A young archer hero character holding a bow with a glowing crosshair-arrow nocked; one eye focused down the sight; precise calm pose; emerald-green ranger outfit; subtle grid-of-light motif behind them indicating precision.',
};

const KINDS = ['vocabulary', 'diligence', 'accuracy'];
const TIERS = ['gold', 'silver', 'bronze'];

function buildPrompt(kind, tier) {
  return `${KIND_BASE[kind]} ${TIER_DECOR[tier]} ${STYLE_TAIL}`;
}

async function genOne(kind, tier, outDir) {
  const prompt = buildPrompt(kind, tier);
  const body = { model: 'gpt-image-2', prompt, size: '1024x1024', n: 1 };
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${kind}-${tier}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error(`${kind}-${tier}: no url in response: ${JSON.stringify(data)}`);
  const img = await fetch(url);
  if (!img.ok) throw new Error(`download ${url} failed: ${img.status}`);
  const buf = Buffer.from(await img.arrayBuffer());
  const outPath = path.join(outDir, `${kind}-${tier}.png`);
  await fs.writeFile(outPath, buf);
  return { kind, tier, bytes: buf.length, outPath };
}

async function main() {
  const outDir = path.resolve('frontend/public/champions');
  await fs.mkdir(outDir, { recursive: true });
  const results = [];
  for (const kind of KINDS) {
    for (const tier of TIERS) {
      console.log(`[gen] ${kind}-${tier} ...`);
      try {
        const r = await genOne(kind, tier, outDir);
        console.log(`     ✓ ${r.outPath} (${(r.bytes / 1024).toFixed(0)} KB)`);
        results.push(r);
      } catch (err) {
        console.error(`     ✗ ${err.message}`);
      }
    }
  }
  console.log(`\n done: ${results.length}/9`);
}

main().catch(err => { console.error(err); process.exit(1); });
