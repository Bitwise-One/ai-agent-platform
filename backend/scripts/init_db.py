"""开发环境建表脚本（生产请使用 alembic 迁移）。

用法：
    uv run python -m scripts.init_db
"""

import asyncio
import os

# 允许无 .env 直接本地跑：默认 sqlite
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./dev.db")

from app.core.database import dispose_engine, get_engine  # noqa: E402
from app.models import Base  # noqa: E402


async def main() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print(f"tables created: {len(Base.metadata.tables)}")
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
