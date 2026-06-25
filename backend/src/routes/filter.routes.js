const router = require('express').Router();
const ctrl = require('../controllers/filter.controller');

router.get('/raags', ctrl.raags);
router.get('/writers', ctrl.writers);
router.get('/sources', ctrl.sources);

module.exports = router;
