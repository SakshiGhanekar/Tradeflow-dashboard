import { useEffect, useState } from 'react';

const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');

function App() {
  const [trades, setTrades] = useState([]);
  const [summary, setSummary] = useState({ count: 0, notional: 0, bySymbol: {} });
  const [status, setStatus] = useState({ state: 'idle', lastPullAt: null, error: null });

  const fetchTrades = async () => {
    try {
      const [tradeRes, summaryRes] = await Promise.all([
        fetch('/api/trades?limit=200'),
        fetch('/api/summary'),
      ]);

      const tradeData = await tradeRes.json();
      const summaryData = await summaryRes.json();

      setTrades(tradeData.trades || []);
      setSummary(summaryData);
    } catch (error) {
      console.error('Unable to load dashboard data', error);
    }
  };

  useEffect(() => {
    fetchTrades();

    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('status', (event) => {
      const payload = JSON.parse(event.data);
      setStatus(payload);
    });

    eventSource.addEventListener('pull-complete', async (event) => {
      const payload = JSON.parse(event.data);
      setStatus(payload);
      await fetchTrades();
    });

    return () => eventSource.close();
  }, []);

  const handlePull = async () => {
    try {
      await fetch('/api/pull', { method: 'POST' });
    } catch (error) {
      console.error('Pull failed', error);
    }
  };

  const entries = Object.entries(summary.bySymbol || {}).sort(([, a], [, b]) => b - a).slice(0, 4);
  const maxValue = Math.max(...entries.map(([, value]) => value), 1);

  return (
    <main className="dashboard-shell">
      <div className="topbar">
        <h1>Trades Dashboard</h1>
        <div className="top-actions">
          <span className={`status-pill ${status.state === 'pulling' ? 'warning' : status.state === 'error' ? 'warning' : 'success'}`}>
            {status.state === 'pulling'
              ? 'Pull in progress'
              : status.state === 'error'
                ? `Pull failed: ${status.error || 'fetch failed'}`
                : 'Up to date'}
          </span>
          <button className="pull-btn" onClick={handlePull} disabled={status.state === 'pulling'}>
            Pull now
          </button>
        </div>
      </div>

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total trades</div>
          <div className="stat-value">{formatNumber(summary.count)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Notional (₹)</div>
          <div className="stat-value">{formatNumber(Math.round(summary.notional || 0))}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Last pull completed</div>
          <div className="stat-value small-value">
            {status.lastPullAt ? new Date(status.lastPullAt).toLocaleString() : 'No completed pull yet'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Notional by symbol</div>
          <div className="bar-list">
            {entries.length ? entries.map(([symbol, value]) => (
              <div key={symbol} className="bar-row">
                <span>{symbol}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(value / maxValue) * 100}%` }} />
                </div>
              </div>
            )) : <div className="empty-state">—</div>}
          </div>
        </div>
      </section>

      <div className="table-shell">
        <div className="table-header">DY PATIL UNIVERSITY</div>
        <table>
          <thead>
            <tr>
              <th>Trade ID</th>
              <th>Client</th>
              <th>Symbol</th>
              <th className="right">Qty</th>
              <th className="right">Price</th>
              <th>Time (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.tradeId}>
                <td>{trade.tradeId}</td>
                <td>{trade.client}</td>
                <td>{trade.symbol}</td>
                <td className="right">{trade.quantity}</td>
                <td className="right">{Number(trade.price).toFixed(2)}</td>
                <td>{trade.timestamp ? trade.timestamp.replace('T', ' ').slice(0, 19) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

export default App;
