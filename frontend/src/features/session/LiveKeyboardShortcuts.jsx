import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PROJECTOR_EMERGENCY_ITEMS, useApp } from '../../context/AppContext';

function isInteractiveTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const selector = [
    'input',
    'textarea',
    'select',
    'button',
    'a',
    '[role="button"]',
    '[contenteditable="true"]',
  ].join(',');
  return Boolean(target.closest?.(selector));
}

export default function LiveKeyboardShortcuts() {
  const navigate = useNavigate();
  const {
    remotePairing,
    setProjectorEmergencyMode,
    setProjectorViewMode,
    setSangatQrFullscreen,
    pushToast,
  } = useApp();

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isInteractiveTarget(event.target)) return;

      const key = String(event.key || '').toLowerCase();
      if (key === 'w') {
        event.preventDefault();
        setProjectorEmergencyMode?.('waheguru');
      } else if (key === 'b') {
        event.preventDefault();
        setProjectorEmergencyMode?.('blank');
      } else if (key === 's') {
        event.preventDefault();
        setSangatQrFullscreen?.(false);
        setProjectorViewMode?.('shabad');
      } else if (key === 'q') {
        event.preventDefault();
        if (!remotePairing?.followCode) {
          pushToast?.({
            kind: 'info',
            title: 'Sangat View not ready',
            message: 'Open the projector first so a share code is generated.',
            timeoutMs: 3500,
          });
          return;
        }
        setProjectorEmergencyMode?.(null);
        setSangatQrFullscreen?.(true);
      } else if (key === 'a') {
        const anand = PROJECTOR_EMERGENCY_ITEMS.find((item) => item.id === 'anand-sahib');
        if (!anand?.shabadId) return;
        event.preventDefault();
        setSangatQrFullscreen?.(false);
        setProjectorViewMode?.('shabad');
        const qs = anand.bundle ? `?bundle=${encodeURIComponent(anand.bundle)}` : '';
        navigate(`/shabad/${encodeURIComponent(anand.shabadId)}${qs}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    navigate,
    pushToast,
    remotePairing?.followCode,
    setProjectorEmergencyMode,
    setProjectorViewMode,
    setSangatQrFullscreen,
  ]);

  return null;
}
