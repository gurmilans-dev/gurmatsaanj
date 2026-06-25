import { useApp } from '../../../context/AppContext';
import './LangSwitcher.css';

/**
 * Global EN ⇄ ਪੰ language toggle. Reads from AppContext so it stays in sync
 * with any other lang-aware control in the app (e.g. the in-bani toggles).
 */
export default function LangSwitcher() {
  const { lang, setLang } = useApp();
  return (
    <div className="lang-switcher" role="group" aria-label="UI language">
      <button
        type="button"
        className={`lang-switcher-btn${lang === 'en' ? ' lang-switcher-btn-on' : ''}`}
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
        title="English"
      >
        EN
      </button>
      <button
        type="button"
        className={`lang-switcher-btn${lang === 'pa' ? ' lang-switcher-btn-on' : ''}`}
        onClick={() => setLang('pa')}
        aria-pressed={lang === 'pa'}
        lang="pa"
        title="ਪੰਜਾਬੀ"
      >
        ਪੰ
      </button>
    </div>
  );
}
