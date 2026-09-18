"""Keyword auto-moderation + user bans (extends the report queue)."""

import uuid
from dataclasses import dataclass

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import ratelimit
from app.core.config import settings
from app.db.base import Base
from app.db.models.comment import Comment
from app.db.models.comment_report import (
    CommentReport,
    ReportReason,
    ReportSource,
    ReportStatus,
)
from app.db.models.user import User, UserRole
from app.db.session import get_db
from app.main import app
from tests.test_moderation import (
    ADMIN,
    ME,
    _comment,
    _promote,
    _register_login,
    _report,
    _report_rows,
)

COMMENTS = "/api/v1/comments"

AUTH = "/api/v1/auth"


@dataclass
class Env:
    client: AsyncClient
    factory: async_sessionmaker


@pytest_asyncio.fixture
async def client_env(tmp_path, monkeypatch):
    """Same harness as test_moderation.py (kept local so the fixture name is
    not imported and shadowed by every test signature)."""
    db_path = tmp_path / "auto_ban.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with factory() as session:
            yield session

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(ratelimit, "check_register_allowed", _noop)
    monkeypatch.setattr(ratelimit, "check_login_allowed", _noop)
    app.dependency_overrides[get_db] = override_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield Env(client=ac, factory=factory)
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


def _configure_keywords(monkeypatch, *keywords: str) -> None:
    monkeypatch.setattr(settings, "moderation_blocked_keywords", list(keywords))


async def _public_items(env: Env, slug: str = "mao") -> list[dict]:
    r = await env.client.get("/api/v1/comments", params={"movie_slug": slug})
    assert r.status_code == 200, r.text
    return r.json()["items"]


async def _reports_of(env: Env, comment_id: str) -> list[CommentReport]:
    async with env.factory() as db:
        stmt = select(CommentReport).where(
            CommentReport.comment_id == uuid.UUID(comment_id)
        )
        return list((await db.execute(stmt)).scalars().all())


async def _user_id(env: Env, username: str) -> str:
    async with env.factory() as db:
        user = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one()
        return str(user.id)


async def test_keyword_comment_auto_hidden_and_queued(client_env, monkeypatch):
    _configure_keywords(monkeypatch, "cá độ")
    headers = await _register_login(client_env, "auto1@gmov.dev", "auto1")

    cid = await _comment(
        client_env, headers, body="Ai muốn cá độ thì nhắn mình nhé"
    )

    items = await _public_items(client_env)
    assert items[0]["id"] == cid
    assert items[0]["is_hidden"] is True
    assert items[0]["body"] is None

    rows = await _reports_of(client_env, cid)
    assert len(rows) == 1
    assert rows[0].source == ReportSource.AUTO
    assert rows[0].reporter_id is None
    assert rows[0].status == ReportStatus.OPEN
    assert rows[0].reason == ReportReason.SPAM
    assert "cá độ" in (rows[0].note or "")

    # It reaches the moderator queue with no reporter, and the author id (which
    # the admin UI needs in order to ban) is exposed.
    await _promote(client_env, "auto1", UserRole.MODERATOR)
    r = await client_env.client.get(f"{ADMIN}/reports", headers=headers)
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert item["source"] == "auto"
    assert item["reporter"] is None
    assert item["comment"]["user"]["username"] == "auto1"
    assert uuid.UUID(item["comment"]["user"]["id"])


async def test_keyword_match_ignores_case_accents_and_spacing(
    client_env, monkeypatch
):
    _configure_keywords(monkeypatch, "cá độ")
    headers = await _register_login(client_env, "auto2@gmov.dev", "auto2")

    # No diacritics + odd spacing still matches the configured keyword.
    cid = await _comment(client_env, headers, body="CA   DO khong ban?")
    items = await _public_items(client_env)
    assert items[0]["id"] == cid
    assert items[0]["is_hidden"] is True


async def test_clean_comment_stays_visible(client_env, monkeypatch):
    _configure_keywords(monkeypatch, "cá độ")
    headers = await _register_login(client_env, "auto3@gmov.dev", "auto3")

    cid = await _comment(client_env, headers, body="Phim này hay lắm nha")
    items = await _public_items(client_env)
    assert items[0]["id"] == cid
    assert items[0]["is_hidden"] is False
    assert items[0]["body"] == "Phim này hay lắm nha"
    assert await _reports_of(client_env, cid) == []


async def test_filter_is_off_by_default(client_env):
    assert settings.moderation_blocked_keywords == []
    headers = await _register_login(client_env, "auto4@gmov.dev", "auto4")

    await _comment(client_env, headers, body="cá độ thoải mái")
    items = await _public_items(client_env)
    assert items[0]["is_hidden"] is False


async def test_auto_reports_do_not_count_toward_hide_threshold(client_env):
    """Auto rows have reporter_id NULL; count(distinct reporter_id) ignores them,
    so a keyword report never helps reach the user-report threshold."""
    author = await _register_login(client_env, "auto5@gmov.dev", "auto5")
    reporter = await _register_login(client_env, "auto6@gmov.dev", "auto6")
    cid = await _comment(client_env, author, body="binh thuong")

    async with client_env.factory() as db:
        for _ in range(3):
            db.add(
                CommentReport(
                    comment_id=uuid.UUID(cid),
                    reporter_id=None,
                    reason=ReportReason.SPAM,
                    source=ReportSource.AUTO,
                    note="Từ khoá: x",
                )
            )
        await db.commit()

    r = await _report(client_env, reporter, cid)
    assert r.status_code == 201, r.text

    async with client_env.factory() as db:
        row = await db.get(Comment, uuid.UUID(cid))
        assert row is not None and row.is_hidden is False


async def test_ban_blocks_auth_and_unban_restores(client_env):
    mod = await _register_login(client_env, "banmod@gmov.dev", "banmod")
    await _promote(client_env, "banmod", UserRole.ADMIN)
    victim = await _register_login(client_env, "victim@gmov.dev", "victim")
    victim_id = await _user_id(client_env, "victim")
    # Written before the ban: stays visible afterwards (banning is about the
    # account, not retrospective content).
    victim_comment = await _comment(client_env, victim, body="spam link here")

    # A refresh token issued before the ban must stop working too.
    login = await client_env.client.post(
        f"{AUTH}/login", data={"username": "victim", "password": "password123"}
    )
    assert login.status_code == 200, login.text
    refresh_token = login.json()["refresh_token"]

    r = await client_env.client.post(
        f"{ADMIN}/users/{victim_id}/ban",
        headers=mod,
        json={"reason": "spam link"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["username"] == "victim"
    assert body["banned_at"] is not None
    assert body["ban_reason"] == "spam link"

    # Existing access token is refused at the dependency boundary.
    r = await client_env.client.post(
        f"{ME}/comments", headers=victim, json={"movie_slug": "mao", "body": "hi"}
    )
    assert r.status_code == 401
    assert r.json()["code"] == "ACCOUNT_BANNED"

    # Cannot log in again, and the pre-ban refresh token is dead.
    r = await client_env.client.post(
        f"{AUTH}/login", data={"username": "victim", "password": "password123"}
    )
    assert r.status_code == 403
    assert r.json()["code"] == "ACCOUNT_BANNED"
    r = await client_env.client.post(
        f"{AUTH}/refresh", json={"refresh_token": refresh_token}
    )
    assert r.status_code == 401

    # The queue tells the UI who the author is and that they are banned.
    reporter = await _register_login(client_env, "victimfan@gmov.dev", "victimfan")
    assert (await _report(client_env, reporter, victim_comment)).status_code == 201
    r = await client_env.client.get(f"{ADMIN}/reports", headers=mod)
    item = r.json()["items"][0]
    author = item["comment"]["user"]
    assert author["username"] == "victim"
    assert author["banned_at"] is not None
    assert item["source"] == "user"
    assert item["reporter"]["username"] == "victimfan"

    # A banned account cannot even file reports.
    assert (await _report(client_env, victim, victim_comment)).status_code == 401

    r = await client_env.client.post(
        f"{ADMIN}/users/{victim_id}/unban", headers=mod
    )
    assert r.status_code == 200, r.text
    assert r.json()["banned_at"] is None
    assert r.json()["ban_reason"] is None
    r = await client_env.client.post(
        f"{ME}/comments", headers=victim, json={"movie_slug": "mao", "body": "hi"}
    )
    assert r.status_code == 201, r.text


async def test_ban_refuses_staff_and_requires_moderator(client_env):
    await _register_login(client_env, "staff1@gmov.dev", "staff1")
    await _promote(client_env, "staff1", UserRole.ADMIN)
    mod = await _register_login(client_env, "staff2@gmov.dev", "staff2")
    await _promote(client_env, "staff2", UserRole.MODERATOR)
    plain = await _register_login(client_env, "plain@gmov.dev", "plain")
    admin_id = await _user_id(client_env, "staff1")
    mod_id = await _user_id(client_env, "staff2")
    plain_id = await _user_id(client_env, "plain")

    # Anonymous and normal users cannot ban at all.
    r = await client_env.client.post(f"{ADMIN}/users/{plain_id}/ban")
    assert r.status_code == 401
    r = await client_env.client.post(
        f"{ADMIN}/users/{plain_id}/ban", headers=plain
    )
    assert r.status_code == 403

    # Staff is out of reach, including the caller's own account.
    for target in (admin_id, mod_id):
        r = await client_env.client.post(
            f"{ADMIN}/users/{target}/ban", headers=mod
        )
        assert r.status_code == 403
        assert r.json()["code"] == "CANNOT_BAN_STAFF"

    r = await client_env.client.post(
        f"{ADMIN}/users/{uuid.uuid4()}/ban", headers=mod
    )
    assert r.status_code == 404
    assert r.json()["code"] == "USER_NOT_FOUND"
    r = await client_env.client.post(
        f"{ADMIN}/users/{uuid.uuid4()}/unban", headers=mod
    )
    assert r.status_code == 404


async def _comment_with_spoiler(env: Env, headers: dict, slug: str = "mao") -> str:
    r = await env.client.post(
        f"{ME}/comments",
        headers=headers,
        json={
            "movie_slug": slug,
            "body": "Phim này kết thúc buồn",
            "has_spoiler": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_author_declared_spoiler_is_stored_and_exposed(client_env):
    env = client_env
    author = await _register_login(env, "sp1@gmov.dev", "sp1")
    viewer = await _register_login(env, "sp1b@gmov.dev", "sp1b")

    cid = await _comment_with_spoiler(env, author)
    own = (await env.client.get(f"{COMMENTS}?movie_slug=mao", headers=author)).json()
    assert next(i for i in own["items"] if i["id"] == cid)["has_spoiler"] is True

    listing = (
        await env.client.get(f"{COMMENTS}?movie_slug=mao", headers=viewer)
    ).json()
    item = next(i for i in listing["items"] if i["id"] == cid)
    # The body still travels (the veil is a reader-side affordance), but the
    # flag tells the UI to cover it.
    assert item["has_spoiler"] is True
    assert item["is_hidden"] is False
    assert item["body"]

    # A plain comment stays unmarked.
    plain = await _comment(env, author, body="Phim hay")
    listing = (
        await env.client.get(f"{COMMENTS}?movie_slug=mao", headers=viewer)
    ).json()
    assert next(i for i in listing["items"] if i["id"] == plain)["has_spoiler"] is False


async def test_spoiler_reports_auto_veil_at_threshold(client_env, monkeypatch):
    monkeypatch.setattr(settings, "comment_spoiler_report_threshold", 2)
    # Keep the two thresholds apart so the veil is what this test observes.
    monkeypatch.setattr(settings, "comment_report_hide_threshold", 10)
    env = client_env
    author = await _register_login(env, "sp2@gmov.dev", "sp2")
    r1 = await _register_login(env, "sp2a@gmov.dev", "sp2a")
    r2 = await _register_login(env, "sp2b@gmov.dev", "sp2b")
    cid = await _comment(env, author, body="Có tiết lộ")

    # One spoiler report is not enough, and other reasons never veil.
    assert (await _report(env, r1, cid, reason="spam")).status_code == 201
    assert (await _report(env, r2, cid, reason="spoiler")).status_code == 201
    async with env.factory() as db:
        assert (await db.get(Comment, uuid.UUID(cid))).has_spoiler is False

    third = await _register_login(env, "sp2c@gmov.dev", "sp2c")
    assert (await _report(env, third, cid, reason="spoiler")).status_code == 201
    async with env.factory() as db:
        comment = await db.get(Comment, uuid.UUID(cid))
        assert comment.has_spoiler is True
        assert comment.is_hidden is False, "a veil must not hide the comment"
    assert len(await _report_rows(env, cid)) == 3


async def test_moderator_veils_and_unveils(client_env):
    env = client_env
    author = await _register_login(env, "sp3@gmov.dev", "sp3")
    mod = await _register_login(env, "sp3m@gmov.dev", "sp3m")
    await _promote(env, "sp3m", UserRole.MODERATOR)
    cid = await _comment(env, author)

    marked = await env.client.post(f"{ADMIN}/comments/{cid}/spoiler", headers=mod)
    assert marked.status_code == 200, marked.text
    assert marked.json() == {"ok": True, "is_hidden": False, "has_spoiler": True}

    # Idempotent, and the queue carries the flag.
    again = await env.client.post(f"{ADMIN}/comments/{cid}/spoiler", headers=mod)
    assert again.status_code == 200, again.text
    queue = (await env.client.get(f"{ADMIN}/reports", headers=mod)).json()

    unmarked = await env.client.post(f"{ADMIN}/comments/{cid}/unspoiler", headers=mod)
    assert unmarked.status_code == 200, unmarked.text
    assert unmarked.json()["has_spoiler"] is False
    assert queue is not None

    unknown = await env.client.post(
        f"{ADMIN}/comments/{uuid.uuid4()}/spoiler", headers=mod
    )
    assert unknown.status_code == 404, unknown.text

    # Regular users cannot touch the flag.
    forbidden = await env.client.post(
        f"{ADMIN}/comments/{cid}/spoiler", headers=author
    )
    assert forbidden.status_code == 403, forbidden.text
