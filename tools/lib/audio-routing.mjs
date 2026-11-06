// Compare sample-derived amplitude envelopes; no transcript or matching policy.
export function envelope(samples, rate) {
  const window = Math.round(rate * 0.02); const values = [];
  if (!(rate > 0)) return values;
  for (let frame = 0; ; frame++) {
    const start = Math.round(frame * rate * 0.002);
    if (start + window > samples.length) break;
    let energy = 0;
    for (let i = start; i < start + window; i++) energy += samples[i] ** 2;
    values.push(Math.sqrt(energy / window));
  }
  return values;
}
export function compareEnvelopes(observed, reference) {
  let best = -1; let offsetMs = null;
  if (!observed.length) return { correlation: best, offsetMs };
  const meanA = observed.reduce((sum, n) => sum + n, 0) / observed.length;
  for (let lag = 0; lag <= Math.min(1000, reference.length - observed.length); lag++) {
    const b = reference.slice(lag, lag + observed.length); const meanB = b.reduce((sum, n) => sum + n, 0) / b.length;
    let numerator = 0; let denominatorA = 0; let denominatorB = 0;
    for (let i = 0; i < observed.length; i++) { const x = observed[i] - meanA; const y = b[i] - meanB; numerator += x * y; denominatorA += x * x; denominatorB += y * y; }
    const score = numerator / Math.sqrt(denominatorA * denominatorB);
    if (score > best) { best = score; offsetMs = lag * 2; }
  }
  return { correlation: best, offsetMs };
}
