import { useApp } from '../../../context/AppContext';
import './ThemeSwitcher.css';

/**
 * Theme switcher — light / dark toggle. Accent is fixed to kesari.
 */
export default function ThemeSwitcher() {
  const { theme, setTheme } = useApp();

  return (
    <div className="theme-switcher" role="group" aria-label="Theme">
      <div className="theme-group" role="radiogroup" aria-label="Brightness">
        <button
          type="button"
          role="radio"
          aria-checked={theme.variant === 'light'}
          className={`theme-btn${theme.variant === 'light' ? ' theme-btn-on' : ''}`}
          onClick={() => setTheme({ variant: 'light' })}
          title="Light mode"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="8" cy="8" r="3" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <line x1="8" y1="1.5" x2="8" y2="3" />
              <line x1="8" y1="13" x2="8" y2="14.5" />
              <line x1="1.5" y1="8" x2="3" y2="8" />
              <line x1="13" y1="8" x2="14.5" y2="8" />
              <line x1="3.2" y1="3.2" x2="4.3" y2="4.3" />
              <line x1="11.7" y1="11.7" x2="12.8" y2="12.8" />
              <line x1="3.2" y1="12.8" x2="4.3" y2="11.7" />
              <line x1="11.7" y1="4.3" x2="12.8" y2="3.2" />
            </g>
          </svg>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={theme.variant === 'dark'}
          className={`theme-btn${theme.variant === 'dark' ? ' theme-btn-on' : ''}`}
          onClick={() => setTheme({ variant: 'dark' })}
          title="Dark mode"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M11 2.5a6 6 0 1 0 2.5 9.5A5 5 0 0 1 11 2.5Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
