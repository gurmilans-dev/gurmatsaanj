import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ShabadProse from '../../features/hukam/ShabadProse';
import ShabadViewToggle from '../../features/hukam/ShabadViewToggle';
import ShabadView from '../../features/shabadView/ShabadView';
import Loader from '../../components/common/Loader/Loader';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import './HukamPage.css';

/**
 * Today's Hukamnama from Sri Harmandir Sahib. Two layouts, switchable:
 *   - 'prose'  → full shabad + meaning as flowing prose (ShabadProse). Default.
 *   - 'reader' → the familiar line-by-line layout (static ShabadView, no mic).
 *
 * Two cheap, separately-cached calls:
 *   1. getDailyHukam()      → today's shabadId (+ date), bucketed by date.
 *   2. getShabad(shabadId)  → the full verses, cached 14 days by the api layer.
 * Both fall back to localStorage when offline, so an already-seen Hukam still
 * opens without network.
 */
export default function HukamPage() {
  const { lang, tLang, display } = useApp();
  const [state, setState] = useState({ loading: true, shabad: null, date: null, error: null });
  const [viewMode, setViewMode] = useState('prose');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hukam = await api.getDailyHukam();
        const first = hukam?.shabads?.[0];
        const shabadId = first?.shabadId;
        if (!shabadId) throw new Error('No Hukamnama is available right now.');
        const shabad = await api.getShabad(shabadId);
        if (cancelled) return;
        setState({ loading: false, shabad, date: hukam?.date || null, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          shabad: null,
          date: null,
          error: err?.response?.data?.error || err?.message || 'Could not load the Hukamnama.',
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { loading, shabad, date, error } = state;

  const dateLocale = lang === 'pa' ? 'pa-IN' : 'en-GB';
  const dateLabel = date
    ? new Date(date.year, (date.month || 1) - 1, date.date || 1).toLocaleDateString(dateLocale, {
        weekday: 'long', month: 'long', day: 'numeric',
      })
    : '';

  const shabadId = shabad?.meta?.shabadId;

  return (
    <div className="app-container hukam-page">
      <header className="hukam-page-head">
        <p className="section-eyebrow" lang={lang}>
          {tLang("Today's Hukamnama · Sri Harmandir Sahib", 'ਅੱਜ ਦਾ ਹੁਕਮਨਾਮਾ · ਸ੍ਰੀ ਹਰਿਮੰਦਰ ਸਾਹਿਬ')}
        </p>
        {dateLabel && <h1 className="hukam-page-date">{dateLabel}</h1>}
        {!loading && !error && shabad && (
          <div className="hukam-page-controls">
            <ShabadViewToggle mode={viewMode} onChange={setViewMode} lang={lang} tLang={tLang} />
            {shabadId && (
              <Link className="btn btn-secondary btn-sm hukam-page-live-link" to={`/shabad/${encodeURIComponent(shabadId)}`}>
                <span lang={lang}>{tLang('Open in live reader', 'ਲਾਈਵ ਰੀਡਰ ਵਿੱਚ ਖੋਲ੍ਹੋ')}</span>
                <span aria-hidden="true"> →</span>
              </Link>
            )}
          </div>
        )}
      </header>

      {loading && (
        <div className="hukam-page-state">
          <Loader label={tLang('Loading the Hukamnama…', 'ਹੁਕਮਨਾਮਾ ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ…')} size="lg" />
        </div>
      )}

      {!loading && error && (
        <div className="hukam-page-state hukam-page-error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && shabad && (
        <>
          {viewMode === 'prose' ? (
            <ShabadProse
              meta={shabad.meta}
              verses={shabad.verses}
              lang={lang}
              tLang={tLang}
              larivaar={!!display?.larivaar}
              punjabiSteek={display?.punjabiSteek || 'ss'}
            />
          ) : (
            <ShabadView
              meta={shabad.meta}
              verses={shabad.verses}
              activeIndex={-1}
              confidence={0}
              tracked={false}
              isListening={false}
            />
          )}
        </>
      )}
    </div>
  );
}
