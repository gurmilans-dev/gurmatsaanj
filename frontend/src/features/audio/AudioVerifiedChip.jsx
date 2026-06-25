import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { readAudioVerified } from '../../utils/audioVerification';
import './AudioVerifiedChip.css';

/**
 * Live-screen chip that reflects the Audio Setup verification:
 *   ✓ Audio checked · HH:MM          — verified today, device still present
 *   ⚠ Audio checked earlier — re-check — verified on an earlier day
 *   ⚠ Mic changed — re-check audio    — the verified device is gone (unplugged)
 *   ⚠ Audio not checked               — never verified
 * Always links to /setup. Re-evaluates on devicechange and window focus (e.g.
 * after returning from /setup), and never prompts for mic permission.
 */
function sameDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

export default function AudioVerifiedChip() {
  const { lang, tLang } = useApp();
  const [verified, setVerified] = useState(() => readAudioVerified());
  const [devicePresent, setDevicePresent] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const v = readAudioVerified();
      if (cancelled) return;
      setVerified(v);
      if (v?.deviceId && navigator.mediaDevices?.enumerateDevices) {
        try {
          const list = await navigator.mediaDevices.enumerateDevices();
          if (cancelled) return;
          // After the one-time grant on /setup, deviceIds persist for the
          // origin, so we can tell if the verified device is still plugged in
          // without prompting. If the list is unlabeled/empty we stay optimistic.
          const inputs = list.filter((d) => d.kind === 'audioinput' && d.deviceId);
          setDevicePresent(inputs.length === 0 || inputs.some((d) => d.deviceId === v.deviceId));
        } catch { /* keep optimistic */ }
      } else {
        setDevicePresent(true);
      }
    };
    check();
    const onChange = () => check();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    window.addEventListener('focus', check);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
      window.removeEventListener('focus', check);
    };
  }, []);

  let tone;
  let text;
  if (!verified) {
    tone = 'warn';
    text = tLang('Audio not checked', 'ਆਡੀਓ ਜਾਂਚ ਨਹੀਂ ਹੋਈ');
  } else if (!devicePresent) {
    tone = 'warn';
    text = tLang('Mic changed — re-check audio', 'ਮਾਈਕ ਬਦਲ ਗਿਆ — ਆਡੀਓ ਮੁੜ ਜਾਂਚੋ');
  } else if (!sameDay(verified.verifiedAt)) {
    tone = 'stale';
    text = tLang('Audio checked earlier — re-check', 'ਪਹਿਲਾਂ ਜਾਂਚਿਆ — ਮੁੜ ਜਾਂਚੋ');
  } else {
    tone = 'ok';
    const time = new Date(verified.verifiedAt).toLocaleTimeString(
      lang === 'pa' ? 'pa-IN' : 'en-GB', { hour: '2-digit', minute: '2-digit' },
    );
    text = tLang(`Audio checked · ${time}`, `ਆਡੀਓ ਜਾਂਚਿਆ · ${time}`);
  }

  return (
    <Link
      to="/setup"
      className={`audio-verified-chip audio-verified-${tone}`}
      title={tLang('Open Audio & session setup', 'ਆਡੀਓ ਤੇ ਸੈਸ਼ਨ ਸੈੱਟਅੱਪ ਖੋਲ੍ਹੋ')}
    >
      <span aria-hidden="true">{tone === 'ok' ? '✓' : '⚠'}</span>
      <span lang={lang}>{text}</span>
    </Link>
  );
}
