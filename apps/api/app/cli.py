"""Admin CLI: python -m app.cli <command>."""

import argparse
import asyncio
import sys
from collections.abc import Sequence

from sqlalchemy import select

from app.core.config import settings
from app.db.models.user import User, UserRole
from app.db.session import engine, session_factory
from app.services import catalog_service


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)

    set_role = subparsers.add_parser("set-role", help="set a user's role")
    set_role.add_argument("username")
    set_role.add_argument("role", choices=[role.value for role in UserRole])

    refresh = subparsers.add_parser(
        "refresh-catalog", help="crawl the upstream catalog snapshot"
    )
    refresh.add_argument("--pages", type=int, default=settings.catalog_refresh_pages)
    refresh.add_argument(
        "--kinds",
        help=(
            "comma-separated listing keys (genre/country/year); "
            "default: all genres except adult, plus countries and years"
        ),
    )
    return parser


async def _set_role(username: str, role: UserRole) -> int:
    async with session_factory() as session:
        user = (
            await session.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
        if user is None:
            print(f"error: unknown username '{username}'", file=sys.stderr)
            return 1
        user.role = role
        await session.commit()
    print(f"user '{username}' role set to '{role.value}'")
    return 0


def _parse_kinds(value: str | None) -> list[str] | None:
    if value is None:
        return None
    return [key.strip() for key in value.split(",") if key.strip()]


async def _refresh_catalog(pages: int, kinds: str | None) -> int:
    async with session_factory() as session:
        stats = await catalog_service.refresh(
            session, kinds=_parse_kinds(kinds), pages=max(1, pages)
        )
    print(
        f"catalog refreshed: {stats.items_upserted} items "
        f"({stats.listings_ok} listings ok, {stats.listings_failed} failed)"
    )
    return 0


async def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = _build_parser().parse_args(argv)
        if args.command == "set-role":
            return await _set_role(args.username, UserRole(args.role))
        if args.command == "refresh-catalog":
            return await _refresh_catalog(args.pages, args.kinds)
        return 2
    finally:
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
