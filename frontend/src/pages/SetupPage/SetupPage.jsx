import { useNavigate } from 'react-router-dom';
import AudioCheckPanel from '../../features/audio/AudioCheckPanel';
import { useApp } from '../../context/AppContext';
import './SetupPage.css';

/**
 * Preflight / "Live Setup" page. Today it hosts the Audio Check; the offline-
 * pack prep can move here later to become the single session-setup surface.
 */
export default function SetupPage() {
  const navigate = useNavigate();
  const { lang, tLang } = useApp();

  return (
    <div className="app-container setup-page">
      <div className="setup-page-top">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/kirtan'); }}
        >
          <span aria-hidden="true">&lt;</span> <span lang={lang}>{tLang('Back', 'ਵਾਪਸ')}</span>
        </button>
      </div>

      <header className="setup-page-head">
        <p className="section-eyebrow" lang={lang}>{tLang('Live setup · Preflight', 'ਲਾਈਵ ਸੈੱਟਅੱਪ · ਪ੍ਰੀਫਲਾਈਟ')}</p>
        <h1 className="setup-page-title" lang={lang}>{tLang('Audio & session setup', 'ਆਡੀਓ ਤੇ ਸੈਸ਼ਨ ਸੈੱਟਅੱਪ')}</h1>
        <p className="setup-page-sub" lang={lang}>
          {tLang(
            'Check the audio path before Kirtan or Katha, especially when feeding a mixer output into the laptop.',
            'ਕੀਰਤਨ ਜਾਂ ਕਥਾ ਤੋਂ ਪਹਿਲਾਂ ਆਡੀਓ ਰਾਹ ਜਾਂਚੋ, ਖ਼ਾਸ ਕਰਕੇ ਜਦੋਂ ਮਿਕਸਰ ਆਉਟਪੁਟ ਲੈਪਟਾਪ ਨਾਲ ਜੋੜਿਆ ਹੋਵੇ।',
          )}
        </p>
      </header>

      <AudioCheckPanel />
    </div>
  );
}
