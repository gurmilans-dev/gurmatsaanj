import { useEffect, useRef } from 'react';
import { matchLine } from '../utils/matchLine';

/**
 * useAnandSahibWatch — an always-on listener for the 6-pauri Anand Sahib.
 *
 * In both kirtan and katha, Anand Sahib (the chhe-pauri Bhog version) is sung
 * at the close of almost every program — but it can start from anywhere, while
 * a completely different shabad is open. The normal detectors only look at the
 * queue (kirtan) or the reading-order neighbourhood (katha), so they'd miss it.
 *
 * This watcher runs independently of those: it scores the recent transcript
 * against Anand Sahib's distinctive opening and, on a confident hit, fires
 * onDetect() so the page can open the bundle (/shabad/333375?bundle=anand-sahib).
 *
 * It's deliberately isolated and additive — it never touches the existing
 * line-tracking / auto-advance logic, so it can't regress them. The signature
 * is fixed bani text (no network), the confidence bar is high, and a cooldown
 * plus an "already on Anand" guard prevent repeat firing.
 */

// 6-pauri Anand Sahib bundle id (first 5 pauris + the 40th), opened via
// ?bundle=anand-sahib (see ShabadPage buildAnandSahibBundle).
export const ANAND_SAHIB_BUNDLE_ID = '333375';

// Distinctive opening of Anand Sahib, in Gurmukhi and romanized form so the
// watcher fires whether the speech engine returns pa-IN Gurmukhi or Latin.
// matchLine normalises both the transcript and these signatures, so either
// script matches its own form.
const ANAND_SIGNATURE = [
  { gurmukhi: 'ਅਨੰਦੁ ਭਇਆ ਮੇਰੀ ਮਾਏ ਸਤਿਗੁਰੂ ਮੈ ਪਾਇਆ' },
  { gurmukhi: 'anand bhaia meri maae satiguru mai paiaa' },
];

const MIN_CONFIDENCE = 72;   // high bar — this is a navigation trigger
const COOLDOWN_MS = 15000;   // don't re-fire for a while after a detection
const TAIL_WORDS = 7;

export default function useAnandSahibWatch({ active, transcript, currentShabadId, onDetect }) {
  const cooldownUntilRef = useRef(0);
  const lastTailRef = useRef('');
  const onDetectRef = useRef(onDetect);
  useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);

  useEffect(() => {
    if (!active) return;
    // Already on the Anand Sahib bundle — nothing to do.
    if (String(currentShabadId || '') === ANAND_SAHIB_BUNDLE_ID) return;
    if (Date.now() < cooldownUntilRef.current) return;

    const text = String(transcript || '').trim();
    if (text.length < 4) return;
    const tail = text.split(/\s+/).slice(-TAIL_WORDS).join(' ');
    if (tail === lastTailRef.current) return;
    lastTailRef.current = tail;

    const res = matchLine(ANAND_SIGNATURE, tail, { currentLine: -1 });
    if (res.tracked && res.confidence >= MIN_CONFIDENCE) {
      cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
      onDetectRef.current?.();
    }
  }, [active, transcript, currentShabadId]);
}
