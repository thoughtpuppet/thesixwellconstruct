const TOKEN_KEY = 'swc_submissions_admin_token';
const $ = (id) => document.getElementById(id);
const TYPES = {
  tattoo_inquiry: 'Custom tattoo', flash_claim: 'Flash claim', special_project: 'Special project',
  build_brief: 'Build your own', maze_design: 'Maze design', tattoo_special: 'Tattoo Special',
  consultation: 'Consultation', studio_booking: 'Studio booking',
};
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = (value) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' }).format(new Date(value)) : '';
const human = (value) => String(value || '').replace(/_/g, ' ');
let token = localStorage.getItem(TOKEN_KEY) || '';
let epoch = 0, rows = [], nextCursor = null, currentDetail = null, config = null, registered = null, subscription = null;
const objectUrls = [];
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function status(message, error = false) {
  $('app-status').textContent = message;
  $('app-status').classList.toggle('error', error);
}

function clearDetail() {
  objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  currentDetail = null;
  $('request-detail').replaceChildren();
}

function lock(message = '') {
  epoch++;
  token = '';
  localStorage.removeItem(TOKEN_KEY);
  rows = []; nextCursor = null; config = null;
  if ($('request-dialog').open) $('request-dialog').close();
  clearDetail();
  $('request-list').replaceChildren();
  $('access-token').value = '';
  $('inbox-panel').hidden = true;
  $('lock').hidden = true;
  $('unlock-panel').hidden = false;
  status(message);
}

async function api(path, options = {}) {
  const generation = epoch;
  const response = await fetch(path, { ...options, cache: 'no-store', headers: {
    authorization: `Bearer ${token}`, ...(options.body ? { 'content-type': 'application/json' } : {}),
  } });
  if (generation !== epoch) throw new Error('Inbox was locked.');
  if (response.status === 401) { lock('Unlock Studio again to continue.'); throw new Error('Unlock Studio again to continue.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to reach Studio. Try again.');
  return data;
}

function renderRows() {
  $('request-list').innerHTML = rows.length ? rows.map((row) => `
    <button type="button" class="request-card ${row.openedAt ? '' : 'unread'}" data-request="${escape(row.id)}">
      <span class="card-top"><time>${escape(date(row.createdAt))}</time><span class="status-badge">${row.openedAt ? escape(human(row.status)) : 'Unread'}</span></span>
      <span class="card-name">${escape(row.contactName || 'Booking request')}</span>
      <span class="card-type">${escape(TYPES[row.type] || human(row.type))}</span>
      ${row.subject ? `<span class="card-subject">${escape(row.subject)}</span>` : ''}
    </button>`).join('') : `<div class="empty-state"><h2>${$('filter').value === 'unread' ? 'You’re caught up.' : 'No requests here yet.'}</h2><p>${$('filter').value === 'unread' ? 'New unread requests will appear here.' : 'Requests submitted through your website will appear here.'}</p></div>`;
  $('request-count').textContent = `${rows.length}${nextCursor ? '+' : ''} requests`;
  $('load-more').hidden = !nextCursor;
}

async function loadInbox(append = false) {
  $('request-list').setAttribute('aria-busy', 'true');
  $('refresh').disabled = true; $('load-more').disabled = true;
  status('Loading requests…');
  const params = new URLSearchParams({ filter: $('filter').value });
  if (append && nextCursor) Object.entries(nextCursor).forEach(([key, value]) => params.set(key, value));
  const result = await api(`/api/admin/booking-inbox?${params}`);
  rows = append ? [...rows, ...result.submissions.filter((row) => !rows.some((old) => old.id === row.id))] : result.submissions;
  nextCursor = result.nextCursor;
  renderRows();
  status('');
  $('request-list').setAttribute('aria-busy', 'false');
}

function fields(submission) {
  const p = submission.payload || {};
  const values = [
    ['Email', submission.contactEmail], ['Phone', submission.contactPhone],
    ['Project', submission.subject || p.project_description || p.design_description],
    ['Notes', p.description || p.notes || p.project_notes || p.meaning || p.additional_notes],
    ['Placement', p.placement || p.body_placement], ['Size', p.size || p.approximate_size],
    ['Budget', p.budget || p.budget_range], ['Status', human(submission.status)],
  ];
  return values.filter(([, value]) => ['string', 'number'].includes(typeof value) && String(value).trim())
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('');
}

async function openRequest(id) {
  const generation = epoch;
  status('Opening request…');
  const { submission } = await api(`/api/admin/submissions/${encodeURIComponent(id)}`);
  if (generation !== epoch) return;
  clearDetail(); currentDetail = submission;
  const mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.contactEmail || '') ? submission.contactEmail : '';
  $('request-detail').innerHTML = `
    <h2 id="request-title">${escape(submission.contactName || 'Booking request')}</h2>
    <p class="detail-meta">${escape(TYPES[submission.type] || human(submission.type))} · ${escape(date(submission.createdAt))}</p>
    <dl class="detail-fields">${fields(submission)}</dl>
    <div class="detail-actions"><a href="/studio/submissions/?request=${encodeURIComponent(id)}">Full review in Studio</a>${mail ? `<a href="mailto:${escape(encodeURIComponent(mail).replace(/%40/g, '@'))}">Email client</a>` : ''}</div>
    <p class="muted">Approve, decline, or prepare a booking link in Studio.</p>
    ${(submission.files || []).length ? `<h2>References</h2><div class="file-list">${submission.files.map((file) => `<button type="button" data-file="${escape(file.id)}" ${file.stored ? '' : 'disabled'}>${escape(file.fileName || 'Reference')}${file.stored ? '' : ' · unavailable'}</button>`).join('')}</div><div id="file-preview"></div>` : ''}`;
  if (!$('request-dialog').open) $('request-dialog').showModal();
  status('');
  try {
    await api(`/api/admin/submissions/${encodeURIComponent(id)}/open`, { method: 'POST' });
    const row = rows.find((item) => item.id === id);
    if (row) row.openedAt = new Date().toISOString();
    if ($('filter').value === 'unread') rows = rows.filter((item) => item.id !== id);
    renderRows();
  } catch (error) { status(error.message, true); }
}

async function previewFile(id, button) {
  const file = currentDetail?.files?.find((item) => item.id === id);
  if (!file) return;
  const detailId = currentDetail.id, generation = epoch;
  button.disabled = true;
  try {
    const response = await fetch(`/api/admin/submissions/${encodeURIComponent(detailId)}/files/${encodeURIComponent(id)}`, {
      cache: 'no-store', headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401) { lock('Unlock Studio again to continue.'); return; }
    if (!response.ok) throw new Error('This reference is unavailable.');
    const blob = await response.blob();
    if (generation !== epoch || currentDetail?.id !== detailId) return;
    const url = URL.createObjectURL(blob); objectUrls.push(url);
    $('file-preview').replaceChildren();
    if (['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
      const image = document.createElement('img'); image.src = url; image.alt = file.fileName; image.className = 'file-preview';
      $('file-preview').append(image);
    } else {
      const link = document.createElement('a'); link.href = url; link.download = file.fileName || 'reference'; link.textContent = `Download ${file.fileName || 'reference'}`;
      $('file-preview').append(link);
    }
  } finally { button.disabled = false; }
}

async function registerWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  registered = await navigator.serviceWorker.register('/studio/bookings/sw.js', { scope: '/studio/bookings/', updateViaCache: 'none' });
  await navigator.serviceWorker.ready;
}

function renderPush() {
  const supported = 'PushManager' in window && 'Notification' in window && registered;
  const installNeeded = iphone && !standalone();
  $('install-help').hidden = !installNeeded;
  $('enable-push').hidden = Boolean(subscription);
  $('enable-push').disabled = (!config?.configured && !config?.canActivate) || !supported || installNeeded || Notification.permission === 'denied';
  $('test-push').hidden = !subscription || !config?.configured;
  $('disable-push').hidden = !subscription;
  if (installNeeded) { $('alerts-summary').textContent = 'Add to Home Screen'; $('push-status').textContent = 'Install the app before enabling iPhone alerts.'; }
  else if (!config?.configured && !config?.canActivate) { $('alerts-summary').textContent = 'Not activated'; $('push-status').textContent = 'Phone alerts are paused on the website. Your booking inbox still works.'; }
  else if (!supported) { $('alerts-summary').textContent = 'Unavailable here'; $('push-status').textContent = 'This browser does not support phone alerts. Open the app on a supported device.'; }
  else if (Notification.permission === 'denied') { $('alerts-summary').textContent = 'Blocked'; $('push-status').textContent = 'Allow notifications in your device settings, then reopen the app.'; }
  else if (subscription) { $('alerts-summary').textContent = 'On'; $('push-status').textContent = 'New booking requests will notify this device. Send a test alert to check delivery.'; }
  else { $('alerts-summary').textContent = 'Off'; $('push-status').textContent = 'Get an alert when a new booking request arrives.'; }
}

async function configurePush() {
  config = await api('/api/admin/booking-push/config');
  await workerPromise;
  subscription = registered?.pushManager ? await registered.pushManager.getSubscription() : null;
  if (subscription && config.configured) {
    await saveSubscription(subscription);
  }
  renderPush();
}

function saveSubscription(value) {
  return api('/api/admin/booking-push/subscriptions', { method: 'POST', body: JSON.stringify({ subscription: value.toJSON(), deviceLabel: iphone ? 'iPhone / iPad' : 'My browser' }) });
}

function decodeKey(key) {
  return Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4)), (char) => char.charCodeAt(0));
}

async function enablePush() {
  if ((!config?.configured && !config?.canActivate) || !registered) return;
  // Permission is requested before any await, inside the owner's button click.
  const permissionPromise = Notification.requestPermission();
  $('enable-push').disabled = true;
  try {
    const permission = await permissionPromise;
    if (permission !== 'granted') { renderPush(); return; }
    if (!config.configured) config = await api('/api/admin/booking-push/activate', { method: 'POST' });
    const value = await registered.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.publicKey) });
    try { await saveSubscription(value); }
    catch (error) { await value.unsubscribe(); throw error; }
    subscription = value; renderPush();
  } finally { renderPush(); }
}

async function disablePush() {
  if (!subscription) return;
  await api('/api/admin/booking-push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
  const unsubscribed = await subscription.unsubscribe();
  if (!unsubscribed) throw new Error('Unable to remove the device subscription. Try again.');
  subscription = null; renderPush();
}

async function unlock() {
  const generation = epoch;
  await loadInbox();
  if (generation !== epoch) return;
  localStorage.setItem(TOKEN_KEY, token);
  $('unlock-panel').hidden = true; $('inbox-panel').hidden = false; $('lock').hidden = false;
  $('access-token').value = '';
  configurePush().catch((error) => { $('push-status').textContent = error.message; $('alerts-summary').textContent = 'Unavailable'; });
  const id = new URLSearchParams(location.search).get('request');
  if (id) await openRequest(id);
}

function run(action, button) {
  if (button) button.disabled = true;
  return Promise.resolve().then(action).catch((error) => status(error.message || 'Try again.', true)).finally(() => {
    if (button) button.disabled = false;
    $('refresh').disabled = false; $('load-more').disabled = false;
    $('request-list').setAttribute('aria-busy', 'false');
  });
}

$('unlock-form').addEventListener('submit', (event) => { event.preventDefault(); epoch++; token = $('access-token').value.trim(); run(unlock, event.submitter); });
$('lock').addEventListener('click', () => lock());
$('refresh').addEventListener('click', () => run(() => loadInbox(), $('refresh')));
$('filter').addEventListener('change', () => run(() => loadInbox(), $('filter')));
$('load-more').addEventListener('click', () => run(() => loadInbox(true), $('load-more')));
$('request-list').addEventListener('click', (event) => { const button = event.target.closest('[data-request]'); if (button) run(() => openRequest(button.dataset.request), button); });
$('close-detail').addEventListener('click', () => $('request-dialog').close());
$('request-dialog').addEventListener('close', clearDetail);
$('request-detail').addEventListener('click', (event) => { const button = event.target.closest('[data-file]'); if (button) run(() => previewFile(button.dataset.file, button), button); });
$('enable-push').addEventListener('click', () => { enablePush().catch((error) => status(error.message, true)); });
$('disable-push').addEventListener('click', () => run(disablePush, $('disable-push')));
$('test-push').addEventListener('click', () => run(async () => {
  await api('/api/admin/booking-push/test', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) });
  status('Test alert sent. Check your notifications.');
}, $('test-push')));
document.addEventListener('visibilitychange', () => { if (!document.hidden && token && !$('inbox-panel').hidden) run(() => loadInbox()); });
window.addEventListener('online', () => { if (token) run(() => loadInbox()); });
const workerPromise = registerWorker().catch(() => { registered = null; });
if (token) run(unlock);
