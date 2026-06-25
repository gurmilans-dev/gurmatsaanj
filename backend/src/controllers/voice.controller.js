/**
 * Voice controller — accepts transcribed text and runs matching.
 *
 * NOTE: We never receive raw audio. The frontend uses the Web Speech API
 * locally and sends only the resulting text to this endpoint.
 */
const matching = require('../services/matching.service');
const banidb = require('../services/banidb.service');
const config = require('../config');

function clampTranscript(t) {
  if (typeof t !== 'string') return '';
  return t.trim().slice(0, config.matching.maxQueryLength);
}

async function suggestShabads(req, res, next) {
  try {
    const transcript = clampTranscript(req.body?.transcript);
    if (!transcript) return res.status(400).json({ error: 'transcript is required.' });

    const filters = {
      source: req.body?.source || undefined,
      writer: req.body?.writer || undefined,
      raag: req.body?.raag || undefined,
    };

    const suggestions = await matching.matchShabads(transcript, filters);
    res.json({ transcript, suggestions });
  } catch (err) {
    next(err);
  }
}

async function trackLine(req, res, next) {
  try {
    const transcript = clampTranscript(req.body?.transcript);
    const shabadId = String(req.body?.shabadId || '').replace(/[^0-9A-Za-z_-]/g, '');
    if (!transcript) return res.status(400).json({ error: 'transcript is required.' });
    if (!shabadId) return res.status(400).json({ error: 'shabadId is required.' });

    // Allow caller to pre-fetch the shabad and pass verses inline to skip
    // the upstream round-trip; otherwise we fetch it ourselves.
    let verses = Array.isArray(req.body?.verses) ? req.body.verses : null;
    if (!verses) {
      const shabad = await banidb.getShabad(shabadId);
      verses = shabad.verses;
    }

    const match = matching.matchLine(verses, transcript, {
      currentLine: req.body?.currentLine,
    });
    res.json({ shabadId, ...match });
  } catch (err) {
    next(err);
  }
}

module.exports = { suggestShabads, trackLine };
