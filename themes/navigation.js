const button = document.querySelector('#menu-button');
const menu = document.querySelector('#document-menu');
const close = document.querySelector('#menu-close');
const compact = matchMedia('(max-width: 1023px)');
const background = [...document.querySelectorAll('main, .menu-bar, .skip-link')];
let expanded = true;
let mobileOpen = false;
try {
  const saved = localStorage.getItem('md-render-menu-expanded');
  if (saved !== null) expanded = saved === 'true';
} catch (error) { console.warn('Menu preference could not be read; using the default.', error); }

function updateMenu() {
  const open = compact.matches ? mobileOpen : expanded;
  menu.hidden = !open;
  document.body.classList.toggle('menu-hidden', !open);
  document.body.classList.toggle('menu-modal', compact.matches && open);
  button.setAttribute('aria-expanded', String(open));
  if (compact.matches && open) {
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-modal', 'true');
  } else {
    menu.removeAttribute('role');
    menu.removeAttribute('aria-modal');
  }
  for (const element of background) element.inert = compact.matches && open;
  revealCurrent();
}
function closeMenu() {
  mobileOpen = false;
  updateMenu();
  button.focus({ preventScroll: true });
}
button.addEventListener('click', () => {
  if (compact.matches) {
    mobileOpen = true;
    updateMenu();
    close.focus();
  } else {
    expanded = !expanded;
    try { localStorage.setItem('md-render-menu-expanded', String(expanded)); }
    catch (error) { console.warn('Menu preference could not be saved; using it for this page.', error); }
    updateMenu();
  }
});
close.addEventListener('click', closeMenu);
menu.addEventListener('click', (event) => {
  const toggle = event.target.closest('.chapter-toggle');
  if (toggle) {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    document.getElementById(toggle.getAttribute('aria-controls')).hidden = !open;
    revealCurrent();
  }
  const link = event.target.closest('a');
  if (link?.getAttribute('href').startsWith('#')) requestAnimationFrame(followHash);
  if (!compact.matches || !link) return;
  closeMenu();
  if (link.getAttribute('href').startsWith('#')) {
    event.preventDefault();
    location.hash = link.hash;
    button.focus({ preventScroll: true });
  }
});
document.addEventListener('keydown', (event) => {
  if (!compact.matches || !mobileOpen) return;
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
  if (event.key === 'Tab') {
    const focusable = [...menu.querySelectorAll('button, a[href], input')].filter((element) =>
      element.getClientRects().length && (element.type !== 'radio' || element.checked));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
compact.addEventListener('change', () => {
  const wasOpen = mobileOpen;
  mobileOpen = false;
  updateMenu();
  if (wasOpen || menu.contains(document.activeElement) && menu.hidden) button.focus();
});
for (const radio of menu.querySelectorAll('input[name="theme"]')) {
  radio.checked = radio.value === (document.documentElement.dataset.theme || 'system');
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    if (radio.value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = radio.value;
    try {
      if (radio.value === 'system') localStorage.removeItem('md-render-theme');
      else localStorage.setItem('md-render-theme', radio.value);
    } catch (error) { console.warn('Theme preference could not be saved; using it for this page.', error); }
  });
}
// Source order defines the reading order. The last heading at or above the
// viewport's one-third line is current, including jumps past several sections.
const navigation = menu.querySelector('nav');
const pageLink = navigation.querySelector('a[aria-current="page"]');
const sections = [...navigation.querySelectorAll('a[href^="#"]')].map((link) => {
  const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
  // Explicit anchors can sit in an empty paragraph before the actual heading.
  const next = target?.closest('p')?.nextElementSibling ?? target?.nextElementSibling;
  const heading = next?.matches('h2,h3') && !target.matches('h2,h3') ? next : target;
  return { link, heading };
}).filter((section) => section.heading);
let currentLink = pageLink;
function revealCurrent() {
  if (!currentLink || menu.hidden || !currentLink.getClientRects().length) return;
  const link = currentLink.getBoundingClientRect();
  const area = navigation.getBoundingClientRect();
  // Scroll only the list, never scrollIntoView(), which can also move the page.
  if (link.top < area.top) navigation.scrollTop += Math.floor(link.top - area.top);
  else if (link.bottom > area.bottom) navigation.scrollTop += Math.ceil(link.bottom - area.bottom);
}
function markCurrent(link) {
  for (const section of sections) section.link.removeAttribute('aria-current');
  currentLink = link || pageLink;
  if (link) {
    link.setAttribute('aria-current', 'location');
    const container = link.closest('.document-group > ol > li > div[id]');
    if (container) {
      container.hidden = false;
      container.previousElementSibling.querySelector('.chapter-toggle').setAttribute('aria-expanded', 'true');
    }
    const group = link.closest('details');
    if (group) group.open = true;
  }
  revealCurrent();
}
function trackSection() {
  let active;
  for (const section of sections) {
    if (section.heading.getBoundingClientRect().top <= innerHeight / 3) active = section.link;
  }
  if ((active || pageLink) !== currentLink) markCurrent(active);
}
function followHash() {
  const section = sections.find(({ link }) => link.hash === location.hash);
  if (!section) { trackSection(); return; }
  markCurrent(section.link);
}
let observer;
function observeSections() {
  observer?.disconnect();
  // Pixel margins avoid rootMargin percentages being relative to viewport width.
  observer = new IntersectionObserver(trackSection, {
    rootMargin: `0px 0px -${innerHeight * 2 / 3}px 0px`,
  });
  for (const section of sections) observer.observe(section.heading);
  trackSection();
  revealCurrent();
}
let scrollFrame;
addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { scrollFrame = undefined; trackSection(); });
}, { passive: true });
addEventListener('hashchange', followHash);
addEventListener('resize', observeSections);
document.documentElement.classList.add('has-js');
updateMenu();
observeSections();
followHash();
document.fonts.ready.then(() => { trackSection(); revealCurrent(); });
