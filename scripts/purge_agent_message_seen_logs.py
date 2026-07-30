"""One-off cleanup: purge moderation_logs rows with action='agent_message_seen'.

That action was written unconditionally by bot/agents/listener.py for every
group message a linked agent observed — nothing reads it back (the audit
dashboard in bot/dashboard/api/routers/admin.py only queries a fixed
allowlist of real moderation actions). The write path was removed; this
script clears out the rows that already accumulated (~5.7M rows, ~4GB as of
2026-07-30).

Deletes in batches to avoid one long-held lock/transaction on a live table.
Run with: python -m scripts.purge_agent_message_seen_logs [--batch-size N]

After this completes, run `VACUUM FULL moderation_logs;` separately
(outside a transaction, ideally during low-traffic hours) to actually
reclaim disk space — a plain DELETE does not shrink the table on disk.
"""

from __future__ import annotations

import argparse
import asyncio
import time

from sqlalchemy import text

from bot.db.session import SessionLocal

DEFAULT_BATCH_SIZE = 50_000


async def purge(batch_size: int) -> None:
    total_deleted = 0
    started = time.monotonic()

    while True:
        async with SessionLocal() as session:
            result = await session.execute(
                text(
                    """
                    DELETE FROM moderation_logs
                    WHERE id IN (
                        SELECT id FROM moderation_logs
                        WHERE action = 'agent_message_seen'
                        LIMIT :batch_size
                    )
                    """
                ),
                {"batch_size": batch_size},
            )
            await session.commit()
            deleted = result.rowcount or 0

        total_deleted += deleted
        elapsed = time.monotonic() - started
        print(f"Deleted {deleted} rows (total {total_deleted}, {elapsed:.1f}s elapsed)")

        if deleted < batch_size:
            break

    print(f"Done. Purged {total_deleted} agent_message_seen rows in {elapsed:.1f}s.")
    print("Run `VACUUM FULL moderation_logs;` separately to reclaim disk space.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    args = parser.parse_args()
    asyncio.run(purge(args.batch_size))
