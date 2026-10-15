const button = document.querySelector('#menu-button');
const menu = document.querySelector('#document-menu');
const close = document.querySelector('#menu-close');
const compact = matchMedia('(max-width: 1023px)');
const background = [...document.querySelectorAll('main, .menu-bar, .skip-link')];
let expanded = true;
let openedByReader = false;
let mobileOpen = false;
try {
  const saved = localStorage.getItem('md-render-menu-expanded');
  if (saved !== null) expanded = saved === 'true';
} catch (error) { console.warn('Menu preference could not be read; using the default.', error); }

function fitNavigation() {
  if (compact.matches) return;
  // A tall first-visit menu shares document scrolling. An explicit open action
  // opts into a viewport-limited menu; only its chapter list then scrolls.
  menu.classList.toggle('fits-viewport', menu.scrollHeight <= innerHeight - 56);
}
function updateMenu() {
  const open = compact.matches ? mobileOpen : expanded;
  menu.hidden = !open;
  document.body.classList.toggle('menu-hidden', !open);
  document.body.classList.toggle('menu-modal', compact.matches && open);
  menu.classList.toggle('reader-opened', openedByReader && !compact.matches);
  button.setAttribute('aria-expanded', String(open));
  if (compact.matches && open) {
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-modal', 'true');
  } else {
    menu.removeAttribute('role');
    menu.removeAttribute('aria-modal');
  }
  for (const element of background) element.inert = compact.matches && open;
  fitNavigation();
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
    openedByReader = expanded;
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
    fitNavigation();
  }
  const link = event.target.closest('a');
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
addEventListener('resize', fitNavigation);
new ResizeObserver(fitNavigation).observe(menu.querySelector('nav'));
updateMenu();
document.fonts.ready.then(fitNavigation);
