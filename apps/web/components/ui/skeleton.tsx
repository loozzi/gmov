import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-muted relative overflow-hidden rounded-lg",
        "after:animate-shimmer after:via-foreground/5 after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:to-transparent after:content-['']",
        className,
      )}
      {...props}
    />
  );
}
