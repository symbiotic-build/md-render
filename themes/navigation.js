const button = document.querySelector('#menu-button');
const menu = document.querySelector('#document-menu');
const close = document.querySelector('#menu-close');
const contents = document.querySelector('.contents');
const phone = matchMedia('(max-width: 720px)');
const background = [...document.querySelectorAll('main, .contents, .menu-bar, .skip-link')];
let expanded = true;
let openedByReader = false;
let mobileOpen = false;
try {
  const saved = localStorage.getItem('md-render-menu-expanded');
  if (saved !== null) expanded = saved === 'true';
} catch (error) { console.warn('Menu preference could not be read; using the default.', error); }

function fitNavigation() {
  const available = Math.max(1, innerHeight - 72);
  // A tall first-visit menu participates in document scrolling. Only an explicit
  // open action opts into a viewport-limited sidebar with its own scrolling.
  menu.classList.toggle('fits-viewport', menu.scrollHeight <= available);
  if (!contents) return;
  contents.classList.remove('sections-only');
  const list = contents.querySelector('details > ol');
  list.style.zoom = '';
  if (phone.matches) return;
  if (contents.scrollHeight > available) contents.classList.add('sections-only');
  if (contents.scrollHeight > available) {
    const listHeight = list.getBoundingClientRect().height;
    const surroundingHeight = contents.getBoundingClientRect().height - listHeight;
    list.style.zoom = Math.max(1, available - surroundingHeight) / listHeight;
  }
}

function updateMenu() {
  const open = phone.matches ? mobileOpen : expanded;
  menu.hidden = !open;
  document.body.classList.toggle('menu-hidden', !open);
  document.body.classList.toggle('menu-modal', phone.matches && open);
  menu.classList.toggle('reader-opened', openedByReader && !phone.matches);
  button.setAttribute('aria-expanded', String(open));
  if (phone.matches && open) {
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-modal', 'true');
  } else {
    menu.removeAttribute('role');
    menu.removeAttribute('aria-modal');
  }
  for (const element of background) element.inert = phone.matches && open;
  if (contents) {
    contents.querySelector('details').open = !phone.matches;
    contents.querySelector('summary').tabIndex = phone.matches ? 0 : -1;
  }
  fitNavigation();
}
function closeMenu() {
  mobileOpen = false;
  updateMenu();
  button.focus({ preventScroll: true });
}
button.addEventListener('click', () => {
  if (phone.matches) {
    mobileOpen = true;
    updateMenu();
    close.focus();
  } else {
    expanded = !expanded;
    openedByReader = expanded;
    try { localStorage.setItem('md-render-menu-expanded', String(expanded)); }
    catch (error) { console.warn('Menu preference could not be saved; using it for this page.', error); }
    updateMenu();
  }
});
close.addEventListener('click', closeMenu);
menu.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!phone.matches || !link) return;
  closeMenu();
  if (link.getAttribute('href').startsWith('#')) {
    // Native fragment navigation moves focus after the click handler. Perform
    // the jump first, then restore the close action's focus without scrolling.
    event.preventDefault();
    location.hash = link.hash;
    button.focus({ preventScroll: true });
  }
});
document.addEventListener('keydown', (event) => {
  if (!phone.matches || !mobileOpen) return;
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
  if (event.key === 'Tab') {
    const links = [...menu.querySelectorAll('button, a[href]')];
    const first = links[0];
    const last = links.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
phone.addEventListener('change', () => {
  const wasOpen = mobileOpen;
  mobileOpen = false;
  updateMenu();
  if (wasOpen || menu.contains(document.activeElement) && menu.hidden) button.focus();
});
contents?.querySelector('summary').addEventListener('click', (event) => {
  if (!phone.matches) event.preventDefault();
});
addEventListener('resize', fitNavigation);
new ResizeObserver(fitNavigation).observe(menu.querySelector('nav'));
updateMenu();
document.fonts.ready.then(fitNavigation);
