// Browser interface for render-time extensions (version 1); see the reference chapter.
// md-render appends this file to navigation.js only in single pages rendered with extensions,
// so it uses that script's single-page routing: singlePages and selectSinglePage.
{
const sectionFor = path => singlePages.find(section => section.dataset.sourcePath === path) || null;
const shownSection = () => singlePages.find(section => !section.hasAttribute('hidden')) || null;
const navigateListeners = [];
let notifiedPath;
const notifyNavigate = () => {
  const shown = shownSection()?.dataset.sourcePath ?? null;
  if (shown === notifiedPath) return;
  notifiedPath = shown;
  for (const listener of navigateListeners) {
    try { listener(shown); } catch (error) { console.error('An md-render navigation listener failed.', error); }
  }
};
// navigation.js selects the chapter in its own listeners, which run first.
addEventListener('hashchange', notifyNavigate);
for (const section of singlePages) section.addEventListener('beforematch', notifyNavigate);
const overlaps = (element, first, last) => {
  const [start, end] = element.dataset.sourceLines.split('-').map(Number);
  return start <= last && end >= first;
};
// A target is a document's path and, optionally, the ID of a block in it; without a block it is the document.
const findTarget = target => {
  const section = sectionFor(target.path);
  if (!section) return null;
  return target.block ? section.querySelector(`[data-block="${CSS.escape(target.block)}"]`) : section.querySelector('article.sd-doc');
};
Object.defineProperty(globalThis, 'mdRender', { enumerable: false, value: Object.freeze({
  version: 1,
  documents: () => singlePages.map(section => ({ path: section.dataset.sourcePath, title: section.dataset.title })),
  currentDocument: () => shownSection()?.dataset.sourcePath ?? null,
  blocks(path, first, last) {
    const section = sectionFor(path);
    return section ? [...section.querySelectorAll('[data-source-lines]')].filter(element => overlaps(element, first, last)) : [];
  },
  block: (path, id) => sectionFor(path)?.querySelector(`[data-block="${CSS.escape(id)}"]`) ?? null,
  async show(target) {
    const element = findTarget(target);
    if (!element) return null;
    // The fragment names the shown chapter, as find-in-page does, so a later link back to the
    // previous chapter changes the hash and navigation.js routes it.
    history.replaceState(history.state, '', '#' + encodeURIComponent(element.closest('.single-page').id));
    selectSinglePage(element, false);
    // A drawn diagram keeps its source in a closed disclosure; open each one around the target.
    for (let node = element.parentElement; node; node = node.parentElement) if (node.localName === 'details') node.open = true;
    notifyNavigate();
    element.scrollIntoView({ block: target.block ? 'center' : 'start' });
    return element;
  },
  onNavigate(listener) { navigateListeners.push(listener); },
  extensionData(name) {
    const data = document.getElementById(`md-render-extension-data-${name}`);
    return data ? JSON.parse(data.textContent) : undefined;
  },
}) });
notifyNavigate();
}
