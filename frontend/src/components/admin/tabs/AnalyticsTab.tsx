import { useAnalytics } from "../../../hooks/useAdminData";
import type { AnalyticsSummary } from "../AdminShared";
import { AdminCard, ErrorBanner } from "../AdminShared";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="admin-stat">
      <span className="admin-stat__label font-display">{label}</span>
      <span className="admin-stat__value font-display crt-glow">{value}</span>
      {hint && <span className="admin-stat__hint font-display">{hint}</span>}
    </div>
  );
}

/**
 * Tiny inline SVG sparkline — no chart dependency. Renders the last-14-days
 * run counts as vertical bars normalized to the peak.
 */
function RunsSparkline({ days }: { days: { date: string; count: number }[] }) {
  if (!days.length) return null;
  const peak = Math.max(1, ...days.map((d) => d.count));
  const barW = 100 / days.length;
  return (
    <svg
      className="admin-sparkline"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label="Runs over the last 14 days"
    >
      {days.map((d, i) => {
        const h = (d.count / peak) * 36;
        return (
          <rect
            key={d.date}
            x={i * barW + 0.5}
            y={40 - h}
            width={Math.max(0.5, barW - 1)}
            height={h}
          />
        );
      })}
    </svg>
  );
}

function ModeBreakdown({ data }: { data: AnalyticsSummary }) {
  const total = data.runsHybrid + data.runsFull + data.runsUnknown || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div className="admin-mode-row">
      <span className="admin-mode admin-mode--hybrid font-display">
        Hybrid {data.runsHybrid} · {pct(data.runsHybrid)}%
      </span>
      <span className="admin-mode admin-mode--full font-display">
        Full {data.runsFull} · {pct(data.runsFull)}%
      </span>
      {data.runsUnknown > 0 && (
        <span className="admin-mode admin-mode--unknown font-display">
          Other {data.runsUnknown}
        </span>
      )}
    </div>
  );
}

export default function AnalyticsTab() {
  const { data, isLoading, error, refresh } = useAnalytics();

  if (isLoading) {
    return <p className="admin-loading font-display">Crunching numbers…</p>;
  }

  return (
    <section className="admin-tab">
      <header className="admin-tab__header">
        <h2 className="admin-tab__heading font-display crt-glow">ANALYTICS</h2>
        <p className="admin-tab__lede font-display">
          Speedrun traffic, token usage, and cost estimate. Runs expire after 24h,
          so numbers reflect recent activity.
        </p>
        <button
          type="button"
          className="admin-btn admin-btn--ghost font-display"
          onClick={refresh}
        >
          ↻ Refresh
        </button>
      </header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {!data && !error && (
        <p className="admin-loading font-display">No data yet.</p>
      )}

      {data && (
        <>
          <div className="admin-stats-grid">
            <StatTile
              label="Runs total"
              value={formatNumber(data.runsTotal)}
              hint={`${data.runsComplete} completed`}
            />
            <StatTile
              label="Last 24h"
              value={formatNumber(data.runsLast24h)}
              hint="fresh sessions"
            />
            <StatTile
              label="Input tokens"
              value={formatNumber(data.inputTokens)}
            />
            <StatTile
              label="Output tokens"
              value={formatNumber(data.outputTokens)}
            />
            <StatTile
              label="Est. cost (Hybrid)"
              value={`$${data.estimatedCostUsd.toFixed(2)}`}
              hint="server-side only"
            />
            <StatTile
              label="URL speedruns"
              value={formatNumber(data.urlRuns)}
              hint="external sites"
            />
          </div>

          <AdminCard title="Run volume (last 14 days)">
            <RunsSparkline days={data.runsPerDay} />
            <p className="admin-hint font-display">
              Each bar = one day. Hover the bars in the data table below for exact counts.
            </p>
          </AdminCard>

          <AdminCard title="Mode breakdown">
            <ModeBreakdown data={data} />
            <p className="admin-hint font-display">
              Hybrid = server key (billed). Full = visitor key (free for us).
            </p>
          </AdminCard>

          <AdminCard title="Top analysed sites">
            {data.topSourceHosts.length === 0 ? (
              <p className="admin-hint font-display">No URL speedruns yet.</p>
            ) : (
              <ol className="admin-top-list">
                {data.topSourceHosts.map((h) => (
                  <li key={h.host} className="admin-top-item font-display">
                    <span className="admin-top-item__host">{h.host}</span>
                    <span className="admin-top-item__count">{h.count}×</span>
                  </li>
                ))}
              </ol>
            )}
          </AdminCard>

          <AdminCard title="Recent days (detail)">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="font-display">Date</th>
                  <th className="font-display">Runs</th>
                </tr>
              </thead>
              <tbody>
                {data.runsPerDay
                  .slice()
                  .reverse()
                  .map((d) => (
                    <tr key={d.date}>
                      <td className="font-display">{d.date}</td>
                      <td className="font-display">{d.count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </AdminCard>
        </>
      )}
    </section>
  );
}
