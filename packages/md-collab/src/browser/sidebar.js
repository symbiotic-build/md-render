// md-collab sidebar: questions for the reader, the decision history and comments on selected text.
// It reads and writes only through the md-collab server and finds text only through mdRender (version 1).
(() => {
const headers = { 'content-type': 'application/json' };
const esc = text => String(text ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const shell = document.createElement('template');
shell.innerHTML = `
<aside class="ov-panel" id="ov-panel" aria-label="Decisions">
  <div class="ov-head">
    <div class="ov-row"><h2 id="ov-heading">Decisions</h2><button class="ov-btn ov-primary" id="ov-next">Next open</button><button class="ov-btn ov-close" id="ov-close" aria-label="Close">✕</button></div>
    <div class="ov-switch" role="group" aria-label="View">
      <button id="ov-v-q" aria-pressed="true">Questions for you<small id="ov-v-qn"></small></button>
      <button id="ov-v-h" aria-pressed="false">History<small id="ov-v-hn"></small></button>
    </div>
    <div id="ov-qhead">
      <div class="ov-prog"><span id="ov-count">0 / 0 answered</span><div class="ov-track"><div class="ov-fill" id="ov-fill"></div></div></div>
      <div class="ov-chips" role="group" aria-label="Filter">
        <button class="ov-chip" data-f="all" aria-pressed="true">All</button>
        <button class="ov-chip" data-f="open" aria-pressed="false">Open</button>
        <button class="ov-chip" data-f="done" aria-pressed="false">Answered</button>
        <button class="ov-chip" data-f="page" aria-pressed="false">This chapter</button>
      </div>
    </div>
    <div id="ov-hhead" hidden>
      <div class="ov-filters">
        <label>Decided by<select id="ov-f-who"><option value="">Anyone</option><option value="operator">You (operator)</option><option value="lead">Lead</option><option value="measurement">Measurement</option><option value="comment">Comments</option></select></label>
        <label>Status<select id="ov-f-status"><option value="">Any status</option><option value="open">Open</option><option value="answered">Answered</option><option value="settled">Settled</option></select></label>
        <label>Topic<select id="ov-f-topic"><option value="">All topics</option></select></label>
        <label>Chapter<select id="ov-f-chapter"><option value="">All chapters</option></select></label>
      </div>
      <div class="ov-hcount"><span id="ov-hshown"></span><button class="ov-reset" id="ov-reset" hidden>Clear filters</button></div>
    </div>
    <div class="ov-status" id="ov-status">Loading decisions…</div>
  </div>
  <div class="ov-list" id="ov-list"></div>
</aside>
<button class="ov-btn ov-primary ov-fab" id="ov-fab">Decisions</button>
<div class="ov-sel" id="ov-sel"><button class="ov-btn ov-primary" id="ov-selbtn">Comment</button></div>
<div class="ov-composer" id="ov-composer" hidden><label class="ov-note-l">Comment on the selected text<textarea class="ov-note" id="ov-comment"></textarea></label><div class="ov-foot"><button class="ov-clear" id="ov-comment-cancel">Cancel</button><button class="ov-btn ov-primary" id="ov-comment-save">Save comment</button></div></div>
<div class="ov-toast" id="ov-toast"></div>`;
// Each label wraps its control instead of naming its ID, so an annotation's anchor with that ID
// cannot take the label away. The sidebar's own elements are found once, before any annotation
// HTML is on the page: an anchor in an annotation may carry the same ID as one of them.
const controls = new Map([...shell.content.querySelectorAll('[id]')].map(element => [element.id, element]));
const $ = selector => controls.get(selector.slice(1)) ?? document.querySelector(selector);
document.body.append(shell.content);
document.body.classList.add('ov-on');
// Cards and history rows are the list's own children; annotation HTML sits deeper inside them.
const listItem = id => [...$('#ov-list').children].find(element => element.id === id);

let state = null, items = [], view = 'q', openQ = null, openH = null, filter = 'all';
const hf = { who: '', status: '', topic: '', chapter: '' };
const toast = message => { const t = $('#ov-toast'); t.textContent = message; t.classList.add('ov-show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('ov-show'), 3200); };
let disconnected = false, loadError = null;
// This owner composes all status causes; a connection or load failure never erases a render failure.
function renderStatus() {
  const messages = [];
  const flagged = state?.threads.flatMap(changed).length ?? 0;
  if (state?.renderError) messages.push(`The documents changed, but rendering them failed: ${state.renderError}. This page shows the last good version.`);
  if (loadError) messages.push(`Could not load decisions (${loadError}). Is md-collab still running?`);
  if (disconnected) messages.push('Live updates from md-collab are disconnected; this page tries to reconnect. If md-collab stopped, restart it and reload.');
  if (!messages.length) messages.push(state ? `Answers are saved to ${state.collection.title} as ${state.person.replace(/^person:/, '')}.${flagged ? ` ${flagged} passages changed since they were annotated.` : ''}` : 'Loading decisions…');
  const element = $('#ov-status');
  element.textContent = messages.join(' ');
  element.classList.toggle('ov-warn', !!(state?.renderError || loadError || disconnected || flagged));
}
const day = at => at ? at.slice(0, 10) : null;
const fmtDay = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not recorded';
const lastAnswer = item => item.entries.filter(entry => entry.kind === 'answer').pop();
const isDone = item => item.status === 'answered' || item.status === 'settled';
const questions = () => items.filter(item => item.kind === 'question' && item.number != null && item.status !== 'withdrawn').sort((a, b) => a.number - b.number);
const byId = id => items.find(item => item.id === id);
const byNumber = n => items.find(item => item.number === n);
const WHO = { operator: 'You', lead: 'Lead', measurement: 'Measure' };

/* ---------- text in the document ---------- */
const elementsOf = anchor => anchor.blocks.map(id => mdRender.block(anchor.path, id)).filter(Boolean);
let permanent = [], transient = [];
function markDocument() {
  // Every mark is drawn again from the current threads, so a passage an anchor left keeps none.
  for (const { element, classes } of permanent) element.classList.remove(...classes);
  document.querySelectorAll('[data-ov-items]').forEach(element => { element.classList.remove('ov-active', 'ov-done'); delete element.dataset.ovItems; delete element.dataset.ovMain; });
  document.querySelectorAll('.ov-tags').forEach(box => box.remove());
  permanent = [];
  for (const item of items) {
    if (item.status === 'withdrawn') continue;
    const question = item.kind === 'question' && item.number != null && item.status !== 'settled';
    if (!question && item.kind !== 'comment') continue;
    for (const anchor of item.anchors) {
      // The main passage is highlighted; the other cited passages get a dotted underline and no fill.
      const classes = anchor.role !== 'main' ? ['ov-hl2'] : item.kind === 'comment' ? ['ov-cm'] : ['ov-hl'];
      const add = (list, id) => [...new Set([...(list || '').split(' ').filter(Boolean), id])].join(' ');
      for (const element of elementsOf(anchor)) {
        element.classList.add(...classes);
        element.dataset.ovItems = add(element.dataset.ovItems, item.id);
        if (anchor.role === 'main') element.dataset.ovMain = add(element.dataset.ovMain, item.id);
        permanent.push({ element, classes });
      }
      if (question && anchor.role === 'main') {
        const first = elementsOf(anchor)[0];
        if (!first) continue;
        const host = first.tagName === 'TR' ? first.firstElementChild : first;
        host.classList.add('ov-anchor');
        permanent.push({ element: host, classes: ['ov-anchor'] });
        let box = host.querySelector(':scope > .ov-tags');
        if (!box) { box = document.createElement('span'); box.className = 'ov-tags'; host.prepend(box); }
        const tag = document.createElement('button');
        tag.className = 'ov-tag' + (isDone(item) ? ' ov-done' : '') + (openQ === item.number ? ' ov-current' : '');
        tag.textContent = 'Q' + item.number; tag.title = item.title;
        tag.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); setView('q'); openQuestion(item.number, false); });
        box.append(tag);
      }
    }
  }
  refreshMarks();
}
function refreshMarks() {
  const active = view === 'q' ? byNumber(openQ)?.id : openH;
  document.querySelectorAll('[data-ov-items]').forEach(element => {
    const ids = element.dataset.ovItems.split(' ');
    // Only the open thread's main passage is filled.
    element.classList.toggle('ov-active', !!active && (element.dataset.ovMain || '').split(' ').includes(active));
    element.classList.toggle('ov-done', element.classList.contains('ov-hl') && ids.every(id => isDone(byId(id) ?? { status: 'open' })));
  });
  const perPage = {};
  for (const q of questions()) { const main = q.anchors.find(a => a.role === 'main'); if (main) (perPage[main.path] ||= []).push(q); }
  for (const link of document.querySelectorAll('.sidebar .chapter-row > a')) {
    const path = document.getElementById(decodeURIComponent(link.hash.slice(1)))?.dataset.sourcePath;
    const list = (path && perPage[path]) || [];
    let badge = link.querySelector('.ov-badge');
    if (!list.length) { badge?.remove(); continue; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'ov-badge'; link.append(badge); }
    const open = list.filter(q => !isDone(q)).length;
    badge.textContent = open ? open + ' Q' : '✓'; badge.classList.toggle('ov-done', !open);
  }
}
function lightItem(item) {
  transient.forEach(element => element.classList.remove('ov-hl-t', 'ov-hl2-t')); transient = [];
  if (!item || (item.kind === 'question' && item.number != null)) return;
  for (const anchor of item.anchors) for (const element of elementsOf(anchor)) {
    element.classList.add(anchor.role === 'main' ? 'ov-hl-t' : 'ov-hl2-t'); transient.push(element);
  }
}
function showAnchor(anchor) {
  if (!anchor) return;
  if (innerWidth < 900) $('#ov-panel').classList.remove('ov-show');
  mdRender.show({ path: anchor.path, block: anchor.blocks[0] }).then(element => { if (!element) toast('This passage is no longer in the document.'); });
}
function wireLinks(root, item) {
  root.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    const cite = /^#md-collab-anchor-(\d+)$/.exec(href);
    if (cite) { event.preventDefault(); showAnchor(item.anchors[Number(cite[1])]); }
  });
}
const isClosed = item => item.status === 'settled' || item.status === 'withdrawn';
// A thread's passage that changed since it was written: "updated" shows the word changes, "removed" the old text.
const changed = item => item.kind !== 'decision' && !isClosed(item) ? item.anchors.filter(anchor => anchor.state !== 'same') : [];
// A thread's cited passages in order, main first; each card remembers which one the reader moved to.
const passages = item => [...item.anchors.filter(anchor => anchor.role === 'main'), ...item.anchors.filter(anchor => anchor.role !== 'main')];
const passageAt = new Map();
function passageNav(item) {
  const list = passages(item);
  const nav = document.createElement('div'); nav.className = 'ov-pnav'; nav.setAttribute('role', 'group'); nav.setAttribute('aria-label', 'Cited passages');
  nav.innerHTML = '<button class="ov-pbtn" aria-label="Previous passage">&lt;</button><span class="ov-pos" aria-live="polite"></span><button class="ov-pbtn" aria-label="Next passage">&gt;</button>';
  const [previous, next] = nav.querySelectorAll('button');
  const draw = () => {
    const at = passageAt.get(item.id) ?? 0;
    nav.querySelector('.ov-pos').textContent = `${at + 1} of ${list.length}`;
    previous.disabled = at === 0; next.disabled = at === list.length - 1;
  };
  const move = step => {
    const at = Math.min(list.length - 1, Math.max(0, (passageAt.get(item.id) ?? 0) + step));
    passageAt.set(item.id, at); draw(); showAnchor(list[at]);
  };
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  draw();
  return nav;
}
function passageLinks(item) {
  const box = document.createElement('div'); box.className = 'ov-links';
  if (item.kind !== 'decision' && item.anchors.length > 1) box.append(passageNav(item));
  for (const anchor of item.anchors) {
    const found = elementsOf(anchor).length > 0;
    const button = document.createElement('button');
    button.className = 'ov-link' + (found ? '' : ' ov-missing');
    button.innerHTML = `<b>${anchor.role === 'main' ? 'Main passage' : 'Also cited'}</b> · `;
    const chapter = mdRender.documents().find(d => d.path === anchor.path)?.title || anchor.path;
    button.append(`${chapter} · ${anchor.label}${anchor.state === 'updated' ? ' (updated)' : anchor.state === 'removed' ? ' (removed)' : ''}`);
    button.addEventListener('click', () => showAnchor(anchor));
    box.append(button);
  }
  if (!item.anchors.length) box.innerHTML = '<span class="ov-none">No single passage; see the context.</span>';
  const flagged = changed(item);
  if (flagged.length) box.append(changeBox(item, flagged));
  return box;
}
// The reader decides what a changed passage means for the thread; each choice is an entry agents read with md-collab list.
function changeBox(item, flagged) {
  const box = document.createElement('div'); box.className = 'ov-change';
  for (const anchor of flagged) {
    const part = document.createElement('div'); part.className = 'ov-was';
    part.innerHTML = anchor.state === 'updated'
      // Runs keep their own spaces; a removed run directly followed by an added one gets a space between them.
      ? '<b>Updated</b> since this was written: ' + anchor.diff.map((run, n) => (run.change === '+' && anchor.diff[n - 1]?.change === '-' ? ' ' : '') + (run.change === '=' ? esc(run.text) : `<${run.change === '-' ? 'del' : 'ins'}>${esc(run.text)}</${run.change === '-' ? 'del' : 'ins'}>`)).join('')
      : anchor.problem ? '<b>Removed</b>. ' + esc(anchor.problem) : '<b>Removed</b>. It read: ' + esc(anchor.text);
    box.append(part);
  }
  const updated = flagged.some(anchor => anchor.state === 'updated');
  const removed = flagged.some(anchor => anchor.state === 'removed');
  if (updated && removed) {
    const scope = document.createElement('p');
    scope.textContent = 'Settling or withdrawing applies to the whole thread.';
    box.append(scope);
  }
  let foot = document.createElement('div'); foot.className = 'ov-foot';
  const action = (label, entry) => { const b = document.createElement('button'); b.className = 'ov-btn'; b.textContent = label; b.addEventListener('click', () => addEntry(item, entry)); foot.append(b); };
  if (updated) {
    foot.setAttribute('role', 'group'); foot.setAttribute('aria-label', 'Updated passage actions');
    action('Mark done', { kind: 'settled', note: 'Done: the passage was updated.' });
    action('Keep open', { kind: 'kept-open', note: '' });
    action('Send to a fix run', { kind: 'fix-requested', note: '' });
  }
  if (removed) {
    if (updated) { box.append(foot); foot = document.createElement('div'); foot.className = 'ov-foot'; }
    foot.setAttribute('role', 'group'); foot.setAttribute('aria-label', 'Removed passage actions');
    action('Close', { kind: 'withdrawn', note: 'Closed: the passage was removed.' });
    const label = document.createElement('label'); label.className = 'ov-note-l';
    label.append('Note for an agent', Object.assign(document.createElement('textarea'), { className: 'ov-note', id: 'ov-agent-' + item.id, value: drafts.get('ov-agent-' + item.id) ?? '' }));
    box.append(label);
    const save = document.createElement('button'); save.className = 'ov-btn'; save.textContent = 'Save note';
    save.addEventListener('click', () => { const note = label.querySelector('textarea').value.trim(); if (note) addEntry(item, { kind: 'comment', note }); });
    foot.append(save);
  }
  box.append(foot);
  return box;
}

/* ---------- writes ---------- */
// Every write names the render the page shows, so the server refuses one that names passages of an older render.
async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, generation: mdRender.extensionData('md-collab')?.generation }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || `Saving failed (${response.status})`), { status: response.status });
  return result;
}
async function addEntry(item, entry) {
  // A draft is cleared only when it still holds what was sent: typing during the save stays.
  const sent = ['ov-note-' + item.number, 'ov-reply-' + item.id, 'ov-agent-' + item.id].map(key => [key, drafts.get(key)]);
  try {
    await post(`/api/threads/${item.id}/entries`, { ...entry, version: item.version });
    for (const [key, value] of sent) if (drafts.get(key) === value) drafts.delete(key);
    await load();
  } catch (error) {
    toast(error.status === 409 ? 'Someone changed this item meanwhile. It is reloaded; please repeat your change.' : error.message);
    await load();
  }
}

/* ---------- questions view ---------- */
function summary(item) {
  const answer = lastAnswer(item);
  if (!answer || item.status !== 'answered') return item.status === 'settled' ? 'Settled' : '';
  const parts = [];
  if (answer.choice) parts.push('Chose ' + answer.choice + (item.options.find(o => o.n === answer.choice)?.recommended ? ' (recommended)' : ''));
  if (answer.note) parts.push('note');
  return parts.join(' + ');
}
function visible(item) {
  if (filter === 'open') return !isDone(item);
  if (filter === 'done') return isDone(item);
  if (filter === 'page') return item.anchors.some(anchor => anchor.path === mdRender.currentDocument());
  return true;
}
function renderQuestions(list) {
  let topic, shown = 0;
  for (const item of questions()) {
    if (!visible(item)) continue;
    shown++;
    if (item.topic !== topic) { topic = item.topic; const h = document.createElement('div'); h.className = 'ov-topic'; h.textContent = topic || 'Questions'; list.append(h); }
    const answer = item.status === 'answered' ? lastAnswer(item) : undefined;
    const open = openQ === item.number;
    const card = document.createElement('article');
    card.className = 'ov-q' + (isDone(item) ? ' ov-done' : '') + (open ? ' ov-open' : '');
    card.id = 'ov-card-' + item.number;
    card.innerHTML = `<button class="ov-qh" aria-expanded="${open}"><span class="ov-num">${item.number}</span><span class="ov-title"></span></button>
      <div class="ov-body"><div class="ov-ctx">${item.contextHtml}</div><div class="ov-opts" role="group" aria-label="Options"></div>
      <label class="ov-note-l">${item.status === 'settled' ? 'Comment or overrule' : 'Your note'}<textarea class="ov-note" id="ov-note-${item.number}" placeholder="Optional: explain, ask for more context, or answer in your own words"></textarea></label>
      <div class="ov-foot"><span class="ov-saved"></span><span><button class="ov-clear">Clear answer</button> <button class="ov-btn ov-save">Save note</button></span></div></div>`;
    const title = card.querySelector('.ov-title'); title.textContent = item.title;
    const text = summary(item); if (text) { const s = document.createElement('span'); s.className = 'ov-sum'; s.textContent = text; title.append(s); }
    card.querySelector('.ov-qh').addEventListener('click', () => openQuestion(open ? null : item.number, true));
    if (item.status === 'settled') {
      const settled = item.entries.filter(entry => entry.kind === 'settled').pop();
      const decision = state.settled.find(decision => decision.id === settled?.settledAs);
      const box = document.createElement('div'); box.className = 'ov-decision';
      box.innerHTML = decision
        ? `<p>Decided by ${esc(decision.decidedBy.join(' and '))} on ${esc(fmtDay(decision.date))}: ${esc(decision.title)}</p><p><b>Choice:</b> ${esc(decision.choice ?? 'Not recorded')}</p><p><b>Reason:</b> ${esc(decision.reason ?? 'Not recorded')}</p><button class="ov-link">Open the decision</button>`
        : `<p>Settled as ${esc(settled?.settledAs)}</p>`;
      if (decision) box.querySelector('button').addEventListener('click', () => showAnchor(decision.anchors[0]));
      card.querySelector('.ov-body').prepend(box);
    }
    card.querySelector('.ov-ctx').after(passageLinks(item));
    wireLinks(card.querySelector('.ov-ctx'), item);
    const note = card.querySelector('textarea[id="ov-note-' + item.number + '"]'); note.value = drafts.get(note.id) ?? answer?.note ?? '';
    for (const option of item.options) {
      const button = document.createElement('button');
      button.className = 'ov-opt'; button.setAttribute('aria-pressed', answer?.choice === option.n);
      button.innerHTML = `<span class="ov-n">${option.n}</span><span>${option.html}${option.recommended ? ' <span class="ov-rec">recommended</span>' : ''}</span>`;
      button.addEventListener('click', event => {
        // A citation inside an option shows its passage; wireLinks below handles it.
        if (event.target.closest('a[href]')) return;
        addEntry(item, { kind: 'answer', choice: option.n, note: note.value });
      });
      card.querySelector('.ov-opts').append(button);
    }
    wireLinks(card.querySelector('.ov-opts'), item);
    card.querySelector('.ov-save').addEventListener('click', () => {
      if (!note.value.trim() && !answer?.choice) { toast('Choose an option or write a note first.'); return; }
      addEntry(item, { kind: 'answer', choice: answer?.choice ?? null, note: note.value });
    });
    card.querySelector('.ov-clear').addEventListener('click', () => { if (item.status === 'answered') addEntry(item, { kind: 'reopened', note: 'Answer cleared' }); });
    if (answer) card.querySelector('.ov-saved').textContent = 'Saved ' + new Date(answer.at).toLocaleString();
    list.append(card);
  }
  if (!shown) list.innerHTML = '<p class="ov-none">No questions match this filter.</p>';
}

/* ---------- history view ---------- */
function lastDate(item) { return item.entries.map(entry => day(entry.at)).filter(Boolean).sort().pop() || null; }
function hVisible(item) {
  if (hf.who === 'comment' ? item.kind !== 'comment' : hf.who && !item.decides.includes(hf.who)) return false;
  if (hf.status && item.status !== hf.status) return false;
  if (hf.topic && item.topic !== hf.topic) return false;
  if (hf.chapter && !item.anchors.some(anchor => anchor.path === hf.chapter)) return false;
  return true;
}
function statusLine(item) {
  const who = item.decides.map(d => d === 'operator' ? 'you' : d).join(' and ');
  if (item.kind === 'comment') return `<b>Comment</b> by ${esc(item.entries[0]?.actor.replace(/^\w+:/, ''))}, ${fmtDay(day(item.entries[0]?.at))}.`;
  if (item.status === 'settled') {
    const settled = item.entries.filter(entry => entry.kind === 'settled').pop();
    return `<b>Settled</b> by ${esc(item.kind === 'decision' ? who : settled?.actor.replace(/^\w+:/, ''))}${settled?.at ? ', ' + fmtDay(day(settled.at)) : ', date not recorded'}.`;
  }
  if (item.status === 'answered') { const answer = lastAnswer(item); return `<b>Answered</b> ${fmtDay(day(answer.at))}${answer.choice ? ': option ' + answer.choice : ''}. Not yet applied to the spec.`; }
  if (item.status === 'withdrawn') return '<b>Withdrawn.</b>';
  const raised = item.entries.find(entry => entry.kind === 'raised');
  return `<b>Open</b>, ${esc(who)} decide${who === 'you' ? '' : 's'}${raised ? '. Raised ' + fmtDay(day(raised.at)) : ''}${item.priority ? ' · ' + esc(item.priority) : ''}.`;
}
function renderHistory(list) {
  const rows = items.filter(hVisible).map(item => ({ item, d: lastDate(item) }));
  rows.sort((x, y) => (y.d || '').localeCompare(x.d || ''));
  $('#ov-hshown').textContent = rows.length === items.length ? `${rows.length} items, newest first` : `${rows.length} of ${items.length} items`;
  $('#ov-reset').hidden = !Object.values(hf).some(Boolean);
  const counts = {}; for (const row of rows) counts[row.d] = (counts[row.d] || 0) + 1;
  let current;
  for (const { item, d } of rows) {
    if (d !== current) { current = d; const h = document.createElement('div'); h.className = 'ov-day'; h.innerHTML = `<span>${fmtDay(d)}</span><span>${counts[d]}</span>`; list.append(h); }
    const open = openH === item.id;
    const row = document.createElement('article');
    row.className = 'ov-h' + (open ? ' ov-open' : ''); row.id = 'ov-h-' + item.id;
    const who = item.kind === 'comment' ? 'Comment' : item.decides.map(x => WHO[x] || x).join(' + ');
    // Only operator questions carry a short label; other titles already name their item.
    const label = item.number != null ? `<span class="ov-hid">Q${item.number}</span>` : '';
    row.innerHTML = `<button class="ov-hh" aria-expanded="${open}"><span class="ov-who${item.decides.includes('operator') ? ' ov-you' : ''}">${esc(who)}</span><span class="ov-htitle">${label}${esc(item.title)}</span><span class="ov-st ov-s-${item.kind === 'comment' ? 'settled' : item.status}" title="${item.status}" aria-label="${item.status}"></span></button>`;
    row.querySelector('.ov-hh').addEventListener('click', () => openItem(open ? null : item.id));
    if (open) row.append(historyBody(item));
    list.append(row);
  }
  if (!rows.length) list.innerHTML = '<p class="ov-none">Nothing matches these filters.</p>';
}
function historyBody(item) {
  const body = document.createElement('div'); body.className = 'ov-hbody';
  body.innerHTML = `<p class="ov-line">${statusLine(item)}</p>`;
  body.append(passageLinks(item));
  if (item.kind === 'question' && item.number != null && item.status !== 'settled' && item.status !== 'withdrawn') {
    const go = document.createElement('button'); go.className = 'ov-btn ov-goto'; go.textContent = isDone(item) ? 'Change answer' : 'Answer this question';
    go.addEventListener('click', () => { setView('q'); openQuestion(item.number, true); });
    body.append(go);
  }
  const more = document.createElement('button'); more.className = 'ov-more'; more.setAttribute('aria-expanded', 'false'); more.textContent = 'Details';
  const detail = document.createElement('div'); detail.className = 'ov-detail'; detail.hidden = true;
  const chosen = lastAnswer(item)?.choice;
  detail.innerHTML = `<div class="ov-ctx">${item.contextHtml}</div>` +
    item.options.map(o => `<div class="ov-optro${chosen === o.n ? ' ov-chosen' : ''}"><span class="ov-n">${o.n}</span><span>${o.html}${o.recommended ? ' <span class="ov-rec">recommended</span>' : ''}</span></div>`).join('') +
    `<ul class="ov-events">${item.entries.map(e => `<li>${e.at ? esc(e.at.slice(0, 16).replace('T', ' ')) + ' UTC' : 'Undated'} · ${esc(e.kind)} by ${esc(e.actor)}${e.choice ? ': option ' + e.choice : ''}${e.note ? ' — ' + esc(e.note) : ''}</li>`).join('')}</ul>`;
  wireLinks(detail, item);
  if (item.kind !== 'decision' && item.status !== 'settled' && !(item.kind === 'question' && item.number != null)) {
    const box = document.createElement('div');
    const to = item.kind === 'comment' ? 'Reply' : `Your note to the ${esc(item.decides[0])}`;
    box.innerHTML = `<label class="ov-note-l">${to}<textarea class="ov-note" id="ov-reply-${item.id}"></textarea></label><div class="ov-foot"><span></span><button class="ov-btn ov-save">Save</button></div>`;
    box.querySelector('textarea').value = drafts.get(`ov-reply-${item.id}`) ?? '';
    box.querySelector('.ov-save').addEventListener('click', () => {
      const note = box.querySelector('textarea').value.trim();
      if (note) addEntry(item, { kind: 'comment', note });
    });
    detail.append(box);
  }
  more.addEventListener('click', () => { detail.hidden = !detail.hidden; more.setAttribute('aria-expanded', !detail.hidden); more.textContent = detail.hidden ? 'Details' : 'Hide details'; });
  body.append(more, detail);
  return body;
}
function fillFilters() {
  const topic = $('#ov-f-topic'), chapter = $('#ov-f-chapter');
  topic.length = 1; chapter.length = 1;
  // One pass counts each item once for its topic and once for each chapter it cites.
  const topics = new Map(), chapters = new Map();
  for (const item of items) {
    if (item.topic) topics.set(item.topic, (topics.get(item.topic) ?? 0) + 1);
    for (const file of new Set(item.anchors.map(a => a.path))) chapters.set(file, (chapters.get(file) ?? 0) + 1);
  }
  for (const [t, n] of topics) topic.append(new Option(`${t} (${n})`, t));
  for (const d of mdRender.documents()) if (chapters.has(d.path)) chapter.append(new Option(`${d.title} (${chapters.get(d.path)})`, d.path));
  topic.value = hf.topic; chapter.value = hf.chapter;
}

/* ---------- shared rendering ---------- */
// Notes being written survive a redraw. A redraw that arrives while the reader types a note in the
// list waits until the focus leaves the sidebar, or until the reader's own save redraws it. The
// comment box is not in the list, so a redraw never waits for it.
const drafts = new Map();
let redrawPending = false;
const typing = () => document.activeElement?.classList.contains('ov-note') && $('#ov-list').contains(document.activeElement);
$('#ov-list').addEventListener('input', event => { if (event.target.classList.contains('ov-note')) drafts.set(event.target.id, event.target.value); });
// Focus may pass from the note to a button in the sidebar first; the redraw waits until it leaves the sidebar.
$('#ov-panel').addEventListener('focusout', event => {
  if (redrawPending && !$('#ov-panel').contains(event.relatedTarget)) renderList();
});
function renderList() {
  redrawPending = false;
  const list = $('#ov-list'), keep = list.scrollTop;
  list.innerHTML = '';
  if (view === 'q') renderQuestions(list); else renderHistory(list);
  list.scrollTop = keep;
}
function renderCounts() {
  const all = questions(), done = all.filter(isDone).length;
  $('#ov-count').textContent = `${done} / ${all.length} answered`;
  $('#ov-fill').style.width = (all.length ? 100 * done / all.length : 0) + '%';
  $('#ov-fab').textContent = `Decisions ${done}/${all.length}`;
  $('#ov-v-qn').textContent = `${all.length - done} open`;
  $('#ov-v-hn').textContent = items.length;
}
function openQuestion(number, fromPanel) {
  const item = number == null ? null : byNumber(number);
  // A card drawn before its question was removed: redraw the list without it.
  openQ = item ? number : null;
  if (item && !visible(item)) setFilter('all');
  renderList(); markDocument();
  if (!item) return;
  if (innerWidth < 900 && !fromPanel) $('#ov-panel').classList.add('ov-show');
  listItem('ov-card-' + number)?.scrollIntoView({ block: 'start' });
  if (fromPanel) showAnchor(item.anchors.find(a => a.role === 'main'));
}
function openItem(id) {
  openH = id; const item = byId(id);
  lightItem(item); renderList(); refreshMarks();
  if (!item) return;
  listItem('ov-h-' + id)?.scrollIntoView({ block: 'nearest' });
  showAnchor(item.anchors.find(a => a.role === 'main') || item.anchors[0]);
}
function setView(next) {
  view = next;
  $('#ov-v-q').setAttribute('aria-pressed', next === 'q'); $('#ov-v-h').setAttribute('aria-pressed', next === 'h');
  $('#ov-qhead').hidden = next !== 'q'; $('#ov-hhead').hidden = next !== 'h'; $('#ov-next').hidden = next !== 'q';
  lightItem(next === 'h' ? byId(openH) : null);
  renderList(); refreshMarks();
}
function setFilter(next) { filter = next; document.querySelectorAll('.ov-chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.f === next)); renderList(); }

/* ---------- loading ---------- */
// One state request at a time, so an older response never replaces a newer one; a request asked
// for meanwhile runs once more after it.
let loading = null, loadAgain = false;
function load() {
  if (loading) { loadAgain = true; return loading; }
  loading = (async () => {
    try { do { loadAgain = false; await loadOnce(); } while (loadAgain); }
    catch (error) { loadError = error.message; renderStatus(); }
    finally { loading = null; }
  })();
  return loading;
}
async function loadOnce() {
  const response = await fetch('/api/state', { headers });
  if (!response.ok) { loadError = String(response.status); renderStatus(); return; }
  const next = await response.json();
  // The documents were rendered again while this page missed the reload notice: show the new render.
  if (next.generation !== mdRender.extensionData('md-collab')?.generation) { location.reload(); return; }
  state = next;
  loadError = null;
  items = [
    ...state.threads,
    ...state.settled.map(decision => ({
      id: decision.id, kind: 'decision', title: decision.title, topic: decision.topic, decides: decision.decidedBy, number: null, priority: null,
      status: 'settled', options: [], contextHtml: '',
      anchors: decision.anchors, entries: [{ at: decision.date ? decision.date + 'T00:00:00Z' : null, kind: 'settled', actor: decision.decidedBy.join(' + ') }],
    })),
  ];
  fillFilters();
  if (typing()) redrawPending = true; else renderList();
  renderCounts(); markDocument();
  renderStatus();
}
const events = new EventSource('/api/events');
// Each connection, the first and every reconnection, starts with a fresh state: writes made while
// disconnected sent no event to this page.
events.onopen = () => { disconnected = false; renderStatus(); load(); };
events.addEventListener('changed', () => { load(); });
events.addEventListener('reload', () => { location.reload(); });
// The state carries the failure until a render succeeds, so the warning stays through later loads.
events.addEventListener('failed', () => { load(); });
// Only live updates stop; each save still reports whether it worked.
events.onerror = () => { disconnected = true; renderStatus(); };
mdRender.onNavigate(() => { if (view === 'q' && filter === 'page') renderList(); });

/* ---------- comments on selected text ---------- */
let selection = null;
// The browser sends every block whose text is touched in the chapter where the selection starts.
// The server keeps only the innermost blocks, the first as the main passage.
function selectedBlocks(range) {
  const start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const chapter = start?.closest('.single-page');
  if (!chapter) return null;
  // A block counts when the selection holds some of its text, so a selection that ends at the very
  // start of the next paragraph, as a triple click does, does not name that paragraph.
  const touches = node => {
    if (!range.intersectsNode(node)) return false;
    const part = document.createRange(); part.selectNodeContents(node);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
    return part.toString().trim() !== '';
  };
  const blocks = [...chapter.querySelectorAll('[data-block]')].filter(touches).map(element => element.dataset.block);
  return blocks.length ? { path: chapter.dataset.sourcePath, blocks } : null;
}
document.addEventListener('selectionchange', () => {
  const current = getSelection(), pop = $('#ov-sel');
  if (!current.rangeCount || current.isCollapsed || !$('#md-render-content')?.contains(current.anchorNode)) { pop.style.display = 'none'; return; }
  const block = selectedBlocks(current.getRangeAt(0));
  if (!block) { pop.style.display = 'none'; return; }
  selection = block;
  const rect = current.getRangeAt(0).getBoundingClientRect();
  pop.style.display = 'block';
  pop.style.top = (scrollY + rect.bottom + 8) + 'px';
  pop.style.left = Math.max(16, Math.min(scrollX + rect.left, scrollX + document.documentElement.clientWidth - 140)) + 'px';
});
$('#ov-selbtn').addEventListener('mousedown', event => event.preventDefault());
$('#ov-selbtn').addEventListener('click', () => {
  const composer = $('#ov-composer');
  composer.style.top = $('#ov-sel').style.top; composer.style.left = $('#ov-sel').style.left;
  composer.hidden = false; $('#ov-sel').style.display = 'none'; $('#ov-comment').focus();
});
$('#ov-comment-cancel').addEventListener('click', () => { $('#ov-composer').hidden = true; $('#ov-comment').value = ''; });
$('#ov-comment-save').addEventListener('click', async () => {
  // As with a note's draft, a completed save closes and empties the box only when it still holds
  // the text and the passage that were saved: typing during the save stays.
  const text = $('#ov-comment').value, passage = selection, note = text.trim();
  if (!note || !passage) { toast('Write the comment first.'); return; }
  try {
    await post('/api/comments', { ...passage, note });
    if ($('#ov-comment').value === text && selection === passage) { $('#ov-composer').hidden = true; $('#ov-comment').value = ''; }
    toast('Comment saved.'); await load();
  } catch (error) { toast(error.message); }
});
document.addEventListener('click', event => {
  const marked = event.target.closest?.('.ov-cm');
  if (!marked || event.target.closest('a,button')) return;
  const id = marked.dataset.ovItems.split(' ').find(x => byId(x)?.kind === 'comment');
  if (id) { setView('h'); openItem(id); }
});

/* ---------- controls ---------- */
$('#ov-next').addEventListener('click', () => {
  const start = openQ || 0, all = questions();
  const next = all.filter(q => q.number > start).concat(all.filter(q => q.number <= start)).find(q => !isDone(q));
  if (!next) { toast('All questions have an answer.'); return; }
  openQuestion(next.number, true);
});
$('#ov-v-q').addEventListener('click', () => setView('q'));
$('#ov-v-h').addEventListener('click', () => setView('h'));
$('#ov-fab').addEventListener('click', () => $('#ov-panel').classList.add('ov-show'));
$('#ov-close').addEventListener('click', () => $('#ov-panel').classList.remove('ov-show'));
document.querySelectorAll('.ov-chip').forEach(chip => chip.addEventListener('click', () => setFilter(chip.dataset.f)));
for (const key of Object.keys(hf)) $('#ov-f-' + key).addEventListener('change', event => { hf[key] = event.target.value; openH = null; lightItem(null); renderList(); });
$('#ov-reset').addEventListener('click', () => { for (const key of Object.keys(hf)) { hf[key] = ''; $('#ov-f-' + key).value = ''; } renderList(); });
setView(view);
load();
})();
