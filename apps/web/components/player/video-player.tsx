"use client";

import Hls from "hls.js";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00";
  const t = Math.floor(totalSeconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

interface Props {
  src: string;
  startAt?: number;
  autoPlay?: boolean;
  onProgress?: (position: number, duration: number) => void;
  onPlayState?: (playing: boolean) => void;
  onEnded?: () => void;
  onFatalError?: (message: string) => void;
}

export function VideoPlayer({
  src,
  startAt = 0,
  autoPlay = true,
  onProgress,
  onPlayState,
  onEnded,
  onFatalError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [preview, setPreview] = useState<{ t: number; x: number } | null>(null);

  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onPlayStateRef = useRef(onPlayState);
  onPlayStateRef.current = onPlayState;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onFatalErrorRef = useRef(onFatalError);
  onFatalErrorRef.current = onFatalError;
  const startAtRef = useRef(startAt);
  startAtRef.current = startAt;
  const seekAttemptsRef = useRef(0);

  // Seek to the resume point, retrying across media events. A single attempt
  // (e.g. on MANIFEST_PARSED before duration is known) can silently fail and
  // strand playback at 0 — so keep trying until the clock is actually there.
  const trySeekStart = useCallback(() => {
    const video = videoRef.current;
    if (!video || startedRef.current) return;
    const target = startAtRef.current;
    if (!(target > 0)) {
      startedRef.current = true;
      return;
    }
    if (!Number.isFinite(video.duration) || video.duration <= target) return;
    if (Math.abs(video.currentTime - target) <= 1.5) {
      startedRef.current = true;
      return;
    }
    if (seekAttemptsRef.current >= 8) {
      startedRef.current = true; // give up rather than fight the user forever
      return;
    }
    seekAttemptsRef.current += 1;
    try {
      video.currentTime = target;
    } catch {
      // Seeking not ready yet; a later media event will retry.
    }
  }, []);

  // Attach source (hls.js with native Safari fallback).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    startedRef.current = false;
    seekAttemptsRef.current = 0;
    let hls: Hls | null = null;

    const seekStart = () => {
      trySeekStart();
      if (autoPlay) void video.play().catch(() => {});
    };

    if (src.includes(".m3u8") && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        seekStart();
        if (autoPlay) void video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          onFatalErrorRef.current?.(
            "Không tải được luồng phát (m3u8 lỗi hoặc đã hết hạn).",
          );
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("loadedmetadata", seekStart, { once: true });
      if (autoPlay) void video.play().catch(() => {});
    } else {
      onFatalErrorRef.current?.("Trình duyệt không hỗ trợ phát HLS.");
    }
    return () => {
      hls?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const pokeControls = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  useEffect(() => {
    pokeControls();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [pokeControls]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(
      Math.max(0, video.currentTime + delta),
      video.duration,
    );
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => {});
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      // PiP unsupported — ignore.
    }
  }, []);

  // Keyboard shortcuts.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const video = videoRef.current;
    if (!video) return;
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowRight":
        e.preventDefault();
        seekBy(10);
        break;
      case "ArrowLeft":
        e.preventDefault();
        seekBy(-10);
        break;
      case "ArrowUp":
        e.preventDefault();
        video.muted = false;
        setMuted(false);
        video.volume = Math.min(1, video.volume + 0.1);
        setVolume(video.volume);
        break;
      case "ArrowDown":
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        setVolume(video.volume);
        break;
      case "f":
        toggleFullscreen();
        break;
      case "m":
        video.muted = !video.muted;
        setMuted(video.muted);
        break;
    }
  };

  const onSeekHover = (e: React.MouseEvent<HTMLInputElement>) => {
    const el = seekRef.current;
    if (!el || !Number.isFinite(duration) || duration <= 0) {
      setPreview(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    setPreview({ t: ratio * duration, x: e.clientX - rect.left });
  };

  const progress = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={pokeControls}
      onClick={pokeControls}
      className="relative aspect-video w-full overflow-hidden rounded-xl bg-black outline-none select-none"
    >
      <video
        ref={videoRef}
        className="h-full w-full"
        playsInline
        preload="metadata"
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          onPlayStateRef.current?.(true);
        }}
        onPause={() => {
          setPlaying(false);
          onPlayStateRef.current?.(false);
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setTime(v.currentTime);
          if (Number.isFinite(v.duration)) setDuration(v.duration);
          trySeekStart();
          onProgressRef.current?.(v.currentTime, v.duration);
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (Number.isFinite(v.duration)) setDuration(v.duration);
          trySeekStart();
        }}
        onCanPlay={trySeekStart}
        onEnded={() => onEndedRef.current?.()}
      />

      {!playing && (
        <button
          onClick={togglePlay}
          aria-label="Phát"
          className="absolute inset-0 m-auto size-16 cursor-pointer rounded-full bg-brand/90 text-brand-foreground transition hover:scale-105"
        >
          <Play className="m-auto size-7 fill-current" />
        </button>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/90 to-transparent px-3 pt-8 pb-2 transition-opacity",
          showControls || !playing ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="relative" onMouseLeave={() => setPreview(null)}>
          {preview && (
            <span
              className="pointer-events-none absolute -top-7 rounded bg-black/90 px-1.5 py-0.5 text-xs whitespace-nowrap"
              style={{ left: preview.x, transform: "translateX(-50%)" }}
            >
              {formatClock(preview.t)}
            </span>
          )}
          <input
            ref={seekRef}
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 10)}
            aria-label="Thanh tua"
            onMouseMove={onSeekHover}
            onChange={(e) => {
              const v = videoRef.current;
              if (!v || !Number.isFinite(duration) || duration <= 0) return;
              startedRef.current = true; // user took over; stop resume-seek
              v.currentTime = (Number(e.target.value) / 1000) * duration;
            }}
            className="w-full cursor-pointer accent-rose-600"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" onClick={togglePlay} aria-label={playing ? "Tạm dừng" : "Phát"}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <span className="text-xs whitespace-nowrap tabular-nums">
            {formatClock(time)} / {formatClock(duration)}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={muted ? "Bật tiếng" : "Tắt tiếng"}
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                v.muted = !v.muted;
                setMuted(v.muted);
              }}
            >
              {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
            </Button>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : Math.round(volume * 100)}
              aria-label="Âm lượng"
              onChange={(e) => {
                const v = videoRef.current;
                if (!v) return;
                const vol = Number(e.target.value) / 100;
                v.volume = vol;
                v.muted = vol === 0;
                setVolume(vol);
                setMuted(v.muted);
              }}
              className="hidden w-20 cursor-pointer accent-rose-600 sm:block"
            />
          </div>
          <select
            value={rate}
            aria-label="Tốc độ phát"
            onChange={(e) => {
              const r = Number(e.target.value);
              setRate(r);
              if (videoRef.current) videoRef.current.playbackRate = r;
            }}
            className="cursor-pointer rounded-md bg-transparent px-1 py-1 text-xs hover:bg-white/10"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s} className="bg-card">
                {s}x
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="icon" onClick={togglePip} aria-label="Ảnh trong ảnh">
              <PictureInPicture2 />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleFullscreen} aria-label="Toàn màn hình">
              <Maximize />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
