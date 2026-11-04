# ISS Moon Transits

Find when the International Space Station crosses in front of the Moon near any address,
where to stand, when and where to look, and watch each crossing in a sky simulator.

Everything runs in the browser; there is no server.

- `index.html` – address search, results table and map of the transit strips
- `sim.html` – night-sky and telescope simulator for the chosen transits (shareable link)
- `core.js` – transit engine: SGP4 ISS orbit + Moon/Sun positions, centerline on the
  ground, strip width, crossing time
- `worker.js` – runs the search in the background

Data sources: ISS orbit from CelesTrak (a daily backup copy is kept in `data/iss.tle` by a
GitHub Action), addresses from OpenStreetMap Nominatim, elevation and time zone from
Open-Meteo, stars from d3-celestial (BSD-3-Clause). Libraries: satellite.js (MIT) and
Astronomy Engine (MIT), vendored in `vendor/`.

Predictions drift as the ISS orbit changes (about 1 km and 0.1 s per day of orbit-data
age, more after a reboost), so check again close to the event.
