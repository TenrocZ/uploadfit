/**
 * Shared, DOM-free lossy quality search. The Worker runtime serializes this
 * exact function so main-thread and Worker decisions cannot drift.
 */
export async function searchLossy({
  encode,
  targetMinBytes = null,
  targetMaxBytes = null,
  qualityMin,
  qualityMax,
  searchSteps,
  onEncode,
  shouldAbort
}) {
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const minimum = targetMinBytes ?? 0;
  const maximum = targetMaxBytes;
  const lowQuality = clamp(qualityMin, 0.01, 1);
  const highQuality = clamp(qualityMax, lowQuality, 1);
  const steps = Math.max(1, Math.min(8, searchSteps ?? 8));
  const valid = (candidate) => Boolean(candidate?.blob)
    && candidate.blob.size >= minimum
    && (maximum === null || maximum === undefined || candidate.blob.size <= maximum);
  const evaluate = async (quality) => {
    shouldAbort?.();
    const blob = await encode(quality);
    shouldAbort?.();
    if (!blob || typeof blob.size !== 'number' || blob.size <= 0) return null;
    onEncode?.({ quality, bytes: blob.size });
    return { blob, quality };
  };

  const highest = await evaluate(highQuality);
  if (!highest) return { blob: null, quality: highQuality, belowMinimum: true };
  if (maximum === null || maximum === undefined) {
    if (highest.blob.size >= minimum) return highest;
    return { blob: null, quality: highQuality, belowMinimum: true, reference: highest.blob };
  }

  // These endpoint decisions are intentionally explicit. When both endpoints
  // cross opposite sides of the interval, the interval may still be valid.
  if (highest.blob.size < minimum) {
    return { blob: null, quality: highQuality, belowMinimum: true, reference: highest.blob };
  }
  if (valid(highest)) return highest;

  const lowest = lowQuality === highQuality
    ? highest
    : await evaluate(lowQuality);
  if (!lowest) return { blob: null, quality: lowQuality, overMaximum: true };
  if (lowest.blob.size > maximum && highest.blob.size > maximum) {
    return { blob: null, quality: lowQuality, overMaximum: true, reference: lowest.blob };
  }

  let best = valid(lowest) ? lowest : null;
  let low = lowQuality;
  let high = highQuality;
  for (let step = 0; step < steps && high - low > Number.EPSILON; step += 1) {
    const quality = (low + high) / 2;
    const candidate = await evaluate(quality);
    if (!candidate) continue;
    if (valid(candidate) && (!best || candidate.quality > best.quality)) best = candidate;
    if (candidate.blob.size > maximum) {
      high = quality;
    } else {
      low = quality;
    }
  }

  if (best) return best;
  if (highest.blob.size < minimum) {
    return { blob: null, quality: highQuality, belowMinimum: true, reference: highest.blob };
  }
  if (lowest.blob.size > maximum) {
    return { blob: null, quality: lowQuality, overMaximum: true, reference: lowest.blob };
  }
  return { blob: null, quality: lowQuality };
}
