/**
 * Remounts on every navigation, so this is where the page-level entrance
 * lives. Opacity only on purpose: a transform here would create a containing
 * block for the sticky header and portalled overlays.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
