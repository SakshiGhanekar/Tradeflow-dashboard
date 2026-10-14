const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  startedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  durationMs: { type: Number, default: 0 },
  error: { type: String, default: null },
  resultCount: { type: Number, default: 0 },
  totalCount: { type: Number, default: 0 },
  idempotencyKey: { type: String, default: null, index: true },
}, { timestamps: true });

module.exports = mongoose.model('PullJob', jobSchema);
