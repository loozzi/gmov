"""Vietnamese category labels -> upstream browse slugs.

The detail endpoint reports genres/countries as Vietnamese *names* while the
browse endpoints are keyed by *slug*; related-candidate gathering has to cross
that gap. Upstream's own `cat.name` on a list response is NOT reliable for this:
for `/films/the-loai/phim-hai` it says "Hài" while the detail of the very same
films says "Phim Hài" (same for "Nhạc"/"Phim Nhạc" and "Phim 18+"), and every
country list reports English names ("South Korea") while details report
"Quốc gia" in Vietnamese ("Hàn Quốc").

Both maps are keyed by the DETAIL labels and were verified against live
upstream on 2026-09-17: every genre label appeared in the category groups of
3-4 of the first 4 films of its list, every country label in the first film's
group of its list. If upstream renames a label, the lookup misses (related
candidates fall back to the other lists) instead of silently mixing categories
— re-verify and update `docs/nguonc-api.md` before editing these.
"""

GENRE_SLUGS: dict[str, str] = {
    "Hành Động": "hanh-dong",
    "Phiêu Lưu": "phieu-luu",
    "Hoạt Hình": "hoat-hinh",
    "Phim Hài": "phim-hai",
    "Hình Sự": "hinh-su",
    "Tài Liệu": "tai-lieu",
    "Chính Kịch": "chinh-kich",
    "Gia Đình": "gia-dinh",
    "Giả Tưởng": "gia-tuong",
    "Lịch Sử": "lich-su",
    "Kinh Dị": "kinh-di",
    "Phim Nhạc": "phim-nhac",
    "Bí Ẩn": "bi-an",
    "Lãng Mạn": "lang-man",
    "Khoa Học Viễn Tưởng": "khoa-hoc-vien-tuong",
    "Gây Cấn": "gay-can",
    "Chiến Tranh": "chien-tranh",
    "Tâm Lý": "tam-ly",
    "Tình Cảm": "tinh-cam",
    "Cổ Trang": "co-trang",
    "Miền Tây": "mien-tay",
    "Phim 18+": "phim-18",
}

COUNTRY_SLUGS: dict[str, str] = {
    "Âu Mỹ": "au-my",
    "Anh": "anh",
    "Trung Quốc": "trung-quoc",
    "Indonesia": "indonesia",
    "Việt Nam": "viet-nam",
    "Pháp": "phap",
    "Hồng Kông": "hong-kong",
    "Hàn Quốc": "han-quoc",
    "Nhật Bản": "nhat-ban",
    "Thái Lan": "thai-lan",
    "Đài Loan": "dai-loan",
    "Nga": "nga",
    "Hà Lan": "ha-lan",
    "Philippines": "philippines",
    "Ấn Độ": "an-do",
    "Quốc gia khác": "quoc-gia-khac",
}


def _normalize(label: str) -> str:
    return " ".join(label.split()).casefold()


GENRE_LABELS: dict[str, str] = {slug: label for label, slug in GENRE_SLUGS.items()}

_GENRE_LOOKUP = {_normalize(k): v for k, v in GENRE_SLUGS.items()}
_COUNTRY_LOOKUP = {_normalize(k): v for k, v in COUNTRY_SLUGS.items()}


def genre_slug(label: str) -> str | None:
    return _GENRE_LOOKUP.get(_normalize(label))


def country_slug(label: str) -> str | None:
    return _COUNTRY_LOOKUP.get(_normalize(label))


def genre_label(slug: str) -> str:
    return GENRE_LABELS.get(slug, slug)
