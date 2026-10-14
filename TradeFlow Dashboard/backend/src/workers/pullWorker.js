const { EventEmitter } = require('events');
const { generateDeterministicTrades } = require('../services/tradeSeed');

class PullWorker extends EventEmitter {
  constructor({ store, jobs, emitSse }) {
    super();
    this.store = store;
    this.jobs = jobs;
    this.emitSse = emitSse;
  }

  async run(job) {
    const jobId = job.jobId;
    const currentJob = this.jobs.get(jobId);
    if (!currentJob) return;

    currentJob.status = 'running';
    currentJob.progress = 0;
    currentJob.updatedAt = new Date().toISOString();
    this.emitSse('pull-started', currentJob);

    const steps = [20, 50, 75, 100];

    for (const step of steps) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(100, currentJob.durationMs / steps.length)));

      const latestJob = this.jobs.get(jobId);
      if (!latestJob) return;

      latestJob.progress = step;
      latestJob.updatedAt = new Date().toISOString();
      this.emitSse('pull-progress', latestJob);

      if (step === 100) {
        try {
          const tradeBatch = generateDeterministicTrades(3000);
          let added = 0;

          for (const trade of tradeBatch) {
            if (!this.store.trades[trade.tradeId]) {
              this.store.trades[trade.tradeId] = trade;
              added += 1;
            }
          }

          this.store.lastPullAt = new Date().toISOString();
          latestJob.status = 'completed';
          latestJob.progress = 100;
          latestJob.resultCount = added;
          latestJob.totalCount = Object.keys(this.store.trades).length;
          latestJob.completedAt = new Date().toISOString();
          latestJob.updatedAt = latestJob.completedAt;
          latestJob.error = null;
          this.emitSse('pull-complete', {
            jobId,
            status: 'completed',
            resultCount: added,
            totalCount: latestJob.totalCount,
            completedAt: latestJob.completedAt,
          });
        } catch (error) {
          latestJob.status = 'failed';
          latestJob.error = error.message;
          latestJob.completedAt = new Date().toISOString();
          latestJob.updatedAt = latestJob.completedAt;
          this.emitSse('pull-failed', {
            jobId,
            status: 'failed',
            error: error.message,
            completedAt: latestJob.completedAt,
          });
        }
      }
    }
  }
}

module.exports = { PullWorker };
