import { useEffect, useMemo, useState } from 'react';
import Logo from './components/Logo.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const DEFAULT_LIMIT = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50];

const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');
const formatCurrency = (value) => `₹ ${formatNumber(Math.round(value || 0))}`;
const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

function TradeFlowDashboard() {
  const [trades, setTrades] = useState([]);
  const [summary, setSummary] = useState({ count: 0, notional: 0, bySymbol: {} });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_LIMIT);
  const [searchTerm, setSearchTerm] = useState('');
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1, page: 1, hasNextPage: false, hasPreviousPage: false });
  const [job, setJob] = useState(null);
  const [lastSuccessfulPull, setLastSuccessfulPull] = useState(null);
  const [durationMs, setDurationMs] = useState(15000);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState('');

  const apiUrl = (path) => `${API_BASE}${path}`;

  const fetchJson = async (url) => {
    const response = await fetch(url);
    const text = await response.text().catch(() => '');

    // try to parse JSON only when body is present
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const payload = text && isJson ? JSON.parse(text) : (text ? text : null);

    if (!response.ok) {
      const message = payload && typeof payload === 'object' ? payload.message || JSON.stringify(payload) : String(payload || `Status ${response.status}`);
      throw new Error(message);
    }

    return payload;
  };

  const loadDashboard = async (nextPage = page, nextPageSize = pageSize, q = searchTerm) => {
    setIsLoading(true);
    setError('');

    try {
      const [tradeResult, summaryResult] = await Promise.all([
        fetchJson(`${apiUrl('/api/trades')}?page=${nextPage}&limit=${nextPageSize}&q=${encodeURIComponent(q)}`),
        fetchJson(apiUrl('/api/summary')),
      ]);

      setTrades(tradeResult.trades || []);
      setSummary(summaryResult || { count: 0, notional: 0, bySymbol: {} });
      setPagination({
        total: tradeResult.total || 0,
        totalPages: tradeResult.totalPages || 1,
        page: tradeResult.page || 1,
        hasNextPage: Boolean(tradeResult.hasNextPage),
        hasPreviousPage: Boolean(tradeResult.hasPreviousPage),
      });
    } catch (loadError) {
      setError(loadError.message || 'Unable to load dashboard data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let eventSource;

    const setupSseAndLoad = async () => {
      // Open SSE first so we won't miss quick completion events
      eventSource = new EventSource(apiUrl('/api/events'));

      eventSource.addEventListener('connected', () => {
        setConnectionStatus('connected');
      });

      eventSource.addEventListener('pull-started', (event) => {
        const payload = JSON.parse(event.data);
        setJob(payload);
        setConnectionStatus('connected');
        setIsActionLoading(true);
        setError('');
      });

      eventSource.addEventListener('pull-progress', (event) => {
        const payload = JSON.parse(event.data);
        setJob(payload);
        setConnectionStatus('connected');
      });

      eventSource.addEventListener('pull-complete', async (event) => {
        const payload = JSON.parse(event.data);
        setJob(payload);
        setConnectionStatus('connected');
        setIsActionLoading(false);
        if (payload.completedAt) setLastSuccessfulPull(payload.completedAt);
        await loadDashboard();
      });

      eventSource.addEventListener('pull-failed', (event) => {
        const payload = JSON.parse(event.data);
        setJob(payload);
        setConnectionStatus('connected');
        setIsActionLoading(false);
        setError(payload.error || 'Pull failed.');
      });

      eventSource.onerror = () => {
        setConnectionStatus('disconnected');
      };

      // After SSE is wired, fetch current data and job status
      try {
        await loadDashboard();

        // fetch current pulls and pick the most relevant job (running/queued/latest)
        const pulls = await fetchJson(apiUrl('/api/pulls')).catch(() => null);
        if (pulls && Array.isArray(pulls.jobs)) {
          const running = pulls.jobs.find((j) => j.status === 'running' || j.status === 'queued');
          const latest = running || (pulls.jobs[0] || null);
          if (latest) {
            setJob(latest);
            if (latest.completedAt) setLastSuccessfulPull(latest.completedAt);
            if (latest.status === 'running' || latest.status === 'queued') setIsActionLoading(true);
          }
        }
      } catch (e) {
        // ignore; loadDashboard sets error state
      }
    };

    setupSseAndLoad();

    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  useEffect(() => {
    loadDashboard(page, pageSize, searchTerm);
  }, [page, pageSize]);

  const handleSearch = (event) => {
    const nextValue = event.target.value;
    setSearchTerm(nextValue);
    setPage(1);
    loadDashboard(1, pageSize, nextValue);
  };

  const handleStartPull = async () => {
    setIsActionLoading(true);
    setError('');

    try {
      const response = await fetch(apiUrl('/api/pulls'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMs }),
      });

      // parse safely (server may return 202 with empty body)
      const text = await response.text().catch(() => '');
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (e) {
        payload = null;
      }

      if (!response.ok) {
        const message = payload && payload.message ? payload.message : `Unable to start pull (status ${response.status})`;
        throw new Error(message);
      }

      if (payload && payload.duplicate) {
        setJob(payload.job);
        setError('A pull with this request is already running.');
        return;
      }

      if (payload) setJob(payload);
      setConnectionStatus('connected');
    } catch (pullError) {
      setError(pullError.message || 'Failed to start pull.');
      setIsActionLoading(false);
    }
  };

  const topSymbols = useMemo(() => {
    return Object.entries(summary.bySymbol || {}).sort(([, a], [, b]) => b - a).slice(0, 4);
  }, [summary]);

  const maxBarValue = Math.max(...topSymbols.map(([, value]) => value), 1);
  const currentJobProgress = job?.progress ?? 0;
  const pullStatusText = isActionLoading || job?.status === 'running' ? 'In progress' : job?.status === 'failed' ? 'Failed' : job?.status === 'completed' ? 'Completed' : 'Ready';

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark" aria-hidden="true">
            {/* SVG logo component inserted here */}
            <Logo />
          </div>
          <div>
            <p className="eyebrow">Market Intelligence</p>
            <h1>TradeFlow Dashboard</h1>
          </div>
        </div>

        <div className="header-actions">
          <div className={`connection-badge ${connectionStatus}`} aria-live="polite">
            <span className="dot" aria-hidden="true" />
            {connectionStatus === 'connected' ? 'SSE connected' : connectionStatus === 'disconnected' ? 'SSE disconnected' : 'Connecting...'}
          </div>
          <button className="primary-btn" onClick={handleStartPull} disabled={isActionLoading}>
            {isActionLoading ? 'Starting pull...' : 'Start Data Pull'}
          </button>
        </div>
      </header>

      <section className="controls-panel">
        <div className="field-group">
          <label htmlFor="duration-select">Simulation duration</label>
          <select id="duration-select" value={durationMs} onChange={(event) => setDurationMs(Number(event.target.value))}>
            <option value={5000}>5 sec</option>
            <option value={15000}>15 sec</option>
            <option value={60000}>1 min</option>
            <option value={300000}>5 min</option>
            <option value={900000}>15 min</option>
          </select>
        </div>

        <div className="field-group search-group">
          <label htmlFor="trade-search">Search trades</label>
          <input
            id="trade-search"
            type="search"
            value={searchTerm}
            onChange={handleSearch}
            placeholder="Search by trade ID, client, or symbol"
            aria-label="Search trades"
          />
        </div>
      </section>

      {error ? <div className="notice error" role="alert">{error}</div> : null}

      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-label">Total trades</div>
          <div className="stat-value">{formatNumber(summary.count || trades.length || pagination.total)}</div>
          <div className="stat-footnote">Across all stored positions</div>
        </article>

        <article className="stat-card">
          <div className="stat-label">Pull status</div>
          <div className="stat-value small-value">{pullStatusText}</div>
          <div className="stat-footnote">{job?.status === 'running' ? `${currentJobProgress}% complete` : 'Awaiting next cycle'}</div>
        </article>

        <article className="stat-card">
          <div className="stat-label">Last successful pull</div>
          <div className="stat-value small-value">{lastSuccessfulPull ? formatDateTime(lastSuccessfulPull) : 'No completed pull yet'}</div>
          <div className="stat-footnote">Latest batch ingestion</div>
        </article>

        <article className="stat-card">
          <div className="stat-label">Current job progress</div>
          <div className="stat-value small-value">{currentJobProgress}%</div>
          <div className="progress-track" aria-label="Current pull progress">
            <span style={{ width: `${currentJobProgress}%` }} />
          </div>
        </article>
      </section>

      <section className="market-panel">
        <div className="panel-header">
          <h2>Top symbols</h2>
        </div>
        <div className="bar-list">
          {topSymbols.length ? topSymbols.map(([symbol, value]) => (
            <div className="bar-row" key={symbol}>
              <span>{symbol}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(value / maxBarValue) * 100}%` }} />
              </div>
              <strong>{formatCurrency(value)}</strong>
            </div>
          )) : <div className="empty-state">No symbol data available yet.</div>}
        </div>
      </section>

      <section className="table-panel">
        <div className="table-header-row">
          <h2>Trade ledger</h2>
          <div className="table-actions">
            <label>
              Rows per page
              <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {isLoading ? (
          <div className="state-box loading">Loading trades...</div>
        ) : trades.length === 0 ? (
          <div className="state-box empty">No trades found for the current filters.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Trade ID</th>
                    <th>Client</th>
                    <th>Symbol</th>
                    <th className="align-right">Quantity</th>
                    <th className="align-right">Price</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr key={trade.tradeId}>
                      <td>{trade.tradeId}</td>
                      <td>{trade.client}</td>
                      <td>{trade.symbol}</td>
                      <td className="align-right">{trade.quantity}</td>
                      <td className="align-right">₹ {Number(trade.price).toFixed(2)}</td>
                      <td>{formatDateTime(trade.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination-bar" aria-label="Trade table pagination">
              <button
                type="button"
                className="secondary-btn"
                disabled={!pagination.hasPreviousPage || isLoading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>

              <span>
                Page {pagination.page || 1} of {pagination.totalPages || 1}
              </span>

              <button
                type="button"
                className="secondary-btn"
                disabled={!pagination.hasNextPage || isLoading}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default TradeFlowDashboard;
