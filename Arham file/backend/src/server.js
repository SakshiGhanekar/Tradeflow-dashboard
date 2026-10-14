const { app, initialize } = require('./app');

const PORT = Number(process.env.PORT || 3001);

if (require.main === module) {
  (async () => {
    try {
      await initialize();
    } catch (err) {
      console.error('Warning: initialization encountered an error (continuing in file-store fallback):', err && err.message ? err.message : err);
      console.error('If you want MongoDB-backed persistence, start MongoDB and set MONGODB_URI.');
      // continue without exiting so the dev server remains usable with the file fallback
    }

    app.listen(PORT, () => {
      console.log(`Dashboard API on http://localhost:${PORT}`);
    });
  })();
}
