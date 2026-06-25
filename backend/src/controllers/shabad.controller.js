/**
 * Shabad controller — search and full-shabad endpoints.
 *
 * Search behaviour:
 *  - Auto-detects whether the user typed Gurmukhi, Roman first-letters
 *    ("mjjj"), or a full Roman/English phrase, and asks BaniDB with the
 *    appropriate searchtype (cascading to alternates if needed).
 *  - Re-ranks results with fuzzy matching so misspelled queries still surface
 *    the right Shabad rather than returning an empty page.
 */
const fuzz = require('fuzzball');

const banidb = require('../services/banidb.service');
const { normalize, normalizeLoose } = require('../utils/gurmukhi');
const config = require('../config');

function clampQuery(q) {
  if (typeof q !== 'string') return '';
  return q.trim().slice(0, config.matching.maxQueryLength);
}

/**
 * Re-rank results against the user's literal query (full + vowel-stripped).
 * Items whose normalized form contains the query as a substring are boosted.
 */
function fuzzyRerank(results, query) {
  if (!query) return results;
  const q = normalize(query);
  const qLoose = normalizeLoose(query);
  if (!q) return results;

  return results
    .map((r) => {
      const cand = normalize(r.gurmukhi);
      const candLoose = normalizeLoose(r.gurmukhi);
      const candTranslit = normalize(r.transliteration);

      // Multi-channel score
      const a = fuzz.token_set_ratio(q, cand);
      const b = fuzz.token_set_ratio(qLoose, candLoose);
      const c = candTranslit ? fuzz.token_set_ratio(q, candTranslit) : 0;
      const partial = fuzz.partial_ratio(q, cand);

      // Substring-of-query boost — exact spelling shouldn't be punished.
      const containsBoost = cand.includes(q) || candLoose.includes(qLoose) ? 8 : 0;

      const score = Math.round(
        Math.max(a, partial) * 0.55 + b * 0.25 + c * 0.20 + containsBoost
      );
      return { ...r, score: Math.min(100, score) };
    })
    .sort((a, b) => b.score - a.score);
}

async function search(req, res, next) {
  try {
    const q = clampQuery(req.query.q);
    const searchType =
      req.query.searchType !== undefined && req.query.searchType !== ''
        ? Number(req.query.searchType)
        : undefined;
    const isAng = searchType === 5;

    // Ang mode accepts a single number; everything else needs ≥2 chars.
    if (isAng) {
      if (!/^[0-9]+$/.test(q)) {
        return res.status(400).json({ error: 'Ang must be a number.' });
      }
    } else if (q.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters.' });
    }

    const raw = await banidb.search(q, {
      source: req.query.source || undefined,
      writer: req.query.writer || undefined,
      raag: req.query.raag || undefined,
      searchType,
    });

    // Ang results are page-ordered already (lineNo). Fuzzy re-rank would
    // shuffle them by text similarity, which is meaningless for a page
    // lookup — preserve the natural reading order instead.
    const results = isAng
      ? raw.slice(0, 60)
      : fuzzyRerank(raw, q).slice(0, 30);

    res.json({
      query: q,
      detectedType: isAng ? 5 : banidb.detectSearchType(q),
      results,
    });
  } catch (err) {
    next(err);
  }
}

async function getShabad(req, res, next) {
  try {
    const id = String(req.params.id || '').replace(/[^0-9A-Za-z_-]/g, '');
    if (!id) return res.status(400).json({ error: 'Invalid shabad id.' });
    const shabad = await banidb.getShabad(id);
    res.json(shabad);
  } catch (err) {
    next(err);
  }
}

async function getBaniById(req, res, next) {
  try {
    const id = String(req.params.id || '').replace(/[^0-9]/g, '');
    if (!id) return res.status(400).json({ error: 'Invalid bani id.' });
    const bani = await banidb.getBaniById(id);
    res.json(bani);
  } catch (err) {
    next(err);
  }
}

async function getDailyHukam(_req, res, next) {
  try {
    const data = await banidb.getDailyHukam();
    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function getAng(req, res, next) {
  try {
    const ang = Number(req.params.ang);
    if (!Number.isFinite(ang) || ang < 1 || ang > 1430) {
      return res.status(400).json({ error: 'Ang must be between 1 and 1430.' });
    }
    const data = await banidb.getAng(ang, {
      source: req.query.source || undefined,
      seedShabadId: req.query.seedShabadId || req.query.seed || undefined,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = { search, getShabad, getAng, getBaniById, getDailyHukam };
