// Radar chart of a player's sound descriptors and of the target they have
// to reach, as on the display of B3-T0G3TH3R and The Contested Zone, but
// drawn in the background of the player itself and in grey scale only, so
// that the white dot stays the brightest thing on screen.
//
// - the sound: a grey polygon
// - the partner's sound, when it is shown: a thin dotted outline, darker
//   than the player's own, lighter while the partner matches their target
// - the target: a dashed outline, lighter while the sound matches it, and
//   filling up as the match is held

const GRID = 'rgba(255, 255, 255, 0.07)';
const AXES = 'rgba(255, 255, 255, 0.10)';
const LABELS = 'rgba(255, 255, 255, 0.30)';
const SOUND_FILL = 'rgba(255, 255, 255, 0.10)';
const SOUND_STROKE = 'rgba(255, 255, 255, 0.38)';
const PARTNER_STROKE = 'rgba(255, 255, 255, 0.24)';
const PARTNER_STROKE_MATCHED = 'rgba(255, 255, 255, 0.50)';
const TARGET_STROKE = 'rgba(255, 255, 255, 0.42)';
const TARGET_STROKE_MATCHED = 'rgba(255, 255, 255, 0.75)';
const FONT = "'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif";

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} options
 * @param {Array}  options.descriptors  [{ key, label }]
 * @param {Array}  options.values       the sound, normalised (0..1), one value per descriptor
 * @param {Array}  [options.partner]    the partner's sound, normalised, or null not to show it
 * @param {boolean} [options.partnerMatched]  the partner's sound matches their target
 * @param {Array}  [options.target]     the target, normalised, or null for no target
 * @param {boolean} [options.matched]   the sound matches the target
 * @param {number} [options.hold]       0..1, how long the match has been held
 */
export function drawRadar(canvas, {
  descriptors, values, partner = null, partnerMatched = false, target = null, matched = false, hold = 0,
}) {
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;

  const cw = Math.round(w * dpr);
  const ch = Math.round(h * dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const numAxes = descriptors.length;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const labelPad = 34;
  const radius = Math.max(10, Math.min(w, h) * 0.5 - labelPad);
  const angleOf = (axis) => -Math.PI / 2 + axis * ((2 * Math.PI) / numAxes);
  const point = (axis, value) => ({
    x: cx + value * radius * Math.cos(angleOf(axis)),
    y: cy + value * radius * Math.sin(angleOf(axis)),
  });
  const polygon = (config) => {
    ctx.beginPath();
    config.forEach((value, axis) => {
      const { x, y } = point(axis, value);
      if (axis === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };

  // grid rings
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  for (const level of [0.2, 0.4, 0.6, 0.8, 1]) {
    polygon(descriptors.map(() => level));
    ctx.stroke();
  }

  // axes and labels
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  descriptors.forEach((descriptor, axis) => {
    const end = point(axis, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = AXES;
    ctx.stroke();

    const label = point(axis, 1 + (labelPad * 0.5) / radius);
    ctx.fillStyle = LABELS;
    ctx.fillText(descriptor.label.toUpperCase(), label.x, label.y);
  });

  // target: filling up while the match is held
  if (target && hold > 0) {
    polygon(target);
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.16 * Math.min(1, hold)).toFixed(3)})`;
    ctx.fill();
  }

  // the partner's sound, under the player's own
  if (partner) {
    polygon(partner);
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = partnerMatched ? PARTNER_STROKE_MATCHED : PARTNER_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // the sound
  polygon(values);
  ctx.fillStyle = SOUND_FILL;
  ctx.fill();
  ctx.strokeStyle = SOUND_STROKE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // target outline, on top
  if (target) {
    polygon(target);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = matched ? TARGET_STROKE_MATCHED : TARGET_STROKE;
    ctx.lineWidth = matched ? 2.5 : 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}
