/* Background transit search, so the page stays responsive. */
importScripts('vendor/satellite.min.js', 'vendor/astronomy.browser.min.js', 'core.js');

const RADII_KM = [250, 600, 1200];
const MIN_ALT = 10;

async function elevations(points) {
  if (!points.length) return [];
  const q = new URLSearchParams({latitude: points.map(p => p[0].toFixed(5)).join(','),
                                 longitude: points.map(p => p[1].toFixed(5)).join(',')});
  const r = await fetch('https://api.open-meteo.com/v1/elevation?' + q);
  if (!r.ok) throw new Error('elevation lookup failed');
  return (await r.json()).elevation.map(Number);
}

onmessage = async ({data: q}) => {
  try {
    const eng = new TC.Engine(q.l1, q.l2);
    const home = TC.site(q.lat, q.lon, q.elevKm);
    const jd0 = TC.jdOfMs(Date.now()), jd1 = jd0 + q.days;
    const keep = e => (!q.night || e.sunAlt < -6) && e.illum * 100 >= q.minIllum;
    let events = [];
    for (const radius of RADII_KM) {
      events = eng.findEvents(home, jd0, jd1, radius, MIN_ALT,
        p => postMessage({type: 'progress', stage: `Searching for transit paths within ${radius} km`, p})).filter(keep);
      if (events.length >= q.count) break;
    }
    events.sort((a, b) => a.near.dist - b.near.dist);
    events = events.slice(0, q.count);

    // re-solve each path for the real ground height where you would stand
    postMessage({type: 'progress', stage: 'Adjusting for terrain height at each spot', p: 0});
    try {
      for (let pass = 0; pass < 2; pass++) {
        const hs = await elevations(events.map(e => [e.near.lat, e.near.lon]));
        events = events.map((e, i) => {
          const h = hs[i] / 1000;
          if (!isFinite(h)) return e;
          if (Math.abs(h - e.pathElevKm) <= 0.03) { e.pathElevKm = h; return e; }
          return eng.analyze(home, e.jdc, h, Math.max(RADII_KM[RADII_KM.length - 1], e.near.dist + 50), MIN_ALT) || e;
        });
      }
    } catch (err) { /* keep the home elevation if the lookup fails */ }

    events.sort((a, b) => a.cl.jd - b.cl.jd);
    postMessage({type: 'done', events: events.map(e => ({
      ms: TC.msOfJd(e.cl.jd), lat: e.near.lat, lon: e.near.lon, elevKm: e.pathElevKm,
      dist: e.near.dist, bearing: e.near.bearing, trackDir: e.near.trackDir, halfWidth: e.halfWidth,
      az: e.cl.az, alt: e.cl.alt, dur: e.cl.dur, illum: e.illum, phaseDeg: e.phaseDeg, sunAlt: e.sunAlt,
      track: e.track}))});
  } catch (err) {
    postMessage({type: 'error', message: err.message || String(err)});
  }
};
