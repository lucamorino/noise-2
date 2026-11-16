// Spectral analysis of a player's sound with Essentia.js (WASM), as in
// B3-T0G3TH3R and The Contested Zone: spectral centroid, spectral
// complexity and dissonance, about 10 times a second, on the output of the
// RNBO device. Sharpness comes from the RNBO patch itself.
//
// The patch of XC-R has no loudness outport (B3-T0G3TH3R's has one), so a
// loudness is also computed here, from the level of the same frame:
// RMS in dBFS + 100, i.e. 100 at full scale and 0 at -100 dB or below.

const ANALYSIS_INTERVAL = 100; // ms
const FFT_SIZE = 2048;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.append(el);
  });
}

let essentiaScripts = null;

// Essentia is served locally (public/assets/essentia), loaded once per page
function loadEssentiaScripts() {
  if (!essentiaScripts) {
    essentiaScripts = Promise.all([
      loadScript('assets/essentia/essentia-wasm.web.js'),
      loadScript('assets/essentia/essentia.js-core.js'),
    ]);
  }
  return essentiaScripts;
}

function levelToLoudness(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / frame.length);
  return Math.max(0, Math.min(100, 20 * Math.log10(Math.max(rms, 1e-5)) + 100));
}

/**
 * Analyse `source` (an AudioNode) and call `onValues` with
 * { spectralCentroid, spectralComplexity, dissonance, loudness } each time
 * a frame is analysed. Values are raw: smoothing is left to the caller.
 */
export async function createSoundAnalysis({ audioContext, source, onValues }) {
  await loadEssentiaScripts();
  const essentiaModule = await window.EssentiaWASM();
  const essentia = new window.Essentia(essentiaModule);

  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = FFT_SIZE;
  source.connect(analyserNode);
  const frame = new Float32Array(analyserNode.fftSize);
  const sampleRate = audioContext.sampleRate;

  function analyse() {
    analyserNode.getFloatTimeDomainData(frame);

    if (frame.some((v) => !Number.isFinite(v))) return;
    if (frame.every((v) => v === 0)) {
      onValues({ spectralCentroid: 0, spectralComplexity: 0, dissonance: 0, loudness: 0 });
      return;
    }

    // essentia.js returns vectors allocated on the WASM heap, which the
    // garbage collector cannot see: each must be delete()d, or the heap
    // grows until the browser kills the page.
    let frameVec, windowed, spectrum, peaks;
    try {
      frameVec = essentia.arrayToVector(frame);
      const { centroid } = essentia.SpectralCentroidTime(frameVec, sampleRate);

      windowed = essentia.Windowing(frameVec, true, analyserNode.fftSize, 'hann');
      spectrum = essentia.Spectrum(windowed.frame, analyserNode.fftSize);
      const { spectralComplexity } = essentia.SpectralComplexity(spectrum.spectrum, 0.005, sampleRate);
      peaks = essentia.SpectralPeaks(spectrum.spectrum, 0.01, sampleRate / 2, 50, 20, 'frequency', sampleRate);
      let dissonance = 0;
      if (essentia.vectorToArray(peaks.frequencies).length >= 2) {
        ({ dissonance } = essentia.Dissonance(peaks.frequencies, peaks.magnitudes));
      }

      onValues({
        spectralCentroid: Number.isFinite(centroid) ? centroid : 0,
        spectralComplexity: Number.isFinite(spectralComplexity) ? spectralComplexity : 0,
        dissonance: Number.isFinite(dissonance) ? dissonance : 0,
        loudness: levelToLoudness(frame),
      });
    } catch (err) {
      console.debug('Essentia analysis error:', err);
    } finally {
      frameVec?.delete();
      windowed?.frame.delete();
      spectrum?.spectrum.delete();
      peaks?.frequencies.delete();
      peaks?.magnitudes.delete();
    }
  }

  const timerId = setInterval(analyse, ANALYSIS_INTERVAL);

  return {
    stop() {
      clearInterval(timerId);
      source.disconnect(analyserNode);
    },
  };
}
