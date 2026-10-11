/* ============================================================
   Nikhil – doodle sky portfolio · scroll choreography
   ------------------------------------------------------------
   1. Measure the page and build ONE long flight path (document coordinates):
        hero → paragraph 1 → paragraph 2 → paragraph 3 → certificates
      (takeoff, U-turn, dive, loop-the-loop, glide, touchdown)
   2. Scroll position → distance along that path.
        scroll down  = plane flies forward and the dashed trail draws behind it
        scroll up    = plane flies the very same path backwards, trail rewinds
        while you read a paragraph the plane sits parked on its card
   3. Certificate belts slide left → right as the section crosses the screen.
   ============================================================ */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const TAU = Math.PI * 2;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const skyEl = $('#sky');
  const trailSvg = $('#trail');
  const trailPath = $('#trailPath');
  const planeEl = $('#plane');
  const planeInner = $('#planeInner');
  const doodles = $$('.doodle');
  // clouds also slide sideways with the scroll: alternate directions, nearer (faster) clouds drift more
  const clouds = doodles
    .filter((d) => d.querySelector('use').getAttribute('href') === '#d-cloud')
    .map((el, i) => ({
      el, base: 0, w: 0,
      left: el.style.left, right: el.style.right,          // original CSS placement, restored on every rebuild
      drift: (i % 2 ? 1 : -1) * (0.16 + parseFloat(el.dataset.speed) * 1.4),
    }));
  const cards = $$('.card');
  const certSection = $('#certs');

  $('#year').textContent = new Date().getFullYear();

  /* ---------- certificate belts: build the 2nd row from the 1st ---------- */
  const trackA = $('#beltA .belt__track');
  const trackB = $('#beltB .belt__track');
  const baseCerts = $$('.cert', trackA);
  baseCerts.map((_, i) => baseCerts[(i + Math.ceil(baseCerts.length / 2)) % baseCerts.length])
    .forEach((c) => trackB.appendChild(c.cloneNode(true)));
  const beltList = [trackA, trackB].map((track) => ({
    track,
    el: track.parentElement,
    speed: parseFloat(track.parentElement.dataset.speed),
    base: Array.from(track.children),
    travel: 0,
  }));

  /* ---------- card entrance ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.2 });
  cards.forEach((c) => io.observe(c));

  $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  /* ---------- reduced motion: parked plane, no scroll choreography ---------- */
  if (reduceMotion) {
    document.body.classList.add('reduce');
    const zone = $('#planeZone');
    zone.style.position = 'relative';
    zone.appendChild(planeEl);
    planeEl.style.cssText = 'position:absolute;left:50%;top:45%;transform:scale(-.9,.9);opacity:1';
    return;
  }

  /* ============================================================
     State
     ============================================================ */
  let W = 0, VH = 0;
  let compact = false;       // single-column layout (phones)
  let K = 1;                 // geometry scale for flight manoeuvres
  let S = 1;                 // plane scale
  let HOLD = 100;            // scroll px the plane stays parked around each landing

  // sampled flight path (document coordinates)
  let N = 0, X, Y, L, TH, F;
  let anchors = [];          // [{ len, s }] plane rests (hero, p1, p2, p3, certificates)
  let certBox = { y: 0, h: 0 };
  let DASH = 12, GAP = 15, DASH_STR = '12 15 ', lastTrail = -1;

  /* ============================================================
     Measuring helpers
     ============================================================ */
  function docRect(el) {
    let x = 0, y = 0, e = el;
    while (e) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }

  /* ============================================================
     Flight-path building blocks.  Every waypoint is
       { x, y, tx, ty }  position + heading (tx,ty optional → auto)
       rest:true         plane parks here (landing)
       loop:true         part of a loop-the-loop (no roll-over flip)
     ============================================================ */
  const P = (x, y, tx, ty, extra) => Object.assign({ x, y, tx, ty }, extra);

  // Roll a little, lift off and make a half-loop U-turn.  Ends at the top, heading -dirA.
  function takeoffUTurn(A, dirA, k) {
    const r = 70 * k, cx = A.x + dirA * 105 * k, cy = A.y - 100 * k;
    const out = [P(A.x + dirA * 55 * k, A.y - k, dirA, -0.02)];
    for (let i = 0; i <= 6; i++) {
      const b = (i * Math.PI) / 6;
      out.push(P(cx + dirA * r * Math.sin(b), cy + r * Math.cos(b), dirA * Math.cos(b), -Math.sin(b)));
    }
    return out;
  }

  // Gentle glide that flares out and touches down at B (rest), heading dir.
  function approach(B, dir, k, h) {
    return [
      P(B.x - dir * 150 * k, B.y - h, dir, 0.1),
      P(B.x - dir * 95 * k, B.y - 26 * k, dir, 0.2),
      P(B.x - dir * 42 * k, B.y - 3 * k, dir, 0.04),
      P(B.x, B.y, dir, 0, { rest: true }),
    ];
  }

  // Loop-the-loop starting at its bottom point `p`, flying in direction dir.
  function loop(p, dir, r, drift) {
    const out = [], n = 12;
    for (let i = 0; i <= n; i++) {
      const f = (i / n) * TAU;
      out.push(P(
        p.x + dir * ((drift * f) / TAU + r * Math.sin(f)),
        p.y - r + r * Math.cos(f),
        dir * (drift / TAU + r * Math.cos(f)),
        -r * Math.sin(f),
        { loop: true }
      ));
    }
    return out;
  }

  // From the top of a turn (or the hero hover) swoop down the free corridor at column xd,
  // loop-the-loop, then glide in and land on B.  dir = heading (+1 right / -1 left).
  function diveAndLand(T, B, dir, xd, k, withLoop) {
    const lb = B.y - 80 * k;                       // height of the loop bottom / glide start
    const out = [
      P(xd - dir * 170 * k, T.y + 6 * k, dir, 0.08),
      P(xd - dir * 20 * k, lerp(T.y, lb, 0.52), dir * 0.5, 1),
    ];
    const lx = xd + dir * 76 * k, r = 62 * k, drift = 68 * k;
    const exitX = lx + dir * drift;
    const f1x = B.x - dir * 150 * k;
    if (withLoop && dir * (f1x - exitX) > 30 * k) out.push(...loop({ x: lx, y: lb }, dir, r, drift));
    out.push(...approach(B, dir, k, 80 * k));
    return out;
  }

  // Parked facing left on A → fly to B facing right (everything in "left → right" coordinates).
  function flightLR(A, B, clearX, k) {
    const up = takeoffUTurn(A, -1, k);
    const T = up[up.length - 1];
    const xd = Math.max(clearX, T.x + 230 * k);
    return [...up, ...diveAndLand(T, B, 1, xd, k, true)];
  }

  function mirror(pts) {
    return pts.map((p) => Object.assign({}, p, { x: W - p.x, tx: p.tx === undefined ? undefined : -p.tx }));
  }

  // Parked facing right on A → fly to B facing left: same manoeuvre, mirrored.
  function flightRL(A, B, limitX, k) {
    return mirror(flightLR({ x: W - A.x, y: A.y }, { x: W - B.x, y: B.y }, W - limitX, k));
  }

  // Phone layout: no free corridor, so just U-turn (if needed) and one S-curve down.
  function flightCompact(A, B, dirB, k, needTurn) {
    const out = [];
    let T = A;
    if (needTurn) { const up = takeoffUTurn(A, -dirB, k); out.push(...up); T = up[up.length - 1]; }
    const F1 = { x: B.x - dirB * 150 * k, y: B.y - 80 * k };
    out.push(P((T.x + F1.x) / 2, (T.y + F1.y) / 2));
    out.push(...approach(B, dirB, k, 80 * k));
    return out;
  }

  /* ============================================================
     Turn waypoints into a dense, evenly walkable polyline
     ============================================================ */
  function sample(wps) {
    const n = wps.length;
    const dir = wps.map((p, i) => {
      let tx = p.tx, ty = p.ty;
      if (tx === undefined) {
        const a = wps[Math.max(0, i - 1)], b = wps[Math.min(n - 1, i + 1)];
        tx = b.x - a.x; ty = b.y - a.y;
      }
      const m = Math.hypot(tx, ty) || 1;
      return [tx / m, ty / m];
    });

    const xs = [], ys = [], inLoop = [], rest = [];
    for (let i = 0; i < n - 1; i++) {
      const a = wps[i], b = wps[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (a.rest) rest.push(xs.length);
      if (d < 0.01) continue;
      const m0x = dir[i][0] * d, m0y = dir[i][1] * d, m1x = dir[i + 1][0] * d, m1y = dir[i + 1][1] * d;
      const steps = Math.max(2, Math.ceil(d / 4));
      const lp = !!(a.loop && b.loop);
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        xs.push(h00 * a.x + h10 * m0x + h01 * b.x + h11 * m1x);
        ys.push(h00 * a.y + h10 * m0y + h01 * b.y + h11 * m1y);
        inLoop.push(lp);
      }
    }
    const last = wps[n - 1];
    if (last.rest) rest.push(xs.length);
    xs.push(last.x); ys.push(last.y); inLoop.push(false);

    const cnt = xs.length;
    const len = new Float32Array(cnt);
    for (let i = 1; i < cnt; i++) len[i] = len[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);

    // heading, unwrapped so it never jumps by 360°
    const th = new Float32Array(cnt);
    let prev = 0;
    for (let i = 0; i < cnt; i++) {
      const a = Math.max(0, i - 2), b = Math.min(cnt - 1, i + 2);
      let h = Math.atan2(ys[b] - ys[a], xs[b] - xs[a]);
      if (i > 0) { while (h - prev > Math.PI) h -= TAU; while (h - prev < -Math.PI) h += TAU; }
      th[i] = prev = h;
    }

    // which way the plane "faces" (flips on U-turns with a quick barrel-roll, never inside a loop)
    const face = new Float32Array(cnt);
    let fc = Math.cos(th[0]) >= 0 ? 1 : -1;
    for (let i = 0; i < cnt; i++) {
      const c = Math.cos(th[i]);
      if (!inLoop[i]) { if (c > 0.15) fc = 1; else if (c < -0.15) fc = -1; }
      face[i] = fc;
    }
    const pre = new Float32Array(cnt + 1);
    for (let i = 0; i < cnt; i++) pre[i + 1] = pre[i] + face[i];
    const sm = new Float32Array(cnt), R = 18;
    for (let i = 0; i < cnt; i++) {
      const a = Math.max(0, i - R), b = Math.min(cnt - 1, i + R);
      sm[i] = (pre[b + 1] - pre[a]) / (b - a + 1);
    }

    return { n: cnt, x: xs, y: ys, len, th, f: sm, rest };
  }

  /* ============================================================
     Build everything from the current layout
     ============================================================ */
  function build() {
    W = document.documentElement.clientWidth;
    VH = window.innerHeight;
    compact = W < 860;
    K = compact ? clamp(W / 700, 0.5, 0.75) : clamp(W / 1280, 0.62, 1.15);
    S = compact ? clamp(W / 760, 0.46, 0.62) : clamp(W / 1400, 0.55, 0.95);
    HOLD = clamp(VH * 0.14, 70, 120);
    // phones: no free corridor beside the cards, so the plane flies BEHIND the paragraphs
    skyEl.style.zIndex = compact ? 1 : 50;
    const H = 59 * S;                               // plane centre → bottom of wheels

    DASH = compact ? 9 : 12; GAP = compact ? 12 : 15; DASH_STR = DASH + ' ' + GAP + ' ';
    trailPath.setAttribute('stroke-width', compact ? 3.5 : 4.5);

    // ---- landing spots (plane centre, facing) ----
    const zone = docRect($('#planeZone'));
    const heroText = docRect($('.hero__text'));
    let hx, hy;
    if (compact) { hx = W * 0.68; hy = zone.y + zone.h * 0.5; }
    else {
      hx = Math.max(zone.x + zone.w * 0.5, heroText.x + heroText.w + 330 * K);
      hx = Math.min(hx, W - 120 * S);
      hy = zone.y + zone.h * 0.45;
    }
    const hero = { x: hx, y: hy, face: -1 };

    const stops = [hero];
    const cardRects = cards.map((c) => Object.assign(docRect(c), { side: c.dataset.side }));
    cardRects.forEach((r) => {
      const left = r.side === 'left';
      const x = compact ? W * (left ? 0.27 : 0.73) : (left ? r.x + r.w * 0.32 : r.x + r.w * 0.68);
      stops.push({ x, y: r.y - H, face: left ? -1 : 1, rect: r });
    });
    const banner = docRect($('#landBanner'));
    stops.push({
      x: compact ? W * 0.73 : banner.x + banner.w * 0.9,
      y: banner.y - H, face: 1, rect: banner,
    });

    // ---- waypoints ----
    const wps = [];
    const H0 = stops[0];
    wps.push(P(W + 60, H0.y + 70 * K, -1, -0.3));
    wps.push(P(H0.x + 120 * K, H0.y + 22 * K, -1, -0.2));
    wps.push(P(H0.x, H0.y, -1, 0, { rest: true }));

    for (let i = 1; i < stops.length; i++) {
      const A = stops[i - 1], B = stops[i];
      let seg;
      if (compact) {
        seg = flightCompact(A, B, B.face, K, A.face !== B.face);
      } else if (i === 1) {
        const xd = A.x - 230 * K;
        seg = diveAndLand(A, B, -1, xd, K, true);
      } else if (B.face === 1) {
        seg = flightLR(A, B, A.rect.x + A.rect.w + 125 * K, K);
      } else {
        seg = flightRL(A, B, A.rect.x - 125 * K, K);
      }
      wps.push(...seg);
    }

    const path = sample(wps);
    N = path.n; X = path.x; Y = path.y; L = path.len; TH = path.th; F = path.f;

    const docH = document.documentElement.scrollHeight;
    trailSvg.setAttribute('width', W);
    trailSvg.setAttribute('height', docH);
    let d = 'M' + X[0].toFixed(1) + ' ' + Y[0].toFixed(1);
    for (let i = 1; i < N; i++) d += 'L' + X[i].toFixed(1) + ' ' + Y[i].toFixed(1);
    trailPath.setAttribute('d', d);
    lastTrail = -1;

    // ---- scroll → path-length anchors ----
    const maxScroll = Math.max(0, docH - VH);
    anchors = path.rest.map((idx, i) => ({
      len: L[idx],
      s: i === 0 ? 0 : Math.max(0, Y[idx] - VH * 0.58),
    }));
    for (let i = 1; i < anchors.length; i++) {
      anchors[i].s = Math.max(anchors[i].s, anchors[i - 1].s + 2 * HOLD + 260);
    }
    const lastA = anchors[anchors.length - 1];
    if (lastA.s > maxScroll && maxScroll > 0) lastA.s = maxScroll;

    // ---- certificate belts ----
    const cs = docRect(certSection);
    certBox = { y: cs.y, h: cs.h };
    beltList.forEach((b) => {
      b.travel = b.speed * (cs.h + VH);
      // clone the certificates until the row is long enough to cover the whole slide
      const need = W + b.travel + 60;
      let guard = 0;
      while (b.track.scrollWidth < need && guard++ < 6) {
        b.base.forEach((n) => { const c = n.cloneNode(true); c.setAttribute('aria-hidden', 'true'); b.track.appendChild(c); });
      }
    });

    // ---- clouds: pin each to a pixel position so it can wrap around the screen ----
    clouds.forEach((c) => {
      c.el.style.translate = '';
      c.el.style.left = c.left; c.el.style.right = c.right;
      const r = c.el.getBoundingClientRect();
      c.base = r.left; c.w = r.width;
      c.el.style.left = c.base + 'px'; c.el.style.right = 'auto';
    });

    lastDrawn = NaN;                                 // force a redraw
    lastPose = '';
  }

  /* ============================================================
     Scroll → pose
     ============================================================ */
  function idxAt(len) {
    let lo = 0, hi = N - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L[mid] <= len) lo = mid; else hi = mid - 1; }
    return lo;
  }

  function lenAt(sc) {
    const n = anchors.length;
    if (sc <= anchors[0].s) return anchors[0].len;
    for (let i = 0; i < n - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (sc < b.s) {
        const start = a.s + (i === 0 ? 0 : HOLD);
        const end = b.s - HOLD;
        if (sc <= start) return a.len;
        if (sc >= end) return b.len;
        return lerp(a.len, b.len, smooth((sc - start) / (end - start)));
      }
    }
    return anchors[n - 1].len;
  }

  const pose = { x: 0, y: 0, th: 0, f: 1 };
  function poseAt(len) {
    const q = clamp(len, 0, L[N - 1]);
    const i = idxAt(q), j = Math.min(N - 1, i + 1);
    const seg = L[j] - L[i];
    const t = seg > 1e-6 ? (q - L[i]) / seg : 0;
    pose.x = lerp(X[i], X[j], t);
    pose.y = lerp(Y[i], Y[j], t);
    pose.th = lerp(TH[i], TH[j], t);
    pose.f = lerp(F[i], F[j], t);
    return pose;
  }

  // Reveal the dashed trail up to path-length `end` (dash phase stays locked to the path start).
  function setTrail(end) {
    const e = clamp(end, 0, L[N - 1]);
    if (Math.abs(e - lastTrail) < 0.4) return;
    lastTrail = e;
    trailPath.style.visibility = e < 1 ? 'hidden' : 'visible';
    const per = DASH + GAP, full = Math.floor(e / per), rem = e - full * per;
    trailPath.setAttribute('stroke-dasharray', DASH_STR.repeat(full) + Math.min(rem, DASH).toFixed(1) + ' 99999');
  }

  /* ============================================================
     Frame loop (smoothed scroll so everything glides)
     ============================================================ */
  let cur = window.scrollY, lastDrawn = NaN, lastPose = '';

  function frame(t) {
    const target = window.scrollY;
    cur += (target - cur) * 0.14;
    if (Math.abs(target - cur) < 0.05) cur = target;

    const len = lenAt(cur);
    const p = poseAt(len);

    // how "in the air" is the plane? (0 = parked on a card, 1 = flying)
    let near = Infinity;
    for (let i = 1; i < anchors.length; i++) near = Math.min(near, Math.abs(len - anchors[i].len));
    const air = smooth(clamp(near / (150 * S), 0, 1));

    let f = p.f;
    if (Math.abs(f) < 0.08) f = f < 0 ? -0.08 : 0.08;
    // document coordinates: a parked plane scrolls rigidly with its card
    const tf = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) rotate(${p.th.toFixed(4)}rad) scale(${S.toFixed(3)},${(S * f).toFixed(3)})`;
    if (tf !== lastPose) { lastPose = tf; planeEl.style.transform = tf; }
    planeInner.style.transform =
      `translateY(${(Math.sin(t / 380) * 4 * air).toFixed(1)}px) rotate(${(Math.sin(t / 520) * 1.6 * air).toFixed(2)}deg)`;
    planeEl.classList.add('ready');

    if (cur !== lastDrawn) {
      lastDrawn = cur;
      setTrail(len - 54 * S);                        // dashes stop at the plane's tail

      for (const d of doodles) d.style.translate = `0 ${(cur * parseFloat(d.dataset.speed)).toFixed(1)}px`;
      for (const c of clouds) {
        const span = W + c.w;                         // wraps while fully off-screen, so it never pops
        const x = ((((c.base + c.w + cur * c.drift) % span) + span) % span) - c.w;
        c.el.style.translate = `${(x - c.base).toFixed(1)}px ${(cur * parseFloat(c.el.dataset.speed)).toFixed(1)}px`;
      }

      const prog = clamp((cur + VH - certBox.y) / (certBox.h + VH), 0, 1);
      for (const b of beltList) b.el.style.transform = `translate3d(${(-b.travel * (1 - prog)).toFixed(1)}px,0,0)`;
    }
    requestAnimationFrame(frame);
  }

  /* ============================================================
     Go
     ============================================================ */
  let rebuildTimer = 0;
  const scheduleBuild = () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(build, 120); };

  build();
  requestAnimationFrame(frame);
  window.addEventListener('resize', scheduleBuild);
  window.addEventListener('load', build);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
  if ('ResizeObserver' in window) new ResizeObserver(scheduleBuild).observe(document.body);
})();
