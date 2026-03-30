#!/bin/bash
# 自动递增版本号并提交推送
# 用法: ./bump.sh "提交信息"
# 版本号格式: x.y.z，每次 z+1（如 1.0.1 → 1.0.2）

set -e
cd "$(dirname "$0")"

MSG="${1:-update: 版本更新}"
DATE=$(date +%Y-%m-%d)

# 读取当前版本并递增 patch 号
python3 -c "
import json

data = json.load(open('version.json'))
parts = data['version'].split('.')
parts[-1] = str(int(parts[-1]) + 1)
new_ver = '.'.join(parts)
old_ver = data['version']

data['version'] = new_ver
data['build_date'] = '$DATE'
json.dump(data, open('version.json', 'w'), indent=2, ensure_ascii=False)
print(f'{old_ver} → {new_ver}')

# 写入环境变量供 bash 读取
open('/tmp/_bump_ver', 'w').write(new_ver)
"

NEW=$(cat /tmp/_bump_ver)
echo "版本: $NEW"

# 提交推送
git add -A
git commit -m "$(cat <<EOF
$MSG (v$NEW)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
git push gitee main

echo "✅ 已推送 v$NEW"
