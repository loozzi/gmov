"""Profile API schemas (request/response boundary)."""

import uuid

from pydantic import BaseModel, Field, field_validator

from app.db.models.profile import AVATAR_KEYS, Profile

MAX_NAME_LENGTH = 32
PIN_PATTERN = r"^\d{4}$"


def _clean_name(value: str) -> str:
    cleaned = value.strip()
    if not cleaned or len(cleaned) > MAX_NAME_LENGTH:
        raise ValueError("name must be 1..32 characters")
    return cleaned


def _known_avatar(value: str) -> str:
    if value not in AVATAR_KEYS:
        raise ValueError("unknown avatar")
    return value


class ProfileOut(BaseModel):
    id: uuid.UUID
    name: str
    avatar: str
    position: int
    has_pin: bool
    is_default: bool

    @classmethod
    def from_profile(cls, profile: Profile) -> "ProfileOut":
        return cls(
            id=profile.id,
            name=profile.name,
            avatar=profile.avatar,
            position=profile.position,
            has_pin=profile.pin_hash is not None,
            is_default=profile.is_default,
        )


class ProfileListItemOut(ProfileOut):
    is_current: bool = False

    @classmethod
    def from_profile(
        cls, profile: Profile, is_current: bool = False
    ) -> "ProfileListItemOut":
        return cls(
            id=profile.id,
            name=profile.name,
            avatar=profile.avatar,
            position=profile.position,
            has_pin=profile.pin_hash is not None,
            is_default=profile.is_default,
            is_current=is_current,
        )


class ProfileListOut(BaseModel):
    items: list[ProfileListItemOut]
    max: int


class ProfileCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    avatar: str

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("avatar")
    @classmethod
    def _avatar(cls, value: str) -> str:
        return _known_avatar(value)


class ProfilePatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_LENGTH)
    avatar: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _clean_name(value)

    @field_validator("avatar")
    @classmethod
    def _avatar(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _known_avatar(value)


class ProfileSwitchIn(BaseModel):
    pin: str | None = Field(default=None, pattern=PIN_PATTERN)


class ProfilePinIn(BaseModel):
    password: str = Field(min_length=1)
    pin: str | None = Field(default=None, pattern=PIN_PATTERN)


class SwitchOut(BaseModel):
    access_token: str | None
    profile: ProfileOut | None
