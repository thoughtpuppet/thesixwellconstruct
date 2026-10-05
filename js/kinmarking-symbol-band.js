(function () {
  const root = document.querySelector('[data-kinmarking-symbol-band]');
  const legend = window.SixWellLegend;
  if (!root || !legend) return;
  const track = root.querySelector('[data-symbol-track]');
  const pause = root.querySelector('[data-symbol-pause]');
  // Match SHAPE_LOCK_ORDER and CircleGeometry orientations in the entry puzzle.
  const shapes = [
    { name: 'Circle', sides: 0, angle: 0 },
    { name: 'Triangle', sides: 3, angle: Math.PI / 2 },
    { name: 'Square', sides: 4, angle: Math.PI / 4 },
    { name: 'Pentagon', sides: 5, angle: Math.PI / 2 },
    { name: 'Hexagon', sides: 6, angle: Math.PI / 2 },
  ];
  function shapeMarkup(shape) {
    const points = Array.from({ length: shape.sides }, (_, index) => {
      const angle = shape.angle + index * Math.PI * 2 / shape.sides;
      return `${(60 + 42 * Math.cos(angle)).toFixed(3)},${(60 - 42 * Math.sin(angle)).toFixed(3)}`;
    }).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round">${shape.sides ? `<polygon points="${points}" vector-effect="non-scaling-stroke"/>` : '<circle cx="60" cy="60" r="42" vector-effect="non-scaling-stroke"/>'}</g></svg>`;
  }
  // Inline SVG references remain local even when the sequence is repeated.
  function scopeSvgIds(svg, prefix) {
    if (!svg) return;
    const ids = new Map();
    [svg, ...svg.querySelectorAll('[id]')].forEach(element => {
      if (!element.id) return;
      const id = element.id;
      const scoped = `${prefix}-${id}`;
      ids.set(id, scoped);
      element.id = scoped;
    });
    [svg, ...svg.querySelectorAll('*')].forEach(element => {
      [...element.attributes].forEach(attribute => {
        let value = attribute.value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (match, quote, id) => ids.has(id) ? `url(#${ids.get(id)})` : match);
        if (['href', 'xlink:href'].includes(attribute.name) && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
        if (value !== attribute.value) element.setAttribute(attribute.name, value);
      });
    });
  }
  function measure() {
    root.style.setProperty('--symbol-band-width', `${root.clientWidth}px`);
    const group = track.firstElementChild;
    if (group) root.style.setProperty('--symbol-band-duration', `${Math.max(24, group.getBoundingClientRect().width / 20)}s`);
  }
  function centerSvgVertically(svg) {
    // Center the visible artwork, including marks with uneven canvas padding.
    const viewBox = svg.viewBox.baseVal;
    const bounds = svg.getBBox();
    if (!viewBox.height || !bounds.height) return;
    const offset = viewBox.y + viewBox.height / 2 - bounds.y - bounds.height / 2;
    if (Math.abs(offset) < 0.01) return;
    const artwork = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    artwork.setAttribute('data-band-alignment', '');
    artwork.setAttribute('transform', `translate(0 ${offset})`);
    [...svg.children].forEach(child => {
      if (!['defs', 'style', 'title', 'desc', 'metadata'].includes(child.localName)) artwork.append(child);
    });
    svg.append(artwork);
  }
  function render(records) {
    const shapeRecords = new Map(shapes.map(shape => {
      const slug = shape.name.toLowerCase();
      return [slug, records.find(record => record.id === `legend-entry-${slug}`)];
    }));
    const symbols = records.filter(record => ![...shapeRecords.values()].includes(record)).flatMap(record => {
      const svg = legend.safeSvg(record.svg_markup);
      return svg ? [{ name: record.name, svg, href: legend.canonicalRoute(record) }] : [];
    });
    const items = [];
    const shapeItems = shapes.map(shape => {
      const record = shapeRecords.get(shape.name.toLowerCase());
      const svg = record && legend.safeSvg(record.svg_markup);
      return {
        name: `Entry puzzle ${shape.name.toLowerCase()}`,
        svg: svg || shapeMarkup(shape),
        href: svg ? legend.canonicalRoute(record) : undefined,
        shape: true,
      };
    });
    for (let index = 0; index < Math.max(symbols.length, shapeItems.length); index++) {
      if (symbols[index]) items.push(symbols[index]);
      if (shapeItems[index]) items.push(shapeItems[index]);
    }
    const group = document.createElement('div');
    group.className = 'kinmarking-symbol-group';
    items.forEach((item, index) => {
      const mark = document.createElement(item.href ? 'a' : 'span');
      mark.className = `kinmarking-symbol-mark${item.shape ? ' kinmarking-symbol-mark--shape' : ''}`;
      mark.setAttribute('aria-label', item.name);
      mark.title = item.name;
      // Offset the fades; the cloned sequence retains the same color phase.
      mark.style.setProperty('--symbol-color-delay', `${-(index % 10) * 2}s`);
      if (item.href) mark.href = item.href;
      else mark.setAttribute('role', 'img');
      mark.innerHTML = item.svg;
      scopeSvgIds(mark.querySelector('svg'), `kinmarking-mark-${index}`);
      group.append(mark);
    });
    track.replaceChildren(group);
    root.hidden = false;
    group.querySelectorAll('svg').forEach(centerSvgVertically);
    const repeat = group.cloneNode(true);
    repeat.setAttribute('aria-hidden', 'true');
    repeat.setAttribute('inert', '');
    repeat.querySelectorAll('a').forEach(link => link.tabIndex = -1);
    repeat.querySelectorAll('svg').forEach((svg, index) => scopeSvgIds(svg, `kinmarking-repeat-${index}`));
    track.replaceChildren(group, repeat);
    measure();
  }
  pause.addEventListener('click', () => {
    const paused = root.dataset.paused !== 'true';
    root.dataset.paused = String(paused);
    pause.setAttribute('aria-pressed', String(paused));
    pause.setAttribute('aria-label', paused ? 'Resume symbol band' : 'Pause symbol band');
    pause.querySelector('svg').innerHTML = paused ? '<path d="M6 4l14 8-14 8z" fill="currentColor"/>' : '<path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" stroke-width="5"/>';
  });
  render([]);
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(root);
  else window.addEventListener('resize', measure);
  fetch('/api/legend', { headers: { accept: 'application/json' } })
    .then(response => { if (!response.ok) throw new Error('Legend unavailable'); return response.json(); })
    .then(payload => render(payload.records || []))
    .catch(() => { root.dataset.legendUnavailable = 'true'; });
})();
