// Renders every tree layout as SVG into docs/layouts/ (plus the gallery table).
// Run from anywhere: node core/tools/render-layouts.js
const fs = require('node:fs');
const path = require('node:path');
const {tree} = require('../index.js');

const out = path.join(__dirname, '..', '..', 'docs', 'layouts');
const AREA = {x: 0, y: 0, width: 2560, height: 1440};
const GAPS = {inner: 16, outer: 16};
const COUNTS = [1, 2, 3, 4, 5, 7];
const COLOURS = ['#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#bb9af7', '#7dcfff', '#ff9e64'];

function svg(name, n) {
  const ids = Array.from({length: n}, (_, i) => String(i + 1));
  const rects = tree.layout(tree.generate(name, ids), AREA, GAPS);
  const body = ids.map((id, i) => {
    const r = rects[id];
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    return `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="12" ` +
      `fill="${COLOURS[i % COLOURS.length]}" fill-opacity="${name === 'monocle' ? 0.25 : 0.85}" stroke="#1a1b26" stroke-width="4"/>` +
      `<text x="${cx}" y="${cy}" font-family="sans-serif" font-size="220" text-anchor="middle" ` +
      `dominant-baseline="central" fill="#1a1b26">${id}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AREA.width} ${AREA.height}" ` +
    `width="320" height="180"><rect width="100%" height="100%" fill="#24283b"/>${body}</svg>\n`;
}

fs.mkdirSync(out, {recursive: true});
let table = '| layout | ' + COUNTS.join(' | ') + ' |\n|---|' + COUNTS.map(() => '---|').join('') + '\n';
for (const name of tree.LAYOUTS) {
  for (const n of COUNTS)
    fs.writeFileSync(path.join(out, `${name}-${n}.svg`), svg(name, n));
  table += `| \`${name}\` | ` + COUNTS.map(n => `![${name} ${n}](${name}-${n}.svg)`).join(' | ') + ' |\n';
}
fs.writeFileSync(path.join(out, 'README.md'),
`# Layouts

Each picture shows a 2560x1440 work area with 16 px gaps; the numbers are the window
order (1 is the first window of the context; monocle stacks all windows, so only the
last drawn shows through). \`stage\` is not a tree layout and is not drawn.

${table}
Regenerate with \`node core/tools/render-layouts.js\` (no dependencies).
`);
console.log('wrote', COUNTS.length * tree.LAYOUTS.length, 'svgs');
