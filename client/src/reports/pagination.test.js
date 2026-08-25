import assert from 'node:assert/strict';
import {
  GRID_ROWS,
  isLegacyReport,
  assignLegacyPages,
  groupByPage,
  computeAddPlacement,
} from './pagination.js';

assert.equal(GRID_ROWS, 36);

// isLegacyReport
assert.equal(isLegacyReport({ widgets: [] }), false);
assert.equal(isLegacyReport({ widgets: [{ chartConfig: { layout: { page: 0 } } }] }), false);
assert.equal(isLegacyReport({ widgets: [{ chartConfig: { layout: {} } }] }), true);
assert.equal(isLegacyReport({ widgets: [{ chartConfig: {} }] }), true);

// assignLegacyPages: layout tự do nhiều cột đã có sẵn, vừa 1 trang (<=36) ->
// giữ nguyên y hệt x/y/w/h, chỉ gán page=0.
const fits = assignLegacyPages([
  { key: 'a', layout: { x: 0, y: 0, w: 4, h: 7, minW: 3, minH: 4 } },
  { key: 'b', layout: { x: 4, y: 0, w: 5, h: 12, minW: 3, minH: 4 } },
]);
assert.deepEqual(fits.map((w) => w.layout), [
  { x: 0, y: 0, w: 4, h: 7, minW: 3, minH: 4, page: 0 },
  { x: 4, y: 0, w: 5, h: 12, minW: 3, minH: 4, page: 0 },
]);

// assignLegacyPages: cao vượt 1 trang (3 widget x 20 hàng = 60 > 36) -> mỗi
// widget nguyên vẹn xuống 1 trang riêng, y tịnh tiến về 0 mỗi trang.
const tall = assignLegacyPages([
  { key: 'a', layout: { x: 0, y: 0, w: 12, h: 20, minW: 3, minH: 4 } },
  { key: 'b', layout: { x: 0, y: 20, w: 12, h: 20, minW: 3, minH: 4 } },
  { key: 'c', layout: { x: 0, y: 40, w: 12, h: 20, minW: 3, minH: 4 } },
]);
assert.deepEqual(
  tall.map((w) => [w.key, w.layout.page, w.layout.y]),
  [['a', 0, 0], ['b', 1, 0], ['c', 2, 0]]
);

// assignLegacyPages: widget hoàn toàn chưa có layout -> xếp nối đuôi
// full-width, cao 10 hàng.
const noLayout = assignLegacyPages([{ key: 'w1' }, { key: 'w2' }]);
assert.deepEqual(
  noLayout.map((w) => [w.layout.page, w.layout.x, w.layout.y, w.layout.w, w.layout.h]),
  [[0, 0, 0, 24, 10], [0, 0, 10, 24, 10]]
);

// groupByPage
assert.deepEqual(groupByPage([]), [[]]);
const grouped = groupByPage([
  { key: 'a', layout: { page: 0 } },
  { key: 'b', layout: { page: 0 } },
  { key: 'c', layout: { page: 1 } },
]);
assert.equal(grouped.length, 2);
assert.equal(grouped[0].length, 2);
assert.equal(grouped[1].length, 1);

// computeAddPlacement
assert.deepEqual(computeAddPlacement([[]]), { page: 0, y: Infinity });
assert.deepEqual(
  computeAddPlacement([[{ layout: { y: 20, h: 10 } }]]), // bottom=30, +10=40>36 -> trang mới
  { page: 1, y: 0 }
);
assert.deepEqual(
  computeAddPlacement([[{ layout: { y: 0, h: 10 } }]]), // bottom=10, +10=20<=36 -> vẫn trang cũ
  { page: 0, y: Infinity }
);

console.log('pagination.test.js: all assertions passed');
