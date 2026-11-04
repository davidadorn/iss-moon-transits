/* Shared helpers for the search page and the simulator page. */
const ISS_TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle';

function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

async function fetchText(url, ms = 12000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, {signal: ctl.signal}); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }
  finally { clearTimeout(timer); }
}

// Latest ISS orbit: CelesTrak (cached for 2 h), falling back to the copy in this site
async function getTLE() {
  const c = lsGet('iss-tle');
  if (c && Date.now() - c.at < 2 * 3600e3) return c;
  for (const [url, source] of [[ISS_TLE_URL, 'CelesTrak'], ['data/iss.tle', 'site copy']]) {
    try {
      const [l1, l2] = TC.parseTLE(await fetchText(url));
      const v = {l1, l2, at: Date.now(), source};
      if (source === 'CelesTrak') lsSet('iss-tle', v);
      return v;
    } catch (e) { /* try the next source */ }
  }
  if (c) return c;
  throw new Error('Could not download the ISS orbit data. Check your internet connection.');
}

function tleAgeDays(l1, l2) {
  const e = new TC.Engine(l1, l2);
  return (TC.jdOfMs(Date.now()) - e.epochJd);
}
