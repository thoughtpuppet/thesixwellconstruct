export function createHomepageReveal() {
  const entryRoot = document.getElementById('entry-root');
  const homeReveal = document.getElementById('home-reveal');

  function reveal() {
    homeReveal.classList.add('is-visible');
    window.setTimeout(() => {
      entryRoot.classList.add('is-hidden');
    }, 720);
  }

  return { reveal };
}
