/* Sky simulator renderer (data prepared by sim.html). */
const EV = window.__EV;
const HOME = window.__HOME;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const st = {ei: 0, t: -20, playing: false, speed: 1, mode: 'sky', fovSky: 70, fovTel: 0.9,
            follow: true, cAz: 180, cAlt: 30};
let E, PRE;

// ---------- vector helpers ----------
const vec = (az, alt) => { const a = az * D2R, h = alt * D2R, c = Math.cos(h);
  return [c * Math.sin(a), c * Math.cos(a), Math.sin(h)]; };
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const toAzAlt = v => [(Math.atan2(v[0], v[1]) * R2D + 360) % 360, Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D];

function basis(f) {
  let r = cross(f, [0, 0, 1]);
  if (Math.hypot(...r) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  return {f, r, u: cross(r, f)};
}
// stereographic camera; fov is the horizontal field in degrees
function camera(center, fov, x0, y0, w, h) {
  const b = basis(center);
  const s = (w / 2) / (2 * Math.tan(fov * D2R / 4));
  return {...b, s, x0, y0, w, h,
    p(v) { const z = dot(v, b.f); if (z < -0.95) return null; const k = 2 / (1 + z);
           return [x0 + w/2 + s * k * dot(v, b.r), y0 + h/2 - s * k * dot(v, b.u), z]; },
    // canvas angle (radians, y down) of the direction from sky point m toward sky point v
    dirAt(m, v) { const d = dot(v, m), t = norm([v[0]-d*m[0], v[1]-d*m[1], v[2]-d*m[2]]);
                  const q = norm([m[0]+.002*t[0], m[1]+.002*t[1], m[2]+.002*t[2]]);
                  const A = this.p(m), B = this.p(q); return Math.atan2(B[1]-A[1], B[0]-A[0]); } };
}

// ---------- per-event precompute ----------
function prep() {
  E = EV[st.ei];
  const mk = S => {
    const n = S.iss_az.length, iss = [], moon = [];
    for (let i = 0; i < n; i++) { iss.push(vec(S.iss_az[i], S.iss_alt[i])); moon.push(vec(S.moon_az[i], S.moon_alt[i])); }
    // ISS position relative to the Moon's centre, in the Moon-centred view (radians)
    const rel = iss.map((v, i) => { const b = basis(moon[i]); const z = dot(v, b.f), k = 2 / (1 + z);
                                    return [k * dot(v, b.r), k * dot(v, b.u)]; });
    return {...S, n, iss, moon, rel};
  };
  PRE = {c: mk(E.coarse), f: mk(E.fine), sun: vec(E.sun[0], E.sun[1]),
         stars: E.stars.map(s => ({v: vec(s[0], s[1]), m: s[2], bv: s[3]})),
         lines: E.lines.map(l => l.map(p => vec(p[0], p[1]))),
         const: E.const.map(c => ({n: c[0], v: vec(c[1], c[2])})),
         planets: E.planets.map(p => ({n: p[0], v: vec(p[1], p[2]), m: p[3]})),
         ncp: vec(0, E.lat)};
  PRE.t0 = PRE.c.t0; PRE.t1 = PRE.c.t0 + (PRE.c.n - 1) * PRE.c.dt;
  const sl = document.getElementById('slider');
  sl.min = PRE.t0; sl.max = PRE.t1;
  const ll = `${E.lat.toFixed(5)}, ${E.lon.toFixed(5)}`;
  const iso = new Date(E.unix * 1000).toISOString();
  const sw = `https://stellarium-web.org/skysource/Moon?fov=1&date=${iso}&lat=${E.lat}&lng=${E.lon}&elev=${E.elev_m}`;
  document.getElementById('details').innerHTML = [
    ['Date', E.date], ['Transit', `${E.clock} ${E.tz}`],
    ['Stand at', `<a href="https://www.google.com/maps?q=${E.lat},${E.lon}" target="_blank">${ll}</a>`],
    ['', `${E.dist_km} km ${E.dir} of home (path centre)`],
    ['Look', `${E.look_txt} ${E.look_az.toFixed(1)}&deg;, ${E.look_alt.toFixed(1)}&deg; up`],
    ['Crossing time', `${E.dur.toFixed(2)} s`],
    ['Visible strip', `${(2 * E.half_width).toFixed(1)} km wide`],
    ['Moon', `${Math.round(E.illum * 100)}% &middot; ${E.phase}`],
    ['Compare', `<a href="${sw}" target="_blank">Stellarium Web</a>`]
  ].map(r => `<div class="row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('');
}

function sample(t) {
  const F = PRE.f, C = PRE.c;
  let S = C, x = (t - C.t0) / C.dt;
  const xf = (t - F.t0) / F.dt;
  if (xf >= 0 && xf <= F.n - 1) { S = F; x = xf; }
  x = Math.max(0, Math.min(S.n - 1.0001, x));
  const i = Math.floor(x), a = x - i;
  const L = (A, B) => norm([A[0] + (B[0]-A[0])*a, A[1] + (B[1]-A[1])*a, A[2] + (B[2]-A[2])*a]);
  return {iss: L(S.iss[i], S.iss[i+1]), moon: L(S.moon[i], S.moon[i+1]),
          rel: [S.rel[i][0] + (S.rel[i+1][0]-S.rel[i][0])*a, S.rel[i][1] + (S.rel[i+1][1]-S.rel[i][1])*a],
          km: S.iss_km[i] + (S.iss_km[i+1]-S.iss_km[i])*a, lit: S.lit[a < .5 ? i : i+1],
          relDir: Math.atan2(-(S.rel[i+1][1]-S.rel[i][1]), S.rel[i+1][0]-S.rel[i][0])};
}

// ---------- drawing ----------
function bvColor(bv) {
  if (bv < 0) return '#a9c4ff'; if (bv < .3) return '#cfdcff'; if (bv < .6) return '#f4f4ff';
  if (bv < 1.0) return '#fff1d0'; if (bv < 1.4) return '#ffd9a0'; return '#ffbf80';
}

function drawMoon(cam, mv, R, detailed) {
  const P = cam.p(mv); if (!P) return;
  const [x, y] = P;
  // glow
  const gR = R < 40 ? Math.max(R * 3, 18) : R * 1.12;
  const g = ctx.createRadialGradient(x, y, R * .95, x, y, gR);
  g.addColorStop(0, `rgba(220,225,255,${R < 40 ? .28 : .12})`); g.addColorStop(1, 'rgba(220,225,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, gR, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(x, y);
  // base disc with limb darkening
  const lg = ctx.createRadialGradient(-R*.15, -R*.15, 0, 0, 0, R);
  lg.addColorStop(0, '#fbf8ee'); lg.addColorStop(.75, '#e6e0cc'); lg.addColorStop(1, '#a9a391');
  ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
  if (detailed && R > 12) {
    // approximate maria (illustrative), lunar north toward the celestial pole
    ctx.save(); ctx.rotate(cam.dirAt(mv, PRE.ncp) + Math.PI / 2);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.clip();
    const maria = [[-.3,.5,.27],[.27,.45,.16],[.42,.12,.19],[.74,.3,.11],[.6,-.17,.13],[-.18,-.33,.15],
                   [-.62,.15,.33],[-.5,-.42,.09],[.45,-.3,.09],[-.05,.08,.1],[-.42,.62,.12]];
    for (const [mx, my, mr] of maria) {
      const rg = ctx.createRadialGradient(mx*R, -my*R, 0, mx*R, -my*R, mr*R*1.25);
      rg.addColorStop(0, 'rgba(120,118,112,.38)'); rg.addColorStop(.6, 'rgba(120,118,112,.22)');
      rg.addColorStop(1, 'rgba(120,118,112,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(mx*R, -my*R, mr*R*1.25, 0, 7); ctx.fill();
    }
    // Tycho and its rays
    ctx.strokeStyle = 'rgba(255,255,250,.07)'; ctx.lineWidth = Math.max(1, R * .008);
    for (let k = 0; k < 10; k++) { const a = k * .63 + .2; ctx.beginPath(); ctx.moveTo(-.15*R, .72*R);
      ctx.lineTo(-.15*R + Math.cos(a)*R*.45, .72*R + Math.sin(a)*R*.45); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,250,.45)'; ctx.beginPath(); ctx.arc(-.15*R, .72*R, R*.018, 0, 7); ctx.fill();
    ctx.restore();
  }
  // unlit part (phase)
  ctx.rotate(cam.dirAt(mv, PRE.sun));   // +x now points toward the Sun
  const e = 1 - 2 * E.illum;
  if (E.illum < .999) {
    ctx.beginPath();
    for (let a = -90; a <= 90; a += 3) ctx.lineTo(-R * Math.cos(a*D2R), R * Math.sin(a*D2R));
    for (let a = 90; a >= -90; a -= 3) ctx.lineTo(e * R * Math.cos(a*D2R), R * Math.sin(a*D2R));
    ctx.closePath(); ctx.fillStyle = 'rgba(18,20,28,.93)'; ctx.fill();
  }
  ctx.restore();
}

function drawISSShape(x, y, Lpx, ang, fill) {
  // Lpx = truss length (108.5 m) in pixels; +x along the direction of motion
  const k = Lpx / 108.5;
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = fill;
  const R = (x0, y0, w, h) => ctx.fillRect(x0 * k, y0 * k, Math.max(w * k, .8), Math.max(h * k, .8));
  R(-2, -54, 4, 108);                    // truss
  R(-26, -3.5, 52, 7);                   // pressurised modules
  for (const s of [-1, 1]) for (const yc of [37, 49]) {   // solar array wings
    R(-36, s * yc - 4.5, 33, 9); R(3, s * yc - 4.5, 33, 9); }
  R(-8, -24, 16, 6); R(-8, 18, 16, 6);   // radiators
  ctx.restore();
}

function drawSky() {
  const now = sample(st.t);
  if (st.follow) { [st.cAz, st.cAlt] = toAzAlt(now.moon); st.cAlt = Math.min(st.cAlt, 80); }
  const cam = camera(vec(st.cAz, st.cAlt), st.fovSky, 0, 0, W, H);
  // sky (moonlit)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#060b1c'); g.addColorStop(1, '#13203d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const pxDeg = cam.s * D2R;
  // alt/az grid
  ctx.strokeStyle = 'rgba(120,150,210,.10)'; ctx.lineWidth = 1;
  for (let alt = 15; alt < 90; alt += 15) { ctx.beginPath(); let on = false;
    for (let az = 0; az <= 360; az += 2) { const p = cam.p(vec(az, alt)); if (!p || p[2] < -.3) { on = false; continue; }
      on ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); on = true; } ctx.stroke(); }
  for (let az = 0; az < 360; az += 30) { ctx.beginPath(); let on = false;
    for (let alt = 0; alt <= 88; alt += 2) { const p = cam.p(vec(az, alt)); if (!p || p[2] < -.3) { on = false; continue; }
      on ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); on = true; } ctx.stroke(); }
  // constellation lines
  ctx.strokeStyle = 'rgba(110,150,220,.32)'; ctx.lineWidth = 1;
  for (const l of PRE.lines) { ctx.beginPath(); let on = false;
    for (const v of l) { const p = cam.p(v); if (!p || p[2] < 0) { on = false; continue; }
      on ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); on = true; } ctx.stroke(); }
  ctx.fillStyle = 'rgba(140,170,230,.55)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  if (st.fovSky > 12) for (const c of PRE.const) { const p = cam.p(c.v); if (p && p[2] > 0) ctx.fillText(c.n.toUpperCase(), p[0], p[1]); }
  // stars (the full Moon washes out the faintest)
  const zoomGain = Math.max(0, Math.log2(60 / st.fovSky)) * .6;
  for (const s of PRE.stars) { const p = cam.p(s.v); if (!p || p[2] < 0) continue;
    const lim = 5.0 + zoomGain; if (s.m > lim) continue;
    const r = Math.max(.5, (lim + 1 - s.m) * .55);
    ctx.globalAlpha = Math.min(1, .35 + (lim - s.m) * .25);
    ctx.fillStyle = bvColor(s.bv); ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  for (const pl of PRE.planets) { const p = cam.p(pl.v); if (!p || p[2] < 0) continue;
    ctx.fillStyle = '#fff6dd'; ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(2.2, 3.5 - pl.m * .4), 0, 7); ctx.fill();
    ctx.fillStyle = '#e8d9a8'; ctx.fillText(pl.n, p[0] + 7, p[1] - 5); }
  // ISS pass: bright where sunlit, dashed grey where in Earth's shadow
  const C = PRE.c;
  ctx.lineWidth = 2;
  for (let i = 0; i < C.n - 1; i++) { const a = cam.p(C.iss[i]), b = cam.p(C.iss[i+1]);
    if (!a || !b || a[2] < 0 || b[2] < 0) continue;
    ctx.strokeStyle = C.lit[i] ? 'rgba(255,210,90,.75)' : 'rgba(170,180,200,.45)';
    ctx.setLineDash(C.lit[i] ? [] : [4, 4]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,220,140,.8)'; ctx.font = '11px system-ui';
  for (let i = 0; i < C.n; i++) { const tt = C.t0 + i * C.dt; if (Math.round(tt) % 30 || Math.abs(tt) < 1) continue;
    const p = cam.p(C.iss[i]); if (!p || p[2] < 0) continue;
    ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, 7); ctx.fill();
    ctx.fillText(`${tt > 0 ? '+' : '−'}${Math.abs(Math.round(tt))}s`, p[0] + 5, p[1] + 12); }
  // ground
  ctx.beginPath(); let first = true;
  for (let az = st.cAz - 175; az <= st.cAz + 175; az += 2) { const p = cam.p(vec(az, 0)); if (!p) continue;
    first ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]); first = false; }
  for (let az = st.cAz + 175; az >= st.cAz - 175; az -= 5) { const p = cam.p(vec(az, -40)); if (!p) continue; ctx.lineTo(p[0], p[1]); }
  ctx.closePath(); ctx.fillStyle = '#0b1209'; ctx.fill();
  ctx.strokeStyle = '#3a5a3a'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.font = '600 14px system-ui'; ctx.textAlign = 'center';
  ['N','NE','E','SE','S','SW','W','NW'].forEach((n, i) => { const p = cam.p(vec(i * 45, 0)); if (!p || p[2] < 0) return;
    ctx.fillStyle = n === 'N' ? '#ff8080' : '#c9d6c0'; ctx.fillText(n, p[0], p[1] + 18); });
  // Moon
  const R = Math.max(5, E.moon_r * D2R * cam.s);
  drawMoon(cam, now.moon, R, R > 12);
  const mp = cam.p(now.moon);
  if (mp) { ctx.fillStyle = '#dfe6ff'; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('Moon', mp[0] + R + 6, mp[1] - R - 2); }
  // ISS now
  const ip = cam.p(now.iss);
  if (ip && ip[2] > 0) {
    ctx.fillStyle = now.lit ? '#fff7d6' : '#8a94a8';
    if (now.lit) { const gg = ctx.createRadialGradient(ip[0], ip[1], 0, ip[0], ip[1], 9);
      gg.addColorStop(0, 'rgba(255,240,190,.9)'); gg.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(ip[0], ip[1], 9, 0, 7); ctx.fill(); ctx.fillStyle = '#fffbe8'; }
    ctx.beginPath(); ctx.arc(ip[0], ip[1], 3, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffe9a8'; ctx.font = '600 12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('ISS', ip[0] + 8, ip[1] + 4);
  }
  // telescope inset
  const barH = document.getElementById('bar').offsetHeight;
  const d = Math.min(W * .5, H * .36, 420), x0 = W - d - 16, y0 = H - d - barH - 34;
  ctx.save(); ctx.beginPath(); ctx.arc(x0 + d/2, y0 + d/2, d/2, 0, 7); ctx.clip();
  drawTel(x0, y0, d, d, true); ctx.restore();
  ctx.strokeStyle = '#6a7da8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x0 + d/2, y0 + d/2, d/2, 0, 7); ctx.stroke();
  ctx.fillStyle = '#aab8d8'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(`Telescope view · ${st.fovTel.toFixed(2)}° field (press T to enlarge)`, x0 + d/2, y0 - 6);
}

function drawTel(x0, y0, w, h, inset) {
  const now = sample(st.t);
  const cam = camera(now.moon, st.fovTel, x0, y0, w, h);
  ctx.fillStyle = '#0a1226'; ctx.fillRect(x0, y0, w, h);
  for (const s of PRE.stars) { const p = cam.p(s.v); if (!p || p[2] < .99) continue;
    if (p[0] < x0 || p[0] > x0 + w || p[1] < y0 || p[1] > y0 + h) continue;
    ctx.fillStyle = bvColor(s.bv); ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(.8, 4 - s.m * .5), 0, 7); ctx.fill(); }
  const R = E.moon_r * D2R * cam.s;
  drawMoon(cam, now.moon, R, true);
  const cx = x0 + w/2, cy = y0 + h/2, s = cam.s;
  const P = r => [cx + s * r[0], cy - s * r[1]];
  // ISS path relative to the Moon (fine samples, then coarse beyond)
  const F = PRE.f;
  ctx.strokeStyle = 'rgba(255,120,90,.85)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
  ctx.beginPath(); F.rel.forEach((r, i) => { const p = P(r); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.stroke();
  ctx.setLineDash([]);
  // time ticks every 0.1 s, labels every 0.5 s
  ctx.font = `${inset ? 10 : 12}px ui-monospace,Consolas,monospace`; ctx.textAlign = 'left';
  for (let i = 0; i < F.n; i += 10) { const tt = F.t0 + i * F.dt, p = P(F.rel[i]);
    if (p[0] < x0 - 20 || p[0] > x0 + w + 20 || p[1] < y0 - 20 || p[1] > y0 + h + 20) continue;
    const lab = Math.abs(Math.round(tt * 100)) % 50 === 0;
    ctx.fillStyle = '#ff6a4a'; ctx.strokeStyle = 'rgba(40,10,0,.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p[0], p[1], lab ? 3.5 : 2.3, 0, 7); ctx.fill(); ctx.stroke();
    if (lab && (!inset || Math.abs(Math.round(tt*100)) % 100 === 0)) {
      ctx.fillStyle = 'rgba(255,190,160,.95)';
      ctx.fillText(Math.abs(tt) < .005 ? 'T 0' : `${tt > 0 ? '+' : '−'}${Math.abs(tt).toFixed(1)}s`, p[0] + 6, p[1] - 6); } }
  // the ISS itself, true angular size
  const ip = P(now.rel);
  const Lpx = (0.1085 / now.km) * s;
  const onMoon = Math.hypot(now.rel[0], now.rel[1]) < E.moon_r * D2R;
  drawISSShape(ip[0], ip[1], Math.max(Lpx, 3), now.relDir, onMoon ? '#050505' : (now.lit ? '#fff2c8' : '#5d6678'));
  if (!onMoon) { ctx.strokeStyle = now.lit ? 'rgba(255,240,190,.5)' : 'rgba(150,160,180,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ip[0], ip[1], Math.max(Lpx, 3) * .8 + 4, 0, 7); ctx.stroke(); }
  if (!inset && ip[0] > x0 && ip[0] < x0 + w && ip[1] > y0 && ip[1] < y0 + h) {
    ctx.fillStyle = onMoon ? '#202020' : '#ffe9a8'; ctx.font = '600 12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('ISS', ip[0] + Math.max(Lpx, 3) * .6 + 6, ip[1] + 4); }
  // reticle
  ctx.strokeStyle = 'rgba(120,160,255,.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y0 + h); ctx.moveTo(x0, cy); ctx.lineTo(x0 + w, cy); ctx.stroke();
  if (!inset) {
    ctx.fillStyle = '#aab8d8'; ctx.font = '12px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(`Telescope view, ${st.fovTel.toFixed(2)}° field · zenith up · tracking the Moon · ISS drawn at true size`, x0 + w - 12, y0 + 20);
    ctx.fillText('Moon surface markings are illustrative', x0 + w - 12, y0 + 38);
    // zenith arrow
    ctx.textAlign = 'center'; ctx.fillText('↑ zenith', x0 + w - 50, y0 + 62);
  }
}

// ---------- HUD ----------
function fmtClock(t) {
  const ms = (E.unix + t) * 1000 + E.tz_offset_min * 60000, d = new Date(ms);
  let h = d.getUTCHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  const p2 = n => String(n).padStart(2, '0');
  return `${h}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${p2(Math.floor(d.getUTCMilliseconds() / 10))} ${ap} ${E.tz}`;
}
function hud() {
  const now = sample(st.t);
  document.getElementById('clock').textContent = fmtClock(st.t);
  const sgn = st.t < 0 ? 'T−' : 'T+';
  document.getElementById('tminus').textContent = `${sgn}${Math.abs(st.t).toFixed(2)} s  (${st.speed}×${st.playing ? '' : ', paused'})`;
  const sep = Math.acos(Math.max(-1, Math.min(1, dot(now.iss, now.moon)))) * R2D;
  const [az, alt] = toAzAlt(now.iss);
  const onMoon = sep < E.moon_r;
  document.getElementById('state').innerHTML =
    `ISS ${az.toFixed(1)}&deg; az, ${alt.toFixed(1)}&deg; up &middot; ${now.km.toFixed(0)} km away<br>` +
    `${sep < 2 ? (sep * 60).toFixed(1) + '′' : sep.toFixed(1) + '&deg;'} from Moon centre &middot; ` +
    (onMoon ? '<b style="color:#ffd36b">IN FRONT OF THE MOON</b>' :
      (now.lit ? 'sunlit (visible as a bright dot)' : "in Earth's shadow (dark, only seen against the Moon)"));
  document.getElementById('slider').value = st.t;
  document.getElementById('play').innerHTML = st.playing ? '&#10074;&#10074; Pause' : '&#9654; Play';
  document.querySelectorAll('[data-sp]').forEach(b => b.classList.toggle('on', +b.dataset.sp === st.speed));
  document.getElementById('vSky').classList.toggle('on', st.mode === 'sky');
  document.getElementById('vTel').classList.toggle('on', st.mode === 'tel');
  document.getElementById('follow').checked = st.follow;
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  if (st.playing) {
    let sp = st.speed;
    if (document.getElementById('slowmo').checked && Math.abs(st.t) < 1.5) sp = Math.min(sp, .1);
    st.t += dt * sp;
    if (st.t >= PRE.t1) { st.t = PRE.t1; st.playing = false; }
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (st.mode === 'sky') drawSky(); else drawTel(0, 0, W, H, false);
  hud();
  requestAnimationFrame(frame);
}
function resize() { DPR = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }

// ---------- controls ----------
const sel = document.getElementById('ev');
EV.forEach((e, i) => { const o = document.createElement('option'); o.value = i;
  o.textContent = `${e.short} · ${e.clock} · ${e.dist_km} km ${e.dir} · ${e.dur.toFixed(2)} s`; sel.appendChild(o); });
sel.onchange = () => { st.ei = +sel.value; prep(); st.t = -20; st.follow = true; st.playing = false; };
document.getElementById('play').onclick = () => { if (st.t >= PRE.t1) st.t = PRE.t0; st.playing = !st.playing; };
document.getElementById('watch').onclick = () => { st.t = -3; st.speed = .25; st.playing = true; };
document.getElementById('toStart').onclick = () => { st.t = PRE.t0; st.playing = false; st.follow = true; };
document.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { st.speed = +b.dataset.sp; });
document.getElementById('vSky').onclick = () => st.mode = 'sky';
document.getElementById('vTel').onclick = () => st.mode = 'tel';
document.getElementById('follow').onchange = e => st.follow = e.target.checked;
document.getElementById('slider').oninput = e => { st.t = +e.target.value; st.playing = false; };
addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT') return;
  if (e.key === ' ') { st.playing = !st.playing; e.preventDefault(); }
  else if (e.key === 'ArrowRight') st.t = Math.min(PRE.t1, st.t + (e.shiftKey ? 1 : .1));
  else if (e.key === 'ArrowLeft') st.t = Math.max(PRE.t0, st.t - (e.shiftKey ? 1 : .1));
  else if (e.key === 't' || e.key === 'T') st.mode = 'tel';
  else if (e.key === 's' || e.key === 'S') st.mode = 'sky';
});
cv.addEventListener('wheel', e => { e.preventDefault(); const k = Math.pow(1.12, Math.sign(e.deltaY));
  if (st.mode === 'sky') st.fovSky = Math.max(3, Math.min(150, st.fovSky * k));
  else st.fovTel = Math.max(.08, Math.min(6, st.fovTel * k)); }, {passive: false});
const ptrs = new Map(); let pinch0 = 0, drag = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0]-b[0], a[1]-b[1]); }
  drag = [e.clientX, e.clientY]; });
cv.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0]-b[0], a[1]-b[1]);
    if (pinch0) { const k = pinch0 / d; if (st.mode === 'sky') st.fovSky = Math.max(3, Math.min(150, st.fovSky * k));
      else st.fovTel = Math.max(.08, Math.min(6, st.fovTel * k)); } pinch0 = d; return; }
  if (st.mode !== 'sky' || !drag) return;
  const degPx = st.fovSky / W;
  st.follow = false;
  st.cAz = (st.cAz - (e.clientX - drag[0]) * degPx / Math.max(.2, Math.cos(st.cAlt * D2R)) + 360) % 360;
  st.cAlt = Math.max(-10, Math.min(85, st.cAlt + (e.clientY - drag[1]) * degPx));
  drag = [e.clientX, e.clientY]; });
const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0; if (!ptrs.size) drag = null; };
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);

addEventListener('resize', resize);
{ const q = +new URLSearchParams(location.search).get('ev');
  if (q >= 0 && q < EV.length) { st.ei = q; sel.value = q; } }
resize(); prep(); requestAnimationFrame(frame);
