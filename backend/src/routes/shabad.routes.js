const router = require('express').Router();
const ctrl = require('../controllers/shabad.controller');

// GET /api/shabads/search?q=...&source=G&writer=1&raag=1
router.get('/search', ctrl.search);
// GET /api/shabads/ang/:ang
router.get('/ang/:ang', ctrl.getAng);
// GET /api/shabads/:id
router.get('/:id', ctrl.getShabad);

module.exports = router;
