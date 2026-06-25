import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Link, useLocation } from 'react-router-dom';
import ThemeSwitcher from '../ThemeSwitcher/ThemeSwitcher';
import LangSwitcher from '../LangSwitcher/LangSwitcher';
import LiveHealthCheck from '../../../features/session/LiveHealthCheck';
import { useApp } from '../../../context/AppContext';
import { createQrMatrix, qrPath, QR_SIZE } from '../../../utils/qrCode';
import './Header.css';

const PRIMARY_NAV = [
  { to: '/kirtan',   label: 'Kirtan',   labelPa: 'ਕੀਰਤਨ' },
  { to: '/katha',    label: 'Katha',    labelPa: 'ਕਥਾ' },
  { to: '/bani',     label: 'Bani',     labelPa: 'ਬਾਣੀ' },
  { to: '/calendar', label: 'Calendar', labelPa: 'ਜੰਤਰੀ' },
  { to: '/remote',   label: 'Remote',   labelPa: 'Remote' },
];

/**
 * Sri Guru Granth Sahib Ji icon - an open Gutka (scripture) with Ik Onkar
 * above it. Drawn as inline SVG so colours are themed via currentColor.
 */
const GGSJIcon = ({ className = 'header-logo-mark' }) => (
  <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
    <circle cx="32" cy="32" r="30" className="header-logo-bg" />

    <text
      x="32"
      y="26"
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize="18"
      fontFamily="Noto Serif Gurmukhi, Mukta Mahee, serif"
      className="header-logo-blade"
    >
      ੴ
    </text>

    <g className="header-logo-blade">
      <rect x="31" y="34" width="2" height="16" rx="1" />
      <path d="M 31 35 Q 20 34 16 38 L 16 50 Q 20 46 31 47 Z" />
      <path d="M 33 35 Q 44 34 48 38 L 48 50 Q 44 46 33 47 Z" />
    </g>

    <g className="header-logo-ring" fill="none" strokeWidth="0.9" strokeLinecap="round" opacity="0.55">
      <line x1="20" y1="40" x2="29" y2="39.5" />
      <line x1="20" y1="43" x2="29" y2="42.5" />
      <line x1="20" y1="46" x2="29" y2="45.5" />
      <line x1="35" y1="39.5" x2="44" y2="40" />
      <line x1="35" y1="42.5" x2="44" y2="43" />
      <line x1="35" y1="45.5" x2="44" y2="46" />
    </g>
  </svg>
);

/**
 * Nav label that reserves the width of BOTH the English and Punjabi text, so a
 * link's width doesn't change when the global language toggles. Without this,
 * the nav shrinks/grows on switch and pushes the header controls (the EN ⇄ ਪੰ
 * toggle especially) sideways. Both labels stack in one grid cell; the inactive
 * one is `visibility:hidden`, which keeps its space (and hides it from a11y).
 */
const NavLabel = ({ en, pa, lang }) => (
  <span className="nav-link-label">
    <span className={`nav-link-label-slot${lang === 'pa' ? ' is-ghost' : ''}`} lang="en">{en}</span>
    <span className={`nav-link-label-slot${lang === 'pa' ? '' : ' is-ghost'}`} lang="pa">{pa || en}</span>
  </span>
);

const GurmatSaanjLogo = ({ className = 'header-logo-mark' }) => (
  <span className={className} aria-hidden="true">
    <img
      className="header-logo-img header-logo-img-light"
      src="/brand/gurmat-saanj-mark-light.png"
      alt=""
      width="46"
      height="46"
    />
    <img
      className="header-logo-img header-logo-img-dark"
      src="/brand/gurmat-saanj-mark-dark.png"
      alt=""
      width="46"
      height="46"
    />
  </span>
);

function remotePairUrl(code) {
  if (!code || typeof window === 'undefined') return '';
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL || import.meta.env.VITE_PUBLIC_REMOTE_URL || window.location.origin;
  const url = new URL('/remote', configuredBase);
  url.searchParams.set('code', code);
  return url.toString();
}

function RemoteQrCode({ value }) {
  const matrix = useMemo(() => {
    try { return createQrMatrix(value); } catch { return null; }
  }, [value]);
  if (!matrix) {
    return (
      <div className="header-remote-qr-fallback" role="img" aria-label="Remote QR unavailable">
        QR unavailable
      </div>
    );
  }
  const margin = 4;
  const size = QR_SIZE + margin * 2;
  return (
    <svg
      className="header-remote-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Scan to pair remote"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={qrPath(matrix, margin)} fill="#111" />
    </svg>
  );
}

export default function Header() {
  const {
    libraryOpen,
    toggleLibrary,
    shabadQueue,
    remotePairing,
    resetRemotePairing,
    approveRemoteControlRequest,
    kickRemoteClient,
    pushToast,
    lang,
    tLang,
  } = useApp();
  const [approvingRemote, setApprovingRemote] = useState(false);
  const [kickingRemoteId, setKickingRemoteId] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [remoteQrOpen, setRemoteQrOpen] = useState(false);
  const remoteWrapRef = useRef(null);
  const location = useLocation();
  // Close the drawer whenever the user navigates so it doesn't sit open
  // covering the page they just landed on.
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);
  // Lock the page scroll while the drawer is open so the body doesn't
  // scroll under it on phones.
  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileNavOpen]);
  const queueCount = Array.isArray(shabadQueue) ? shabadQueue.length : 0;
  const remoteCode = remotePairing?.code || '';
  const remoteActive = Boolean(remotePairing?.hostConnected);
  const remoteRequests = Array.isArray(remotePairing?.pendingRequests)
    ? remotePairing.pendingRequests
    : [];
  const remoteRequest = remoteRequests[0] || null;
  const remoteClients = useMemo(() => {
    const clients = Array.isArray(remotePairing?.clients) ? remotePairing.clients : [];
    return clients
      .filter((client) => client?.clientId)
      .slice()
      .sort((a, b) => Number(Boolean(b.isController)) - Number(Boolean(a.isController)));
  }, [remotePairing?.clients]);
  const remoteClientCount = remoteClients.length || Number(remotePairing?.clientCount || 0);
  const remoteClientNames = remoteClients
    .map((client) => client.name || 'Remote device')
    .slice(0, 3)
    .join(', ');
  const remoteClientSummary = remoteClientCount > 0
    ? `${remoteClientCount} paired${remoteClientNames ? `: ${remoteClientNames}${remoteClientCount > 3 ? '...' : ''}` : ''}`
    : '';
  const remoteUrl = useMemo(() => remotePairUrl(remoteCode), [remoteCode]);
  const remoteUrlUsesLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(remoteUrl);
  useEffect(() => {
    if (!remoteQrOpen) return undefined;
    const close = (event) => {
      if (remoteWrapRef.current?.contains(event.target)) return;
      setRemoteQrOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setRemoteQrOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [remoteQrOpen]);
  const resetRemoteCode = async () => {
    try {
      const next = await resetRemotePairing?.();
      pushToast?.({
        kind: 'success',
        title: 'Remote code changed',
        message: next?.code ? `New remote code: ${next.code}` : 'Remote devices need to pair again.',
        timeoutMs: 2600,
      });
    } catch (err) {
      pushToast?.({
        kind: 'error',
        title: 'Could not reset remote',
        message: err?.response?.data?.error || err.message || 'Try again after the backend reconnects.',
      });
    }
  };
  const approveRemoteRequest = async (request = remoteRequest) => {
    if (!request?.clientId || approvingRemote) return;
    setApprovingRemote(true);
    try {
      const result = await approveRemoteControlRequest?.(request.clientId);
      pushToast?.({
        kind: 'success',
        title: 'Remote control approved',
        message: `${result?.grantedTo?.name || request.name || 'Remote device'} can control now.`,
        timeoutMs: 2600,
      });
    } catch (err) {
      pushToast?.({
        kind: 'error',
        title: 'Could not approve remote',
        message: err?.response?.data?.error || err.message || 'Ask the device to request control again.',
      });
    } finally {
      setApprovingRemote(false);
    }
  };
  const kickRemoteDevice = async (client) => {
    if (!client?.clientId || kickingRemoteId) return;
    setKickingRemoteId(client.clientId);
    try {
      const result = await kickRemoteClient?.(client.clientId);
      pushToast?.({
        kind: 'success',
        title: 'Remote removed',
        message: `${result?.removed?.name || client.name || 'Remote device'} was disconnected.`,
        timeoutMs: 2600,
      });
    } catch (err) {
      pushToast?.({
        kind: 'error',
        title: 'Could not remove remote',
        message: err?.response?.data?.error || err.message || 'Try again after the backend reconnects.',
      });
    } finally {
      setKickingRemoteId('');
    }
  };

  return (
    <header className="site-header">
      <div className="app-container site-header-inner">
        <Link to="/" className="header-brand" aria-label="Gurmat Saanj home">
          <GurmatSaanjLogo />
          <span className="header-brand-text">
            <span className="header-brand-name">Gurmat&nbsp;Saanj</span>
            <span className="header-brand-tag">Every Line. Live.</span>
          </span>
        </Link>

        <div className="header-right">
          <LangSwitcher />
          <ThemeSwitcher />
          <LiveHealthCheck />

          {remoteCode && (
            <div className="header-remote-wrap" ref={remoteWrapRef}>
              <button
                type="button"
                className={`header-remote-code${remoteActive ? ' header-remote-code-on' : ''}${remoteRequest ? ' header-remote-code-requested' : ''}`}
                onClick={() => setRemoteQrOpen((open) => !open)}
                title="Show QR code for remote pairing."
                aria-label={`Remote pairing code ${remoteCode}. Show QR code.`}
                aria-expanded={remoteQrOpen}
              >
                <span className="header-remote-dot" aria-hidden="true" />
                <span lang={lang}>{tLang('Remote', 'Remote')}</span>
                <strong>{remoteCode}</strong>
                {remoteRequest ? (
                  <small className="header-remote-request">
                    Request: {remoteRequest.name || 'Remote device'}
                  </small>
                ) : remoteClientSummary ? (
                  <small>{remoteClientCount} paired</small>
                ) : remotePairing?.controllerName && (
                  <small>{remotePairing.controllerName}</small>
                )}
              </button>
              {remoteQrOpen && (
                <div className="header-remote-popover" role="dialog" aria-label="Remote QR pairing">
                  <div className="header-remote-popover-head">
                    <div>
                      <p className="section-eyebrow">Remote pairing</p>
                      <strong>Scan or enter code</strong>
                    </div>
                    <button
                      type="button"
                      className="header-remote-popover-close"
                      onClick={() => setRemoteQrOpen(false)}
                      aria-label="Close remote QR"
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                        <path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  <RemoteQrCode value={remoteUrl} />
                  <div className="header-remote-popover-code">
                    <span>Code</span>
                    <strong>{remoteCode}</strong>
                  </div>
                  <p className="header-remote-popover-copy">
                    Phone camera opens the remote and fills the code automatically.
                  </p>
                  {remoteClientSummary && (
                    <section className="header-remote-device-section" aria-label="Paired remote devices">
                      <div className="header-remote-device-section-head">
                        <span>Paired devices</span>
                        <strong>{remoteClientCount}</strong>
                      </div>
                      <ul className="header-remote-device-list">
                        {remoteClients.map((client) => (
                          <li key={client.clientId}>
                            <div>
                              <strong>{client.name || 'Remote device'}</strong>
                              <small>
                                {client.isController ? 'Controller' : client.pendingControl ? 'Requested control' : 'Viewer'}
                              </small>
                            </div>
                            <button
                              type="button"
                              className="header-remote-device-kick"
                              onClick={() => kickRemoteDevice(client)}
                              disabled={kickingRemoteId === client.clientId}
                            >
                              {kickingRemoteId === client.clientId ? 'Removing' : 'Kick'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {remoteRequests.length > 0 && (
                    <section className="header-remote-device-section" aria-label="Remote control requests">
                      <div className="header-remote-device-section-head">
                        <span>Control requests</span>
                        <strong>{remoteRequests.length}</strong>
                      </div>
                      <ul className="header-remote-device-list">
                        {remoteRequests.map((request) => (
                          <li key={request.clientId}>
                            <div>
                              <strong>{request.name || 'Remote device'}</strong>
                              <small>Wants to control</small>
                            </div>
                            <button
                              type="button"
                              className="header-remote-device-allow"
                              onClick={() => approveRemoteRequest(request)}
                              disabled={approvingRemote}
                            >
                              {approvingRemote ? 'Allowing' : 'Allow'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {remoteUrlUsesLocalhost && (
                    <p className="header-remote-popover-warning">
                      For phones, open the main app using this computer's network IP instead of localhost.
                    </p>
                  )}
                  <div className="header-remote-popover-actions">
                    <a className="btn-ghost" href={remoteUrl}>
                      Open remote
                    </a>
                    <button type="button" className="btn-ghost" onClick={resetRemoteCode}>
                      New code
                    </button>
                  </div>
                </div>
              )}
              {remoteRequest && (
                <button
                  type="button"
                  className="header-remote-approve"
                  onClick={() => approveRemoteRequest(remoteRequest)}
                  disabled={approvingRemote}
                  title="Allow this remote to take control"
                >
                  {approvingRemote ? 'Allowing...' : 'Allow'}
                </button>
              )}
            </div>
          )}

          <nav className="site-nav" aria-label="Primary">
            {PRIMARY_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => 'nav-link' + (isActive ? ' nav-link-active' : '')}
              >
                <NavLabel en={item.label} pa={item.labelPa} lang={lang} />
              </NavLink>
            ))}
          </nav>

          {/* Library lives at the very right edge so it isn't lost in the
              middle of the header. Queue badge surfaces setlist size. */}
          <button
            type="button"
            className={`header-library-btn${libraryOpen ? ' header-library-btn-active' : ''}`}
            onClick={toggleLibrary}
            aria-pressed={libraryOpen}
            aria-label={`${libraryOpen ? 'Close' : 'Open'} library — queue, history, saved`}
            title="Library — Queue · History · Saved"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M4 5h12M4 9h12M4 13h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M18 13v8M14 17h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {queueCount > 0 && (
              <span className="header-library-badge" aria-hidden="true">{Math.min(queueCount, 9)}</span>
            )}
          </button>

          {/* Mobile hamburger — visible only on phone via CSS. Opens a drawer
              with the same nav links + theme switcher + remote info, so the
              header doesn't have to cram 8 elements into one row at 360px. */}
          <button
            type="button"
            className={`header-mobile-toggle${mobileNavOpen ? ' header-mobile-toggle-on' : ''}`}
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-expanded={mobileNavOpen}
            aria-controls="site-mobile-drawer"
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
          >
            <span className="header-mobile-bars" aria-hidden="true">
              <span /><span /><span />
            </span>
          </button>
        </div>
      </div>

      {/* Mobile drawer — slides in from the right on phone. Rendered into
          document.body via a Portal so that the header's backdrop-filter
          (which creates a containing block for `position: fixed`
          descendants) doesn't clip the drawer to header height. Without
          the portal, only the title row was visible because the drawer
          got constrained to the 72px header bounds. */}
      {createPortal(
      <div
        id="site-mobile-drawer"
        className={`site-mobile-drawer${mobileNavOpen ? ' site-mobile-drawer-open' : ''}`}
        aria-hidden={!mobileNavOpen}
      >
        <div
          className="site-mobile-drawer-scrim"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
        <aside className="site-mobile-drawer-panel" aria-label="Mobile navigation">
          <div className="site-mobile-drawer-head">
            <span className="site-mobile-drawer-title">Gurmat Saanj</span>
            <button
              type="button"
              className="site-mobile-drawer-close"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <nav className="site-mobile-nav" aria-label="Primary (mobile)">
            {PRIMARY_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => 'site-mobile-nav-link' + (isActive ? ' site-mobile-nav-link-active' : '')}
              >
                <span lang={lang}>{lang === 'pa' ? (item.labelPa || item.label) : item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="site-mobile-drawer-row">
            <span className="site-mobile-drawer-label" lang={lang}>{tLang('Language', 'ਭਾਸ਼ਾ')}</span>
            <LangSwitcher />
          </div>

          <div className="site-mobile-drawer-row">
            <span className="site-mobile-drawer-label" lang={lang}>{tLang('Theme', 'ਥੀਮ')}</span>
            <ThemeSwitcher />
          </div>

          {remoteCode && (
            <div className="site-mobile-drawer-row">
              <span className="site-mobile-drawer-label" lang={lang}>{tLang('Remote', 'Remote')}</span>
              <div className="site-mobile-drawer-remote">
                <span className="header-remote-dot" aria-hidden="true" />
                <strong>{remoteCode}</strong>
                {remoteClientCount > 0 && <span>{remoteClientCount} paired</span>}
                <a className="btn-ghost" href={remoteUrl}>
                  QR link
                </a>
                <button type="button" className="btn-ghost" onClick={resetRemoteCode}>
                  New code
                </button>
              </div>
              {remoteRequest && (
                <button
                  type="button"
                  className="header-remote-approve"
                  onClick={() => approveRemoteRequest(remoteRequest)}
                  disabled={approvingRemote}
                >
                  {approvingRemote ? 'Allowing…' : `Allow ${remoteRequest.name || 'request'}`}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>,
      document.body
      )}
    </header>
  );
}
