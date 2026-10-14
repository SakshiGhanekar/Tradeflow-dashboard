const mongoose = require('mongoose');

async function connectDatabase(uri) {
  await mongoose.connect(uri);
  return mongoose.connection;
}

module.exports = { connectDatabase };
