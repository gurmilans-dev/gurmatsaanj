import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import './ShabadView.css';

/**
 * Split a Gurmukhi verse into styled tokens.
 *   - "ਰਹਾਉ" (rahao)  — the refrain marker. Painted in maroon.
 *   - "॥…॥" / "॥"    — danda markers (verse separators). Muted.
 *   - vishraam word   — the curated mid-line pause word the singer dwells on
 *                       (BaniDB sttm/igurbani annotation). Painted in kesari.
 *   - yamki word      — lighter pause. Softer kesari tint.
 *   - everything else — normal verse colour.
 *
 * Vishraam annotations are word-indexed (excluding danda markers), so we
 * walk the line counting only "real" words and apply the class to the Nth one.
 */
function isDandaToken(w) {
  return /॥/.test(w);
}
function isRahaoToken(w) {
  const bare = w.replace(/[॥।]/g, '').trim();
  return bare === 'ਰਹਾਉ' || bare === 'ਰਹਾਉ੧' || bare === 'ਰਹਾਉ੨' || bare === 'ਰਹਾਉਦੂਜਾ';
}

export function renderGurmukhiLine(text, vishraams, larivaar = false) {
  if (!text) return null;

  // Build a lookup: word-index → vishraam type ('v' | 'y')
  const visMap = new Map();
  if (Array.isArray(vishraams)) {
    for (const it of vishraams) {
      if (it && Number.isInteger(it.p)) visMap.set(it.p, it.t === 'y' ? 'y' : 'v');
    }
  }

  const tokens = text.split(/(\s+)/); // keep whitespace
  let wordCount = 0; // index of "real" (non-danda, non-rahao) words

  return tokens.map((tok, i) => {
    if (!tok) return null;
    if (!tok.trim()) {
      // Larivaar mode collapses inter-word whitespace so the words touch,
      // mirroring the traditional way Gurbani appears in Sri Guru Granth
      // Sahib Ji. Per-word colours (vishraam, rahao, yamki) are preserved.
      return larivaar ? null : tok;
    }

    let cls = 'shabad-word';
    if (isRahaoToken(tok)) {
      cls += ' shabad-word-rahao';
    } else if (isDandaToken(tok)) {
      cls += ' shabad-word-marker';
    } else {
      // Real word — check if its index is a vishraam
      const v = visMap.get(wordCount);
      if (v === 'v') cls += ' shabad-word-pause';
      else if (v === 'y') cls += ' shabad-word-yamki';
      wordCount += 1;
    }
    return <span key={i} className={cls}>{tok}</span>;
  });
}

/**
 * One verse row. Memoized so a manualLine click only re-renders the two rows
 * that actually changed (the previous active row + the new active row),
 * instead of the whole 50-line list.
 */
/**
 * Pick the Punjabi steek text for a verse, respecting the user's selected
 * channel. Falls back through ss → bdb → ms → ft so a Faridkot-empty verse
 * (common on Dasam Bani) still renders something instead of a blank line.
 * Returns '' if no channel has text for this verse.
 */
export function pickPunjabiSteek(verse, preferredChannel) {
  const channels = verse?.translationPaChannels;
  const fallback = ['ss', 'bdb', 'ms', 'ft'];
  const order = preferredChannel
    ? [preferredChannel, ...fallback.filter((c) => c !== preferredChannel)]
    : fallback;
  if (channels && typeof channels === 'object') {
    for (const key of order) {
      const value = channels[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return verse?.translationPa || '';
}

const ShabadLine = memo(function ShabadLine({
  verse,
  index,
  isActive,
  isPast,
  showTransliteration,
  showEnglish,
  showPunjabi,
  punjabiSteek,
  larivaar,
  onClick,
  meaningEnabled,
  onMeaningEnter,
  onMeaningLeave,
  registerRef,
}) {
  const punjabiText = showPunjabi ? pickPunjabiSteek(verse, punjabiSteek) : '';
  const cls = [
    'shabad-line',
    onClick ? 'shabad-line-clickable' : '',
    isActive ? 'shabad-line-active' : '',
    isPast ? 'shabad-line-past' : '',
    verse.isRahao ? 'shabad-line-rahao' : '',
  ].filter(Boolean).join(' ');

  return (
    <li
      ref={(el) => registerRef(index, el)}
      className={cls}
      data-line-index={index}
      aria-current={isActive ? 'true' : undefined}
      aria-label={onClick ? `Select line ${index + 1}` : undefined}
      onClick={onClick ? () => onClick(index) : undefined}
      onMouseEnter={meaningEnabled ? () => onMeaningEnter(index) : undefined}
      onMouseLeave={meaningEnabled ? onMeaningLeave : undefined}
      onFocus={meaningEnabled ? () => onMeaningEnter(index) : undefined}
      onBlur={meaningEnabled ? onMeaningLeave : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(index);
        }
      } : undefined}
    >
      <span className="shabad-line-num" aria-hidden="true">{index + 1}</span>
      <div className="shabad-line-body">
        <p className={`shabad-line-gurmukhi gurmukhi${larivaar ? ' shabad-line-larivaar' : ''}`}>
          {renderGurmukhiLine(verse.gurmukhi, verse.vishraams, larivaar)}
        </p>
        {showTransliteration && verse.transliteration && (
          <p className="shabad-line-translit translit">{verse.transliteration}</p>
        )}
        {showEnglish && verse.translationEn && (
          <p className="shabad-line-en translation-en">{verse.translationEn}</p>
        )}
        {showPunjabi && punjabiText && (
          <p className="shabad-line-pa gurmukhi">{punjabiText}</p>
        )}
      </div>
    </li>
  );
});

function meaningForVerse(verse, display) {
  if (!verse || (display.showEnglish && display.showPunjabi)) return null;

  const english = String(verse.translationEn || '').trim();
  const punjabi = String(pickPunjabiSteek(verse, display.punjabiSteek) || '').trim();
  const items = [];

  if (!display.showEnglish && english) {
    items.push({ id: 'english', label: 'English', text: english, className: 'shabad-meaning-en' });
  }
  if (!display.showPunjabi && punjabi) {
    items.push({ id: 'punjabi', label: 'Punjabi', text: punjabi, className: 'shabad-meaning-pa gurmukhi' });
  }

  if (!items.length) return null;
  return {
    items,
  };
}

/**
 * Renders the verses of a Shabad. Highlights the line currently being sung
 * (driven by the parent which runs useLineTracking) and auto-scrolls it into
 * view smoothly.
 */
export default function ShabadView({
  meta,
  verses,
  activeIndex,
  confidence,
  tracked,
  isListening,
  onLineClick,
  showSectionHeadings = true,
  showSectionMeta = true,
  disableAutoScroll = false,
}) {
  const { display } = useApp();
  const lineRefs = useRef([]);
  const [meaningIndex, setMeaningIndex] = useState(-1);
  const meaningEnabled = !(display.showEnglish && display.showPunjabi);

  const registerRef = useCallback((i, el) => {
    lineRefs.current[i] = el;
  }, []);

  const showMeaningForLine = useCallback((index) => {
    if (!meaningEnabled) return;
    setMeaningIndex((current) => (current === index ? current : index));
  }, [meaningEnabled]);

  const hideMeaning = useCallback(() => {
    setMeaningIndex(-1);
  }, []);

  // Auto-scroll the active line into view (centered) whenever it changes.
  useEffect(() => {
    if (disableAutoScroll) return;
    if (activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    if (el?.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIndex, disableAutoScroll]);

  useEffect(() => {
    if (!meaningEnabled) setMeaningIndex(-1);
  }, [meaningEnabled]);

  const hoverMeaning = useMemo(() => {
    if (!meaningEnabled || meaningIndex < 0) return null;
    return meaningForVerse(verses?.[meaningIndex], display);
  }, [display, meaningEnabled, meaningIndex, verses]);

  if (!verses || verses.length === 0) {
    return (
      <div className="empty-state">
        <h3>This Shabad is empty</h3>
        <p>Try another Shabad from the search page.</p>
      </div>
    );
  }

  // Meta + tracker now live in the parent ShabadPage's sticky bar — this
  // component is just the verse list.
  return (
    <article className="shabad-view">
      <ol className="shabad-lines">
        {verses.map((v, i) => {
          const showSection = showSectionHeadings && v.sectionTitle && v.sectionTitle !== verses[i - 1]?.sectionTitle;
          return (
            <Fragment key={v.verseId ?? i}>
              {showSection && (
                <li className={`shabad-section-heading${showSectionMeta ? '' : ' shabad-section-heading-simple'}`}>
                  <span>{v.sectionTitle}</span>
                  {showSectionMeta && v.sectionMeta && <small>{v.sectionMeta}</small>}
                </li>
              )}
              <ShabadLine
                verse={v}
                index={i}
                isActive={i === activeIndex}
                isPast={i < activeIndex && tracked}
                showTransliteration={display.showTransliteration}
                showEnglish={display.showEnglish}
                showPunjabi={display.showPunjabi}
                punjabiSteek={display.punjabiSteek}
                larivaar={!!display.larivaar}
                onClick={onLineClick}
                meaningEnabled={meaningEnabled}
                onMeaningEnter={showMeaningForLine}
                onMeaningLeave={hideMeaning}
                registerRef={registerRef}
              />
            </Fragment>
          );
        })}
      </ol>
      {hoverMeaning && (
        <aside className="shabad-meaning-bar" role="note">
          <div className="shabad-meaning-card">
            <div className="shabad-meaning-head">
              <span>Meaning</span>
              {meaningIndex >= 0 && <strong>Line {meaningIndex + 1}</strong>}
            </div>
            <div className="shabad-meaning-items">
              {hoverMeaning.items.map((item) => (
                <section key={item.id} className="shabad-meaning-item">
                  <span className="shabad-meaning-label">{item.label}</span>
                  <p className={item.className}>{item.text}</p>
                </section>
              ))}
            </div>
          </div>
        </aside>
      )}
    </article>
  );
}
