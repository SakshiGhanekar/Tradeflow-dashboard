const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  tradeId: { type: String, required: true, unique: true, index: true },
  client: { type: String, required: true },
  symbol: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0.01 },
  timestamp: { type: Date, required: true },
}, { timestamps: true });

tradeSchema.index({ symbol: 1, timestamp: -1 });
tradeSchema.index({ client: 1, timestamp: -1 });

module.exports = mongoose.model('Trade', tradeSchema);
