import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { BTN_SUBTLE, Card, EmptyState, PanelHeader, StatusNote } from './ui';

function describeLocation(location) {
  if (!location) return '—';
  if (location.status === 'fail') return location.message || 'lookup failed';
  return [location.city, location.regionName, location.country].filter(Boolean).join(', ') || '—';
}

export default function LogsPanel({ adminFetch }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetch('/logs');
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const data = await r.json();
      setLogs(Array.isArray(data) ? data : []);
      setStatus(null);
    } catch (e) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    load();
  }, [load]);

  // Group by IP, newest hit first, most recently active IP at the top.
  const groups = useMemo(() => {
    const byIp = logs.reduce((acc, log) => {
      const ip = log.ip || 'Unknown IP';
      (acc[ip] = acc[ip] || []).push(log);
      return acc;
    }, {});

    return Object.entries(byIp)
      .map(([ip, entries]) => {
        const sorted = [...entries].sort(
          (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        );
        return { ip, logs: sorted, newest: sorted[0]?.timestamp };
      })
      .sort((a, b) => new Date(b.newest) - new Date(a.newest));
  }, [logs]);

  return (
    <div>
      <PanelHeader
        title="Visitor Logs"
        description="Page loads grouped by IP address."
        actions={
          <button onClick={load} className={BTN_SUBTLE}>
            Refresh
          </button>
        }
      />

      <StatusNote status={status} />

      {loading ? (
        <EmptyState>Loading logs…</EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState>No visits logged yet.</EmptyState>
      ) : (
        <>
          <p className="mb-4 text-xs text-white/30">
            {logs.length} hit{logs.length === 1 ? '' : 's'} from {groups.length} address
            {groups.length === 1 ? '' : 'es'}
          </p>

          <div className="space-y-3">
            {groups.map(({ ip, logs: entries, newest }) => {
              const isOpen = !!expanded[ip];
              return (
                <Card key={ip}>
                  <button
                    onClick={() => setExpanded((p) => ({ ...p, [ip]: !p[ip] }))}
                    className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
                  >
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-white/30">{isOpen ? '▾' : '▸'}</span>
                      <span className="font-mono text-sm text-white/85">{ip}</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
                        {entries.length} hit{entries.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="text-xs text-white/35">
                      Last seen {new Date(newest).toLocaleString()}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="divide-y divide-white/5 border-t border-white/8">
                      {entries.map((log, i) => (
                        <div key={`${log.timestamp}-${i}`} className="px-5 py-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="truncate font-mono text-xs text-white/70">
                              {log.pageAccessed}
                            </span>
                            <span className="text-[10px] text-white/30">
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] text-white/35">
                            {[log.device, log.browser, log.platform].filter(Boolean).join(' · ')}
                            {' — '}
                            {describeLocation(log.location)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
