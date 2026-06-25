const router = require('express').Router();
const ctrl = require('../controllers/remote.controller');

router.post('/command', ctrl.postCommand);
router.get('/commands', ctrl.getCommands);
// SSE stream — same data as /commands but pushed instead of polled.
router.get('/stream', ctrl.streamCommands);
router.post('/state', ctrl.postState);
router.get('/state', ctrl.getState);
router.get('/follow/:code/state', ctrl.getFollowState);
router.get('/follow/stream', ctrl.streamFollowState);
router.post('/join', ctrl.joinSession);
router.post('/leave', ctrl.leaveSession);
router.post('/kick', ctrl.kickClient);
router.post('/heartbeat', ctrl.heartbeat);
router.post('/claim', ctrl.claimControl);
router.post('/release', ctrl.releaseControl);
router.post('/grant', ctrl.grantControl);
router.post('/reset', ctrl.resetSession);

module.exports = router;
