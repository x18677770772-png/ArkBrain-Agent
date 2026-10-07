#!/usr/bin/env bash
# ark-api 启动脚本 —— 钉死 /usr/bin/python3（PATH 的 hermes venv 3.13 无 asyncpg）
# 依赖顺序：PG 容器(5433) → 本服务(3724) → ArkBrain 后端(3721) → 浏览器
set -euo pipefail
cd "$(dirname "$0")"
exec /usr/bin/python3 -m uvicorn app:app --host 127.0.0.1 --port 3724
