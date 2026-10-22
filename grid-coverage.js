/* Coverage of a rectilinear point grid; no interpolation or extrapolation.
 * An interior query needs four valid corners. On an exact grid line it needs
 * both endpoints, and at a grid node it needs only that node. Keep missing
 * nodes in the index: filtering them out would bridge coastal/data gaps.
 */
(function (root) {
    'use strict';

    function createGridCoverage(data) {
        const nodes = new Map();
        const longitudes = new Set();
        const latitudes = new Set();
        for (const feature of data.features) {
            const [lng, lat] = feature.geometry.coordinates;
            longitudes.add(lng);
            latitudes.add(lat);
            nodes.set(`${lng},${lat}`, feature);
        }
        const xs = [...longitudes].sort((a, b) => a - b);
        const ys = [...latitudes].sort((a, b) => a - b);

        function bracket(axis, value) {
            if (!Number.isFinite(value) || !axis.length ||
                value < axis[0] || value > axis[axis.length - 1]) return null;
            let lo = 0;
            let hi = axis.length - 1;
            while (lo < hi) {
                const mid = Math.floor((lo + hi) / 2);
                if (axis[mid] < value) lo = mid + 1;
                else hi = mid;
            }
            // Exact comparisons avoid extending the mask past its boundary.
            return axis[lo] === value ? [axis[lo]] : [axis[lo - 1], axis[lo]];
        }

        return {
            contains(lng, lat) {
                const xb = bracket(xs, lng);
                const yb = bracket(ys, lat);
                if (!xb || !yb) return false;
                return xb.every(x => yb.every(y => {
                    const feature = nodes.get(`${x},${y}`);
                    const vs30 = feature?.properties?.Vs30;
                    return Number.isFinite(vs30) && vs30 !== -999 && vs30 > 0;
                }));
            }
        };
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = createGridCoverage;
    else root.createGridCoverage = createGridCoverage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
