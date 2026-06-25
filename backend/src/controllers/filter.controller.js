/**
 * Filter controller — exposes raags, writers and sources to populate the UI.
 */
const banidb = require('../services/banidb.service');

async function raags(_req, res, next) {
  try { res.json(await banidb.listRaags()); } catch (err) { next(err); }
}
async function writers(_req, res, next) {
  try { res.json(await banidb.listWriters()); } catch (err) { next(err); }
}
async function sources(_req, res, next) {
  try { res.json(await banidb.listSources()); } catch (err) { next(err); }
}

module.exports = { raags, writers, sources };
