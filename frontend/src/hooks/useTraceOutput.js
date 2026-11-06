import { useEffect, useRef } from 'react';
import { recordEvent, recordNavigation, recordVerses, subscribeRecordingStart } from '../utils/sessionRecorder';
import { positionFor } from '../utils/recognitionTrace';

// Observe committed page state. Recording never feeds back into page state.
export default function useTraceOutput({ groupId, verses, lineIndex, mode, ready, held = false, tracked = false, manual = false, observationAt = null }) {
  const latestObservationRef = useRef(observationAt);
  latestObservationRef.current = observationAt;
  const previousGroupRef = useRef(null);

  useEffect(() => {
    const capture = () => {
      if (!ready) {
        recordEvent('page', { position: null, mode: 'empty', held: false, tracked: false, manual: false });
        return;
      }
      recordVerses(groupId, verses);
      recordEvent('page', () => ({
        position: positionFor(groupId, verses, lineIndex), mode,
        held: Boolean(held), tracked: Boolean(tracked), manual: Boolean(manual),
        evidenceAgeMs: latestObservationRef.current == null ? undefined : Math.max(0, Date.now() - latestObservationRef.current),
      }));
    };
    if (ready && groupId && previousGroupRef.current !== groupId) {
      recordNavigation('committed', 'unknown', positionFor(groupId, verses, lineIndex), 'route-loaded');
      previousGroupRef.current = groupId;
    }
    capture();
    return subscribeRecordingStart(capture);
  }, [groupId, verses, lineIndex, mode, ready, held, tracked, manual]);
  useEffect(() => () => {
    recordEvent('page', { position: null, mode: 'empty', held: false, tracked: false, manual: false });
  }, []);
}
