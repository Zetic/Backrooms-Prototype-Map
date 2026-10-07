/* Presentation of the elevation JSON only. No generation/debug state needed. */
(function (root) {
  'use strict';
  const BR = root.BR, E = BR.ELEV;
  const zLabel = (z) => (z > 0 ? '+' : '') + z + ' m';
  const bigRect = (rs) => rs.reduce((a, b) => (b[2] - b[0]) * (b[3] - b[1]) > (a[2] - a[0]) * (a[3] - a[1]) ? b : a);

  function draw(g, b, o) {
    o = o || {};
    const level = o.level === undefined ? b.rooms.find((r) => r.floorZ === b.bands[0].elevation).level : o.level;
    const floor = o.floorZ === undefined ? b.levels.find((l) => l.index === level).elevation : o.floorZ;
    const S = o.scale || 20, X = (x) => (o.ox || 0) + x * S, Y = (y) => (o.oy || 0) + y * S;
    g.save();
    if (o.ghost !== false) for (const l of b.levels) {
      if (l.index === level) continue;
      g.globalAlpha = 0.10;
      BR.TPL.drawBuilding(g, b, { scale: S, ox: o.ox, oy: o.oy, level: l.index, site: false, labels: false, portals: false, layer: o.layer });
    }
    g.globalAlpha = 1;
    BR.TPL.drawBuilding(g, b, { scale: S, ox: o.ox, oy: o.oy, level, site: false, labels: o.labels !== false, portals: true, highlight: o.highlight, layer: o.layer });
    for (const v of b.voids || []) {
      if (floor < v.z0 || floor > v.z1) continue;
      g.fillStyle = 'rgba(170,180,195,0.08)'; g.strokeStyle = '#8a8780'; g.lineWidth = 1;
      g.setLineDash([5, 5]);
      for (const r of v.rects) { if (o.layer !== 'walls') g.fillRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * S, (r[3] - r[1]) * S); g.strokeRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * S, (r[3] - r[1]) * S); }
      g.setLineDash([]);
      const r = bigRect(v.rects);
      g.fillStyle = '#a39d92'; g.font = '12px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      if ((r[2] - r[0]) * S > 110) g.fillText('Reserved atrium', X((r[0] + r[2]) / 2), Y((r[1] + r[3]) / 2));
    }
    for (const c of b.connectors) {
      const lo = Math.min(...c.path.map((p) => p[2])), hi = Math.max(...c.path.map((p) => p[2]));
      const active = floor >= lo && floor <= hi;
      if (!active && o.ghost === false) continue;
      g.globalAlpha = active ? 1 : 0.12;
      if (c.kind === 'ramp' && o.layer !== 'walls') {
        g.fillStyle = '#c8b69a';
        for (const r of c.reservation.rects) g.fillRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * S, (r[3] - r[1]) * S);
      }
      g.strokeStyle = c.kind === 'ladder' ? '#e2b45f' : '#715e44'; g.lineWidth = Math.max(1.5, S * 0.07);
      g.beginPath(); c.path.forEach((p, k) => k ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke();
      if (active && S >= 5) {
        const r = bigRect(c.reservation.rects), a = c.path[0], d = c.path[c.path.length - 1];
        g.font = '11px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = c.kind === 'ladder' ? '#e2b45f' : '#473a29';
        const label = (c.kind === 'ladder' ? 'Ladder ' : '') + zLabel(a[2]) + ' → ' + zLabel(d[2]);
        if ((r[2] - r[0]) * S > g.measureText(label).width + 8) g.fillText(label, X((r[0] + r[2]) / 2), Y((r[1] + r[3]) / 2));
        else if (c.kind === 'ladder') { const p = c.landings.find((p) => p[2] === floor) || a; g.fillText('↕', X(p[0]), Y(p[1])); }
      }
    }
    g.globalAlpha = 1;
    for (const h of b.holes) {
      const s = b.surfaces.find((s) => s.id === h.surface);
      if (!s || s.floorZ !== floor) continue;
      g.strokeStyle = '#c39745'; g.lineWidth = 1.5;
      const r = h.rect;
      g.strokeRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * S, (r[3] - r[1]) * S);
    }
    if (o.territories) {
      g.strokeStyle = '#979b9e'; g.lineWidth = 1; g.setLineDash([3, 5]);
      const band = b.bands.find((band) => band.elevation === floor);
      const territory = band && b.bandTerritories.find((t) => t.band === band.id);
      if (territory) for (const r of territory.rects) g.strokeRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * S, (r[3] - r[1]) * S);
      g.setLineDash([]);
    }
    g.restore();
  }

  function profilePoints(b) {
    let distance = 0;
    return b.route.map((p, i) => {
      if (i) { const q = b.route[i - 1]; distance += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
      return { distance, z: p[2] };
    });
  }
  function drawProfile(g, b, width, height, selectedZ) {
    g.clearRect(0, 0, width, height);
    const ps = profilePoints(b);
    if (!ps.length) { g.fillStyle = '#a39d92'; g.font = '12px system-ui'; g.fillText('Select a vertical connection to inspect its route.', 12, 28); return; }
    const zs = b.surfaces.map((s) => s.floorZ).concat(b.bands.map((r) => r.elevation));
    const lo = Math.min(...zs) - 0.8, hi = Math.max(...zs) + 0.8, length = ps[ps.length - 1].distance || 1;
    const left = 64, right = width - 16, top = 20, bottom = height - 32;
    const X = (d) => left + d / length * (right - left), Y = (z) => bottom - (z - lo) / (hi - lo) * (bottom - top);
    g.save(); g.font = '12px system-ui'; g.textBaseline = 'middle';
    for (const band of b.bands) {
      g.strokeStyle = '#5b5750'; g.lineWidth = 1; g.beginPath(); g.moveTo(left, Y(band.elevation)); g.lineTo(right, Y(band.elevation)); g.stroke();
      g.fillStyle = '#a39d92'; g.textAlign = 'right'; g.fillText(zLabel(band.elevation), left - 10, Y(band.elevation));
    }
    g.strokeStyle = '#e5cc9b'; g.lineWidth = 3; g.beginPath(); ps.forEach((p, k) => k ? g.lineTo(X(p.distance), Y(p.z)) : g.moveTo(X(p.distance), Y(p.z))); g.stroke();
    g.fillStyle = '#e5cc9b';
    for (const p of ps) if (p.z === selectedZ) { g.beginPath(); g.arc(X(p.distance), Y(p.z), 4, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#a39d92'; g.textAlign = 'left'; g.fillText('Entry', left, height - 13);
    g.textAlign = 'right'; g.fillText('Arrival · ' + Math.round(length) + ' m along route', right, height - 13);
    g.restore();
  }
  Object.assign(E, { draw, drawProfile, profilePoints, zLabel });
})(typeof window !== 'undefined' ? window : globalThis);
