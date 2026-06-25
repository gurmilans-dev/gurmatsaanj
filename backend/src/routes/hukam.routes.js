const router = require('express').Router();
const ctrl = require('../controllers/shabad.controller');

// GET /api/hukamnamas/today — daily Hukam from Sri Harmandir Sahib.
router.get('/today', ctrl.getDailyHukam);

module.exports = router;
