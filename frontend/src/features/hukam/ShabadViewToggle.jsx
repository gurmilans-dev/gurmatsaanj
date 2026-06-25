import './ShabadViewToggle.css';

/**
 * Two-button segmented control to switch a shabad between the line-by-line
 * Reader and the prose / Hukamnama layout. Presentational only — the parent
 * owns the `mode` state. Self-contained styles so it renders as a real
 * segmented control on any page.
 *
 *   mode: 'reader' | 'prose'
 */
export default function ShabadViewToggle({ mode = 'reader', onChange, lang = 'en', tLang }) {
  const t = typeof tLang === 'function' ? tLang : (en) => en;
  const set = (next) => () => { if (next !== mode) onChange?.(next); };

  return (
    <div className="shabad-view-toggle" role="radiogroup" aria-label={t('View mode', 'ਦ੍ਰਿਸ਼')}>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'reader'}
        className={`shabad-view-toggle-btn${mode === 'reader' ? ' shabad-view-toggle-btn-on' : ''}`}
        onClick={set('reader')}
        lang={lang}
      >
        {t('Reader', 'ਰੀਡਰ')}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'prose'}
        className={`shabad-view-toggle-btn${mode === 'prose' ? ' shabad-view-toggle-btn-on' : ''}`}
        onClick={set('prose')}
        lang={lang}
      >
        {t('Prose', 'ਪੈਰਾ')}
      </button>
    </div>
  );
}
