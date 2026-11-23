"use client";

import { useElementWidth } from "@/lib/hooks";
import { niceTicks, type HourBucket } from "@/lib/domain/stats";

const HEIGHT = 220;
const PAD = { top: 10, right: 4, bottom: 26, left: 56 };

/**
 * Barras por hora: hoje na cor de dado; o mesmo dia da semana passada como um traço cinza
 * na altura que teve, para comparar sem empilhar duas séries.
 */
export function HourlyBars({
  buckets,
  formatTick,
  formatValue,
  compareLabel,
  label,
  minTop = 1,
}: {
  buckets: HourBucket[];
  formatTick: (v: number) => string;
  formatValue: (v: number) => string;
  compareLabel: string;
  label: string;
  /** Topo mínimo da escala, para um dia sem vendas não virar uma régua de zeros. */
  minTop?: number;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const max = Math.max(minTop, ...buckets.map((b) => Math.max(b.value ?? 0, b.compare)));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = buckets.length ? plotW / buckets.length : 0;
  const barW = Math.min(28, band * 0.56);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const labelEvery = band >= 40 ? 1 : band >= 22 ? 2 : 3;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 bg-accent" />
          Hoje
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-3 bg-muted" />
          {compareLabel}
        </span>
      </div>
      <div ref={ref} className="w-full">
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={label} className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? "#cbd5e1" : "#e2e8f0"}
                  strokeWidth={1}
                />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12} fill="#52525b" className="num">
                  {formatTick(t)}
                </text>
              </g>
            ))}
            {buckets.map((b, i) => {
              const cx = PAD.left + band * i + band / 2;
              const v = b.value;
              return (
                <g key={b.hour}>
                  <title>
                    {`${b.hour}h — hoje: ${v === null ? "ainda não chegou" : formatValue(v)} · ${compareLabel.toLowerCase()}: ${formatValue(b.compare)}`}
                  </title>
                  <rect x={cx - band / 2} y={PAD.top} width={band} height={plotH} fill="transparent" />
                  {v !== null && v > 0 && (
                    <rect x={cx - barW / 2} y={y(v)} width={barW} height={y(0) - y(v)} fill="#eb5f00" rx={1} />
                  )}
                  {b.compare > 0 && (
                    <line
                      x1={cx - barW / 2 - 3}
                      x2={cx + barW / 2 + 3}
                      y1={y(b.compare)}
                      y2={y(b.compare)}
                      stroke="#52525b"
                      strokeWidth={2}
                    />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={HEIGHT - 6} textAnchor="middle" fontSize={12} fill="#52525b">
                      {b.hour}h
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {width === 0 && <div style={{ height: HEIGHT }} />}
      </div>
    </div>
  );
}
