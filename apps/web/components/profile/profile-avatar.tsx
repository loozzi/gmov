import { cn } from "@/lib/utils";

const AVATAR_EMOJI: Record<string, string> = {
  popcorn: "🍿",
  rocket: "🚀",
  cat: "🐱",
  panda: "🐼",
  robot: "🤖",
  ghost: "👻",
  alien: "👽",
  ninja: "🥷",
  pirate: "🏴☠️",
  dino: "🦖",
  star: "⭐",
  clover: "🍀",
};

export function avatarEmoji(avatar: string): string {
  return AVATAR_EMOJI[avatar] ?? AVATAR_EMOJI.popcorn;
}

export function ProfileAvatar({
  avatar,
  className,
}: {
  avatar: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-brand/10 flex size-12 shrink-0 items-center justify-center rounded-full text-2xl leading-none",
        className,
      )}
    >
      {avatarEmoji(avatar)}
    </span>
  );
}
