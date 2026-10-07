"""ark-api 数据层：.env 加载 / asyncpg 连接池 / 计数聚合。

只依赖 /usr/bin/python3 (3.11) 自带的 asyncpg；PATH 的 hermes venv 无 asyncpg，禁用。
"""
import json
import os
from pathlib import Path

import asyncpg

ENV_FILE = Path(__file__).resolve().parent / ".env"


def load_dsn() -> str:
    """读 ark-api/.env 的 DATABASE_URL（无 python-dotenv，手写 5 行解析）。"""
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            if key.strip() == "DATABASE_URL":
                return value.strip()
    raise RuntimeError(f"DATABASE_URL 未配置（{ENV_FILE} 缺失该键）")


async def _init_conn(conn: asyncpg.Connection) -> None:
    """jsonb ⇄ Python 对象直通（否则 asyncpg 返回 str，处处要手动 loads）。"""
    await conn.set_type_codec(
        "jsonb", schema="pg_catalog",
        encoder=lambda v: json.dumps(v, ensure_ascii=False),
        decoder=json.loads,
    )


async def create_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(load_dsn(), min_size=1, max_size=6, init=_init_conn)


async def get_counts(pool: asyncpg.Pool) -> dict:
    """看板三数字：偏好对总数 / 今日新增 / 已签发方案数（蓝图 DSK HeroMetric 语义）。"""
    row = await pool.fetchrow("""
        SELECT
          (SELECT count(*) FROM preference_pairs)                        AS preference_pairs,
          (SELECT count(*) FROM preference_pairs
             WHERE created_at >= date_trunc('day', now()))               AS preference_today,
          (SELECT count(*) FROM plans WHERE status IN ('signed','active')) AS plans_signed""")
    return {
        "preferencePairs": row["preference_pairs"],
        "preferenceToday": row["preference_today"],
        "plansSigned": row["plans_signed"],
    }
