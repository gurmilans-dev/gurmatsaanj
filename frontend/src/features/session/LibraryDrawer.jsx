import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import SessionTools from './SessionTools';
import './LibraryDrawer.css';

/**
 * Slide-in drawer that hosts the queue / history / saved tools so they're
 * accessible from any page without crowding the main column. Mounted once
 * inside <Layout> — controlled by `libraryOpen` in AppContext.
 */
export default function LibraryDrawer() {
  const { libraryOpen, closeLibrary, voice, openProjector } = useApp();
  const location = useLocation();
  const isKathaContext =
    location.pathname === '/katha' ||
    location.pathname.startsWith('/ang') ||
    new URLSearchParams(location.search).get('katha') === '1';

  // Close on Escape so a stray drawer doesn't trap the user.
  useEffect(() => {
    if (!libraryOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeLibrary(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [libraryOpen, closeLibrary]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!libraryOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [libraryOpen]);

  return (
    <>
      <div
        className={`library-backdrop${libraryOpen ? ' library-backdrop-on' : ''}`}
        onClick={closeLibrary}
        aria-hidden={!libraryOpen}
      />
      <aside
        className={`library-drawer${libraryOpen ? ' library-drawer-on' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Library"
        aria-hidden={!libraryOpen}
      >
        <header className="library-drawer-head">
          <div>
            <p className="section-eyebrow">Library</p>
            <h2 className="library-drawer-title">Setlist · History · Saved</h2>
          </div>
          <button
            type="button"
            className="library-drawer-close"
            onClick={closeLibrary}
            aria-label="Close library"
            title="Close"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="library-drawer-body">
          <SessionTools
            isKatha={isKathaContext}
            openAs="shabad"
            onOpen={() => {
              voice.stop?.();
              voice.reset?.();
              openProjector?.();
              closeLibrary();
            }}
          />
        </div>
      </aside>
    </>
  );
}
