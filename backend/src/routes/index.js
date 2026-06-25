const router = require('express').Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), name: 'gurmat-saanj-api' });
});

router.use('/shabads', require('./shabad.routes'));
router.use('/banis', require('./bani.routes'));
router.use('/hukamnamas', require('./hukam.routes'));
router.use('/voice', require('./voice.routes'));
router.use('/filters', require('./filter.routes'));
router.use('/remote', require('./remote.routes'));

module.exports = router;
