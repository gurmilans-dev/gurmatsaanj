import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Loader from '../../components/common/Loader/Loader';
import ConfidenceBadge from '../../components/common/ConfidenceBadge/ConfidenceBadge';
import ProjectorControls from '../../features/projector/ProjectorControls';
import ProjectorMiniPreview from '../../features/projector/ProjectorMiniPreview';
import ShabadView from '../../features/shabadView/ShabadView';
import VoiceDebugPanel from '../../features/voiceRecognition/VoiceDebugPanel';
import CalendarTodayBanner from '../../features/calendar/CalendarTodayBanner';
import {
  BANI_CATEGORIES,
  BANI_SETS,
  BANI_TAG_LABELS,
  BANI_UI_TEXT,
  getBaniSet,
  getBaniVariantForId,
  getBaniVariantGroupForId,
} from '../../data/baniSets';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import useVoiceRecognition from '../../hooks/useVoiceRecognition';
import { trimToWords, matchedWordPositions, highlightSegments } from '../../utils/gurmukhi';
import '../ShabadPage/ShabadPage.css';
import './BaniPage.css';

const BANI_LOAD_CONCURRENCY = 4;
const BANI_LOCAL_TRACK_INTERVAL_MS = 130;
const BANI_LOCAL_MIN_CONFIDENCE = 48;
const BANI_PROGRESS_STORAGE_KEY = 'gurmat-saanj.baniProgress.v1';

function readBaniProgressStore() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(BANI_PROGRESS_STORAGE_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch {
    return {};
  }
}

function getStoredBaniProgress(id) {
  if (!id) return null;
  const item = readBaniProgressStore()[id];
  if (!item || !Number.isFinite(Number(item.lineIndex))) return null;
  return {
    ...item,
    lineIndex: Math.max(0, Number(item.lineIndex)),
    verseCount: Number(item.verseCount) || 0,
  };
}

function writeStoredBaniProgress(id, progress) {
  if (typeof window === 'undefined' || !id) return;
  try {
    const store = readBaniProgressStore();
    store[id] = progress;
    window.localStorage.setItem(BANI_PROGRESS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Best-effort only. Reading must never depend on localStorage availability.
  }
}

function clearStoredBaniProgress(id) {
  if (typeof window === 'undefined' || !id) return;
  try {
    const store = readBaniProgressStore();
    delete store[id];
    window.localStorage.setItem(BANI_PROGRESS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage failures.
  }
}

function resetPageScroll() {
  if (typeof window === 'undefined') return;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  document.querySelector('.site-main')?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
}

const MicIcon = () => (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path d="M10 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" />
    <path d="M5 9v1a5 5 0 0 0 10 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M10 15v3M7 18h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const MicOffIcon = () => (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path d="M10 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" />
    <path d="M5 9v1a5 5 0 0 0 10 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M10 15v3M7 18h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="3.5" y1="3.5" x2="16.5" y2="16.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

// ── Bani-page language helpers (EN ⇄ ਪੰ) ───────────────────────────────
//
// The actual lang state lives in AppContext now so any page can read/write
// it. This hook just builds bani-domain helpers (ui-text lookup + tag
// translation) on top of the global `lang`. No local state here.
function useBaniLang() {
  const { lang, setLang } = useApp();
  // t(en, pa) — pick the active form; pa falls back to en when missing.
  const t = useCallback((en, pa) => (lang === 'pa' ? (pa ?? en) : en), [lang]);
  // ui(key) — read from BANI_UI_TEXT.
  const ui = useCallback((key) => {
    const entry = BANI_UI_TEXT[key];
    if (!entry) return key;
    return lang === 'pa' ? (entry.pa || entry.en) : entry.en;
  }, [lang]);
  // tag(value) — translate an English tag string.
  const tag = useCallback((value) => {
    if (lang !== 'pa') return value;
    return BANI_TAG_LABELS[value] || value;
  }, [lang]);
  return { lang, setLang, t, ui, tag };
}

function rangeLabel(segment) {
  if (segment.type === 'angRange') {
    return segment.start === segment.end ? `Ang ${segment.start}` : `Ang ${segment.start}-${segment.end}`;
  }
  if (segment.type === 'shabadIdRange') {
    return `Shabad ${segment.start}-${segment.end}`;
  }
  if (segment.type === 'shabadList') {
    return `${segment.shabadIds?.length || 0} Shabad sections`;
  }
  return segment.shabadId ? `Shabad ${segment.shabadId}` : '';
}

function withSection(verses, sectionTitle, sourceLabel) {
  return (verses || []).map((verse, index) => ({
    ...verse,
    verseId: `bani-${sectionTitle}-${sourceLabel}-${verse.verseId ?? verse.shabadId ?? index}`,
    sectionTitle,
    sectionMeta: sourceLabel,
  }));
}

function applySegmentSlice(verses, segment) {
  let next = Array.isArray(verses) ? verses : [];
  const skip = Math.max(0, Number(segment.skip || 0) || 0);
  const take = Number(segment.take || 0) || 0;
  const dropLast = Math.max(0, Number(segment.dropLast || 0) || 0);
  if (skip > 0) next = next.slice(skip);
  if (take > 0) next = next.slice(0, take);
  if (dropLast > 0) next = next.slice(0, Math.max(0, next.length - dropLast));
  return next;
}

function normalizeBaniText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0a3c\u0a3e-\u0a4d\u0a70\u0a71\u0964\u0965]/g, '')
    .replace(/[^a-z0-9\u0a00-\u0a7f\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baniTokens(text) {
  return normalizeBaniText(text).split(/\s+/).filter(Boolean);
}

function tokenSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b))) return 0.88;
  let common = 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  for (const ch of new Set(Array.from(shorter))) {
    if (longer.includes(ch)) common += 1;
  }
  return common / Math.max(1, Math.max(a.length, b.length));
}

function scoreBaniText(queryTokens, candidateText) {
  const candidateTokens = baniTokens(candidateText);
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const queryText = queryTokens.join(' ');
  const candidateJoined = candidateTokens.join(' ');

  let overlap = 0;
  for (const q of queryTokens) {
    const best = candidateTokens.reduce((max, c) => Math.max(max, tokenSimilarity(q, c)), 0);
    if (best >= 0.78) overlap += best;
  }
  const overlapScore = (overlap / queryTokens.length) * 100;

  let cursor = 0;
  let orderedHits = 0;
  for (const c of candidateTokens) {
    const q = queryTokens[cursor];
    if (!q) break;
    if (tokenSimilarity(q, c) >= 0.76) {
      orderedHits += 1;
      cursor += 1;
    }
  }
  const orderedScore = (orderedHits / queryTokens.length) * 100;
  const phraseScore =
    queryText.length >= 4 && candidateJoined.includes(queryText)
      ? 100
      : queryText.length >= 4 && candidateJoined.includes(queryTokens.slice(0, 2).join(' '))
        ? 80
        : 0;

  return Math.round(Math.max(overlapScore * 0.68 + orderedScore * 0.32, phraseScore));
}

function matchBaniLineLocally(verses, transcript, currentLine = -1) {
  const queryTokens = baniTokens(transcript).slice(-5);
  if (!Array.isArray(verses) || !verses.length || queryTokens.length === 0) {
    return {
      lineIndex: -1,
      confidence: 0,
      tracked: false,
      debug: {
        status: 'listening',
        reason: 'transcript-too-short',
        transcriptTail: transcript || '',
        candidates: Array.isArray(verses) ? verses.length : 0,
      },
    };
  }

  let best = { index: -1, score: 0 };
  let second = { index: -1, score: 0 };
  verses.forEach((verse, index) => {
    const gurmukhiScore = scoreBaniText(queryTokens, verse?.gurmukhi || '');
    const translitScore = scoreBaniText(queryTokens, verse?.transliteration || '');
    let score = Math.max(gurmukhiScore, translitScore);

    if (currentLine >= 0) {
      const distance = Math.abs(index - currentLine);
      if (distance === 0) score += 6;
      else if (distance === 1) score += 6;
      else if (distance === 2) score += 3;
      else score -= Math.min(18, (distance - 2) * 1.6);
    } else if (index === 0) {
      score += 3;
    }

    if (score > best.score) {
      second = best;
      best = { index, score };
    } else if (score > second.score) {
      second = { index, score };
    }
  });

  const confidence = Math.max(0, Math.min(100, Math.round(best.score)));
  const tracked = confidence >= BANI_LOCAL_MIN_CONFIDENCE;
  return {
    lineIndex: best.index,
    confidence,
    tracked,
    debug: {
      status: tracked ? 'tracked' : 'no-match',
      state: tracked ? 'accepted' : 'rejected',
      reason: tracked ? 'local-bani-match' : 'confidence-too-low',
      transcriptTail: queryTokens.join(' '),
      candidates: verses.length,
      currentLineIndex: currentLine,
      lineIndex: best.index,
      score: confidence,
      secondScore: Math.max(0, Math.min(100, Math.round(second.score || 0))),
      gap: Math.round(best.score - (second.score || 0)),
      distance: currentLine >= 0 && best.index >= 0 ? Math.abs(best.index - currentLine) : null,
      target: {
        type: 'bani',
        groupId: 'bani',
        localIndex: best.index,
      },
    },
  };
}

function useLocalBaniLineTracking({
  verses,
  transcript,
  active,
  anchorLineIndex = null,
  anchorVersion = 0,
  resetKey = '',
  intervalMs = BANI_LOCAL_TRACK_INTERVAL_MS,
}) {
  const [lineIndex, setLineIndex] = useState(-1);
  const [confidence, setConfidence] = useState(0);
  const [tracked, setTracked] = useState(false);
  const [debug, setDebug] = useState({ status: 'idle' });
  const lineIndexRef = useRef(-1);
  const lastRunRef = useRef(0);
  const lastTailRef = useRef('');
  const timerRef = useRef(null);
  const prevAnchorVersionRef = useRef(anchorVersion);

  useEffect(() => {
    lineIndexRef.current = lineIndex;
  }, [lineIndex]);

  useEffect(() => {
    lineIndexRef.current = -1;
    lastRunRef.current = 0;
    lastTailRef.current = '';
    if (timerRef.current) clearTimeout(timerRef.current);
    setLineIndex(-1);
    setConfidence(0);
    setTracked(false);
    setDebug({ status: 'idle', reason: 'reset' });
  }, [resetKey]);

  useEffect(() => {
    if (!Number.isFinite(Number(anchorVersion)) || anchorVersion === prevAnchorVersionRef.current) return;
    prevAnchorVersionRef.current = anchorVersion;
    if (!verses?.length) return;
    const next = Math.min(verses.length - 1, Math.max(0, Number(anchorLineIndex) || 0));
    lineIndexRef.current = next;
    lastTailRef.current = '';
    setLineIndex(next);
    setConfidence(0);
    setTracked(false);
    setDebug({ status: 'manual-anchor', reason: 'line-selected', lineIndex: next });
  }, [anchorLineIndex, anchorVersion, verses?.length]);

  useEffect(() => {
    if (!active || !verses?.length) {
      setDebug((prev) => (prev?.status === 'idle' ? prev : { ...prev, status: 'idle' }));
      return undefined;
    }
    const latest = String(transcript || '').trim();
    if (latest.length < 2) {
      setDebug((prev) => (
        prev?.status === 'listening' && prev?.reason === 'waiting-for-transcript'
          ? prev
          : { ...prev, status: 'listening', reason: 'waiting-for-transcript' }
      ));
      return undefined;
    }

    const run = () => {
      const rawTail = String(transcript || '').trim().split(/\s+/).slice(-5).join(' ');
      const tail = normalizeBaniText(rawTail);
      if (tail.length < 2 || tail === lastTailRef.current) return;
      lastTailRef.current = tail;
      lastRunRef.current = Date.now();
      setDebug((prev) => ({
        ...prev,
        status: 'matching',
        reason: 'local-bani-match',
        transcriptTail: rawTail,
        candidates: verses.length,
        currentLineIndex: lineIndexRef.current,
      }));

      const result = matchBaniLineLocally(verses, rawTail, lineIndexRef.current);
      setConfidence(result.confidence);
      setTracked(result.tracked);
      setDebug(result.debug);
      if (result.tracked) {
        lineIndexRef.current = result.lineIndex;
        setLineIndex(result.lineIndex);
      } else if (lineIndexRef.current < 0) {
        setLineIndex(-1);
      }
    };

    const elapsed = Date.now() - lastRunRef.current;
    if (elapsed >= intervalMs) {
      run();
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(run, intervalMs - elapsed);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, intervalMs, transcript, verses]);

  return { lineIndex, confidence, tracked, status: debug?.status || 'idle', debug };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryBaniRequest(request, attempts = 2) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await request();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(350 * (i + 1));
    }
  }
  throw lastError;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Jump-to helpers (digit conversion + paudi/mahalla index + query parser) ──

const ASCII_TO_GURMUKHI_DIGIT = { 0: '੦', 1: '੧', 2: '੨', 3: '੩', 4: '੪', 5: '੫', 6: '੬', 7: '੭', 8: '੮', 9: '੯' };
const GURMUKHI_TO_ASCII_DIGIT = Object.fromEntries(
  Object.entries(ASCII_TO_GURMUKHI_DIGIT).map(([a, g]) => [g, a])
);
function gurmukhiDigitsToAscii(value) {
  return String(value || '').replace(/[੦-੯]/g, (g) => GURMUKHI_TO_ASCII_DIGIT[g] || g);
}

// Paudi-end marker: the last `॥<digits>॥` on a line means that verse closes
// paudi N, so paudi N+1 starts at the next verse. Paudi 1 = verses[0].
const PAUDI_END_RE = /॥\s*([0-9]+)\s*॥\s*$/;
const MAHALLA_RE = /(?:ਮਹਲਾ|ਮ:?)\s*([0-9]+)/;
const ASTPADI_RE = /ਅਸਟਪਦੀ/;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
const SHORTCUT_LABEL = IS_MAC ? '⌘K' : 'Ctrl K';

function buildBaniLocationIndex(verses) {
  const paudiIndex = {};
  const mahallaIndex = {};
  const astpadiIndex = {};
  if (!Array.isArray(verses) || verses.length === 0) {
    return { paudiIndex, mahallaIndex, astpadiIndex, paudiCount: 0, astpadiCount: 0 };
  }

  paudiIndex[1] = 0;
  let nextPaudi = 2;
  let paudiCount = 1;
  let astpadiCount = 0;

  for (let i = 0; i < verses.length; i += 1) {
    const raw = gurmukhiDigitsToAscii(verses[i]?.gurmukhi || '').trim();
    if (!raw) continue;

    const paudiMatch = raw.match(PAUDI_END_RE);
    if (paudiMatch && i + 1 < verses.length) {
      paudiIndex[nextPaudi] = i + 1;
      paudiCount = nextPaudi;
      nextPaudi += 1;
    } else if (paudiMatch) {
      paudiCount = Math.max(paudiCount, Number(paudiMatch[1]) || paudiCount);
    }

    const mahallaMatch = raw.match(MAHALLA_RE);
    if (mahallaMatch) {
      const n = Number(mahallaMatch[1]);
      if (Number.isFinite(n) && mahallaIndex[n] === undefined) mahallaIndex[n] = i;
    }

    if (ASTPADI_RE.test(verses[i]?.gurmukhi || '')) {
      astpadiCount += 1;
      astpadiIndex[astpadiCount] = i;
    }
  }

  return { paudiIndex, mahallaIndex, astpadiIndex, paudiCount, astpadiCount };
}

function parseJumpQuery(rawQuery, verses, locationIndex) {
  const raw = String(rawQuery || '').trim();
  if (!raw || !Array.isArray(verses) || verses.length === 0) return [];

  const normalized = gurmukhiDigitsToAscii(raw);
  const { paudiIndex, mahallaIndex, astpadiIndex, paudiCount, astpadiCount } = locationIndex || {};
  const suggestions = [];
  const seenLines = new Set();
  const push = (s) => {
    if (s == null || seenLines.has(s.index)) return;
    seenLines.add(s.index);
    suggestions.push(s);
  };

  const lineMatch = normalized.match(/^\s*(?:line\s*)?(\d+)\s*$/i);
  const paudiMatch = normalized.match(/^\s*(?:p|paudi|pauri|pauree)\s*(\d+)\s*$/i);
  const mahallaMatch = normalized.match(/^\s*(?:m|mahalla|mahala|mehla|mahla)\s*[: ]?\s*(\d+)\s*$/i);
  const astpadiMatch = normalized.match(/^\s*(?:a|ast|asht|astpadi|asthpadi|ashtpadi|ashtapadi)\s*(\d+)\s*$/i);
  const gurmukhiAstpadiMatch = /ਅਸਟਪਦੀ/.test(raw);

  if (astpadiMatch || (gurmukhiAstpadiMatch && /\d/.test(normalized))) {
    const n = astpadiMatch
      ? Number(astpadiMatch[1])
      : Number(normalized.match(/(\d+)/)?.[1] || NaN);
    if (Number.isFinite(n) && astpadiIndex && astpadiIndex[n] !== undefined) {
      push({ kind: 'astpadi', label: `Astpadi ${n}`, index: astpadiIndex[n] });
    } else if (astpadiCount > 0 && Number.isFinite(n)) {
      const available = Object.keys(astpadiIndex || {}).map(Number).sort((a, b) => a - b);
      const nearest = available.reduce((best, k) => (Math.abs(k - n) < Math.abs(best - n) ? k : best), available[0]);
      if (nearest !== undefined) {
        push({ kind: 'astpadi', label: `Astpadi ${nearest} (closest, of ${astpadiCount})`, index: astpadiIndex[nearest] });
      }
    }
  } else if (paudiMatch) {
    const n = Number(paudiMatch[1]);
    if (paudiIndex && paudiIndex[n] !== undefined) {
      push({ kind: 'paudi', label: `Paudi ${n}`, index: paudiIndex[n] });
    } else if (paudiCount > 0) {
      const available = Object.keys(paudiIndex || {}).map(Number).sort((a, b) => a - b);
      const nearest = available.reduce((best, k) => (Math.abs(k - n) < Math.abs(best - n) ? k : best), available[0]);
      if (nearest !== undefined) {
        push({ kind: 'paudi', label: `Paudi ${nearest} (closest, of ${paudiCount})`, index: paudiIndex[nearest] });
      }
    }
  } else if (mahallaMatch || /ਮਹਲਾ|ਮ:/.test(raw)) {
    const m = (mahallaMatch && Number(mahallaMatch[1]))
      || Number(gurmukhiDigitsToAscii(raw).match(/(\d+)/)?.[1] || NaN);
    if (Number.isFinite(m) && mahallaIndex && mahallaIndex[m] !== undefined) {
      push({ kind: 'mahalla', label: `Mahalla ${m}`, index: mahallaIndex[m] });
    }
  } else if (lineMatch) {
    const n = Math.max(1, Math.min(verses.length, Number(lineMatch[1])));
    push({ kind: 'line', label: `Line ${n}`, index: n - 1 });
  }

  // Free-text pankti search (also runs alongside line-number to surface context).
  const queryTokens = baniTokens(raw);
  if (queryTokens.length >= 1) {
    const scored = verses
      .map((verse, index) => {
        const gurmukhiScore = scoreBaniText(queryTokens, verse?.gurmukhi || '');
        const translitScore = scoreBaniText(queryTokens, verse?.transliteration || '');
        return { index, score: Math.max(gurmukhiScore, translitScore) };
      })
      .filter((row) => row.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    for (const row of scored) {
      push({ kind: 'pankti', label: `Line ${row.index + 1}`, index: row.index, score: row.score });
    }
  }

  return suggestions.slice(0, 6);
}

function shabadIdsForSegment(segment) {
  if (segment.type === 'shabad') return [segment.shabadId].filter(Boolean);
  if (segment.type === 'shabadList') return (segment.shabadIds || []).filter(Boolean);
  if (segment.type === 'shabadIdRange') {
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    const step = start <= end ? 1 : -1;
    const ids = [];
    for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
      ids.push(String(value));
    }
    return ids;
  }
  return [];
}

function BaniCard({ item, lang, tag, highlighted = false }) {
  const desc = lang === 'pa' ? (item.descriptionPa || item.description) : item.description;
  const variantGroup = getBaniVariantGroupForId(item.id);
  return (
    <Link
      id={`bani-card-${item.id}`}
      to={`/bani/${item.id}`}
      className={`bani-card${highlighted ? ' bani-card-highlighted' : ''}`}
    >
      <span className="bani-card-chip-row">
        <span className="bani-card-chip">{item.title}</span>
        {variantGroup && variantGroup.variants.length > 1 && (
          <small className="bani-card-variant-count">{variantGroup.variants.length} versions</small>
        )}
      </span>
      {item.titlePa && (
        <p className="bani-card-title-pa gurmukhi" lang="pa">{item.titlePa}</p>
      )}
      {desc && (
        <p className="bani-card-desc" lang={lang}>{desc}</p>
      )}
      {Array.isArray(item.tags) && item.tags.length > 0 && (
        <span className="bani-card-tags">
          {item.tags.slice(0, 3).map((value) => (
            <small key={value} lang={lang}>{tag ? tag(value) : value}</small>
          ))}
        </span>
      )}
    </Link>
  );
}

function BaniJumpRowText({ text, query, highlight }) {
  if (!highlight || !text || !query) return text || null;
  const matched = matchedWordPositions(text, query, 'auto');
  if (matched.size === 0) return text;
  return highlightSegments(text, matched).map((seg, i) => (
    seg.match
      ? <strong key={i} className="bani-jump-match">{seg.text}</strong>
      : <span key={i}>{seg.text}</span>
  ));
}

function BaniJumpPanel({ query, onQueryChange, suggestions, onJump, onClose, inputRef, panelRef }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    if (suggestions.length === 0) return;
    onJump(suggestions[0]);
  };

  return (
    <div className="bani-jump-panel" role="dialog" aria-label="Find in bani" ref={panelRef}>
      <div className="bani-jump-panel-head">
        <p className="section-eyebrow">Find in bani</p>
        <button type="button" className="bani-jump-close" onClick={onClose} aria-label="Close find">×</button>
      </div>

      <form className="bani-jump-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="bani-jump-input"
          placeholder="Type 27, paudi 4, astpadi 5, mahalla 1, or a pankti…"
          aria-label="Search line, paudi, astpadi, mahalla, or pankti"
          autoComplete="off"
          spellCheck="false"
        />
      </form>

      {!query.trim() ? (
        <p className="bani-jump-hint">Try: <span>27</span> · <span>paudi 4</span> · <span>astpadi 5</span> · <span>mahalla 1</span> · a pankti</p>
      ) : suggestions.length === 0 ? (
        <p className="bani-jump-empty">No match in this bani — try a number or a pankti.</p>
      ) : (
        <ul className="bani-jump-list">
          {suggestions.map((s) => (
            <li key={`${s.kind}-${s.index}-${s.label}`}>
              <button type="button" className="bani-jump-suggestion" onClick={() => onJump(s)}>
                <span className={`bani-jump-chip bani-jump-chip-${s.kind}`}>{s.label}</span>
                <span className="bani-jump-gurmukhi gurmukhi" lang="pa">
                  <BaniJumpRowText
                    text={trimToWords(s.gurmukhi || '', 10)}
                    query={query}
                    highlight={s.kind === 'pankti'}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BaniCategorySection({ category, items, lang, tag, highlightedId = '' }) {
  const label = lang === 'pa' ? (category.labelPa || category.label) : category.label;
  return (
    <section className="bani-category-section" id={`bani-${category.id}`}>
      <header className="bani-category-head">
        <div>
          <p className="section-eyebrow" lang={lang}>{label}</p>
          <h2 lang={lang}>{label}</h2>
        </div>
      </header>
      <div className="bani-grid" aria-label={`${label} Bani`}>
        {items.map((item) => (
          <BaniCard key={item.id} item={item} lang={lang} tag={tag} highlighted={item.id === highlightedId} />
        ))}
      </div>
    </section>
  );
}

async function loadShabadIdSegments(segment, onProgress) {
  const ids = shabadIdsForSegment(segment);
  const sourceLabel = segment.sourceLabel || rangeLabel(segment);
  const results = await mapWithConcurrency(ids, BANI_LOAD_CONCURRENCY, async (shabadId, order) => {
    try {
      const data = await retryBaniRequest(() => api.getShabad(shabadId));
      onProgress?.({ ok: true });
      return {
        order,
        verses: withSection(applySegmentSlice(data?.verses || [], segment), segment.title, sourceLabel),
        failed: null,
      };
    } catch {
      onProgress?.({ ok: false });
      return { order, verses: [], failed: `Shabad ${shabadId}` };
    }
  });

  return {
    verses: results
      .filter(Boolean)
      .sort((a, b) => a.order - b.order)
      .flatMap((item) => item.verses),
    failed: results.map((item) => item?.failed).filter(Boolean),
  };
}

async function loadBaniSegment(segment, onProgress) {
  if (['shabad', 'shabadList', 'shabadIdRange'].includes(segment.type)) {
    return loadShabadIdSegments(segment, onProgress);
  }

  if (segment.type === 'bani') {
    const sourceLabel = segment.sourceLabel || segment.title || `Bani ${segment.baniId}`;
    try {
      const data = await retryBaniRequest(() => api.getBaniById(segment.baniId));
      onProgress?.({ ok: true });
      return {
        verses: withSection(applySegmentSlice(data?.verses || [], segment), segment.title, sourceLabel),
        failed: [],
      };
    } catch {
      onProgress?.({ ok: false });
      return { verses: [], failed: [`Bani ${segment.baniId}`] };
    }
  }

  if (segment.type === 'static') {
    const sourceLabel = segment.sourceLabel || rangeLabel(segment) || segment.title || 'Local Bani text';
    const rawLines = Array.isArray(segment.lines) ? segment.lines : [];
    const verses = rawLines
      .map((line, index) => {
        const item = typeof line === 'string' ? { gurmukhi: line } : (line || {});
        return {
          shabadId: `static-${segment.title || 'bani'}`,
          verseId: `static-${segment.title || 'bani'}-${index + 1}`,
          lineNo: index + 1,
          pageNo: null,
          gurmukhi: item.gurmukhi || item.text || '',
          vishraams: item.vishraams || [],
          transliteration: item.transliteration || '',
          translationEn: item.translationEn || '',
          translationPa: item.translationPa || '',
          raag: '',
          writer: '',
          source: sourceLabel,
          sourceId: 'LOCAL',
        };
      })
      .filter((line) => line.gurmukhi);
    onProgress?.({ ok: true });
    return {
      verses: withSection(applySegmentSlice(verses, segment), segment.title, sourceLabel),
      failed: [],
    };
  }

  if (segment.type === 'angRange') {
    const start = Math.min(Number(segment.start), Number(segment.end));
    const end = Math.max(Number(segment.start), Number(segment.end));
    const angs = Array.from({ length: end - start + 1 }, (_, index) => start + index);
    const results = await mapWithConcurrency(angs, BANI_LOAD_CONCURRENCY, async (ang) => {
      try {
        const data = await retryBaniRequest(() => api.getAng(ang, { source: segment.source || undefined }));
        onProgress?.({ ok: true });
        return {
          ang,
          verses: withSection(data?.verses || [], segment.title, `Ang ${ang}`),
          failed: null,
        };
      } catch {
        onProgress?.({ ok: false });
        return { ang, verses: [], failed: `Ang ${ang}` };
      }
    });

    return {
      verses: results
        .filter(Boolean)
        .sort((a, b) => a.ang - b.ang)
        .flatMap((item) => item.verses),
      failed: results.map((item) => item?.failed).filter(Boolean),
    };
  }

  return { verses: [], failed: [] };
}

export default function BaniPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const set = id ? getBaniSet(id) : null;
  const {
    voice,
    setEditableTranscript,
    display,
    updateDisplay,
    setSelectedShabad,
    setActiveLine,
    observeProjectorTranscript,
    remoteLineCommand,
    pushToast,
    openProjector,
    focusProjector,
    projectorWindowOpen,
    setRemoteMicTargetGetter,
  } = useApp();

  const viewerVoice = useVoiceRecognition({ lang: 'pa-IN', wordLimit: 0 });
  const pageVoice = viewerVoice;
  const viewerVoiceRef = useRef(viewerVoice);
  useEffect(() => { viewerVoiceRef.current = viewerVoice; }, [viewerVoice]);
  useEffect(() => {
    if (!setRemoteMicTargetGetter) return undefined;
    setRemoteMicTargetGetter(() => viewerVoiceRef.current);
    return () => setRemoteMicTargetGetter(null);
  }, [setRemoteMicTargetGetter]);

  const [bani, setBani] = useState(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [progress, setProgress] = useState({ loaded: 0, total: 0, failed: 0 });
  const [error, setError] = useState(null);
  const [baniSearch, setBaniSearch] = useState('');
  const [manualLine, setManualLine] = useState(null);
  const [manualAnchorVersion, setManualAnchorVersion] = useState(0);
  const [readLineIndex, setReadLineIndex] = useState(0);
  const [readerScale, setReaderScale] = useState(1);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpQuery, setJumpQuery] = useState('');
  const [displayOpen, setDisplayOpen] = useState(false);
  const [resumePrompt, setResumePrompt] = useState(null);
  const [highlightedBaniId, setHighlightedBaniId] = useState('');
  const [voiceDebugOpen, setVoiceDebugOpen] = useState(false);
  const returnBaniId = !id ? location.state?.fromBaniId || '' : '';
  const hasRouteLine = searchParams.has('line');
  const routeLineIndex = Math.max(0, Number(searchParams.get('line') || 0) || 0);
  const { lang, setLang, t, ui, tag } = useBaniLang();
  const manualLineTimerRef = useRef(null);
  const jumpPanelRef = useRef(null);
  const jumpInputRef = useRef(null);
  const jumpToggleRef = useRef(null);
  const displayPopoverRef = useRef(null);
  const displayToggleRef = useRef(null);
  const variantGroup = useMemo(() => (set ? getBaniVariantGroupForId(set.id) : null), [set]);
  const currentVariant = useMemo(() => (set ? getBaniVariantForId(set.id) : null), [set]);
  const baniGroups = useMemo(() => {
    const fallbackCategory =
      BANI_CATEGORIES.find((category) => category.id === 'other-banis') ||
      { id: 'uncategorized', label: 'Other Banis' };
    const groups = new Map(
      BANI_CATEGORIES.map((category) => [category.id, { category, items: [] }])
    );
    if (!groups.has(fallbackCategory.id)) {
      groups.set(fallbackCategory.id, { category: fallbackCategory, items: [] });
    }

    const seen = new Set();
    const sourceOrder = new Map(BANI_SETS.map((item, index) => [item.id, index]));
    BANI_SETS.forEach((item) => {
      if (!item?.id || seen.has(item.id)) return;
      seen.add(item.id);
      const targetId = groups.has(item.categoryId) ? item.categoryId : fallbackCategory.id;
      groups.get(targetId).items.push(item);
    });

    groups.forEach((group) => {
      group.items.sort((a, b) => {
        const orderA = Number.isFinite(Number(a.categoryOrder)) ? Number(a.categoryOrder) : 999;
        const orderB = Number.isFinite(Number(b.categoryOrder)) ? Number(b.categoryOrder) : 999;
        if (orderA !== orderB) return orderA - orderB;
        return (sourceOrder.get(a.id) || 0) - (sourceOrder.get(b.id) || 0);
      });
    });

    return Array.from(groups.values()).filter((group) => group.items.length > 0);
  }, []);

  const baniSearchResults = useMemo(() => {
    const q = baniSearch.trim().toLowerCase();
    if (!q) return null;
    const matches = [];
    for (const group of baniGroups) {
      for (const item of group.items) {
        const haystack = [
          item.title,
          item.titlePa,
          item.description,
          ...(Array.isArray(item.tags) ? item.tags : []),
        ].filter(Boolean).join('   ').toLowerCase();
        if (haystack.includes(q) || (item.titlePa || '').includes(baniSearch.trim())) {
          matches.push(item);
        }
      }
    }
    return matches;
  }, [baniGroups, baniSearch]);

  useEffect(() => {
    voice.stop?.();
    voice.reset?.();
    setEditableTranscript?.('');
    voice.setWordLimit?.(7);
    viewerVoice.setWordLimit?.(0);
    return () => {
      viewerVoice.stop?.();
      viewerVoice.reset?.();
      observeProjectorTranscript?.('');
      if (manualLineTimerRef.current) clearTimeout(manualLineTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (id || typeof window === 'undefined') return undefined;

    const scrollToReturnBani = () => {
      if (!returnBaniId) {
        resetPageScroll();
        return;
      }
      const card = document.getElementById(`bani-card-${returnBaniId}`);
      if (!card) {
        resetPageScroll();
        return;
      }
      card.scrollIntoView({ behavior: 'auto', block: 'center' });
    };

    setHighlightedBaniId(returnBaniId);
    scrollToReturnBani();
    const frame = window.requestAnimationFrame(scrollToReturnBani);
    const timeout = window.setTimeout(scrollToReturnBani, 120);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [id, returnBaniId]);

  useEffect(() => {
    observeProjectorTranscript?.(pageVoice.isListening ? pageVoice.transcript : '');
  }, [observeProjectorTranscript, pageVoice.isListening, pageVoice.transcript]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError(null);
      setBani(null);
      setResumePrompt(null);
      return undefined;
    }
    if (!set) {
      setLoading(false);
      setError('This Bani set is not configured yet.');
      setBani(null);
      setResumePrompt(null);
      return undefined;
    }

    let cancelled = false;
    const total = set.segments.reduce((sum, segment) => {
      if (segment.type === 'angRange') return sum + Math.abs(Number(segment.end) - Number(segment.start)) + 1;
      if (['shabad', 'shabadList', 'shabadIdRange'].includes(segment.type)) {
        return sum + shabadIdsForSegment(segment).length;
      }
      return sum + 1;
    }, 0);
    setProgress({ loaded: 0, total, failed: 0 });
    setLoading(true);
    setError(null);
    setBani(null);
    setManualLine(null);
    setReadLineIndex(0);
    setResumePrompt(null);
    pageVoice.reset?.();

    (async () => {
      const verses = [];
      const failedSections = [];
      let loaded = 0;
      let failed = 0;
      const tick = ({ ok }) => {
        loaded += 1;
        if (!ok) failed += 1;
        if (!cancelled) setProgress({ loaded, total, failed });
      };

      for (const segment of set.segments) {
        // eslint-disable-next-line no-await-in-loop
        const result = await loadBaniSegment(segment, tick);
        verses.push(...result.verses);
        failedSections.push(...result.failed);
      }

      if (!verses.length) {
        throw new Error('No Bani lines loaded. Please check the backend/API connection and try again.');
      }

      if (cancelled) return;
      const data = {
        meta: {
          shabadId: `bani-${set.id}`,
          title: set.title,
          raag: 'Bani mode',
          writer: '',
          source: failedSections.length
            ? `${set.title} - ${failedSections.length} section(s) skipped`
            : set.title,
          pageNo: null,
          remoteKind: 'bani',
          remoteMode: 'bani',
          isKatha: false,
        },
        verses,
        navigation: {},
        baniSetId: set.id,
      };
      setBani(data);
      setSelectedShabad(data);
      if (hasRouteLine) {
        const nextLine = Math.min(verses.length - 1, routeLineIndex);
        setManualLine(nextLine);
        setReadLineIndex(nextLine);
        setManualAnchorVersion((version) => version + 1);
        if (manualLineTimerRef.current) clearTimeout(manualLineTimerRef.current);
        manualLineTimerRef.current = setTimeout(() => setManualLine(null), 900);
        setResumePrompt(null);
      }
      const storedProgress = getStoredBaniProgress(set.id);
      if (!hasRouteLine && (
        storedProgress &&
        storedProgress.lineIndex > 0 &&
        storedProgress.lineIndex < verses.length - 1
      )) {
        setResumePrompt({
          lineIndex: storedProgress.lineIndex,
          lineNumber: storedProgress.lineIndex + 1,
          verseCount: verses.length,
          updatedAt: storedProgress.updatedAt || null,
        });
      } else if (!hasRouteLine && storedProgress?.lineIndex >= verses.length - 1) {
        clearStoredBaniProgress(set.id);
      }
      if (failedSections.length) {
        pushToast?.({
          kind: 'info',
          title: 'Bani opened with missing sections',
          message: `${failedSections.slice(0, 3).join(', ')}${failedSections.length > 3 ? '...' : ''} did not load. Try again to fill cached sections.`,
          timeoutMs: 6500,
        });
      }
    })()
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.response?.data?.error || err.message || 'Could not load this Bani set.';
        setError(msg);
        pushToast?.({ kind: 'error', title: 'Could not open Bani', message: msg });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRouteLine, id, pushToast, routeLineIndex, set?.id, setSelectedShabad]);

  // Memoise so the array reference is stable when `bani` hasn't changed.
  // Without this, every render produces a fresh `[]` (when bani is null) or a
  // fresh derived array, which retriggers any effect that depends on `verses`
  // — notably the setActiveLine effect below — causing a render loop.
  const verses = useMemo(() => bani?.verses || [], [bani]);
  const verseCount = verses.length;
  const tracking = useLocalBaniLineTracking({
    verses,
    transcript: pageVoice.transcript,
    active: Boolean(id && pageVoice.isListening && !loading && !error && verseCount),
    anchorLineIndex: manualLine,
    anchorVersion: manualAnchorVersion,
    resetKey: set?.id || '',
  });
  const activeIndex = manualLine !== null ? manualLine : tracking.lineIndex;
  const isManual = manualLine !== null;

  useEffect(() => {
    if (tracking.tracked && activeIndex >= 0) {
      setReadLineIndex(Math.min(verseCount - 1, Math.max(0, activeIndex)));
    }
  }, [activeIndex, tracking.tracked, verseCount]);

  useEffect(() => {
    if (!verses.length || activeIndex < 0 || activeIndex >= verses.length) {
      setActiveLine({ index: -1, text: '', tracked: false });
      return;
    }
    setActiveLine({
      index: activeIndex,
      text: verses[activeIndex]?.gurmukhi || '',
      tracked: !isManual && tracking.tracked,
    });
  }, [activeIndex, isManual, setActiveLine, tracking.tracked, verses]);

  useEffect(() => {
    if (!set?.id || !bani || loading || error || !verseCount) return;
    const safeReadIndex = Math.min(verseCount - 1, Math.max(0, Number(readLineIndex) || 0));
    if (safeReadIndex >= verseCount - 1) {
      clearStoredBaniProgress(set.id);
      return;
    }
    writeStoredBaniProgress(set.id, {
      lineIndex: safeReadIndex,
      verseCount,
      title: set.title,
      updatedAt: Date.now(),
    });
  }, [bani, error, loading, readLineIndex, set?.id, set?.title, verseCount]);

  const correctToLine = useCallback((index) => {
    if (!verseCount) return;
    const next = Math.min(verseCount - 1, Math.max(0, Number(index) || 0));
    setManualLine(next);
    setReadLineIndex(next);
    setManualAnchorVersion((version) => version + 1);
    if (manualLineTimerRef.current) clearTimeout(manualLineTimerRef.current);
    manualLineTimerRef.current = setTimeout(() => setManualLine(null), 900);
  }, [verseCount]);

  const continueFromResume = useCallback(() => {
    if (!resumePrompt) return;
    correctToLine(resumePrompt.lineIndex);
    setResumePrompt(null);
  }, [correctToLine, resumePrompt]);

  const startBaniFromBeginning = useCallback(() => {
    if (set?.id) clearStoredBaniProgress(set.id);
    correctToLine(0);
    setResumePrompt(null);
  }, [correctToLine, set?.id]);

  const locationIndex = useMemo(() => buildBaniLocationIndex(verses), [verses]);

  const jumpSuggestions = useMemo(() => {
    if (!jumpOpen || !jumpQuery.trim() || !verses.length) return [];
    return parseJumpQuery(jumpQuery, verses, locationIndex).map((s) => ({
      ...s,
      gurmukhi: verses[s.index]?.gurmukhi || '',
    }));
  }, [jumpOpen, jumpQuery, verses, locationIndex]);

  const handleJumpSelect = useCallback((suggestion) => {
    if (!suggestion || typeof suggestion.index !== 'number') return;
    correctToLine(suggestion.index);
    setJumpOpen(false);
    setJumpQuery('');
  }, [correctToLine]);

  // Focus the input the moment the panel opens.
  useEffect(() => {
    if (!jumpOpen) return;
    const t = setTimeout(() => jumpInputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [jumpOpen]);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!jumpOpen) return undefined;
    const onPointer = (event) => {
      const panel = jumpPanelRef.current;
      const toggle = jumpToggleRef.current;
      if (panel && panel.contains(event.target)) return;
      if (toggle && toggle.contains(event.target)) return;
      setJumpOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setJumpOpen(false);
        jumpToggleRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [jumpOpen]);

  // Display popover (mobile-only Aa button) — outside-click / Esc close.
  useEffect(() => {
    if (!displayOpen) return undefined;
    const onPointer = (event) => {
      const pop = displayPopoverRef.current;
      const btn = displayToggleRef.current;
      if (pop && pop.contains(event.target)) return;
      if (btn && btn.contains(event.target)) return;
      setDisplayOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setDisplayOpen(false);
        displayToggleRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [displayOpen]);

  const goPrev = useCallback(() => {
    const cur = manualLine !== null ? manualLine : Math.max(0, activeIndex >= 0 ? activeIndex : 0);
    correctToLine(Math.max(0, cur - 1));
  }, [activeIndex, correctToLine, manualLine]);

  const goNext = useCallback(() => {
    const cur = manualLine !== null ? manualLine : Math.max(0, activeIndex >= 0 ? activeIndex : 0);
    correctToLine(Math.min(verseCount - 1, cur + 1));
  }, [activeIndex, correctToLine, manualLine, verseCount]);

  const resumeLive = () => setManualLine(null);

  useEffect(() => {
    if (!remoteLineCommand?.id || loading || error || !bani) return;
    if (remoteLineCommand.type === 'line-prev') goPrev();
    else if (remoteLineCommand.type === 'line-next') goNext();
    else if (remoteLineCommand.type === 'line-first') correctToLine(0);
    else if (remoteLineCommand.type === 'line-last') correctToLine(verseCount - 1);
    else if (remoteLineCommand.type === 'line-select') correctToLine(remoteLineCommand.index);
    else if (remoteLineCommand.type === 'resume-live') resumeLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteLineCommand?.id]);

  useEffect(() => {
    if (loading || error || !bani) return undefined;
    const handleKeyDown = (event) => {
      // Cmd/Ctrl+K opens the Find panel from anywhere (even inside inputs).
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        setJumpOpen((open) => !open);
        return;
      }
      const tagName = event.target?.tagName?.toLowerCase();
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || tagName === 'button' || tagName === 'a' || event.target?.isContentEditable) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        goNext();
      } else if ((event.key === ' ' || event.code === 'Space') && !event.repeat && pageVoice?.isSupported !== false) {
        event.preventDefault();
        if (pageVoice.isListening) pageVoice.stop?.();
        else {
          pageVoice.reset?.();
          pageVoice.start?.();
        }
      } else if (event.key === 'Escape' && manualLine !== null) {
        event.preventDefault();
        resumeLive();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bani, error, goNext, goPrev, loading, manualLine, pageVoice?.isSupported, pageVoice.isListening, pageVoice.reset, pageVoice.start, pageVoice.stop]);

  const openOrFocusProjector = () => {
    if (projectorWindowOpen) {
      focusProjector?.();
      return;
    }
    openProjector?.();
  };
  const startMic = () => {
    pageVoice.reset?.();
    pageVoice.start?.();
  };
  const stopMic = () => {
    pageVoice.stop?.();
  };
  const adjustReaderScale = (delta) => {
    setReaderScale((value) => Math.min(1.35, Math.max(0.85, Number((value + delta).toFixed(2)))));
  };
  const trackingStatusText = isManual
    ? (pageVoice.isListening ? 'Line corrected - listening' : 'Line selected manually')
    : tracking.tracked && activeIndex >= 0
      ? `Following mic - line ${activeIndex + 1}`
      : pageVoice.isListening
        ? 'Listening - finding line'
        : 'Mic off';
  // Reading progress is separate from the live/projector line. Scrolling a
  // Bani should update the progress bar and saved resume point, but it should
  // not change the projected/active line unless the user taps a line or the
  // mic tracks it.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!id || loading || error || !verseCount) {
      setReadLineIndex(0);
      return undefined;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const lines = Array.from(document.querySelectorAll('.bani-reader-page .shabad-line[data-line-index]'));
      if (!lines.length) {
        setReadLineIndex(0);
        return;
      }

      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const anchor = Math.max(140, Math.min(viewportHeight * 0.42, 360));
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      let firstVisibleIndex = -1;

      for (const el of lines) {
        const rect = el.getBoundingClientRect();
        const index = Number(el.getAttribute('data-line-index'));
        if (!Number.isFinite(index)) continue;
        const visible = rect.bottom > 0 && rect.top < viewportHeight;
        if (visible && firstVisibleIndex < 0) firstVisibleIndex = index;
        const lineAnchor = rect.top + Math.min(rect.height * 0.45, 90);
        const distance = Math.abs(lineAnchor - anchor);
        if (visible && distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }

      if (firstVisibleIndex < 0) {
        const firstRect = lines[0].getBoundingClientRect();
        bestIndex = firstRect.top > anchor ? 0 : verseCount - 1;
      }
      setReadLineIndex((prev) => (prev === bestIndex ? prev : bestIndex));
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    const initialFrame = window.requestAnimationFrame(() => {
      document.addEventListener('scroll', onScroll, { passive: true, capture: true });
      window.addEventListener('resize', onScroll);
      measure();
    });

    return () => {
      window.cancelAnimationFrame(initialFrame);
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [
    id,
    loading,
    error,
    verseCount,
    readerScale,
    display.showTransliteration,
    display.showEnglish,
    display.showPunjabi,
    display.larivaar,
  ]);

  const readerProgress = verseCount
    ? Math.min(100, Math.max(0, Math.round(((Math.min(verseCount - 1, Math.max(0, readLineIndex)) + 1) / verseCount) * 100)))
    : 0;

  if (!id) {
    const isSearching = baniSearch.trim().length > 0;
    const resultsCount = baniSearchResults?.length || 0;
    const baniWord = resultsCount === 1 ? ui('baniCountSingular') : ui('baniCountPlural');
    return (
      <div className="app-container bani-page bani-home-page" lang={lang}>
        <section className="bani-hero bani-home-hero">
          <div className="bani-home-hero-text">
            <p className="section-eyebrow">{ui('eyebrow')}</p>
            <h1>{ui('heroTitle')}</h1>
            <p>{ui('heroSub')}</p>
          </div>
       
        </section>

        <div className="bani-search-row" role="search">
          <span className="bani-search-icon" aria-hidden="true"><SearchIcon /></span>
          <input
            type="text"
            value={baniSearch}
            onChange={(event) => setBaniSearch(event.target.value)}
            className="bani-search-input"
            placeholder={ui('searchPlaceholder')}
            aria-label={ui('searchAriaLabel')}
            autoComplete="off"
            spellCheck="false"
            lang={lang}
          />
          {isSearching && (
            <button type="button" className="bani-search-clear" onClick={() => setBaniSearch('')} aria-label={ui('clearSearch')}>×</button>
          )}
        </div>

        {!isSearching && <CalendarTodayBanner />}

        {!isSearching && (
          <nav className="bani-category-nav" aria-label="Bani categories">
            {baniGroups.map(({ category, items }) => {
              const catLabel = lang === 'pa' ? (category.labelPa || category.label) : category.label;
              return (
                <a key={category.id} href={`#bani-${category.id}`} className="bani-category-chip">
                  <span lang={lang}>{catLabel}</span>
                  <small>{items.length}</small>
                </a>
              );
            })}
          </nav>
        )}

        {isSearching ? (
          resultsCount === 0 ? (
            <p className="bani-search-empty" lang={lang}>
              {ui('searchEmpty')} "<strong>{baniSearch}</strong>". {ui('searchEmptyHint')}
            </p>
          ) : (
            <section className="bani-category-section" aria-label={ui('searchResults')}>
              <header className="bani-category-head">
                <div>
                  <p className="section-eyebrow" lang={lang}>{ui('searchResults')}</p>
                  <h2 lang={lang}>{resultsCount} {baniWord}</h2>
                </div>
                <p lang={lang}>"{baniSearch}" {ui('searchMeta')}. {ui('searchMetaHint')}</p>
              </header>
              <div className="bani-grid" aria-label={ui('searchResults')}>
                {baniSearchResults.map((item) => (
                  <BaniCard
                    key={item.id}
                    item={item}
                    lang={lang}
                    tag={tag}
                    highlighted={item.id === highlightedBaniId}
                  />
                ))}
              </div>
            </section>
          )
        ) : (
          baniGroups.map(({ category, items }) => (
            <BaniCategorySection
              key={category.id}
              category={category}
              items={items}
              lang={lang}
              tag={tag}
              highlightedId={highlightedBaniId}
            />
          ))
        )}
      </div>
    );
  }

  return (
    <div className="app-container shabad-page bani-page bani-reader-page" style={{ '--bani-reader-scale': readerScale }}>
      <div className="shabad-page-sticky">
        <div className="shabad-page-primary">
          <button
            type="button"
            className="btn btn-secondary btn-sm shabad-page-back"
            onClick={() => navigate('/bani', { state: { fromBaniId: set?.id || '' } })}
            aria-label={ui('backToBani')}
          >
            <span aria-hidden="true">&lt;</span>
            <span className="bani-back-label" lang={lang}> {lang === 'pa' ? 'ਬਾਣੀ' : 'Bani'}</span>
          </button>
          <div className="shabad-page-title-block">
            {set?.titlePa && (
              <p className="bani-reader-title-pa gurmukhi" lang="pa">{set.titlePa}</p>
            )}
            <p className="shabad-page-title">{set?.title || 'Bani set'}</p>
            {!loading && !error && bani && (
              <div className="shabad-meta-pills shabad-page-title-meta">
                <span className="meta-pill meta-pill-muted">Fixed Bani mode</span>
                {currentVariant && <span className="meta-pill meta-pill-muted">{currentVariant.label}</span>}
                <span className="meta-pill meta-pill-muted">{verseCount} lines</span>
                <span className="meta-pill meta-pill-muted">{readerProgress}% read</span>
                <span className={`meta-pill meta-pill-status${tracking.tracked && !isManual ? ' meta-pill-status-on' : ''}${isManual ? ' meta-pill-status-manual' : ''}`} aria-live="polite">
                  <span className="meta-pill-dot" aria-hidden="true" />
                  <span>{trackingStatusText}</span>
                  {tracking.tracked && !isManual && <ConfidenceBadge value={tracking.confidence} compact />}
                </span>
              </div>
            )}
          </div>
          {!loading && !error && bani && (
            <>
              <button
                ref={jumpToggleRef}
                type="button"
                className={`btn btn-sm bani-jump-toggle${jumpOpen ? ' bani-jump-toggle-on' : ''}`}
                onClick={() => setJumpOpen((open) => !open)}
                aria-expanded={jumpOpen}
                aria-controls="bani-jump-panel"
                aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}
                title={`${ui('findTitle')} (${SHORTCUT_LABEL})`}
              >
                <SearchIcon />
                <span className="bani-jump-toggle-label" lang={lang}>{ui('findLabel')}</span>
                <span className="bani-jump-toggle-kbd" aria-hidden="true">{SHORTCUT_LABEL}</span>
              </button>
              <button
                ref={displayToggleRef}
                type="button"
                className={`btn btn-sm bani-display-toggle${displayOpen ? ' bani-display-toggle-on' : ''}`}
                onClick={() => setDisplayOpen((open) => !open)}
                aria-expanded={displayOpen}
                aria-controls="bani-display-popover"
                title={ui('readerDisplay')}
              >
                Aa
              </button>
            </>
          )}
        </div>

        {!loading && !error && bani && (
          <div className="shabad-control-groups" aria-label="Bani controls">
            <section className="shabad-control-group shabad-live-group">
              <p className="shabad-control-label">Live controls</p>
              <button
                type="button"
                className={`btn btn-sm bani-mic-btn ${pageVoice.isListening ? 'btn-primary' : 'btn-secondary'}${pageVoice.isListening ? ' bani-mic-listening' : ''}${tracking.tracked && !isManual ? ' bani-mic-tracked' : ''}`}
                onClick={pageVoice.isListening ? stopMic : startMic}
                aria-label={pageVoice.isListening ? 'Stop mic' : 'Start mic'}
              >
                {pageVoice.isListening ? <MicOffIcon /> : <MicIcon />}
                <span className="bani-mic-label">{pageVoice.isListening ? 'Stop mic' : 'Start mic'}</span>
                {pageVoice.isListening && (
                  <span className="bani-mic-dot" aria-hidden="true" />
                )}
              </button>
              <div className="shabad-nav-line">
                <button type="button" className="btn btn-secondary btn-sm shabad-nav-btn" onClick={goPrev} disabled={activeIndex <= 0}>&lt;</button>
                <span className="shabad-nav-indicator">
                  {activeIndex >= 0 ? `${activeIndex + 1} / ${verseCount}` : `${verseCount} lines`}
                 
                </span>
                <button type="button" className="btn btn-secondary btn-sm shabad-nav-btn" onClick={goNext} disabled={activeIndex >= verseCount - 1}>&gt;</button>
              </div>
              {isManual && (
                <button type="button" className="btn-ghost shabad-nav-resume" onClick={resumeLive} lang={lang}>
                  {ui('resumeLive')}
                </button>
              )}
            </section>

            <section className="shabad-control-group shabad-display-group">
              <p className="shabad-control-label">Reader controls</p>
              <div className="shabad-page-toggles" role="group" aria-label="Visible text layers">
                <button type="button" className={`display-toggle${display.showTransliteration ? ' display-toggle-on' : ''}`} onClick={() => updateDisplay({ showTransliteration: !display.showTransliteration })}>Translit</button>
                <button type="button" className={`display-toggle${display.showEnglish ? ' display-toggle-on' : ''}`} onClick={() => updateDisplay({ showEnglish: !display.showEnglish })}>English</button>
                <button type="button" className={`display-toggle${display.showPunjabi ? ' display-toggle-on' : ''}`} onClick={() => updateDisplay({ showPunjabi: !display.showPunjabi })}>Punjabi</button>
                <button type="button" className={`display-toggle${display.larivaar ? ' display-toggle-on' : ''}`} onClick={() => updateDisplay({ larivaar: !display.larivaar })}>Larivaar</button>
              </div>
              <div className="bani-reader-font-controls" role="group" aria-label="Reader font size">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => adjustReaderScale(-0.05)} disabled={readerScale <= 0.85}>A-</button>
                <span>{Math.round(readerScale * 100)}%</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => adjustReaderScale(0.05)} disabled={readerScale >= 1.35}>A+</button>
              </div>
              <button type="button" className="btn btn-secondary btn-sm bani-projector-open" onClick={openOrFocusProjector}>
                {projectorWindowOpen ? 'Focus projector' : 'Open projector'}
              </button>
            </section>
          </div>
        )}
        {!loading && !error && bani && variantGroup && variantGroup.variants.length > 1 && (
          <div className="bani-variant-strip" role="group" aria-label="Bani version">
            <span className="bani-variant-label">Version</span>
            {variantGroup.variants.map((variant) => {
              const isCurrent = variant.id === set?.id;
              if (isCurrent) {
                return (
                  <span
                    key={variant.id}
                    className="bani-variant-chip bani-variant-chip-on"
                    title={variant.description}
                    aria-current="true"
                  >
                    {variant.label}
                  </span>
                );
              }
              return (
                <Link
                  key={variant.id}
                  to={`/bani/${variant.id}`}
                  className="bani-variant-chip"
                  title={variant.description}
                >
                  {variant.label}
                </Link>
              );
            })}
          </div>
        )}
        {!loading && !error && bani && displayOpen && (
          <div
            ref={displayPopoverRef}
            id="bani-display-popover"
            className="bani-display-popover"
            role="dialog"
            aria-label={ui('readerDisplay')}
            lang={lang}
          >
            <div className="bani-display-popover-head">
              <p className="section-eyebrow">{ui('readerDisplay')}</p>
              <button
                type="button"
                className="bani-display-popover-close"
                onClick={() => {
                  setDisplayOpen(false);
                  displayToggleRef.current?.focus();
                }}
                aria-label={ui('close')}
              >
                ×
              </button>
            </div>

            <div
              className="bani-lang-toggle bani-lang-toggle-popover"
              role="group"
              aria-label={ui('langToggleLabel')}
            >
              <button
                type="button"
                className={`bani-lang-toggle-btn${lang === 'en' ? ' bani-lang-toggle-btn-on' : ''}`}
                onClick={() => setLang('en')}
                aria-pressed={lang === 'en'}
              >
                EN
              </button>
              <button
                type="button"
                className={`bani-lang-toggle-btn${lang === 'pa' ? ' bani-lang-toggle-btn-on' : ''}`}
                onClick={() => setLang('pa')}
                aria-pressed={lang === 'pa'}
                lang="pa"
              >
                ਪੰ
              </button>
            </div>

            <div className="bani-display-popover-toggles" role="group" aria-label="Visible text layers">
              <button type="button" className={`display-toggle${display.showTransliteration ? ' display-toggle-on' : ''}`} onClick={() => updateDisplay({ showTransliteration: !display.showTransliteration })}>Translit</button>
              <button type="button" className={`display-toggle${display.showEnglish ? ' display-toggle-on' : ''}`} onClick={() => updateDisplay({ showEnglish: !display.showEnglish })}>English</button>
              <button type="button" className={`display-toggle${display.showPunjabi ? ' display-toggle-on' : ''}`} onClick={() => updateDisplay({ showPunjabi: !display.showPunjabi })}>Punjabi</button>
              <button type="button" className={`display-toggle${display.larivaar ? ' display-toggle-on' : ''}`} onClick={() => updateDisplay({ larivaar: !display.larivaar })}>Larivaar</button>
            </div>

            {display.showPunjabi && (
              <div className="bani-display-popover-steek" role="group" aria-label="Punjabi steek">
                <p className="bani-display-popover-steek-label" lang={lang}>
                  {t('Steek', 'ਟੀਕਾ')}
                </p>
                <div className="bani-display-popover-steek-row">
                  <button
                    type="button"
                    className={`display-toggle${display.punjabiSteek === 'ss' ? ' display-toggle-on' : ''}`}
                    onClick={() => updateDisplay({ punjabiSteek: 'ss' })}
                    aria-pressed={display.punjabiSteek === 'ss'}
                    lang={lang}
                  >
                    {t('Sahib Singh', 'ਸਾਹਿਬ ਸਿੰਘ')}
                  </button>
                  <button
                    type="button"
                    className={`display-toggle${display.punjabiSteek === 'ft' ? ' display-toggle-on' : ''}`}
                    onClick={() => updateDisplay({ punjabiSteek: 'ft' })}
                    aria-pressed={display.punjabiSteek === 'ft'}
                    lang={lang}
                  >
                    {t('Faridkot', 'ਫਰੀਦਕੋਟ')}
                  </button>
                  <button
                    type="button"
                    className={`display-toggle${display.punjabiSteek === 'ms' ? ' display-toggle-on' : ''}`}
                    onClick={() => updateDisplay({ punjabiSteek: 'ms' })}
                    aria-pressed={display.punjabiSteek === 'ms'}
                    lang={lang}
                  >
                    {t('Manmohan Singh', 'ਮਨਮੋਹਨ ਸਿੰਘ')}
                  </button>
                </div>
              </div>
            )}

            <div className="bani-display-popover-font" role="group" aria-label="Reader font size">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => adjustReaderScale(-0.05)} disabled={readerScale <= 0.85}>A-</button>
              <span>{Math.round(readerScale * 100)}%</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => adjustReaderScale(0.05)} disabled={readerScale >= 1.35}>A+</button>
            </div>
          </div>
        )}
        {!loading && !error && bani && jumpOpen && (
          <BaniJumpPanel
            query={jumpQuery}
            onQueryChange={setJumpQuery}
            suggestions={jumpSuggestions}
            onJump={handleJumpSelect}
            onClose={() => {
              setJumpOpen(false);
              jumpToggleRef.current?.focus();
            }}
            inputRef={jumpInputRef}
            panelRef={jumpPanelRef}
          />
        )}
        {!loading && !error && bani && (
          <div className="bani-reader-progress" aria-hidden="true">
            <span style={{ width: `${readerProgress}%` }} />
            <small className="bani-progress-label">{readerProgress}% read</small>
          </div>
        )}
      </div>

      {!loading && !error && bani && resumePrompt && (
        <section className="bani-resume-card" aria-label="Continue reading">
          <div>
            <p className="section-eyebrow">Continue from here</p>
            <h2>Continue from line {resumePrompt.lineNumber}?</h2>
            <p>
              This Bani was last followed at line {resumePrompt.lineNumber} of {resumePrompt.verseCount}.
            </p>
          </div>
          <div className="bani-resume-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={continueFromResume}>
              Continue
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={startBaniFromBeginning}>
              Start from beginning
            </button>
          </div>
        </section>
      )}

      {!loading && !error && bani && (
        <details className="shabad-advanced-projector">
          <summary>Advanced projector controls</summary>
          <ProjectorControls compact embedded />
        </details>
      )}
      {!loading && !error && bani && (
        <VoiceDebugPanel
          title="Bani voice debug"
          mode="bani"
          voice={pageVoice}
          tracking={tracking}
          transcript={pageVoice.transcript}
          activeIndex={activeIndex}
          verseCount={verseCount}
          groupLabel={set?.title || 'Bani'}
          verses={verses}
          currentGroupId={set?.id || 'bani'}
          onOpenChange={setVoiceDebugOpen}
        />
      )}
      {!loading && !error && bani && <ProjectorMiniPreview />}

      {loading && (
        <div className="shabad-page-state">
          <Loader
            label={progress.total
              ? `Opening ${set?.title || 'Bani'}... ${progress.loaded}/${progress.total}${progress.failed ? `, ${progress.failed} skipped` : ''}`
              : 'Opening Bani...'}
            size="lg"
          />
        </div>
      )}

      {error && (
        <div className="shabad-page-state shabad-page-error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && bani && (
        <ShabadView
          meta={bani.meta}
          verses={verses}
          activeIndex={activeIndex}
          confidence={tracking.confidence}
          tracked={isManual ? false : tracking.tracked}
          isListening={pageVoice.isListening}
          onLineClick={correctToLine}
          showSectionHeadings={false}
          showSectionMeta={false}
          disableAutoScroll={voiceDebugOpen}
        />
      )}
    </div>
  );
}
