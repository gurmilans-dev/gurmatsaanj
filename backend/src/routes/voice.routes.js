const router = require('express').Router();
const ctrl = require('../controllers/voice.controller');

// POST /api/voice/suggest      { transcript, source?, writer?, raag? }
router.post('/suggest', ctrl.suggestShabads);

// POST /api/voice/track-line   { transcript, shabadId, verses?, currentLine? }
router.post('/track-line', ctrl.trackLine);

module.exports = router;
