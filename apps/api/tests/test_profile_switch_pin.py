"""Switch profiles, PIN locks and profile deletion (TDD)."""

import uuid
from dataclasses import dataclass

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import ratelimit, security
from app.db.base import Base
from app.db.models.favorite import Favorite
from app.db.models.profile import Profile
from app.db.session import get_db
from app.main import app
from app.services import profile_service
from tests.session_helpers import select_default

AUTH = "/api/v1/auth"
ME = "/api/v1/me"
PASSWORD = "password123"

# Captured before the fixture stubs it out, so a test can restore the real
# login-throttle check the pin-set route now shares.
_real_check_login_allowed = ratelimit.check_login_allowed


@dataclass
class Env:
    client: AsyncClient
    factory: async_sessionmaker


@pytest_asyncio.fixture
async def client_env(tmp_path, monkeypatch):
    db_path = tmp_path / "switch_pin.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_pragma(dbapi_conn, _record):
        dbapi_conn.cursor().execute("PRAGMA foreign_keys=ON")

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


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_login(env: Env, email: str, username: str) -> dict:
    r = await env.client.post(
        f"{AUTH}/register",
        json={"email": email, "username": username, "password": PASSWORD},
    )
    assert r.status_code == 201, r.text
    r = await env.client.post(
        f"{AUTH}/login", data={"username": username, "password": PASSWORD}
    )
    assert r.status_code == 200, r.text
    tokens = r.json()
    tokens["access_token"] = await select_default(env.client, tokens["access_token"])
    return tokens


async def _create(env: Env, headers: dict, name: str, avatar: str = "cat") -> dict:
    r = await env.client.post(
        f"{ME}/profiles", headers=headers, json={"name": name, "avatar": avatar}
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _set_pin(
    env: Env,
    headers: dict,
    profile_id: str,
    password: str = PASSWORD,
    pin: str | None = "1234",
    current_pin: str | None = None,
):
    body: dict = {"password": password, "pin": pin}
    if current_pin is not None:
        body["current_pin"] = current_pin
    return await env.client.put(
        f"{ME}/profiles/{profile_id}/pin",
        headers=headers,
        json=body,
    )


async def _switch(env: Env, headers: dict, profile_id: str, pin: str | None = None):
    body = {} if pin is None else {"pin": pin}
    return await env.client.post(
        f"{ME}/profiles/{profile_id}/switch", headers=headers, json=body
    )


async def _delete(env: Env, headers: dict, profile_id: str, pin: str | None = None):
    body = {} if pin is None else {"pin": pin}
    return await env.client.request(
        "DELETE", f"{ME}/profiles/{profile_id}", headers=headers, json=body
    )


async def _profile_row(env: Env, profile_id: str) -> Profile | None:
    async with env.factory() as db:
        return await db.get(Profile, uuid.UUID(profile_id))


async def test_switch_changes_active_profile(client_env):
    tokens = await _register_login(client_env, "sw1@gmov.dev", "sw1")
    headers = _bearer(tokens["access_token"])
    second = await _create(client_env, headers, "Kid")

    r = await _switch(client_env, headers, second["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile"]["id"] == second["id"]
    assert body["access_token"]
    payload = security.decode_token(body["access_token"])
    assert payload["pid"] == second["id"]
    assert payload["sid"] == security.decode_token(tokens["access_token"])["sid"]

    current = await client_env.client.get(
        f"{ME}/profile", headers=_bearer(body["access_token"])
    )
    assert current.status_code == 200, current.text
    assert current.json()["id"] == second["id"]


async def test_switch_requires_pin_when_locked(client_env):
    tokens = await _register_login(client_env, "sw2@gmov.dev", "sw2")
    headers = _bearer(tokens["access_token"])
    second = await _create(client_env, headers, "Locked")
    assert (await _set_pin(client_env, headers, second["id"])).status_code == 200

    missing = await _switch(client_env, headers, second["id"])
    assert missing.status_code == 403, missing.text
    assert missing.json()["code"] == "PIN_REQUIRED"

    wrong = await _switch(client_env, headers, second["id"], pin="0000")
    assert wrong.status_code == 401, wrong.text
    assert wrong.json()["code"] == "INVALID_PIN"

    right = await _switch(client_env, headers, second["id"], pin="1234")
    assert right.status_code == 200, right.text
    assert right.json()["profile"]["id"] == second["id"]


async def test_switch_foreign_profile_is_404(client_env):
    owner = await _register_login(client_env, "sw3@gmov.dev", "sw3")
    owner_headers = _bearer(owner["access_token"])
    victim = await _create(client_env, owner_headers, "Victim")

    intruder = await _register_login(client_env, "sw4@gmov.dev", "sw4")
    r = await _switch(
        client_env, _bearer(intruder["access_token"]), victim["id"]
    )
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "PROFILE_NOT_FOUND"


async def test_pin_attempts_are_rate_limited(client_env, monkeypatch):
    monkeypatch.setattr(profile_service, "PIN_MAX_ATTEMPTS", 2)
    tokens = await _register_login(client_env, "rl1@gmov.dev", "rl1")
    headers = _bearer(tokens["access_token"])
    locked = await _create(client_env, headers, "Locked")
    assert (await _set_pin(client_env, headers, locked["id"])).status_code == 200

    for _ in range(2):
        r = await _switch(client_env, headers, locked["id"], pin="0000")
        assert r.status_code == 401, r.text

    # Budget exhausted: 429 wins over a comparison, even with the right PIN.
    blocked = await _switch(client_env, headers, locked["id"], pin="1234")
    assert blocked.status_code == 429, blocked.text
    assert blocked.json()["code"] == "RATE_LIMITED"
    assert "Retry-After" in blocked.headers

    # ...and over the missing-PIN branch too.
    missing = await _switch(client_env, headers, locked["id"])
    assert missing.status_code == 429, missing.text
    assert missing.json()["code"] == "RATE_LIMITED"

    # Same (profile, IP) counter is shared with delete.
    deleted = await _delete(client_env, headers, locked["id"], pin="0000")
    assert deleted.status_code == 429, deleted.text
    assert deleted.json()["code"] == "RATE_LIMITED"


async def test_only_failed_pin_attempts_consume_budget(client_env, monkeypatch):
    monkeypatch.setattr(profile_service, "PIN_MAX_ATTEMPTS", 2)
    tokens = await _register_login(client_env, "rl2@gmov.dev", "rl2")
    headers = _bearer(tokens["access_token"])
    locked = await _create(client_env, headers, "Locked")
    assert (await _set_pin(client_env, headers, locked["id"])).status_code == 200

    assert (
        await _switch(client_env, headers, locked["id"], pin="0000")
    ).status_code == 401

    # Correct PINs must never spend the budget, no matter how many. Each
    # switch re-points the session, so the client moves to the token it got
    # back (an access token that no longer matches the session is invalid).
    current = headers
    for _ in range(4):
        ok = await _switch(client_env, current, locked["id"], pin="1234")
        assert ok.status_code == 200, ok.text
        current = _bearer(ok.json()["access_token"])

    # Only now does a second real failure exhaust the limit of 2.
    assert (
        await _switch(client_env, headers, locked["id"], pin="0000")
    ).status_code == 401
    assert (
        await _switch(client_env, headers, locked["id"], pin="1234")
    ).status_code == 429


async def test_missing_pin_counts_as_failure(client_env, monkeypatch):
    monkeypatch.setattr(profile_service, "PIN_MAX_ATTEMPTS", 1)
    tokens = await _register_login(client_env, "rl3@gmov.dev", "rl3")
    headers = _bearer(tokens["access_token"])
    locked = await _create(client_env, headers, "Locked")
    assert (await _set_pin(client_env, headers, locked["id"])).status_code == 200

    first = await _switch(client_env, headers, locked["id"])
    assert first.status_code == 403, first.text
    assert first.json()["code"] == "PIN_REQUIRED"

    second = await _switch(client_env, headers, locked["id"])
    assert second.status_code == 429, second.text
    assert second.json()["code"] == "RATE_LIMITED"


async def test_set_pin_wrong_password_locks_login(client_env, monkeypatch):
    monkeypatch.setattr(ratelimit, "check_login_allowed", _real_check_login_allowed)
    monkeypatch.setattr(ratelimit, "LOGIN_FAIL_LIMIT", 2)
    tokens = await _register_login(client_env, "pinlock@gmov.dev", "pinlock")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Kid")

    for _ in range(2):
        r = await _set_pin(client_env, headers, profile["id"], password="wrong")
        assert r.status_code == 400, r.text
        assert r.json()["code"] == "INVALID_PASSWORD"

    # Those account-password failures count against the shared login budget.
    login = await client_env.client.post(
        f"{AUTH}/login", data={"username": "pinlock", "password": PASSWORD}
    )
    assert login.status_code == 429, login.text
    assert login.json()["code"] == "RATE_LIMITED"
    assert "Retry-After" in login.headers


async def test_set_pin_needs_account_password(client_env):
    tokens = await _register_login(client_env, "pin1@gmov.dev", "pin1")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Kid")

    wrong = await _set_pin(client_env, headers, profile["id"], password="nope")
    assert wrong.status_code == 400, wrong.text
    assert wrong.json()["code"] == "INVALID_PASSWORD"

    set_ok = await _set_pin(client_env, headers, profile["id"], pin="1234")
    assert set_ok.status_code == 200, set_ok.text
    assert set_ok.json()["has_pin"] is True

    clear = await _set_pin(
        client_env, headers, profile["id"], pin=None, current_pin="1234"
    )
    assert clear.status_code == 200, clear.text
    assert clear.json()["has_pin"] is False

    invalid = await _set_pin(client_env, headers, profile["id"], pin="12")
    assert invalid.status_code == 422, invalid.text


async def test_set_first_pin_needs_no_current_pin(client_env):
    tokens = await _register_login(client_env, "chg0@gmov.dev", "chg0")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Kid")

    r = await _set_pin(client_env, headers, profile["id"], pin="1234")
    assert r.status_code == 200, r.text
    assert r.json()["has_pin"] is True


async def test_change_pin_requires_current_pin(client_env):
    tokens = await _register_login(client_env, "chg1@gmov.dev", "chg1")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Kid")
    assert (
        await _set_pin(client_env, headers, profile["id"], pin="1234")
    ).status_code == 200

    missing = await _set_pin(client_env, headers, profile["id"], pin="5678")
    assert missing.status_code == 403, missing.text
    assert missing.json()["code"] == "PIN_REQUIRED"

    wrong = await _set_pin(
        client_env, headers, profile["id"], pin="5678", current_pin="0000"
    )
    assert wrong.status_code == 401, wrong.text
    assert wrong.json()["code"] == "INVALID_PIN"

    # The account password is still checked after a correct current PIN.
    bad_password = await _set_pin(
        client_env,
        headers,
        profile["id"],
        password="nope",
        pin="5678",
        current_pin="1234",
    )
    assert bad_password.status_code == 400, bad_password.text
    assert bad_password.json()["code"] == "INVALID_PASSWORD"

    changed = await _set_pin(
        client_env, headers, profile["id"], pin="5678", current_pin="1234"
    )
    assert changed.status_code == 200, changed.text

    old = await _switch(client_env, headers, profile["id"], pin="1234")
    assert old.status_code == 401, old.text
    new = await _switch(client_env, headers, profile["id"], pin="5678")
    assert new.status_code == 200, new.text


async def test_change_pin_wrong_current_pin_is_rate_limited(client_env, monkeypatch):
    monkeypatch.setattr(profile_service, "PIN_MAX_ATTEMPTS", 2)
    tokens = await _register_login(client_env, "chg2@gmov.dev", "chg2")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Kid")
    assert (
        await _set_pin(client_env, headers, profile["id"], pin="1234")
    ).status_code == 200

    for _ in range(2):
        r = await _set_pin(
            client_env,
            headers,
            profile["id"],
            pin="5678",
            current_pin="0000",
        )
        assert r.status_code == 401, r.text
        assert r.json()["code"] == "INVALID_PIN"

    blocked = await _set_pin(
        client_env, headers, profile["id"], pin="5678", current_pin="1234"
    )
    assert blocked.status_code == 429, blocked.text
    assert blocked.json()["code"] == "RATE_LIMITED"
    assert "Retry-After" in blocked.headers


async def test_clear_pin_requires_current_pin_when_set(client_env):
    tokens = await _register_login(client_env, "chg3@gmov.dev", "chg3")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Kid")
    assert (
        await _set_pin(client_env, headers, profile["id"], pin="1234")
    ).status_code == 200

    missing = await _set_pin(client_env, headers, profile["id"], pin=None)
    assert missing.status_code == 403, missing.text
    assert missing.json()["code"] == "PIN_REQUIRED"

    cleared = await _set_pin(
        client_env, headers, profile["id"], pin=None, current_pin="1234"
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["has_pin"] is False


async def test_clear_pin_without_existing_pin_is_allowed(client_env):
    tokens = await _register_login(client_env, "chg4@gmov.dev", "chg4")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Kid")

    cleared = await _set_pin(client_env, headers, profile["id"], pin=None)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["has_pin"] is False


async def test_delete_default_profile_is_rejected(client_env):
    tokens = await _register_login(client_env, "del1@gmov.dev", "del1")
    headers = _bearer(tokens["access_token"])
    current = await client_env.client.get(f"{ME}/profile", headers=headers)

    r = await _delete(client_env, headers, current.json()["id"])
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "DEFAULT_PROFILE"


async def test_delete_locked_profile_requires_its_pin(client_env):
    tokens = await _register_login(client_env, "del2@gmov.dev", "del2")
    headers = _bearer(tokens["access_token"])
    locked = await _create(client_env, headers, "Locked")
    assert (await _set_pin(client_env, headers, locked["id"])).status_code == 200

    async with client_env.factory() as db:
        db.add(
            Favorite(
                profile_id=uuid.UUID(locked["id"]),
                movie_slug="mao",
                movie_name="Mao",
            )
        )
        await db.commit()

    missing = await _delete(client_env, headers, locked["id"])
    assert missing.status_code == 403, missing.text
    assert missing.json()["code"] == "PIN_REQUIRED"

    wrong = await _delete(client_env, headers, locked["id"], pin="0000")
    assert wrong.status_code == 401, wrong.text
    assert wrong.json()["code"] == "INVALID_PIN"

    ok = await _delete(client_env, headers, locked["id"], pin="1234")
    assert ok.status_code == 200, ok.text
    assert ok.json() == {"access_token": None, "profile": None}

    assert await _profile_row(client_env, locked["id"]) is None
    async with client_env.factory() as db:
        rows = (
            await db.execute(
                select(Favorite).where(
                    Favorite.profile_id == uuid.UUID(locked["id"])
                )
            )
        ).scalars().all()
    assert list(rows) == []


async def test_delete_active_profile_leaves_session_unselected(client_env):
    """Deleting the profile you are watching must not hand out the (possibly
    PIN-locked) default profile: the session goes back to the chooser."""
    tokens = await _register_login(client_env, "del3@gmov.dev", "del3")
    headers = _bearer(tokens["access_token"])
    second = await _create(client_env, headers, "Kid")

    switched = await _switch(client_env, headers, second["id"])
    assert switched.status_code == 200, switched.text
    active_headers = _bearer(switched.json()["access_token"])

    r = await _delete(client_env, active_headers, second["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"] is None
    assert body["profile"] is None

    current = await client_env.client.get(
        f"{ME}/profile", headers=active_headers
    )
    assert current.status_code == 403, current.text
    assert current.json()["code"] == "PROFILE_REQUIRED"

    listing = await client_env.client.get(f"{ME}/profiles", headers=active_headers)
    assert listing.status_code == 200, listing.text
    assert all(not item["is_current"] for item in listing.json()["items"])


async def test_pin_hash_is_not_plaintext(client_env):
    tokens = await _register_login(client_env, "hash1@gmov.dev", "hash1")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Kid")
    assert (await _set_pin(client_env, headers, profile["id"])).status_code == 200

    row = await _profile_row(client_env, profile["id"])
    assert row is not None
    assert row.pin_hash != "1234"
    assert security.verify_password("1234", row.pin_hash)


async def _rename(env: Env, headers: dict, profile_id: str, name: str, pin=None):
    body: dict = {"name": name}
    if pin is not None:
        body["pin"] = pin
    return await env.client.patch(
        f"{ME}/profiles/{profile_id}", headers=headers, json=body
    )


async def test_renaming_a_locked_profile_requires_its_pin(client_env):
    """The manage page must not be a way around the PIN lock."""
    tokens = await _register_login(client_env, "rn1@gmov.dev", "rn1")
    headers = _bearer(tokens["access_token"])
    locked = await _create(client_env, headers, "Khoá")
    open_profile = await _create(client_env, headers, "Mở")
    assert (
        await _set_pin(client_env, headers, locked["id"], pin="1357")
    ).status_code == 200

    missing = await _rename(client_env, headers, locked["id"], "Đổi trộm")
    assert missing.status_code == 403, missing.text
    assert missing.json()["code"] == "PIN_REQUIRED"

    wrong = await _rename(client_env, headers, locked["id"], "Đổi trộm", pin="0000")
    assert wrong.status_code == 401
    assert wrong.json()["code"] == "INVALID_PIN"

    assert (await _profile_row(client_env, locked["id"])).name == "Khoá"

    ok = await _rename(client_env, headers, locked["id"], "Đổi thật", pin="1357")
    assert ok.status_code == 200, ok.text
    assert ok.json()["name"] == "Đổi thật"

    # An unlocked profile still needs no PIN.
    unlocked = await _rename(client_env, headers, open_profile["id"], "Mở luôn")
    assert unlocked.status_code == 200, unlocked.text


async def _login(env: Env, username: str) -> str:
    r = await env.client.post(
        f"{AUTH}/login", data={"username": username, "password": PASSWORD}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def test_locking_a_profile_drops_other_sessions_selection(client_env):
    """Sessions that picked the profile while it was unlocked (or with the old
    PIN) must not keep it once the PIN changes."""
    tokens = await _register_login(client_env, "rev1@gmov.dev", "rev1")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Bé")

    # Second device (fresh session, same account) selects the profile while it
    # has no PIN.
    second = await _switch(
        client_env, _bearer(await _login(client_env, "rev1")), profile["id"]
    )
    assert second.status_code == 200, second.text
    second_headers = _bearer(second.json()["access_token"])
    assert (
        await client_env.client.get(f"{ME}/profile", headers=second_headers)
    ).status_code == 200

    # First device also selects it, then locks it.
    first = await _switch(client_env, headers, profile["id"])
    first_headers = _bearer(first.json()["access_token"])
    assert (
        await _set_pin(client_env, first_headers, profile["id"], pin="2468")
    ).status_code == 200

    # The other device loses the selection...
    revoked = await client_env.client.get(f"{ME}/profile", headers=second_headers)
    assert revoked.status_code == 403, revoked.text
    assert revoked.json()["code"] == "PROFILE_REQUIRED"
    listing = await client_env.client.get(f"{ME}/profiles", headers=second_headers)
    assert listing.status_code == 200, listing.text
    assert all(not item["is_current"] for item in listing.json()["items"])

    # ...while the device that locked it keeps watching.
    assert (
        await client_env.client.get(f"{ME}/profile", headers=first_headers)
    ).status_code == 200

    # Clearing the PIN must NOT revoke anything: access only widens.
    second2 = await _switch(
        client_env,
        _bearer(await _login(client_env, "rev1")),
        profile["id"],
        pin="2468",
    )
    assert second2.status_code == 200, second2.text
    second2_headers = _bearer(second2.json()["access_token"])
    assert (
        await _set_pin(
            client_env, first_headers, profile["id"], pin=None, current_pin="2468"
        )
    ).status_code == 200
    assert (
        await client_env.client.get(f"{ME}/profile", headers=second2_headers)
    ).status_code == 200, "clearing a PIN must not eject the other device"
