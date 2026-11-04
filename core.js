/* ISS Moon-transit engine (browser + web worker).
 * Needs satellite.js (SGP4) and astronomy-engine loaded first.
 * Port of the Python/Skyfield version: everything is done in an Earth-fixed
 * frame (ISS from SGP4, Moon/Sun from astronomy-engine), so the ISS-Moon
 * geometry from any ground spot is self-consistent. */
(function (G) {
  'use strict';
  const S = G.satellite, A = G.Astronomy;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const WA = 6378.137, WB = 6356.752314245, E2 = 1 - (WB * WB) / (WA * WA);
  const AU = 149597870.7, MOON_R = 1737.4, RE = 6371.0;
  const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const unit = a => { const l = len(a); return [a[0]/l, a[1]/l, a[2]/l]; };
  const angle = (a, b) => Math.atan2(len(cross(a, b)), dot(a, b));
  const rotz = (v, g) => { const c = Math.cos(g), s = Math.sin(g); return [c*v[0] + s*v[1], -s*v[0] + c*v[1], v[2]]; };
  const wrapPi = x => { x %= 2 * Math.PI; if (x > Math.PI) x -= 2 * Math.PI; if (x < -Math.PI) x += 2 * Math.PI; return x; };
  const jdOfMs = ms => ms / 86400000 + 2440587.5;
  const msOfJd = jd => (jd - 2440587.5) * 86400000;
  const atime = jd => A.MakeTime(jd - 2451545.0);
  const compass = d => COMPASS[Math.floor(((d % 360) + 360) % 360 / 22.5 + 0.5) % 16];

  function phaseName(phaseDeg, illum) {
    const waxing = ((phaseDeg % 360) + 360) % 360 < 180;
    if (illum >= 0.97) return 'Full';
    if (illum <= 0.03) return 'New';
    if (illum >= 0.45 && illum <= 0.55) return waxing ? 'First quarter' : 'Last quarter';
    return `${waxing ? 'Waxing' : 'Waning'} ${illum > 0.5 ? 'gibbous' : 'crescent'}`;
  }

  // ground position: ECEF (km) plus local east/north/up axes
  function site(lat, lon, elevKm) {
    const p = lat * D2R, l = lon * D2R, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
    const N = WA / Math.sqrt(1 - E2 * sp * sp);
    return {lat, lon, elevKm,
      ecef: [(N + elevKm) * cp * cl, (N + elevKm) * cp * sl, (N * (1 - E2) + elevKm) * sp],
      E: [-sl, cl, 0], N: [-sp * cl, -sp * sl, cp], U: [cp * cl, cp * sl, sp]};
  }
  function altaz(st, v) {      // v: topocentric vector -> [az, alt] degrees
    const e = dot(v, st.E), n = dot(v, st.N), u = dot(v, st.U);
    return [(Math.atan2(e, n) * R2D + 360) % 360, Math.atan2(u, Math.hypot(e, n)) * R2D];
  }
  function enuKm(lat0, lon0, lat, lon) {
    let dl = lon - lon0; dl = ((dl + 540) % 360) - 180;
    return [RE * dl * D2R * Math.cos(lat0 * D2R), RE * (lat - lat0) * D2R];
  }
  function offsetPoint(lat, lon, brg, km) {
    const b = brg * D2R;
    return [lat + (km * Math.cos(b) / RE) * R2D, lon + (km * Math.sin(b) / (RE * Math.cos(lat * D2R))) * R2D];
  }

  function parseTLE(text) {
    const L = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const i = L.findIndex(s => s.startsWith('1 25544'));
    if (i < 0 || !L[i + 1] || !L[i + 1].startsWith('2 25544')) throw new Error('ISS orbit data not found in TLE');
    return [L[i], L[i + 1]];
  }

  class Engine {
    constructor(l1, l2) {
      this.l1 = l1; this.l2 = l2;
      this.rec = S.twoline2satrec(l1, l2);
      this.epochJd = this.rec.jdsatepoch + (this.rec.jdsatepochF || 0);
      this.mc = new Map();
    }
    iss(jd) {                                    // ISS, Earth-fixed km
      const pv = S.sgp4(this.rec, (jd - this.epochJd) * 1440);
      if (!pv || !pv.position) return null;
      const p = pv.position;
      return rotz([p.x, p.y, p.z], S.gstime(jd));
    }
    _moonMin(k) {                                // Moon (equator of date) each whole minute
      let c = this.mc.get(k);
      if (!c) {
        const jd = k / 1440, t = atime(jd);
        const w = A.RotateVector(A.Rotation_EQJ_EQD(t), A.GeoMoon(t));
        c = [w.x * AU, w.y * AU, w.z * AU, wrapPi(A.SiderealTime(t) * 15 * D2R - S.gstime(jd))];
        this.mc.set(k, c);
      }
      return c;
    }
    moon(jd) {                                   // Moon, Earth-fixed km (interpolated)
      const x = jd * 1440, k = Math.floor(x), f = x - k, a = this._moonMin(k), b = this._moonMin(k + 1);
      const v = [a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f, a[2] + (b[2]-a[2])*f];
      return rotz(v, S.gstime(jd) + a[3] + (b[3]-a[3])*f);
    }
    sun(jd) {
      const t = atime(jd), w = A.RotateVector(A.Rotation_EQJ_EQD(t), A.GeoVector(A.Body.Sun, t, true));
      return rotz([w.x * AU, w.y * AU, w.z * AU], A.SiderealTime(t) * 15 * D2R);
    }
    sky(st, jd) {
      const p = this.iss(jd), m = this.moon(jd);
      const ti = sub(p, st.ecef), tm = sub(m, st.ecef);
      const ia = altaz(st, ti), ma = altaz(st, tm), dm = len(tm);
      return {sep: angle(ti, tm) * R2D, r: Math.asin(MOON_R / dm) * R2D, issAz: ia[0], issAlt: ia[1],
              issKm: len(ti), az: ma[0], alt: ma[1]};
    }
    crossing(st, jdc, half = 4, step = 0.002) {
      let best = null, inside = 0;
      for (let s = -half; s < half; s += step) {
        const jd = jdc + s / 86400, k = this.sky(st, jd);
        if (k.sep < k.r) inside++;
        if (!best || k.sep < best.sep) best = {...k, jd};
      }
      best.dur = inside * step;
      return best;
    }
    // ground spot where the ISS is dead-centre on the Moon at time jd
    centerline(jd, elevKm) {
      const p = this.iss(jd), m = this.moon(jd);
      const u = unit(sub(m, p)), a = WA + elevKm, b = WB + elevKm;
      const P = [p[0]/a, p[1]/a, p[2]/b], U = [u[0]/a, u[1]/a, u[2]/b];
      const qa = dot(U, U), qb = -2 * dot(P, U), qc = dot(P, P) - 1, disc = qb * qb - 4 * qa * qc;
      if (disc < 0) return null;
      const s = (-qb - Math.sqrt(disc)) / (2 * qa);
      if (s <= 0) return null;
      const g = [p[0] - s*u[0], p[1] - s*u[1], p[2] - s*u[2]];
      return [Math.atan2(g[2] / (b*b), Math.hypot(g[0], g[1]) / (a*a)) * R2D, Math.atan2(g[1], g[0]) * R2D];
    }
    sunlit(p, sunDir) {
      const d = dot(p, sunDir);
      return d > 0 || len([p[0] - d*sunDir[0], p[1] - d*sunDir[1], p[2] - d*sunDir[2]]) > RE;
    }
    moonInfo(jd) {
      const t = atime(jd);
      return {illum: A.Illumination(A.Body.Moon, t).phase_fraction, phaseDeg: A.MoonPhase(t)};
    }

    analyze(home, jdc, pathElevKm, radiusKm, minAlt) {
      const half = Math.max(40, radiusKm / 6), step = 0.02, pts = [];
      for (let w = -half; w < half; w += step) pts.push([w, this.centerline(jdc + w / 86400, pathElevKm)]);
      // nearest point of the centerline polyline to home
      let best = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const A0 = pts[i][1], B0 = pts[i + 1][1];
        if (!A0 || !B0) continue;
        const a = enuKm(home.lat, home.lon, A0[0], A0[1]), b = enuKm(home.lat, home.lon, B0[0], B0[1]);
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx*dx + dy*dy || 1e-12;
        const f = Math.min(1, Math.max(0, -(a[0]*dx + a[1]*dy) / L2));
        const px = a[0] + f*dx, py = a[1] + f*dy, d = Math.hypot(px, py);
        if (!best || d < best.dist) best = {dist: d, i, f, px, py, dx, dy,
          lat: A0[0] + f * (B0[0] - A0[0]), lon: A0[1] + f * (B0[1] - A0[1])};
      }
      if (!best || best.dist > radiusKm) return null;
      const near = {dist: best.dist, lat: best.lat, lon: best.lon,
                    bearing: (Math.atan2(best.px, best.py) * R2D + 360) % 360,
                    trackDir: (Math.atan2(best.dx, best.dy) * R2D + 360) % 360};
      const jdCl = jdc + (pts[best.i][0] + best.f * step) / 86400;
      const clSite = site(near.lat, near.lon, pathElevKm);
      const cl = this.crossing(clSite, jdCl);
      if (cl.alt < minAlt || cl.sep > cl.r * 0.2) return null;
      let seps = 0;     // 1 km either side; averaging cancels a small centre offset
      for (const b of [90, 270]) { const [la, lo] = offsetPoint(near.lat, near.lon, near.trackDir + b, 1.0);
        seps += this.crossing(site(la, lo, pathElevKm), jdCl).sep; }
      const halfWidth = cl.r / Math.max(seps / 2, 1e-9);
      const track = [];
      const keepKm = Math.max(radiusKm, near.dist + 100) * 1.5;
      for (let i = 0; i < pts.length; i += 10) { const q = pts[i][1]; if (!q) continue;
        const e = enuKm(home.lat, home.lon, q[0], q[1]); if (Math.hypot(e[0], e[1]) < keepKm) track.push([+q[0].toFixed(5), +q[1].toFixed(5)]); }
      const mi = this.moonInfo(cl.jd);
      const sunAlt = altaz(clSite, sub(this.sun(cl.jd), clSite.ecef))[1];
      return {jdc, pathElevKm, near, cl, halfWidth, track, illum: mi.illum, phaseDeg: mi.phaseDeg, sunAlt};
    }

    findEvents(home, jd0, jd1, radiusKm, minAlt, progress) {
      const passAlt = radiusKm > 300 ? 0 : Math.max(0, minAlt - 8);
      // ISS passes over home: coarse 20 s scan
      const passes = []; let start = null;
      for (let jd = jd0; jd < jd1; jd += 20 / 86400) {
        const p = this.iss(jd); if (!p) continue;
        const up = altaz(home, sub(p, home.ecef))[1] > passAlt;
        if (up && start === null) start = jd - 20 / 86400;
        if (!up && start !== null) { passes.push([start, jd]); start = null; }
      }
      const events = [];
      passes.forEach(([r, s], n) => {
        if (progress && n % 4 === 0) progress(n / passes.length);
        let bestI = -1, bestSep = 999, moonUp = false;
        const samples = [];
        for (let jd = r; jd < s; jd += 0.5 / 86400) samples.push([jd, this.sky(home, jd)]);
        for (const [, k] of samples) if (k.alt >= minAlt - 8) moonUp = true;
        if (!moonUp) return;
        samples.forEach(([jd, k], i) => {
          const slack = (radiusKm / k.issKm) * R2D * 1.5 + k.r + 0.5;
          if (k.sep < slack && k.alt > minAlt - 8 && k.sep < bestSep) { bestSep = k.sep; bestI = i; }
        });
        if (bestI < 0) return;
        const ev = this.analyze(home, samples[bestI][0], home.elevKm, radiusKm, minAlt);
        if (ev) events.push(ev);
      });
      if (progress) progress(1);
      return events;
    }
  }

  // ---------- time formatting in a given IANA time zone ----------
  function tzParts(ms, tz) {
    const o = {};
    for (const p of new Intl.DateTimeFormat('en-US', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long', timeZoneName: 'short'})
      .formatToParts(new Date(ms))) o[p.type] = p.value;
    const asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second);
    return {...o, offsetMin: Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000)};
  }
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmt(ms, tz) {
    const p = tzParts(ms, tz), h = +p.hour % 24, h12 = h % 12 || 12, ap = h < 12 ? 'AM' : 'PM';
    const hund = String(Math.floor((((ms % 1000) + 1000) % 1000) / 10)).padStart(2, '0');
    const mon = MONTHS[+p.month - 1];
    return {date: `${p.weekday}, ${mon} ${+p.day} ${p.year}`, short: `${mon} ${+p.day}`,
            dateShort: `${p.weekday.slice(0, 3)} ${mon} ${+p.day} ${p.year}`,
            clock: `${String(h12).padStart(2, '0')}:${p.minute}:${p.second}.${hund} ${ap}`,
            tz: p.timeZoneName, offsetMin: p.offsetMin};
  }

  // ---------- data for the sky simulator, seen from one spot ----------
  function simData(eng, spot, home, tz, sky) {
    const st = site(spot.lat, spot.lon, spot.elevKm);
    const c = eng.crossing(st, spot.jd, 6, 0.002);
    const jt = c.jd;
    // whole pass seen from the spot
    let r = jt, s = jt;
    while (r > jt - 0.012) { const p = eng.iss(r - 5 / 86400); if (!p || altaz(st, sub(p, st.ecef))[1] < 0) break; r -= 5 / 86400; }
    while (s < jt + 0.012) { const p = eng.iss(s + 5 / 86400); if (!p || altaz(st, sub(p, st.ecef))[1] < 0) break; s += 5 / 86400; }
    const sunV = eng.sun(jt), sunDir = unit(sunV);
    const series = (t0, t1, dt, nd) => {
      const o = {t0, dt, iss_az: [], iss_alt: [], iss_km: [], moon_az: [], moon_alt: [], lit: []};
      for (let t = t0; t <= t1 + 1e-9; t += dt) {
        const jd = jt + t / 86400, p = eng.iss(jd), m = eng.moon(jd);
        const ti = sub(p, st.ecef), ia = altaz(st, ti), ma = altaz(st, sub(m, st.ecef));
        o.iss_az.push(+ia[0].toFixed(nd)); o.iss_alt.push(+ia[1].toFixed(nd)); o.iss_km.push(+len(ti).toFixed(2));
        o.moon_az.push(+ma[0].toFixed(nd)); o.moon_alt.push(+ma[1].toFixed(nd)); o.lit.push(eng.sunlit(p, sunDir) ? 1 : 0);
      }
      return o;
    };
    const c0 = Math.floor((r - jt) * 86400), c1 = Math.ceil((s - jt) * 86400);
    const coarse = series(c0, c1, 1, 4);
    const fine = series(-6, 6, 0.01, 6);
    const sunAA = altaz(st, sub(sunV, st.ecef));
    // stars, constellations, planets
    const t = atime(jt), obs = new A.Observer(spot.lat, spot.lon, spot.elevKm * 1000);
    const rot = A.Rotation_EQJ_HOR(t, obs);
    const hor = (ra, dec) => { const v = A.RotateVector(rot, A.VectorFromSphere(new A.Spherical(dec, ra, 1), t));
      return [+((Math.atan2(-v.y, v.x) * R2D + 360) % 360).toFixed(3), +(Math.asin(Math.max(-1, Math.min(1, v.z))) * R2D).toFixed(3)]; };
    const stars = [];
    for (const [ra, dec, m, bv] of sky.stars) { const h = hor(ra, dec); if (h[1] > -2) stars.push([h[0], h[1], m, bv]); }
    const lines = sky.lines.map(seg => seg.map(p => hor(p[0], p[1]))).filter(seg => seg.some(p => p[1] > -5));
    const cnst = sky.names.map(n => { const h = hor(n[1], n[2]); return [n[0], h[0], h[1]]; }).filter(n => n[2] > 3);
    const MAG = {Mercury: 0, Venus: -4.2, Mars: 0.5, Jupiter: -2.3, Saturn: 0.7};
    const planets = [];
    for (const name of Object.keys(MAG)) {
      const e = A.Equator(name, t, obs, true, true), h = A.Horizon(t, obs, e.ra, e.dec);
      if (h.altitude > -2) planets.push([name, +h.azimuth.toFixed(3), +h.altitude.toFixed(3), MAG[name]]);
    }
    const mi = eng.moonInfo(jt), ms = msOfJd(jt), F = fmt(ms, tz);
    const e = enuKm(home[0], home[1], spot.lat, spot.lon);
    return {date: F.date, short: F.short, clock: F.clock, tz: F.tz, tz_offset_min: F.offsetMin, unix: ms / 1000,
      lat: +spot.lat.toFixed(5), lon: +spot.lon.toFixed(5), elev_m: Math.round(spot.elevKm * 1000),
      dist_km: +Math.hypot(e[0], e[1]).toFixed(1), dir: compass(Math.atan2(e[0], e[1]) * R2D),
      half_width: spot.halfWidth, dur: +c.dur.toFixed(3), look_az: +c.az.toFixed(2), look_alt: +c.alt.toFixed(2),
      look_txt: compass(c.az), illum: +mi.illum.toFixed(4), phase: phaseName(mi.phaseDeg, mi.illum),
      moon_r: +c.r.toFixed(5), sun: [+sunAA[0].toFixed(3), +sunAA[1].toFixed(3)], miss_arcmin: +(c.sep * 60).toFixed(2),
      coarse, fine, stars, lines, const: cnst, planets};
  }

  G.TC = {Engine, site, altaz, parseTLE, compass, phaseName, fmt, simData, jdOfMs, msOfJd, offsetPoint, D2R, R2D};
})(typeof self !== 'undefined' ? self : globalThis);
