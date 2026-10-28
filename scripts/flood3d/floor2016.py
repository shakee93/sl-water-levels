"""The Irrigation Department's drawn May 2016 Kelani extent as a FLOOR under the learned flood level, and a connected reach beyond it. Used by prep.py.

Why: the learned level was fitted on satellite maps (Copernicus EMS), which miss water between houses, on a 30 m surface model that reads roofs. At 2016's peak stage
(7.64 ft at Nagalagam Street) it flooded 43% of the checked Megoda Kolonnawa block against 55% in the official drawn polygon, and about 6% of the polygon's ground
never flooded at any stage. Residents say Cyclone Ditwah (peak 8.43 ft) was far worse than 2016, so the map must not flood less than the official 2016 map.

1. FLOOR. Every covered non-river cell inside the polygon gets a level <= CAP (7.6 ft, the 0.1 ft step that is <= 7.64). Holes of the polygon (islands of high ground)
   are left as they were. The ORDER in which cells fill is kept (same low spots first): cells at or below KNEE (5 ft, the alert level) are untouched, so nothing changes at
   normal and alert stages; the cells above KNEE, sorted by (level, HAND), are spread evenly over [KNEE + 0.1, CAP], and a cell never gets a HIGHER level than it had.
2. REACH. Outside the polygon, water that is connected to it at 2016 (priority flood seeded from the polygon cells, each seed carrying the 2016 water surface of its
   neighbourhood) goes further at a higher stage: a cell whose terrain sits `rise` metres above that surface floods at 7.64 ft + rise / REACH_M_PER_FT. Isolated high ground
   (no connection that low) is not touched. Only lowers a level, only up to REACH_MAX_FT.
"""
import heapq, numpy as np
from scipy import ndimage as ndi

STAGE_2016 = 7.64
CAP = 7.6
KNEE = 5.0
REACH_M_PER_FT = 0.25      # pool plateau slope above 7.4 ft (depth.ts poolW): metres of water-surface rise per ft of Nagalagam stage
REACH_MAX_FT = 9.0
SEED_RADIUS_CELLS = 10     # the 2016 surface seen by a seed = highest fill level among polygon cells within ~300 m

def priority_flood(zf, seeds_mask, seed_val):
    """Minimax-path flood: returns (G, W) where G[cell] = lowest 'highest value on the way' from any seed, W = seed value of the seed that gave it."""
    H, W_ = zf.shape
    G = np.full(zf.shape, np.inf); Wv = np.full(zf.shape, np.nan); hp = []
    for r, c in zip(*np.where(seeds_mask)):
        G[r, c] = seed_val[r, c]; Wv[r, c] = seed_val[r, c]; heapq.heappush(hp, (G[r, c], r, c))
    while hp:
        f, r, c = heapq.heappop(hp)
        if f > G[r, c]: continue
        w = Wv[r, c]
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                rr, cc = r + dr, c + dc
                if (dr or dc) and 0 <= rr < H and 0 <= cc < W_:
                    nf = max(f, zf[rr, cc])
                    if nf < G[rr, cc]: G[rr, cc] = nf; Wv[rr, cc] = w; heapq.heappush(hp, (nf, rr, cc))
    return G, Wv

def apply(Lft, cls, P16, okall, DRAIN, HAND, F, z, slope=REACH_M_PER_FT, reach_max=REACH_MAX_FT, verbose=True):
    """Lft: level (ft at Nagalagam), cls: uncertainty class, P16: polygon raster, F: priority-flood fill level (m) from the Kelani-side channels, z: DSM (m)."""
    Lft = Lft.copy(); cls = cls.copy()
    TG = P16 & okall & ~DRAIN
    Lc = np.where(np.isfinite(Lft), np.minimum(Lft, 40.0), 40.0)
    hand = np.where(np.isfinite(HAND), HAND, 99.0)
    A = TG & (Lc > KNEE)
    idx = np.argwhere(A)
    order = np.lexsort((hand[A], Lc[A]))               # by level, ties (and the 'never floods' cells) by height above the drain
    u = (np.arange(len(order)) + 1.0) / len(order)
    f = np.empty(len(order)); f[order] = (KNEE + 0.1) + (CAP - KNEE - 0.1) * u   # first step is 0.1 ft above the knee: levels are stored in 0.1 ft steps
    new = np.minimum(Lc[A], f)
    Lft[A] = new; cls[A] = np.where(new < Lc[A], 1, cls[A])   # no longer 'observed-bounded' where the floor moved it
    n_floor = int((new < Lc[A]).sum())
    # ---- reach beyond the polygon
    zf = np.where(np.isfinite(z), z, 99.0)
    Fm = np.where(TG, F, -np.inf)
    Wseed = ndi.maximum_filter(Fm, size=2 * SEED_RADIUS_CELLS + 1)
    Wseed = np.where(TG, Wseed, np.nan)
    G, Wv = priority_flood(zf, TG, np.where(TG, Wseed, 0.0))
    rise = G - Wv
    cand = okall & ~DRAIN & ~P16 & np.isfinite(rise)
    Lr = STAGE_2016 + 0.1 + rise / slope
    take = cand & (Lr <= reach_max) & (Lr < np.where(np.isfinite(Lft), Lft, 99.0))
    Lft = np.where(take, np.maximum(Lr, STAGE_2016 + 0.06), Lft)
    cls = np.where(take, 1, cls)
    if verbose: print(f"floor2016: polygon cells {int(TG.sum())}, above knee {int(A.sum())}, lowered {n_floor}; reach: lowered {int(take.sum())} cells outside")
    return Lft, cls, dict(polygon=TG, floored=n_floor, reach=take, rise=rise)
