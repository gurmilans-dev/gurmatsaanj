const router = require('express').Router();
const ctrl = require('../controllers/shabad.controller');

// GET /api/banis/:id  — fetch a complete bani by BaniDB baniID.
router.get('/:id', ctrl.getBaniById);

module.exports = router;
