from __future__ import annotations

import bcrypt
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.db.models import User


class PhoneNumberTakenError(ValueError):
    pass


class UserService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_tg_id(self, tg_user_id: int) -> User | None:
        return (
            await self.session.execute(select(User).where(User.tg_user_id == tg_user_id))
        ).scalar_one_or_none()

    async def get_or_create_user_by_tg_id(self, tg_user_id: int) -> User:
        """Resolve the `users.id` row for a raw Telegram user id, creating it if needed.

        Every dashboard `actor_user_id` today is a raw `tg_user_id`, but
        `TenantMembership`/`Tenant` are keyed on `users.id`. This is the
        resolution step between the two — call it before any workspace
        membership lookup.
        """
        user = await self.get_by_tg_id(tg_user_id)
        if user is not None:
            return user

        statement = insert(User).values(tg_user_id=tg_user_id)
        statement = statement.on_conflict_do_nothing(index_elements=[User.tg_user_id])
        await self.session.execute(statement)
        await self.session.commit()

        user = await self.get_by_tg_id(tg_user_id)
        if user is None:
            raise RuntimeError(f"Failed to resolve or create user for tg_user_id={tg_user_id}")
        return user

    async def get_language(self, tg_user_id: int) -> str | None:
        user = await self.get_by_tg_id(tg_user_id)
        return user.language_code if user else None

    async def set_language(
        self,
        tg_user_id: int,
        language_code: str,
        username: str | None = None,
        full_name: str | None = None,
    ) -> None:
        values = {
            "tg_user_id": tg_user_id,
            "username": username,
            "full_name": full_name,
            "language_code": language_code,
        }
        update_values = {"language_code": language_code}
        if username is not None:
            update_values["username"] = username
        if full_name is not None:
            update_values["full_name"] = full_name

        statement = insert(User).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=[User.tg_user_id],
            set_=update_values,
        )
        await self.session.execute(statement)
        await self.session.commit()

    async def resolve_language(self, tg_user_id: int, fallback: str | None = None) -> str:
        lang = await self.get_language(tg_user_id)
        return lang or fallback or get_settings().default_language

    async def get_by_phone_number(self, phone_number: str) -> User | None:
        return (
            await self.session.execute(select(User).where(User.phone_number == phone_number))
        ).scalar_one_or_none()

    async def set_password(self, *, tg_user_id: int, password: str) -> None:
        user = await self.get_or_create_user_by_tg_id(tg_user_id)
        user.password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        await self.session.commit()

    async def verify_password(self, *, tg_user_id: int, password: str) -> bool:
        user = await self.get_by_tg_id(tg_user_id)
        if user is None or not user.password_hash:
            return False
        return bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8"))

    async def update_profile(
        self,
        *,
        tg_user_id: int,
        full_name: str | None = None,
        phone_number: str | None = None,
    ) -> User:
        user = await self.get_or_create_user_by_tg_id(tg_user_id)
        if full_name is not None:
            user.full_name = full_name
        if phone_number is not None:
            existing = await self.get_by_phone_number(phone_number)
            if existing is not None and existing.id != user.id:
                raise PhoneNumberTakenError("Phone number is already in use")
            user.phone_number = phone_number
        await self.session.commit()
        return user
