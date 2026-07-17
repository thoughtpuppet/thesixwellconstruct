document.querySelectorAll('.constellation').forEach((field) => {
  const nodes = [...field.querySelectorAll('.orbit-node')];
  const lines = [...field.querySelectorAll('line, path')];
  const note = field.querySelector('.constellation-note');
  nodes.forEach((node, index) => node.addEventListener('click', () => {
    const willOpen = node.getAttribute('aria-pressed') !== 'true';
    nodes.forEach((item) => item.setAttribute('aria-pressed', 'false'));
    lines.forEach((line) => line.classList.remove('is-lit'));
    if (willOpen) {
      node.setAttribute('aria-pressed', 'true');
      if (lines[index]) lines[index].classList.add('is-lit');
      if (note) note.textContent = `${node.textContent.trim()} · selected route`;
    } else if (note) {
      note.textContent = note.dataset.idle || note.textContent;
    }
  }));
  if (note) note.dataset.idle = note.textContent;
});
