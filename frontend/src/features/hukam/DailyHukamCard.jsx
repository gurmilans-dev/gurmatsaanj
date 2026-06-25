import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { trimToWords } from '../../utils/gurmukhi';
import './DailyHukamCard.css';

/**
 * Today's Hukamnama from Sri Harmandir Sahib. Loads once when mounted (the
 * api layer caches by Gregorian date so navigating in/out is free). Renders
 * a compact card with the first pankti, raag, writer, and a tap-to-open
 * link to the full shabad reader. Stays silent on failure — this is a
 * "nice to have", not blocking.
 */
export default function DailyHukamCard({ sessionId = 'kirtan' }) {
  const { lang, tLang } = useApp();
  const [state, setState] = useState({ loading: true, data: null });

  useEffect(() => {
    let cancelled = false;
    api.getDailyHukam()
      .then((data) => {
        if (cancelled) return;
        setState({ loading: false, data });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, data: null });
      });
    return () => { cancelled = true; };
  }, []);

  const first = state.data?.shabads?.[0];
  if (state.loading || !first?.shabadId) return null;

  // Tapping the card opens the dedicated Hukamnama view (full shabad + meaning
  // as prose). Katha sessions still go to the line-by-line reader so the live
  // commentary tracking works.
  const shabadHref = sessionId === 'katha'
    ? `/shabad/${encodeURIComponent(first.shabadId)}?katha=1`
    : '/hukam';

  const date = state.data?.date;
  const dateLocale = lang === 'pa' ? 'pa-IN' : 'en-GB';
  const dateLabel = date
    ? new Date(date.year, (date.month || 1) - 1, date.date || 1).toLocaleDateString(dateLocale, {
        weekday: 'long', month: 'long', day: 'numeric',
      })
    : '';

  const firstLine = first.firstLineGurmukhi || '';
  const meta = [first.raag, first.writer, first.pageNo ? `Ang ${first.pageNo}` : null].filter(Boolean);

  return (
    <Link to={shabadHref} className="daily-hukam-card" aria-label="Today's Hukam from Sri Harmandir Sahib">
      <span className="daily-hukam-card-eyebrow" lang={lang}>
        {tLang("Today's Hukam · Sri Harmandir Sahib", "ਅੱਜ ਦਾ ਹੁਕਮਨਾਮਾ · ਸ੍ਰੀ ਹਰਿਮੰਦਰ ਸਾਹਿਬ")}
      </span>
      {dateLabel && <small className="daily-hukam-card-date">{dateLabel}</small>}
      <p className="daily-hukam-card-gurmukhi gurmukhi" lang="pa">
        {trimToWords(firstLine, 14)}
      </p>
      {meta.length > 0 && (
        <p className="daily-hukam-card-meta">
          {meta.map((m, i) => (
            <span key={i} className="meta-pill meta-pill-muted">{m}</span>
          ))}
        </p>
      )}
      <span className="daily-hukam-card-cta" lang={lang}>
        {tLang('Open Hukam', 'ਹੁਕਮਨਾਮਾ ਖੋਲ੍ਹੋ')} <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}
