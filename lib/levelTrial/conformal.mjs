// slwl-port conformal ranges: static evaluator + adaptive-conformal online update. JS twin of py/conformal.py
// (same float64 operations in the same order; the parity test requires bit-identical results). Dependency-free.
// See the header of py/conformal.py for the definitions. The state is a plain JSON-able object.

export const CONFORMAL_SCHEMA = "slwl-port/conformal@1";

export function newState({ target = 0.8, gamma = 0.01, window = 200, alphaMin = 0.01, alphaMax = 0.99, minScores = 20 } = {}) {
  return { schema: CONFORMAL_SCHEMA, target, gamma, window, alpha_min: alphaMin, alpha_max: alphaMax, min_scores: minScores, keys: {} };
}

export function checkState(state) {
  if (!state || state.schema !== CONFORMAL_SCHEMA) throw new Error("not a " + CONFORMAL_SCHEMA + " state");
  return state;
}

/** Conformity score: how far outside the base interval y fell, in units of scale (<= 0 means inside). */
export function score(lo0, hi0, y, scale = 1) {
  const a = lo0 - y;
  const b = y - hi0;
  return (a > b ? a : b) / scale;
}

/** k-th smallest, k = clamp(ceil((n + 1) * (1 - alpha)), 1, n); null for an empty list. */
export function quantile(scores, alpha) {
  const n = scores.length;
  if (n === 0) return null;
  const s = Float64Array.from(scores).sort(); // typed-array sort is numeric
  let k = Math.ceil((n + 1) * (1 - alpha));
  if (k < 1) k = 1;
  if (k > n) k = n;
  return s[k - 1];
}

function qOf(state, e) {
  const sc = e.scores;
  if (sc && sc.length >= state.min_scores) return quantile(sc, e.alpha);
  if (e.q !== undefined && e.q !== null) return e.q;
  if (sc && sc.length) return quantile(sc, e.alpha);
  return null;
}

/** Entry for a key with fallback "h|regime" -> "h|*" -> "*"; undefined when the state knows nothing. */
export function resolve(state, key) {
  const ks = state.keys;
  if (Object.prototype.hasOwnProperty.call(ks, key)) return ks[key];
  const i = key.lastIndexOf("|");
  if (i >= 0) {
    const alt = key.slice(0, i) + "|*";
    if (Object.prototype.hasOwnProperty.call(ks, alt)) return ks[alt];
  }
  return Object.prototype.hasOwnProperty.call(ks, "*") ? ks["*"] : undefined;
}

export function currentQ(state, key) {
  const e = resolve(state, key);
  return e === undefined ? null : qOf(state, e);
}

/** Static / current evaluator: [lo, hi] or null if the key is unknown and there is no "*" entry. */
export function interval(state, key, lo0, hi0, scale = 1) {
  const q = currentQ(state, key);
  if (q === null) return null;
  return [lo0 - q * scale, hi0 + q * scale];
}

/** Record one realised outcome (mutates `state`). Returns { q, covered }: the q that was served for this case
 *  (null if none) and whether y fell inside the served interval (null if none was served). */
export function update(state, key, lo0, hi0, y, scale = 1) {
  const ks = state.keys;
  let e = Object.prototype.hasOwnProperty.call(ks, key) ? ks[key] : undefined;
  if (e === undefined) {
    const fb = resolve(state, key);
    e = { q: fb === undefined ? null : qOf(state, fb), alpha: 1 - state.target, scores: [], n: 0 };
    ks[key] = e;
  } else if (e.scores === undefined || e.scores === null) {
    e.scores = [];
    if (e.alpha === undefined) e.alpha = 1 - state.target;
    if (e.n === undefined) e.n = 0;
  }
  const q = qOf(state, e);
  const s = score(lo0, hi0, y, scale);
  let covered = null;
  if (q !== null) {
    covered = !(s > q);
    const err = covered ? 0 : 1;
    let a = e.alpha + state.gamma * ((1 - state.target) - err);
    if (a < state.alpha_min) a = state.alpha_min;
    if (a > state.alpha_max) a = state.alpha_max;
    e.alpha = a;
  }
  e.scores.push(s);
  if (e.scores.length > state.window) e.scores.splice(0, e.scores.length - state.window);
  e.n += 1;
  return { q, covered };
}

/** Smallest static form: only the current q per key (no online updating without scores). */
export function staticState(state) {
  const out = newState({ target: state.target, gamma: 0, window: state.window, alphaMin: state.alpha_min, alphaMax: state.alpha_max, minScores: state.min_scores });
  for (const k of Object.keys(state.keys)) {
    const q = qOf(state, state.keys[k]);
    if (q !== null) out.keys[k] = { q };
  }
  return out;
}
