/**
 * Shared wallboard scene primitives. Extracted so every scene (Sprint Board,
 * Flow Health, and the ones to come) renders with the same panel chrome,
 * stage lozenges, and metric tiles instead of each re-inventing them.
 */
import { cn } from "@/lib/utils";
import { Stage, STAGE_COLORS, stageOf } from "../stages";

/** The wallboard's primary accent (also each scene's default dot color). */
export const ACCENT = "#4493f8";

export function Panel({
  title,
  titleRight,
  dotColor,
  className,
  titleClassName,
  children,
}: {
  title: string;
  titleRight?: React.ReactNode;
  dotColor?: string;
  className?: string;
  titleClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border bg-muted/20 p-[0.7em]",
        className
      )}
    >
      <h2
        className={cn(
          "mb-[0.55em] flex items-center gap-[0.4em] text-[0.62em] font-semibold uppercase tracking-widest text-muted-foreground",
          titleClassName
        )}
      >
        {dotColor && (
          <span
            className="h-[0.55em] w-[0.55em] rounded-full"
            style={{ background: dotColor }}
          />
        )}
        {title}
        {titleRight}
      </h2>
      {children}
    </section>
  );
}

export function StageChip({ status }: { status: string }) {
  const stage = stageOf(status);
  const c = STAGE_COLORS[stage];
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded px-[0.4em] py-[0.05em] text-[0.55em] font-semibold"
      style={{ background: `${c}22`, color: c }}
    >
      {stage}
    </span>
  );
}

/**
 * A simple headline metric with a caption and optional semantic tone. Kept
 * deliberately lighter than the Sprint Board's sparkline StatTile — Flow
 * Health and friends mostly want a number, a label, and a color.
 */
export function MetricTile({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string | number | null;
  /** Semantic color of the value (separate from any scene accent). */
  tone?: "good" | "warn" | "bad" | "accent";
  sub?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-green-400"
      : tone === "warn"
      ? "text-amber-400"
      : tone === "bad"
      ? "text-red-400"
      : tone === "accent"
      ? "text-[#4493f8]"
      : "text-foreground";
  return (
    <div className="rounded-xl border bg-muted/20 px-[0.7em] py-[0.5em]">
      <div
        className={cn(
          "text-[1.5em] font-bold leading-tight tabular-nums",
          toneClass
        )}
      >
        {value ?? "—"}
      </div>
      <div className="truncate text-[0.52em] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {sub && (
        <div className="truncate text-[0.5em] text-muted-foreground/70">{sub}</div>
      )}
    </div>
  );
}

/** Re-export for scenes that render stage-colored segmented bars. */
export type { Stage };
export { STAGE_COLORS, stageOf };
