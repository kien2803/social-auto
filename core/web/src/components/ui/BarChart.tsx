interface BarDatum {
  label: string;
  value: number;
  /** Tailwind text/color utility classes for the bar fill. */
  colorClass?: string;
}

const PALETTE = {
  pending: 'fill-slate-400 dark:fill-slate-500',
  uploading: 'fill-blue-500 dark:fill-blue-400',
  published: 'fill-emerald-500 dark:fill-emerald-400',
  failed: 'fill-amber-500 dark:fill-amber-400',
  dead: 'fill-red-500 dark:fill-red-400',
  default: 'fill-brand-500 dark:fill-brand-400',
} as const;

export function BarChart({
  data,
  height = 220,
  className,
  yLabel,
}: {
  data: BarDatum[];
  height?: number;
  className?: string;
  yLabel?: string;
}) {
  if (data.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-xs text-ink-subtle dark:text-slate-500 ${className ?? ''}`}
        style={{ height }}
      >
        No data to chart
      </div>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.value));
  // Round up to a nice tick so the chart head doesn't hug max.
  const yMax = Math.ceil(max * 1.1);
  const paddingLeft = 40;
  const paddingRight = 12;
  const paddingTop = 16;
  const paddingBottom = 32;
  const width = Math.max(320, data.length * 80 + paddingLeft + paddingRight);
  const innerW = width - paddingLeft - paddingRight;
  const innerH = height - paddingTop - paddingBottom;
  const barWidth = (innerW / data.length) * 0.55;
  const gap = (innerW / data.length) * 0.45;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={yLabel ?? 'Bar chart'}
      className={className}
      width="100%"
    >
      {/* y-axis grid */}
      {ticks.map((t) => {
        const y = paddingTop + innerH - (t / yMax) * innerH;
        return (
          <g key={t}>
            <line
              x1={paddingLeft}
              x2={width - paddingRight}
              y1={y}
              y2={y}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeWidth={1}
            />
            <text
              x={paddingLeft - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-slate-400 dark:fill-slate-500 text-[10px]"
            >
              {t}
            </text>
          </g>
        );
      })}

      {/* bars */}
      {data.map((d, i) => {
        const x = paddingLeft + i * (innerW / data.length) + gap / 2;
        const h = (d.value / yMax) * innerH;
        const y = paddingTop + innerH - h;
        const fillClass =
          (d.colorClass &&
            (PALETTE as Record<string, string>)[d.colorClass]) ||
          PALETTE.default;
        return (
          <g key={`${d.label}-${i}`}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={h}
              rx={4}
              className={fillClass}
            >
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
            {d.value > 0 && (
              <text
                x={x + barWidth / 2}
                y={y - 4}
                textAnchor="middle"
                className="fill-ink dark:fill-slate-200 text-[10px] font-medium"
              >
                {d.value}
              </text>
            )}
            <text
              x={x + barWidth / 2}
              y={height - paddingBottom + 16}
              textAnchor="middle"
              className="fill-ink-muted dark:fill-slate-400 text-[11px]"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}