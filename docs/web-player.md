# Watch page / player (Phase 6)

Route: `/xem/[slug]/[episode]` (server component + metadata, `WatchView` island).

## Playback modes (dual-mode by necessity)

Upstream provides only `embed.php` page URLs — **no direct m3u8 exists**
(probed 2026-09-15). So:

- **`m3u8_url` present (future-proof):** full custom `VideoPlayer` (hls.js,
  native HLS fallback for Safari/iOS).
- **embed only (today):** `EmbedPlayer` iframe 16:9. Cross-origin means no
  time access — resume is advisory, and a manual "Đánh dấu đã xem" button
  exists. Opening an episode records it as the movie's current episode (so
  "Xem tiếp" follows the last episode opened); it never overwrites a saved
  position or a watched marker.

## Custom player controls

Play/pause (click video, big center button when paused), seek bar with hover
time preview, volume slider + mute, speed 0.5–2x, fullscreen, PiP.
Shortcuts: `Space`/`K` play-pause, `←`/`→` ∓10s, `↑`/`↓` volume, `F`
fullscreen, `M` mute. Controls auto-hide after 3s idle.

## Progress sync (logged-in only)

- HLS: heartbeat upsert every 15s while playing, immediate save on pause,
  `keepalive: true` fetch on unmount/`beforeunload` (beacon can't carry the
  `Authorization` header, keepalive fetch can).
- Resume toast "Đã tiếp tục từ HH:MM:SS" + "Xem từ đầu" (remount at 0).
- Episode ≥90% duration counts as watched (server derives it;
  `GET /api/v1/me/watched/{movie}`); embed mode has explicit
  `POST /api/v1/me/watched` marker.

## Episode flow

- Next-episode countdown 10s on `ended` (cancellable); next = following
  episode across servers in order.
- Server tabs preserve position (HLS seeks after source swap).
- HLS fatal error → overlay with retry + switch-server; embed mode always
  shows a "try another server" hint (iframe errors are undetectable
  cross-origin).
