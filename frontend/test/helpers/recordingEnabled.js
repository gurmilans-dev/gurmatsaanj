import { afterEach, beforeEach, expect } from 'vitest';
import { startRecording, stopRecording } from '../../src/utils/sessionRecorder';
import { validateTrace } from '../../src/utils/recognitionTrace';

// Run the same recognition assertions with opt-in diagnostics active.
beforeEach(() => { startRecording({ synthetic: true, mode: 'test' }); });
afterEach(() => { expect(() => validateTrace(stopRecording())).not.toThrow(); });
