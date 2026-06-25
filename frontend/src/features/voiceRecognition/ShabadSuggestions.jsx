import { memo } from 'react';
import { Link } from 'react-router-dom';
import ConfidenceBadge from '../../components/common/ConfidenceBadge/ConfidenceBadge';
import Loader from '../../components/common/Loader/Loader';
import { getMainVerse, trimToWords, matchedWordPositions, highlightSegments } from '../../utils/gurmukhi';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import './ShabadSuggestions.css';

/**
 * Renders the ranked list of suggested shabads. Bolds the words that matched
 * the user's transcript so it's obvious why each row was suggested.
 *
 * Heuristic for the section header:
 *   - top suggestion ≥ 70%   → "Suggested Shabads"
 *   - top suggestion 40-69%  → "Closest matches"
 *   - top suggestion < 40%   → "Nearest possibilities"
 */
const GURMUKHI_RE = /[਀-੿]/;

const QueueIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M3 4h7M3 8h7M3 12h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 10v4M10 12h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

function baseLibraryEntry(item, queueSessionId = 'kirtan') {
  return {
    shabadId: item?.shabadId,
    gurmukhi: item?.mainGurmukhi || item?.displayGurmukhi || item?.gurmukhi || '',
    mainGurmukhi: item?.mainGurmukhi || '',
    firstGurmukhi: item?.firstGurmukhi || item?.gurmukhi || '',
    raag: item?.raag || '',
    writer: item?.writer || '',
    source: item?.source || '',
    pageNo: item?.pageNo || null,
    queueSessionId,
  };
}

async function enrichedLibraryEntry(item, queueSessionId = 'kirtan') {
  const fallback = baseLibraryEntry(item, queueSessionId);
  if (!item?.shabadId) return fallback;
  try {
    const data = await api.getShabad(item.shabadId);
    const mainVerse = getMainVerse(data?.verses, data?.meta);
    const firstVerse = data?.verses?.[0] || null;
    return {
      ...fallback,
      shabadId: data?.meta?.shabadId || item.shabadId,
      gurmukhi: mainVerse?.gurmukhi || firstVerse?.gurmukhi || fallback.gurmukhi,
      mainGurmukhi: mainVerse?.gurmukhi || '',
      firstGurmukhi: firstVerse?.gurmukhi || fallback.firstGurmukhi,
      raag: data?.meta?.raag || fallback.raag,
      writer: data?.meta?.writer || fallback.writer,
      source: data?.meta?.source || fallback.source,
      pageNo: data?.meta?.pageNo || fallback.pageNo,
      queueSessionId,
    };
  } catch {
    return fallback;
  }
}

function HighlightedText({ text, query, alignAgainst }) {
  if (!text || !query) return text || null;
  const queryIsGurmukhi = GURMUKHI_RE.test(query);
  const align = queryIsGurmukhi ? text : (alignAgainst || text);
  const matched = matchedWordPositions(align, query, 'auto');
  const segments = highlightSegments(text, matched);
  return segments.map((s, i) => (
    s.match
      ? <strong key={i} className="suggestion-match">{s.text}</strong>
      : <span    key={i}>{s.text}</span>
  ));
}

const SuggestionItem = memo(function SuggestionItem({
  s,
  transcript,
  showTransliteration,
  showEnglish,
  isFavourite,
  onToggleFavourite,
  onAddToQueue,
  onSelect,
}) {
  const gurmukhiTrim    = trimToWords(s.gurmukhi, 14);
  const translitTrim    = s.transliteration ? trimToWords(s.transliteration, 14) : '';
  const translationTrim = s.translationEn   ? trimToWords(s.translationEn,   18) : '';

  return (
    <li className="suggestion-item card fade-up">
      <Link
        to={`/shabad/${encodeURIComponent(s.shabadId)}`}
        className="suggestion-link"
        onClick={onSelect}
      >
        <div className="suggestion-text">
          <p className="suggestion-gurmukhi gurmukhi">
            <HighlightedText
              text={gurmukhiTrim}
              query={transcript}
              alignAgainst={translitTrim}
            />
          </p>
          {showTransliteration && translitTrim && (
            <p className="suggestion-translit translit">
              <HighlightedText text={translitTrim} query={transcript} />
            </p>
          )}
          {showEnglish && translationTrim && (
            <p className="suggestion-en translation-en">{translationTrim}</p>
          )}
          <p className="suggestion-meta">
            {s.raag && <span className="meta-pill">{s.raag}</span>}
            {s.writer && <span className="meta-pill">{s.writer}</span>}
            {s.source && <span className="meta-pill meta-pill-muted">{s.source}</span>}
          </p>
        </div>

        <div className="suggestion-confidence">
          <ConfidenceBadge value={s.confidence} />
          <span className="suggestion-cta" aria-hidden="true">→</span>
        </div>
      </Link>
      <button
        type="button"
        className={`suggestion-favourite${isFavourite ? ' suggestion-favourite-active' : ''}`}
        onClick={() => onToggleFavourite(s)}
        aria-pressed={isFavourite}
        aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
        title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
      >
        <span aria-hidden="true">{isFavourite ? '♥' : '♡'}</span>
      </button>
      <button type="button" className="suggestion-queue" onClick={() => onAddToQueue?.(s)}>
        <QueueIcon />
        Queue
      </button>
    </li>
  );
});

export default function ShabadSuggestions({ suggestions, loading, error, transcript, sessionId = 'kirtan' }) {
  const { display, isShabadFavourite, toggleShabadFavourite, addToQueue, pushToast, openProjector, voice } = useApp();
  // Selecting a suggestion is a user gesture — open the projector window
  // synchronously so the popup blocker accepts it. The Link continues to
  // navigate after this returns.
  const handleSelect = () => {
    voice.stop?.();
    voice.reset?.();
    openProjector?.();
  };
  const trimmedTranscript = (transcript || '').trim();
  const hasTranscript = trimmedTranscript.length > 0;
  const wordCount = hasTranscript ? trimmedTranscript.split(/\s+/).filter(Boolean).length : 0;
  const top = suggestions[0]?.confidence ?? 0;

  let heading = 'Suggested Shabads';
  let eyebrow = 'Live matches';
  if (suggestions.length > 0 && top < 70 && top >= 40) {
    heading = 'Closest matches';
    eyebrow = 'Best guesses';
  } else if (suggestions.length > 0 && top < 40) {
    heading = 'Nearest possibilities';
    eyebrow = 'Low confidence';
  }

  return (
    <section className="suggestions" aria-label="Suggested shabads">
      <header className="suggestions-header">
        <div>
          <p className="section-eyebrow">{eyebrow}</p>
          <h2 className="section-title">{heading}</h2>
        </div>
        {loading && <Loader label="Matching…" size="sm" />}
      </header>

      {error && (
        <p className="suggestions-error" role="alert">
          {error}
        </p>
      )}

      {!error && suggestions.length === 0 && (
        <div className="empty-state">
          {!hasTranscript ? (
            <>
              <h3>Awaiting your voice</h3>
              <p>Press the mic and start singing. Top matches appear here with a confidence score.</p>
            </>
          ) : wordCount < 2 ? (
            <>
              <h3>One more word…</h3>
              <p>Matching kicks in after two words. Keep singing — the suggestion list refreshes as more comes through.</p>
            </>
          ) : (
            <>
              <h3>Listening for a clearer phrase…</h3>
              <p>
                No close match yet. Try singing a longer or more distinctive line —
                the matcher needs a few in-tune words to lock in.
              </p>
            </>
          )}
        </div>
      )}

      <ul className="suggestions-list">
        {suggestions.map((s, index) => (
          <SuggestionItem
            key={`${s.shabadId}-${s.verseId ?? s.lineNo ?? index}`}
            s={s}
            transcript={transcript}
            showTransliteration={display.showTransliteration}
            showEnglish={display.showEnglish}
            isFavourite={isShabadFavourite?.(s.shabadId)}
            onSelect={handleSelect}
            onToggleFavourite={async (item) => {
              const entry = isShabadFavourite?.(item.shabadId)
                ? baseLibraryEntry(item, sessionId)
                : await enrichedLibraryEntry(item, sessionId);
              toggleShabadFavourite?.(entry);
            }}
            onAddToQueue={async (item) => {
              addToQueue?.(await enrichedLibraryEntry(item, sessionId));
              pushToast?.({
                kind: 'success',
                title: `Added to ${sessionId === 'katha' ? 'Katha' : 'Kirtan'} session`,
                message: 'This Shabad is ready in your queue.',
                timeoutMs: 2200,
              });
            }}
          />
        ))}
      </ul>
    </section>
  );
}
