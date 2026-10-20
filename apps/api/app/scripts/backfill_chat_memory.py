import asyncio
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import AsyncSessionLocal
from app.models.chat import ChatMessage
from app.services.chat_memory import ChatTurn, completed_turns, index_turns


async def backfill() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.scalars(
            select(ChatMessage)
            .options(selectinload(ChatMessage.attachments))
            .order_by(ChatMessage.session_id, ChatMessage.created_at, ChatMessage.id)
        )
        messages_by_session: dict[object, list[ChatMessage]] = defaultdict(list)
        for message in result:
            messages_by_session[message.session_id].append(message)

    turns: list[ChatTurn] = []
    for messages in messages_by_session.values():
        turns.extend(completed_turns(messages))

    indexed = 0
    for offset in range(0, len(turns), 32):
        indexed += await index_turns(turns[offset : offset + 32])
        print(f"Indexed {indexed}/{len(turns)} completed turns")
    if not turns:
        print("No completed turns to index")


if __name__ == "__main__":
    asyncio.run(backfill())
