const express = require('express');
const { getTrades, getSummary, triggerPull, handleBseCallback, streamHealth } = require('../controllers/tradeController');

const router = express.Router();

router.get('/trades', getTrades);
router.get('/summary', getSummary);
router.get('/health', streamHealth);
router.post('/pull', triggerPull);
router.post('/bse-callback', handleBseCallback);

module.exports = router;
