const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const createGridCoverage = require('../grid-coverage.js');
const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root,
    'Vs30_Z10_EG_SSHAC_integrate_grid2km.geojson'), 'utf8'));
const coverage = createGridCoverage(data);
const xs = [...new Set(data.features.map(f => f.geometry.coordinates[0]))].sort((a,b) => a-b);
const ys = [...new Set(data.features.map(f => f.geometry.coordinates[1]))].sort((a,b) => a-b);
const nodes = new Map(data.features.map(f => [f.geometry.coordinates.join(','), f]));
const valid = f => Number.isFinite(f?.properties.Vs30) && f.properties.Vs30 > 0;
const turfContext = {};
// Run the same Turf 6 browser bundle used by index.html, without a CDN/network.
vm.runInNewContext(fs.readFileSync(path.join(root, 'node_modules/@turf/turf/turf.min.js'), 'utf8'), turfContext);
const turf = turfContext.turf;

function page(source = data) {
    const displays = Object.fromEntries(['vs30-display', 'z10-display', 'distance-display']
        .map(id => [id, { innerText: '' }]));
    const context = vm.createContext({ turf, createGridCoverage, window: {}, console,
        document: { getElementById: id => displays[id] }, source });
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /<script src="grid-coverage.js"><\/script>/);
    vm.runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1], context);
    vm.runInContext('vs30Data = source; gridCoverage = createGridCoverage(source);', context);
    return { displays, query: (lng, lat) => context.calculateValues(lng, lat) };
}

test('reported four-corner centre: recover coverage, retain nearest raw parameters', () => {
    const coordinate = [120.049020, 23.0603175];
    const point = turf.point(coordinate);
    const nearest = turf.nearestPoint(point, data);
    const km = turf.distance(point, nearest);
    assert.ok(km > 1.41 && km < 1.42);
    assert.equal(coverage.contains(...coordinate), true);
    const p = page();
    p.query(...coordinate);
    assert.equal(p.displays['vs30-display'].innerText, `Vs30: ${Math.round(nearest.properties.Vs30)} m/s`);
    assert.equal(p.displays['z10-display'].innerText, `Z1.0: ${Math.round(nearest.properties.Z10)} m`);
    console.log('Reported centre:', JSON.stringify({ km, nearest: nearest.properties }));
});

test('all 19,570 original nodes retain the valid/missing classification', () => {
    let count = 0;
    for (const f of data.features) {
        assert.equal(coverage.contains(...f.geometry.coordinates), valid(f));
        if (valid(f)) count++;
    }
    assert.equal(data.features.length, 19570);
    assert.equal(count, 9190);
});

test('all cells: valid centres and interior samples covered; mixed/missing centres rejected', () => {
    const counts = { valid: 0, mixed: 0, missing: 0 };
    for (let i = 0; i < xs.length - 1; i++) {
        for (let j = 0; j < ys.length - 1; j++) {
            const corners = [[xs[i],ys[j]], [xs[i+1],ys[j]],
                [xs[i],ys[j+1]], [xs[i+1],ys[j+1]]].map(c => nodes.get(c.join(',')));
            const n = corners.filter(valid).length;
            counts[n === 4 ? 'valid' : n === 0 ? 'missing' : 'mixed']++;
            for (const [u,v] of [[.5,.5], [.01,.01], [.99,.01], [.01,.99], [.99,.99]]) {
                assert.equal(coverage.contains(xs[i] + u*(xs[i+1]-xs[i]),
                    ys[j] + v*(ys[j+1]-ys[j])), n === 4);
            }
        }
    }
    console.log('Real-grid cell counts:', counts);
});

test('valid boundary edge is included; adjacent missing side and outer bounds rejected', () => {
    let edge;
    for (let i = 1; i < xs.length - 1 && !edge; i++) {
        for (let j = 0; j < ys.length - 1 && !edge; j++) {
            const at = (x,y) => valid(nodes.get([xs[x],ys[y]].join(',')));
            if (at(i,j) && at(i,j+1) && at(i-1,j) && at(i-1,j+1) &&
                (!at(i+1,j) || !at(i+1,j+1))) edge = [i,j];
        }
    }
    assert.ok(edge);
    const [i,j] = edge;
    const lat = (ys[j]+ys[j+1])/2;
    assert.equal(coverage.contains(xs[i], lat), true);
    assert.equal(coverage.contains(xs[i]-1e-8, lat), true);
    assert.equal(coverage.contains(xs[i]+1e-8, lat), false);
    const outside = turf.point([xs[i]+1e-8,lat]);
    const outsideNearest = turf.nearestPoint(outside, data);
    assert.ok(valid(outsideNearest));
    assert.ok(turf.distance(outside, outsideNearest) < 1.5);
    const p = page();
    p.query(xs[i],lat);
    assert.match(p.displays['vs30-display'].innerText, /^Vs30:/);
    p.query(xs[i]+1e-8,lat);
    assert.equal(p.displays['vs30-display'].innerText, '所在位置無資料');
    assert.equal(p.displays['z10-display'].innerText, '');
    assert.equal(p.displays['distance-display'].innerText, '');
    console.log('Boundary:', { lng: xs[i], lat });
    for (const point of [[119,23], [123,23], [121,21], [121,26], [NaN,23], [121,Infinity]]) {
        assert.equal(coverage.contains(...point), false);
    }
});

test('missing node, missing corner and coastal mixed cell are never rescued by a nearby valid node', () => {
    const missing = data.features.find(f => f.properties.Vs30 === -999);
    const p = page();
    p.query(...missing.geometry.coordinates);
    assert.equal(p.displays['vs30-display'].innerText, '所在位置無資料');
    const features = [];
    for (let x = 0; x <= 2; x++) for (let y = 0; y <= 2; y++) {
        features.push({ type:'Feature', geometry:{type:'Point',coordinates:[x,y]},
            properties:{ Vs30: x === 1 && y === 1 ? -999 : 300, Z10: 10 } });
    }
    const source = { type:'FeatureCollection', features };
    assert.equal(createGridCoverage(source).contains(.01,.01), false);
    // An absent feature must also remain a gap, rather than being skipped.
    source.features = features.filter(f => f.properties.Vs30 !== -999);
    assert.equal(createGridCoverage(source).contains(.5,.5), false);
});

test('Z10 -999 is not rendered as a physical depth; zero depth remains valid', () => {
    const f = data.features.find(valid);
    for (const z10 of [-999, 0]) {
        const source = { type:'FeatureCollection', features:[{ ...f, properties:{...f.properties, Z10:z10} }] };
        const p = page(source);
        p.query(...f.geometry.coordinates);
        assert.match(p.displays['vs30-display'].innerText, /^Vs30:/);
        assert.equal(p.displays['z10-display'].innerText, z10 === -999 ? 'Z1.0: 無資料' : 'Z1.0: 0 m');
    }
});

test('existing valid 1 km queries keep the same nearest-neighbour values', () => {
    for (const f of data.features.filter(valid).filter((_,i) => i % 1000 === 0)) {
        const [lng,lat] = f.geometry.coordinates;
        const p = page();
        p.query(lng,lat);
        assert.equal(p.displays['vs30-display'].innerText, `Vs30: ${Math.round(f.properties.Vs30)} m/s`);
    }
    let checked = 0;
    for (let i = 0; i < xs.length-1 && checked < 12; i++) {
        for (let j = 0; j < ys.length-1 && checked < 12; j++) {
            const coordinate = [xs[i]+.25*(xs[i+1]-xs[i]), ys[j]+.25*(ys[j+1]-ys[j])];
            if (!coverage.contains(...coordinate)) continue;
            const nearest = turf.nearestPoint(turf.point(coordinate), data);
            assert.ok(turf.distance(turf.point(coordinate),nearest) < 1);
            const p = page();
            p.query(...coordinate);
            assert.equal(p.displays['vs30-display'].innerText, `Vs30: ${Math.round(nearest.properties.Vs30)} m/s`);
            assert.equal(p.displays['z10-display'].innerText, `Z1.0: ${Math.round(nearest.properties.Z10)} m`);
            checked++;
        }
    }
    assert.equal(checked,12);
});
