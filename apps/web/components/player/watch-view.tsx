"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  RotateCcw,
  ServerCrash,
  X,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { EmbedPlayer } from "@/components/player/embed-player";
import { EpisodeGrid } from "@/components/player/episode-grid";
import { VideoPlayer, formatClock } from "@/components/player/video-player";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { getAccessToken } from "@/lib/api";
import { saveGuestProgress } from "@/lib/guest-progress";
import {
  sendProgressKeepalive,
  useMarkWatched,
  useProgress,
  useUpsertProgress,
  useWatched,
  type ProgressUpsert,
} from "@/lib/me";
import type { MovieDetail } from "@/lib/types";

const HEARTBEAT_MS = 15_000;
const NEXT_EP_COUNTDOWN = 10;

interface Props {
  detail: MovieDetail;
  episodeSlug: string;
}

export function WatchView({ detail, episodeSlug }: Props) {
  const router = useRouter();
  const notify = useToast();
  const { isAuthenticated } = useAuth();
  const upsert = useUpsertProgress();
  const markWatched = useMarkWatched(detail.slug);

  const servers = useMemo(
    () => detail.servers.filter((s) => s.episodes.length > 0),
    [detail],
  );

  const [serverName, setServerName] = useState(() => {
    const hit = servers.find((s) =>
      s.episodes.some((e) => (e.slug ?? e.name) === episodeSlug),
    );
    return hit?.name ?? servers[0]?.name ?? "";
  });
  const [playKey, setPlayKey] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const [toast, setToast] = useState<number | null>(null);
  const [toastGone, setToastGone] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const posRef = useRef({ t: 0, d: 0 });
  const playingRef = useRef(false);
  const markedRef = useRef(false);
  const resumeDoneRef = useRef(false);
  const embedRegisteredRef = useRef(false);

  const server =
    servers.find((s) => s.name === serverName) ?? servers[0] ?? null;
  const episodes = useMemo(() => server?.episodes ?? [], [server]);
  const currentEp =
    episodes.find((e) => (e.slug ?? e.name) === episodeSlug) ??
    episodes[0] ??
    null;
  const currentKey = currentEp ? (currentEp.slug ?? currentEp.name) : "";

  // Series position within the selected server (not the cross-server flat
  // list): "tập N/M" for the history/rail/detail UI.
  const seriesPosition = useMemo(() => {
    const idx =
      episodes.findIndex((e) => (e.slug ?? e.name) === currentKey) + 1;
    return {
      episode_index: idx > 0 ? idx : null,
      total_episodes: episodes.length > 0 ? episodes.length : null,
    };
  }, [episodes, currentKey]);

  const src = currentEp?.m3u8_url ?? null;
  const isHls = src !== null;

  const { data: savedProgress, isFetched: progressFetched } = useProgress(
    detail.slug,
  );
  const { data: watchedData } = useWatched(detail.slug, isAuthenticated);
  const [localWatched, setLocalWatched] = useState<Set<string>>(new Set());
  const watched = useMemo(
    () => new Set([...(watchedData?.episode_slugs ?? []), ...localWatched]),
    [watchedData, localWatched],
  );

  const poster = detail.poster_url || detail.thumb_url;

  const buildPayload = useCallback(
    (t: number, d: number): ProgressUpsert => ({
      movie_slug: detail.slug,
      movie_name: detail.name,
      poster_url: poster,
      episode_slug: episodeSlug,
      episode_name: currentEp?.name ?? episodeSlug,
      server_name: server?.name ?? null,
      position_seconds: Math.floor(t),
      duration_seconds: d > 0 ? Math.floor(d) : null,
      ...seriesPosition,
    }),
    [detail, episodeSlug, currentEp, server, poster, seriesPosition],
  );

  // Single write path: logged-in viewers save to the server, guests to
  // localStorage. Callers below never branch on auth themselves.
  const persist = useCallback(
    (payload: ProgressUpsert) => {
      if (isAuthenticated) upsert.mutate(payload);
      else saveGuestProgress(payload);
    },
    [isAuthenticated, upsert],
  );

  // Reset per-episode transient state. Client components persist across
  // episode navigations within the same route, so stale startAt/toast from
  // the previous episode must not leak into the next one.
  useEffect(() => {
    resumeDoneRef.current = false;
    markedRef.current = false;
    embedRegisteredRef.current = false;
    posRef.current = { t: 0, d: 0 };
    playingRef.current = false;
    setStartAt(0);
    setToast(null);
    setToastGone(false);
    setFatal(null);
    setCountdown(null);
    const hit = servers.find((s) =>
      s.episodes.some((e) => (e.slug ?? e.name) === episodeSlug),
    );
    setServerName(hit?.name ?? servers[0]?.name ?? "");
  }, [episodeSlug, servers]);

  // Resume: decide EXACTLY ONCE per episode. Re-deciding on every progress
  // refetch (e.g. after a heartbeat save) would remount the player mid-watch
  // and interrupt playback. Never yank a viewer who already started watching.
  useEffect(() => {
    if (resumeDoneRef.current || !progressFetched || !savedProgress) return;
    resumeDoneRef.current = true;
    if (savedProgress.episode_slug !== episodeSlug) return;
    if (savedProgress.position_seconds <= 10) return;
    if (posRef.current.t > 10) return;
    setStartAt(savedProgress.position_seconds);
    setToast(savedProgress.position_seconds);
    setPlayKey((k) => k + 1);
  }, [progressFetched, savedProgress, episodeSlug]);

  // Auto-dismiss resume toast.
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Heartbeat while playing (HLS). Guests write to localStorage instead.
  useEffect(() => {
    if (!isHls) return;
    const timer = setInterval(() => {
      if (playingRef.current && posRef.current.d > 0) {
        persist(buildPayload(posRef.current.t, posRef.current.d));
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isHls, episodeSlug, serverName]);

  // Flush on tab close. Guests write synchronously; only the server path
  // needs keepalive to survive unload.
  useEffect(() => {
    if (!isHls) return;
    const flush = () => {
      if (posRef.current.d <= 0) return;
      const payload = buildPayload(posRef.current.t, posRef.current.d);
      if (!isAuthenticated) {
        saveGuestProgress(payload);
        return;
      }
      const token = getAccessToken();
      if (token) sendProgressKeepalive(payload, token);
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isHls, episodeSlug, serverName]);

  // Embed mode: cross-origin iframe exposes no playtime, so we cannot save a
  // position — but we CAN record which episode was opened last, so "Xem tiếp"
  // follows the viewer. Register the CURRENT episode unless it is already the
  // movie's latest row, or it carries a completed marker (1s/1s), which we
  // must never clobber with a 0s/0s row. Guests have no server watched list,
  // so they register unconditionally.
  useEffect(() => {
    if (isHls || !progressFetched || !currentEp) return;
    if (embedRegisteredRef.current) return;
    if (savedProgress?.episode_slug === episodeSlug) return;
    if (isAuthenticated && (!watchedData || watched.has(currentKey))) return;
    embedRegisteredRef.current = true;
    persist(buildPayload(0, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAuthenticated,
    isHls,
    progressFetched,
    savedProgress,
    currentEp,
    episodeSlug,
    watchedData,
    watched,
    currentKey,
  ]);

  const flatEpisodes = useMemo(
    () =>
      servers.flatMap((s) =>
        s.episodes.map((e) => ({ server: s.name, ep: e })),
      ),
    [servers],
  );
  const currentFlatIdx = flatEpisodes.findIndex(
    ({ server: sn, ep }) =>
      sn === server?.name && (ep.slug ?? ep.name) === currentKey,
  );
  const nextFlat = flatEpisodes[currentFlatIdx + 1] ?? null;

  // Auto-next countdown.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      if (nextFlat) {
        router.push(
          `/xem/${detail.slug}/${nextFlat.ep.slug ?? nextFlat.ep.name}`,
        );
      }
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, nextFlat, router, detail.slug]);

  const handleProgress = useCallback(
    (t: number, d: number) => {
      posRef.current = { t, d };
      if (
        isAuthenticated &&
        d > 0 &&
        t / d >= 0.9 &&
        !markedRef.current &&
        currentKey
      ) {
        markedRef.current = true;
        setLocalWatched((prev) => new Set(prev).add(currentKey));
      }
    },
    [isAuthenticated, currentKey],
  );

  const handlePause = useCallback(() => {
    if (posRef.current.d > 0) {
      persist(buildPayload(posRef.current.t, posRef.current.d));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, episodeSlug, serverName]);

  const switchServer = useCallback((name: string) => {
    setServerName(name);
    setStartAt(posRef.current.t);
    setFatal(null);
    setCountdown(null);
    setPlayKey((k) => k + 1);
  }, []);

  const cycleServer = useCallback(() => {
    if (servers.length < 2) return;
    const idx = servers.findIndex((s) => s.name === server?.name);
    switchServer(servers[(idx + 1) % servers.length].name);
  }, [servers, server, switchServer]);

  if (!server || !currentEp) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-xl border p-8 text-center text-sm">
        Tập phim này chưa có nguồn phát.{" "}
        <Link
          href={`/phim/${detail.slug}`}
          className="text-brand hover:underline"
        >
          Quay lại chi tiết phim
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/phim/${detail.slug}`}>
            <ArrowLeft /> {detail.name}
          </Link>
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">
          {currentEp.name}
          {server ? ` · ${server.name}` : ""}
        </span>
      </div>

      <div className="relative">
        {isHls ? (
          <VideoPlayer
            key={`${serverName}-${currentKey}-${playKey}`}
            src={src}
            startAt={startAt}
            onProgress={handleProgress}
            onPlayState={(playing) => {
              playingRef.current = playing;
              if (!playing) handlePause();
            }}
            onEnded={() => {
              handlePause();
              if (nextFlat) setCountdown(NEXT_EP_COUNTDOWN);
            }}
            onFatalError={setFatal}
          />
        ) : currentEp.embed_url ? (
          <EmbedPlayer src={currentEp.embed_url} title={currentEp.name} />
        ) : (
          <div className="border-border bg-card text-muted-foreground flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border text-sm">
            <ServerCrash className="size-8" />
            Tập này chưa có link phát.
          </div>
        )}

        {fatal && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/85 p-6 text-center">
            <AlertTriangle className="size-10 text-amber-400" />
            <p className="max-w-md text-sm">{fatal}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {servers.length > 1 && (
                <Button onClick={cycleServer}>Đổi server khác</Button>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  setFatal(null);
                  setPlayKey((k) => k + 1);
                }}
              >
                <RotateCcw /> Thử lại
              </Button>
            </div>
          </div>
        )}

        {countdown !== null && nextFlat && (
          <div className="absolute inset-x-0 bottom-16 mx-auto w-fit rounded-xl bg-black/85 px-5 py-3 text-center">
            <p className="text-sm">
              Tập tiếp theo sau <strong>{countdown}s</strong>
            </p>
            <div className="mt-2 flex justify-center gap-2">
              <Button
                size="sm"
                onClick={() =>
                  router.push(
                    `/xem/${detail.slug}/${nextFlat.ep.slug ?? nextFlat.ep.name}`,
                  )
                }
              >
                Xem ngay
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setCountdown(null)}
              >
                <X /> Hủy
              </Button>
            </div>
          </div>
        )}
      </div>

      {toast !== null && !toastGone && (
        <div className="border-brand/40 bg-brand/10 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm">
          <p>
            Đã tiếp tục từ <strong>{formatClock(toast)}</strong>
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setToastGone(true);
              setToast(null);
              setStartAt(0);
              setPlayKey((k) => k + 1);
            }}
          >
            Xem từ đầu
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {nextFlat && (
          <Button
            variant="secondary"
            onClick={() =>
              router.push(
                `/xem/${detail.slug}/${nextFlat.ep.slug ?? nextFlat.ep.name}`,
              )
            }
          >
            Tập tiếp theo: {nextFlat.ep.name}
          </Button>
        )}
        {!isHls && isAuthenticated && currentEp.embed_url && (
          <Button
            variant="secondary"
            disabled={markWatched.isPending || watched.has(currentKey)}
            onClick={() =>
              markWatched.mutate(
                {
                  movie_name: detail.name,
                  episode_slug: currentKey,
                  episode_name: currentEp.name,
                  poster_url: poster,
                  server_name: server?.name ?? null,
                  ...seriesPosition,
                },
                {
                  onSuccess: () =>
                    notify("Đã đánh dấu tập này là đã xem.", "success"),
                  onError: () =>
                    notify("Đánh dấu thất bại. Thử lại nhé.", "error"),
                },
              )
            }
          >
            <BadgeCheck />
            {watched.has(currentKey) ? "Đã đánh dấu xem" : "Đánh dấu đã xem"}
          </Button>
        )}
        {!isHls && (
          <p className="text-muted-foreground w-full text-xs">
            Nguồn phát nhúng từ nhà cung cấp — nếu đứng hình, hãy thử server
            khác bên dưới.
          </p>
        )}
      </div>

      <EpisodeGrid
        movieSlug={detail.slug}
        servers={servers}
        activeServer={server.name}
        activeEpisode={currentKey}
        watched={watched}
        onServer={switchServer}
      />
    </div>
  );
}
