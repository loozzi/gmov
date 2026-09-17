"""Internal movie schemas — normalized, never raw upstream JSON."""

from pydantic import BaseModel, Field


class MovieCard(BaseModel):
    slug: str
    name: str
    original_name: str | None = None
    thumb_url: str | None = None
    poster_url: str | None = None
    description: str | None = None
    year: str | None = None
    quality: str | None = None
    language: str | None = None
    current_episode: str | None = None
    total_episodes: int | None = None
    time: str | None = None


class Episode(BaseModel):
    name: str
    slug: str | None = None
    embed_url: str | None = None
    m3u8_url: str | None = None  # null until upstream provides direct streams


class ServerGroup(BaseModel):
    name: str
    episodes: list[Episode] = Field(default_factory=list)


class MovieDetail(MovieCard):
    provider_id: str | None = None
    director: str | None = None
    casts: str | None = None
    formats: list[str] = Field(default_factory=list)
    genres: list[str] = Field(default_factory=list)
    countries: list[str] = Field(default_factory=list)
    servers: list[ServerGroup] = Field(default_factory=list)


class PaginatedMovies(BaseModel):
    items: list[MovieCard]
    current_page: int
    total_page: int
    total_items: int
    per_page: int


class CandidateCard(MovieCard):
    """INTERNAL list item: the card plus the people fields the related scorer
    needs. Upstream list responses carry `casts`/`director`, but the public
    MovieCard deliberately drops them — never return this model from a public
    endpoint.
    """

    director: str | None = None
    casts: str | None = None


class CandidatePage(BaseModel):
    """INTERNAL candidate page (see CandidateCard)."""

    items: list[CandidateCard] = Field(default_factory=list)
    current_page: int = 1
    total_page: int = 1


class RelatedMovies(BaseModel):
    items: list[MovieCard] = Field(default_factory=list)
