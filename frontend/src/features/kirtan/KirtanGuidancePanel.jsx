import { useEffect, useState } from 'react';
import {
  getMonthKirtanGuide,
  getPeharGuide,
  getRaagSearchSuggestion,
  RAAG_TIMING_SOURCES,
} from '../../data/kirtanGuidance';
import { getNanakshahiMonthDay } from '../../data/sikhCalendar';
import './KirtanGuidancePanel.css';

const STORAGE_KEY = 'saanj-kirtan.kirtanGuideCollapsed';

export default function KirtanGuidancePanel({ date = new Date(), onSearchSuggestion, compact = false }) {
  const pehar = getPeharGuide(date);
  const nsDate = getNanakshahiMonthDay(date);
  const monthGuide = getMonthKirtanGuide(nsDate.month.id);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch { /* noop */ }
  }, [collapsed]);

  return (
    <section className={`kirtan-guide${compact ? ' kirtan-guide-compact' : ''}${collapsed ? ' kirtan-guide-collapsed' : ''}`} aria-label="Kirtan raag guide">
      <header className="kirtan-guide-head">
        <div>
          <p className="section-eyebrow">Kirtan Guide</p>
          <h2>Raag for now</h2>
        </div>
        <div className="kirtan-guide-head-actions">
          <span>{pehar.timeLabel}</span>
          <button
            type="button"
            className="kirtan-guide-collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand kirtan guide' : 'Minimize kirtan guide'}
            title={collapsed ? 'Expand kirtan guide' : 'Minimize kirtan guide'}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              {collapsed ? (
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </header>

      {collapsed ? (
        <div className="kirtan-guide-mini">
          <span>{pehar.label}</span>
          <strong>{pehar.raags.slice(0, 3).join(' · ')}</strong>
          <span>{monthGuide.title}</span>
        </div>
      ) : (
        <>
          <div className="kirtan-guide-grid">
            <GuideBlock
              title={pehar.label}
              meta="Pehar of day"
              note={pehar.note}
              raags={pehar.raags}
              suggestions={pehar.suggestions}
              onSearchSuggestion={onSearchSuggestion}
              onRaagSelect={onSearchSuggestion}
            />
            <GuideBlock
              title={`${monthGuide.title} mahina`}
              meta={`${nsDate.month.name} ${nsDate.day}, Nanakshahi ${nsDate.nanakshahiYear}`}
              note={monthGuide.mood}
              raags={monthGuide.raags}
              suggestions={monthGuide.suggestions}
              onSearchSuggestion={onSearchSuggestion}
              onRaagSelect={onSearchSuggestion}
            />
          </div>

          {!compact && (
            <p className="kirtan-guide-source">
              Raag timing follows common Gurbani raag-time tables. Seasonal raags:
              Basant in spring, Malaar in rainy season.
              {' '}
              <a href={RAAG_TIMING_SOURCES[0].url} target="_blank" rel="noreferrer">Source</a>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function gurmukhiLabelFor(suggestion) {
  return suggestion?.labelGurmukhi || suggestion?.gurmukhi || suggestion?.query || suggestion?.label || '';
}

function GuideBlock({ title, meta, note, raags, suggestions, onSearchSuggestion, onRaagSelect }) {
  return (
    <article className="kirtan-guide-block">
      <div className="kirtan-guide-block-head">
        <div>
          <h3>{title}</h3>
          <p>{meta}</p>
        </div>
      </div>

      <div className="kirtan-guide-raags" aria-label={`Suggested raags for ${title}`}>
        {raags.map((raag) => {
          const suggestion = getRaagSearchSuggestion(raag);
          return (
            <button
              key={raag}
              type="button"
              onClick={() => suggestion && onRaagSelect?.(suggestion)}
              title={`Show Shabads in ${raag}`}
            >
              {raag}
            </button>
          );
        })}
      </div>

      <p className="kirtan-guide-note">{note}</p>

      <div className="kirtan-guide-actions" aria-label={`Suggested Shabads for ${title}`}>
        {suggestions.slice(0, 3).map((suggestion) => (
          <button
            key={`${suggestion.label}-${suggestion.query}`}
            type="button"
            className="kirtan-guide-suggestion"
            onClick={() => onSearchSuggestion?.(suggestion)}
            title={suggestion.raag || suggestion.label}
          >
            <span className="kirtan-guide-suggestion-text">
              <span className="kirtan-guide-suggestion-gurmukhi gurmukhi">{gurmukhiLabelFor(suggestion)}</span>
              <small>{suggestion.label}</small>
            </span>
            {suggestion.raag && <small className="kirtan-guide-suggestion-raag">{suggestion.raag}</small>}
          </button>
        ))}
      </div>
    </article>
  );
}
