#!/usr/bin/env bash
# 建音标判定服务的独立 venv(生产机上跑)
#
# ⚠️ torch 必须走**官方 cpu 索引**:阿里云镜像那份是 CUDA 版,
#    wheel 899MB 且会拖一堆 nvidia-* 依赖(共 2G+),这台机器没显卡,纯浪费。
#    cpu 版 wheel 约 200MB。官方源从国内慢但能下完,别中途换源。
#
# ⚠️ 判断「是不是卡死了」看 /tmp/pip-unpack-*,不要看 ~/.cache/pip ——
#    pip 先下到临时目录、下完才移进 cache,所以 cache 大小在下载期间恒定不变。
#    我就因为看 cache 不动误杀过一次只差 1MB 就下完的 torch。
#
# 用法(必须脱离 SSH,否则连接一断就被杀):
#     setsid nohup bash scripts/setup_judge_env.sh > /tmp/judge_setup.log 2>&1 < /dev/null &
set -x
cd /www/wwwroot/english-helper/backend || exit 1

python3 -m venv venv_judge
P=./venv_judge/bin/pip
$P install --upgrade pip

# torch CPU 版(约 200MB)。--no-cache-dir 免得再占 5G 缓存
$P install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch || exit 1

# transformers 走默认的阿里云源(快),它不需要 CUDA
$P install --no-cache-dir transformers aiohttp || exit 1

./venv_judge/bin/python -c "import torch, transformers; print('torch', torch.__version__, '/ transformers', transformers.__version__)"
du -sh venv_judge
echo "JUDGE_ENV_DONE_OK"
