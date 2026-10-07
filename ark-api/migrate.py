"""手写迁移 runner（无 alembic —— 环境无 pip 可装；ADR-103：migrations/ 为唯一 DDL 真源）。

用法:
    /usr/bin/python3 ark-api/migrate.py     # 独立执行
    app.py lifespan 启动时 await run_migrations(pool)  # 幂等，已应用的跳过
"""
import asyncio
from pathlib import Path

import asyncpg

from db import load_dsn

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


async def run_migrations(pool: asyncpg.Pool) -> list[str]:
    """按文件名序应用未执行过的 migrations/*.sql，返回本次应用的文件名列表。"""
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )""")
        applied = {r["version"] for r in await conn.fetch("SELECT version FROM schema_migrations")}
        ran = []
        for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if sql_file.name in applied:
                continue
            # asyncpg 无参 execute 走 simple query 协议：多语句在同一隐式事务内执行
            await conn.execute(sql_file.read_text(encoding="utf-8"))
            await conn.execute(
                "INSERT INTO schema_migrations (version) VALUES ($1)", sql_file.name)
            ran.append(sql_file.name)
        return ran


async def _main() -> None:
    pool = await asyncpg.create_pool(load_dsn(), min_size=1, max_size=2)
    try:
        ran = await run_migrations(pool)
        print(f"migrations applied: {ran or '(none — up to date)'}")
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(_main())
