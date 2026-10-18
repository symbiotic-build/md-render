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
    const focusable = [...menu.querySelectorAll('button, a[href]')].filter((element) =>
      element.getClientRects().length);
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
const appearanceButtons = menu.querySelectorAll('.theme-switch button');
function updateAppearance() {
  const selected = document.documentElement.dataset.theme || 'system';
  for (const control of appearanceButtons) control.setAttribute('aria-pressed', String(control.value === selected));
}
updateAppearance();
for (const control of appearanceButtons) {
  control.addEventListener('click', () => {
    if (control.value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = control.value;
    updateAppearance();
    try {
      if (control.value === 'system') localStorage.removeItem('md-render-theme');
      else localStorage.setItem('md-render-theme', control.value);
    } catch (error) { console.warn('Theme preference could not be saved; using it for this page.', error); }
  });
}
// Source order defines the reading order. The last heading at or above the
// viewport's one-third line is current, including jumps past several sections.
const navigation = menu.querySelector('nav');
const singlePages = [...document.querySelectorAll('.single-page')];
function selectSinglePage(target, scroll = true) {
  const selected = target?.closest('.single-page') || singlePages[0];
  if (!selected) return;
  for (const section of singlePages) {
    if (section === selected) section.removeAttribute('hidden');
    else section.setAttribute('hidden', 'until-found');
  }
  document.title = selected.dataset.title;
  for (const link of navigation.querySelectorAll('.chapter-row a')) {
    if (decodeURIComponent(link.hash.slice(1)) === selected.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  for (const link of navigation.querySelectorAll('a[aria-current="location"]')) link.removeAttribute('aria-current');
  bindSections();
  expandChapter(pageLink);
  if (scroll) {
    const heading = selected.querySelector('h1,h2,h3,h4,h5,h6') || selected;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
    (target || selected).scrollIntoView();
  }
}
function routeSinglePage() {
  if (!singlePages.length) return;
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target && !target.closest('.single-page')) return;
  selectSinglePage(target);
  observeSections();
}
for (const section of singlePages) section.addEventListener('beforematch', event => {
  selectSinglePage(event.target, false);
  // Preserve an incoming fragment; find-in-page has no incoming hash to retain.
  requestAnimationFrame(() => {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target?.closest('.single-page') !== section) history.replaceState(null, '', '#' + encodeURIComponent(section.id));
  });
  observeSections();
});
addEventListener('hashchange', routeSinglePage);

let pageLink;
let sections;
function bindSections() {
  pageLink = navigation.querySelector('a[aria-current="page"]');
  sections = [...navigation.querySelectorAll('a[href^="#"]')].filter(link => !singlePages.length || decodeURIComponent(link.hash.slice(1)).startsWith(decodeURIComponent(pageLink.hash.slice(1)) + '--')).map((link) => {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    // Explicit anchors can sit in an empty paragraph before the actual heading.
    const next = target?.closest('p')?.nextElementSibling ?? target?.nextElementSibling;
    const heading = next?.matches('h2,h3') && !target.matches('h2,h3') ? next : target;
    return { link, heading };
  }).filter((section) => section.heading);
  currentLink = pageLink;
}
let currentLink;
if (singlePages.length) selectSinglePage(document.getElementById(decodeURIComponent(location.hash.slice(1))), false);
else bindSections();
function revealCurrent() {
  if (!currentLink || menu.hidden || !currentLink.getClientRects().length) return;
  const link = currentLink.getBoundingClientRect();
  const area = navigation.getBoundingClientRect();
  // Scroll only the list, never scrollIntoView(), which can also move the page.
  if (link.top < area.top) navigation.scrollTop += Math.floor(link.top - area.top);
  else if (link.bottom > area.bottom) navigation.scrollTop += Math.ceil(link.bottom - area.bottom);
}
function expandChapter(link) {
  const chapter = link?.closest('.document-group > ol > li');
  const toggle = chapter?.querySelector('.chapter-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'true');
    document.getElementById(toggle.getAttribute('aria-controls')).hidden = false;
  }
  const group = link?.closest('details');
  if (group) group.open = true;
}
function markCurrent(link) {
  for (const section of sections) section.link.removeAttribute('aria-current');
  currentLink = link || pageLink;
  if (link) {
    link.setAttribute('aria-current', 'location');
    expandChapter(link);
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


if (!singlePages.length) {
// Rendered output is immutable during a viewer session. The cache is transient;
// insertion order evicts the oldest request, including unfinished prefetches.
// Resolve shell assets before pushState changes the base for relative URLs.
for (const element of document.querySelectorAll('head link[href], .site-title img[src]')) {
  if (element.hasAttribute('href')) element.setAttribute('href', element.href);
  else element.setAttribute('src', element.src);
}
const policy = JSON.parse(document.querySelector('meta[name="md-render-navigation"]').content);
const pageKey = (value) => { const url = new URL(value, location.href); url.hash = ''; return url.href; };
const renderedPaths = new Set([...navigation.querySelectorAll('.chapter-row a')].map(link => new URL(link.href).pathname));
const pageCache = new Map();
let displayedPage = pageKey(location.href);
let navigationSequence = 0;
// Keep coordinates per history entry in memory. Writing replaceState on every
// scroll would consume the browser's history API rate limit during reading.
const positions = new Map();
const newEntryKey = () => [...crypto.getRandomValues(new Uint32Array(4))].join('-');
let entryKey = history.state?.mdRender?.key || newEntryKey();
function renderedLink(target) {
  const link = target.closest('a[href]');
  if (!link || link.hasAttribute('target') || link.hasAttribute('download')) return;
  const url = new URL(link.href);
  if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin ||
      !renderedPaths.has(url.pathname) || pageKey(url.href) === displayedPage) return;
  return url;
}
function loadPage(url) {
  const key = pageKey(url);
  if (pageCache.has(key)) return pageCache.get(key).promise;
  const controller = new AbortController();
  const entry = { controller };
  entry.promise = (async () => {
    const response = await fetch(key, { signal: controller.signal });
    if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error(`Unexpected rendered response: ${response.status} ${key}`);
    }
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const meta = parsed.querySelector('meta[name="md-render-navigation"]');
    if (!meta || JSON.parse(meta.content).version !== policy.version ||
        !parsed.querySelector('main#md-render-content article.sd-doc') || !parsed.querySelector('title') ||
        !parsed.querySelector('#document-menu nav[aria-label="Document map"]') ||
        !parsed.querySelector('.site-title')) throw new Error(`Unexpected rendered document: ${key}`);
    return parsed;
  })().catch(error => {
    if (pageCache.get(key) === entry) pageCache.delete(key);
    throw error;
  });
  pageCache.set(key, entry);
  while (pageCache.size > policy.cachePages) {
    const oldest = pageCache.keys().next().value;
    pageCache.get(oldest).controller.abort();
    pageCache.delete(oldest);
  }
  return entry.promise;
}
function prefetch(url) {
  loadPage(url).catch(error => console.warn('Page prefetch failed; a click will load the destination normally if needed.', error));
}
function prefetchAdjacent() {
  for (const link of document.querySelectorAll('.adjacent a')) {
    const url = renderedLink(link);
    if (url) prefetch(url.href);
  }
}
for (const eventName of ['mouseover', 'focusin']) document.addEventListener(eventName, event => {
  const url = renderedLink(event.target);
  if (url) prefetch(url.href);
});
function rememberPosition() {
  positions.set(entryKey, { x: scrollX, y: scrollY });
}
function placeReader(url, position) {
  const main = document.querySelector('main');
  const heading = main.querySelector('h1,h2,h3,h4,h5,h6') || main;
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
  if (position) scrollTo(position.x, position.y);
  else {
    const target = url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (target) target.scrollIntoView();
    else scrollTo(0, 0);
  }
  followHash();
}
// Compare the rendered map, excluding only state owned by the reading session.
// Resolve each map's links against its own page, independent of history's base.
function menuStructure(nav, base) {
  const copy = nav.cloneNode(true);
  for (const link of copy.querySelectorAll('a[href]')) {
    link.setAttribute('href', new URL(link.getAttribute('href'), base).href);
    link.removeAttribute('aria-current');
  }
  for (const toggle of copy.querySelectorAll('.chapter-toggle')) toggle.removeAttribute('aria-expanded');
  for (const container of copy.querySelectorAll('.document-group > ol > li > div[id]')) container.removeAttribute('hidden');
  for (const group of copy.querySelectorAll('details')) group.removeAttribute('open');
  return copy;
}
function updateNavigation(next, url) {
  const same = menuStructure(navigation, displayedPage).isEqualNode(menuStructure(next, url));
  if (same) {
    const links = [...navigation.querySelectorAll('a')];
    for (const [index, incoming] of [...next.querySelectorAll('a')].entries()) {
      const link = links[index];
      const href = incoming.getAttribute('href');
      if (link.getAttribute('href') !== href) link.setAttribute('href', href);
      const current = incoming.getAttribute('aria-current');
      if (current !== link.getAttribute('aria-current')) {
        if (current) link.setAttribute('aria-current', current);
        else link.removeAttribute('aria-current');
      }
    }
  } else {
    navigation.replaceChildren(...[...next.childNodes].map(node => node.cloneNode(true)));
    renderedPaths.clear();
    for (const link of navigation.querySelectorAll('.chapter-row a')) renderedPaths.add(new URL(link.getAttribute('href'), url).pathname);
  }
  expandChapter(navigation.querySelector('a[aria-current="page"]'));
  return same;
}
async function changePage(url, position, push, targetEntryKey) {
  const sequence = ++navigationSequence;
  try {
    const parsed = await loadPage(url.href);
    if (sequence !== navigationSequence) return;
    if (push) {
      rememberPosition();
      const nextKey = newEntryKey();
      history.pushState({ mdRender: { key: nextKey } }, '', url.href);
      entryKey = nextKey;
    }
    if (targetEntryKey) entryKey = targetEntryKey;
    const menuPosition = { x: navigation.scrollLeft, y: navigation.scrollTop };
    // Keep the shell and its controls/listeners; replace only page-owned nodes.
    document.querySelector('main').replaceChildren(...[...parsed.querySelector('main').childNodes].map(node => node.cloneNode(true)));
    const sameMenu = updateNavigation(parsed.querySelector('#document-menu nav'), url);
    displayedPage = pageKey(url.href);
    document.title = parsed.title;
    document.querySelector('.site-title').setAttribute('href', new URL(parsed.querySelector('.site-title').getAttribute('href'), url).href);
    bindSections();
    mobileOpen = false;
    updateMenu();
    observeSections();
    placeReader(url, position);
    if (sameMenu) navigation.scrollTo(menuPosition.x, menuPosition.y);
    rememberPosition();
    prefetchAdjacent();
  } catch (error) {
    if (sequence !== navigationSequence) return;
    console.warn('Page navigation failed; loading the destination normally.', error);
    location.assign(url.href);
  }
}
document.addEventListener('click', event => {
  if (event.defaultPrevented) { navigationSequence++; return; }
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = renderedLink(event.target);
  if (!url) { navigationSequence++; rememberPosition(); return; }
  event.preventDefault();
  changePage(url, undefined, true);
});
if (/^https?:$/.test(location.protocol)) {
  history.scrollRestoration = 'manual';
  history.replaceState({ ...history.state, mdRender: { key: entryKey } }, '', location.href);
  rememberPosition();
  addEventListener('popstate', event => {
    rememberPosition();
    const url = new URL(location.href);
    const nextKey = event.state?.mdRender?.key || newEntryKey();
    if (!event.state?.mdRender?.key) history.replaceState({ ...event.state, mdRender: { key: nextKey } }, '', url.href);
    const position = positions.get(nextKey);
    if (pageKey(url.href) === displayedPage) {
      navigationSequence++;
      entryKey = nextKey;
      placeReader(url, position);
      rememberPosition();
    } else changePage(url, position, false, nextKey);
  });
  prefetchAdjacent();
}

}
