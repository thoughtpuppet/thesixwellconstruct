(() => {
  document.querySelectorAll('[data-gallery-carousel]').forEach(gallery => {
    const track = gallery.querySelector('.sny-flyers');
    const slides = [...track.children];
    const previous = gallery.querySelector('[data-gallery-previous]');
    const next = gallery.querySelector('[data-gallery-next]');
    const position = gallery.querySelector('[data-gallery-position]');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let index = 0;
    let scrollTimer;

    const offset = slide => slide.offsetLeft - slides[0].offsetLeft;
    const update = selected => {
      index = selected;
      previous.disabled = index === 0;
      next.disabled = index === slides.length - 1;
      position.textContent = `${index + 1} / ${slides.length}`;
    };
    const goTo = selected => {
      update(Math.max(0, Math.min(slides.length - 1, selected)));
      track.scrollTo({left: offset(slides[index]), behavior: reducedMotion.matches ? 'instant' : 'smooth'});
    };
    const syncPosition = () => {
      const nearest = slides.reduce((closest, slide, candidate) =>
        Math.abs(offset(slide) - track.scrollLeft) < Math.abs(offset(slides[closest]) - track.scrollLeft) ? candidate : closest, 0);
      update(nearest);
    };

    previous.addEventListener('click', () => goTo(index - 1));
    next.addEventListener('click', () => goTo(index + 1));
    gallery.addEventListener('keydown', event => {
      const selected = {ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: slides.length - 1}[event.key];
      if (selected === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      goTo(selected);
    });
    track.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(syncPosition, 100);
    }, {passive: true});
    track.addEventListener('focusin', event => {
      const selected = slides.indexOf(event.target.closest('li'));
      if (selected !== -1) goTo(selected);
    });
    new ResizeObserver(() => {
      track.scrollTo({left: offset(slides[index]), behavior: 'instant'});
    }).observe(track);

    gallery.querySelector('[data-gallery-controls]').hidden = false;
    update(0);
  });
})();
