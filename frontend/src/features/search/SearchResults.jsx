import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Loader from '../../components/common/Loader/Loader';
import { getMainVerse, trimToWords, matchedWordPositions, highlightSegments } from '../../utils/gurmukhi';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import './SearchResults.css';

/**
 * Renders manual-search results. Adds a small note explaining how the query
 * was interpreted (full-word, first-letter, etc.) and a "closest matches"
 * hint when the top-scoring result is fuzzy.
 *
 * Each result row bolds the words that matched the user's query, so it's
 * obvious why the row was suggested.
 */
const TYPE_LABELS = {
  0: 'first-letter (e.g. mjjj)',
  2: 'Gurmukhi',
  4: 'romanized',
  5: 'Ang / page',
  7: 'romanized first-letter',
};

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

function HighlightedText({ text, query, mode, alignAgainst }) {
  // Pick the right candidate to compute matches against:
  //   - If query is Gurmukhi → match against the gurmukhi text directly.
  //   - Otherwise → match against the transliteration (alignAgainst); the
  //     resulting word indices apply to BOTH gurmukhi and transliteration
  //     because BaniDB keeps them word-aligned.
  const queryIsGurmukhi = GURMUKHI_RE.test(query || '');
  const align = queryIsGurmukhi ? text : (alignAgainst || text);
  const matched = matchedWordPositions(align, query, mode);
  const segments = highlightSegments(text, matched);
  return segments.map((s, i) => (
    s.match
      ? <strong key={i} className="search-match">{s.text}</strong>
      : <span    key={i}>{s.text}</span>
  ));
}

const ResultItem = memo(function ResultItem({
  r,
  showTransliteration,
  showEnglish,
  query,
  mode,
  to,
  actionLabel,
  isFavourite,
  onToggleFavourite,
  onAddToQueue,
  onSelect,
}) {
  const gurmukhiTrim     = trimToWords(r.gurmukhi, 18);
  const translitTrim     = r.transliteration ? trimToWords(r.transliteration, 18) : '';
  const translationTrim  = r.translationEn   ? trimToWords(r.translationEn,   22) : '';

  return (
    <li className="search-result-item card fade-up">
      <Link
        to={to || `/shabad/${encodeURIComponent(r.shabadId)}`}
        className="search-result-link"
        onClick={(e) => onSelect?.(e, r)}
      >
        <p className="search-result-gurmukhi gurmukhi">
          <HighlightedText
            text={gurmukhiTrim}
            query={query}
            mode={mode}
            alignAgainst={translitTrim}
          />
        </p>
        {showTransliteration && translitTrim && (
          <p className="search-result-translit translit">
            <HighlightedText text={translitTrim} query={query} mode={mode} />
          </p>
        )}
        {showEnglish && translationTrim && (
          <p className="search-result-en translation-en">{translationTrim}</p>
        )}
        <div className="search-result-meta">
          {r.raag && <span className="meta-pill">{r.raag}</span>}
          {r.writer && <span className="meta-pill">{r.writer}</span>}
          {r.source && <span className="meta-pill meta-pill-muted">{r.source}</span>}
          {r.pageNo && <span className="meta-pill meta-pill-muted">Ang {r.pageNo}</span>}
          {actionLabel && <span className="meta-pill meta-pill-action">{actionLabel}</span>}
        </div>
      </Link>
      <button
        type="button"
        className={`search-result-favourite${isFavourite ? ' search-result-favourite-active' : ''}`}
        onClick={() => onToggleFavourite(r)}
        aria-pressed={isFavourite}
        aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
        title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
      >
        <span aria-hidden="true">{isFavourite ? '♥' : '♡'}</span>
      </button>
      <button
        type="button"
        className="search-result-queue"
        onClick={() => onAddToQueue?.(r)}
      >
        <QueueIcon />
        Queue
      </button>
    </li>
  );
});

function buildKathaTarget(r, openAs, source) {
  const qs = new URLSearchParams({ katha: '1' });
  if (source) qs.set('source', source);
  if (openAs === 'ang' && r.pageNo) {
    return `/ang/${encodeURIComponent(r.pageNo)}?${qs.toString()}`;
  }
  return `/shabad/${encodeURIComponent(r.shabadId)}?${qs.toString()}`;
}

export default function SearchResults({
  results,
  loading,
  error,
  query,
  detectedType,
  mode,
  variant = 'kirtan',
  openAs = 'shabad',
  source,
}) {
  const { display, isShabadFavourite, toggleShabadFavourite, addToQueue, openProjector, pushToast, voice } = useApp();
  const navigate = useNavigate();
  const queueSessionId = variant === 'katha' ? 'katha' : 'kirtan';
  // Open the projector window in the same user-gesture as the result click
  // so the popup blocker accepts it. Link navigation continues after this.
  const handleSelect = async (event, item) => {
    voice.stop?.();
    voice.reset?.();
    openProjector?.();
    if (variant !== 'katha' || openAs !== 'ang' || item?.pageNo || !item?.shabadId) return;

    event.preventDefault();
    try {
      const shabad = await api.getShabad(item.shabadId);
      const pageNo = shabad?.meta?.pageNo;
      if (!pageNo) {
        pushToast?.({
          kind: 'info',
          title: 'Ang unavailable',
          message: 'Opening the Shabad because this result has no Ang number.',
        });
        navigate(`/shabad/${encodeURIComponent(item.shabadId)}?katha=1`);
        return;
      }
      const qs = new URLSearchParams({ katha: '1' });
      if (source) qs.set('source', source);
      navigate(`/ang/${encodeURIComponent(pageNo)}?${qs.toString()}`);
    } catch (err) {
      pushToast?.({
        kind: 'error',
        title: 'Could not open Ang',
        message: err?.response?.data?.error || err.message || 'Opening the Shabad instead.',
      });
      navigate(`/shabad/${encodeURIComponent(item.shabadId)}?katha=1`);
    }
  };

  if (loading) {
    return (
      <div className="search-results-state">
        <Loader label="Searching the Granths…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="search-results-state search-results-error" role="alert">
        {error}
      </div>
    );
  }

  const numericAngQuery = /^[0-9]+$/.test((query || '').trim());
  const queryReady = mode === 'ang' || (variant === 'katha' && numericAngQuery)
    ? numericAngQuery
    : (query || '').trim().length >= 2;

  if (!queryReady) {
    return (
      <div className="empty-state">
        <h3>{mode === 'ang' ? 'Type an Ang number' : 'Type to search'}</h3>
        <p>
          {mode === 'ang'
            ? 'Enter a page number to view the lines from that Ang.'
            : 'Search by Gurmukhi, English translation, or first-letter shorthand. Filter by Raag, Writer or Granth from the panel above.'}
        </p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="empty-state">
        <h3>No matches for "{query}"</h3>
        <p>Try a shorter query, switch to first-letter shorthand, or remove some filters.</p>
      </div>
    );
  }

  const topScore = results[0]?.score ?? 100;
  const weakHeader = topScore < 40;   // nothing scored as a real match
  const fuzzyHeader = topScore < 70;  // fuzzy but plausible
  const typeLabel = TYPE_LABELS[detectedType];

  if (variant === 'katha' && openAs === 'ang' && numericAngQuery) {
    const ang = (query || '').trim();
    const qs = new URLSearchParams({ katha: '1' });
    if (source) qs.set('source', source);
    const shabadFallbacks = results.filter((item, index, list) =>
      item?.shabadId &&
      list.findIndex((candidate) => String(candidate.shabadId) === String(item.shabadId)) === index
    );

    return (
      <section className="katha-ang-results" aria-label={`Open full Ang ${ang}`}>
        <div className="katha-ang-open-card">
          <div>
            <p className="section-eyebrow">Full Ang</p>
            <h2>Open complete Ang {ang}</h2>
            <p>
              This opens the Ang viewer with every line the backend can load. If the full Ang
              cannot load, choose a Shabad from this Ang below.
            </p>
          </div>
          <Link
            to={`/ang/${encodeURIComponent(ang)}?${qs.toString()}`}
            className="btn btn-primary"
            onClick={() => {
              voice.stop?.();
              voice.reset?.();
              openProjector?.();
            }}
          >
            Open Full Ang
          </Link>
        </div>

        {shabadFallbacks.length > 0 && (
          <>
            <p className="search-results-summary">
              Shabads found on Ang {ang}
            </p>
            <ul className="search-results">
              {shabadFallbacks.map((r, index) => (
                <ResultItem
                  key={`${r.shabadId}-${r.verseId ?? r.lineNo ?? index}`}
                  r={{ ...r, pageNo: r.pageNo || Number(ang) }}
                  query={query}
                  mode={mode}
                  to={`/shabad/${encodeURIComponent(r.shabadId)}?katha=1`}
                  actionLabel={`Open Shabad from Ang ${r.pageNo || ang}`}
                  showTransliteration={display.showTransliteration}
                  showEnglish={display.showEnglish}
                  isFavourite={isShabadFavourite?.(r.shabadId)}
                  onSelect={handleSelect}
                  onToggleFavourite={async (item) => {
                    const entry = isShabadFavourite?.(item.shabadId)
                      ? baseLibraryEntry(item, queueSessionId)
                      : await enrichedLibraryEntry(item, queueSessionId);
                    toggleShabadFavourite?.(entry);
                  }}
                  onAddToQueue={async (item) => {
                    addToQueue?.(await enrichedLibraryEntry(item, queueSessionId));
                    pushToast?.({
                      kind: 'success',
                      title: 'Added to Katha session',
                      message: 'This Shabad is ready in your queue.',
                      timeoutMs: 2200,
                    });
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    );
  }

  if (variant !== 'katha' && mode === 'ang') {
    const ang = (query || '').trim();
    return (
      <section className="ang-viewer" aria-label={`Ang ${ang}`}>
        <header className="ang-viewer-head">
          <div>
            <p className="section-eyebrow">Manual Ang Viewer</p>
            <h2>Ang {ang}</h2>
          </div>
          <span>{results.length} line{results.length === 1 ? '' : 's'}</span>
        </header>

        <ol className="ang-viewer-lines">
          {results.map((r, index) => (
            <li key={`${r.shabadId}-${r.verseId ?? index}`} className="ang-viewer-line">
              <Link
                to={`/shabad/${encodeURIComponent(r.shabadId)}`}
                className="ang-viewer-link"
                onClick={handleSelect}
              >
                <span className="ang-viewer-num">{r.lineNo || index + 1}</span>
                <span className="ang-viewer-body">
                  <span className="ang-viewer-gurmukhi gurmukhi">{r.gurmukhi}</span>
                  {display.showTransliteration && r.transliteration && (
                    <span className="ang-viewer-translit translit">{r.transliteration}</span>
                  )}
                  {display.showEnglish && r.translationEn && (
                    <span className="ang-viewer-translation translation-en">{r.translationEn}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <>
      <p className="search-results-summary">
        {weakHeader
          ? 'No strong match — showing closest guesses'
          : fuzzyHeader
            ? 'Closest matches'
            : `${results.length} result${results.length === 1 ? '' : 's'}`}
        {typeLabel && (
          <>
            {' '}· interpreted as <span className="search-results-type">{typeLabel}</span>
          </>
        )}
      </p>
      <ul className="search-results">
        {results.map((r, index) => (
          <ResultItem
            key={`${r.shabadId}-${r.verseId ?? r.lineNo ?? index}`}
            r={r}
            query={query}
            mode={mode}
            to={variant === 'katha' ? buildKathaTarget(r, openAs, source) : undefined}
            actionLabel={variant === 'katha' ? (openAs === 'ang' ? 'Open full Ang' : 'Open Shabad') : undefined}
            showTransliteration={display.showTransliteration}
            showEnglish={display.showEnglish}
            isFavourite={isShabadFavourite?.(r.shabadId)}
            onSelect={handleSelect}
            onToggleFavourite={async (item) => {
              const entry = isShabadFavourite?.(item.shabadId)
                ? baseLibraryEntry(item, queueSessionId)
                : await enrichedLibraryEntry(item, queueSessionId);
              toggleShabadFavourite?.(entry);
            }}
            onAddToQueue={async (item) => {
              addToQueue?.(await enrichedLibraryEntry(item, queueSessionId));
              pushToast?.({
                kind: 'success',
                title: `Added to ${queueSessionId === 'katha' ? 'Katha' : 'Kirtan'} session`,
                message: 'This Shabad is ready in your queue.',
                timeoutMs: 2200,
              });
            }}
          />
        ))}
      </ul>
    </>
  );
}
