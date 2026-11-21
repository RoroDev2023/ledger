// [Alex] GET / : a one-file browser page for testing the API by hand (upload plan and videos, live
// progress, Decisions stats, statement). Not the product UI; apps/web is. No build step, no dependencies.

export const TEST_PAGE = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>LEDGER API test page</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --ink:#111; --muted:#6b7280; --line:#e5e7eb; --red:#dc2626; --green:#16a34a; --blue:#2563eb; --bg:#f9fafb; }
  * { box-sizing: border-box }
  body { font: 15px/1.45 system-ui, -apple-system, sans-serif; color: var(--ink); background: var(--bg); margin: 0 }
  header { padding: 18px 28px; background: #fff; border-bottom: 1px solid var(--line); display: flex; gap: 16px; align-items: baseline }
  header h1 { font-size: 18px; margin: 0 } header span { color: var(--muted); font-size: 13px }
  main { display: grid; grid-template-columns: 380px 1fr; gap: 20px; padding: 20px 28px; max-width: 1400px }
  section { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 16px }
  h2 { font-size: 14px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted) }
  label { display: block; font-size: 13px; color: var(--muted); margin: 8px 0 4px }
  input, select, button { font: inherit; width: 100% } input, select { padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px }
  button { margin-top: 10px; padding: 9px; border: 0; border-radius: 6px; background: var(--ink); color: #fff; cursor: pointer }
  button:disabled { background: #9ca3af; cursor: default } button.secondary { background: #fff; color: var(--ink); border: 1px solid var(--line) }
  .row { display: flex; gap: 8px } .row > * { flex: 1 }
  .stage { display: grid; grid-template-columns: 80px 1fr 50px; gap: 8px; align-items: center; font-size: 13px; margin: 4px 0 }
  .bar { height: 8px; background: var(--line); border-radius: 4px; overflow: hidden } .bar i { display: block; height: 100%; width: 0; background: var(--blue); transition: width .15s }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px }
  .stat { background: var(--bg); border-radius: 8px; padding: 10px; text-align: center } .stat b { display: block; font-size: 22px } .stat span { font-size: 12px; color: var(--muted) }
  #log { font: 12px/1.5 ui-monospace, monospace; background: #0b1020; color: #cbd5e1; border-radius: 8px; padding: 10px; height: 180px; overflow: auto; white-space: pre-wrap }
  table { width: 100%; border-collapse: collapse; font-size: 14px } td, th { text-align: left; padding: 7px 6px; border-bottom: 1px solid var(--line); vertical-align: top }
  .charged td { color: var(--red); font-weight: 600 } .free td { color: var(--muted) } .num { text-align: right; white-space: nowrap }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; background: var(--bg); border: 1px solid var(--line) }
  .links a { margin-right: 12px; font-size: 13px } .muted { color: var(--muted); font-size: 13px } .err { color: var(--red); font-size: 13px; min-height: 18px }
  .total { font-size: 20px; font-weight: 700 }
</style></head>
<body>
<header><h1>LEDGER · API test page</h1><span id="health">checking…</span></header>
<main>
<div>
  <section>
    <h2>1 · Floor plan</h2>
    <label>Unit id (optional)</label><input id="unitId" placeholder="auto">
    <label>Plan file, or a sample (mock mode picks the apartment by name)</label>
    <input type="file" id="planFile" accept=".png,.jpg,.jpeg,.webp,.pdf">
    <select id="planSample"><option value="">— or use a sample —</option><option>demo-table.png</option><option>studio-l.png</option><option>one-bed-railroad.pdf</option></select>
    <button id="createBtn">Create unit</button>
    <div class="err" id="planErr"></div>
    <div id="planInfo" class="muted"></div>
  </section>
  <section>
    <h2>2 · Walkthrough videos</h2>
    <label>Video file (optional: leave empty to send a dummy file)</label>
    <input type="file" id="videoFile" accept=".mp4,.mov,.webm,.m4v">
    <label>Move-out date</label><input type="date" id="moveOutDate">
    <div class="row"><button id="baselineBtn" disabled>Upload baseline</button><button id="moveoutBtn" disabled>Upload move-out</button></div>
    <div class="err" id="walkErr"></div>
  </section>
  <section>
    <h2>Raw JSON</h2>
    <div class="links" id="links"><span class="muted">Create a unit first.</span></div>
  </section>
</div>
<div>
  <section>
    <h2>Live job <span class="pill" id="jobLabel">idle</span></h2>
    <div id="stages"></div>
    <div class="stats">
      <div class="stat"><b id="sCalls">0</b><span>Decisions calls</span></div>
      <div class="stat"><b id="sQuestions">0</b><span>questions asked</span></div>
      <div class="stat"><b id="sLatency">–</b><span>avg / last response</span></div>
    </div>
  </section>
  <section>
    <h2>Statement</h2>
    <div id="statement" class="muted">Upload a baseline, then a move-out.</div>
  </section>
  <section><h2>Event log</h2><div id="log"></div></section>
</div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const STAGES = ['frames', 'rooms', 'surfaces', 'findings', 'diff'];
let unitId = null;
const log = (msg) => { const l = $('log'); l.textContent += new Date().toLocaleTimeString() + '  ' + msg + '\\n'; l.scrollTop = l.scrollHeight; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
$('moveOutDate').value = new Date().toISOString().slice(0, 10);

fetch('/health').then((r) => r.json()).then((h) => { $('health').textContent = 'API ok · pipeline: ' + h.pipeline; }).catch(() => { $('health').textContent = 'API not reachable'; });

function resetStages() {
  $('stages').innerHTML = STAGES.map((s) => '<div class="stage"><span>' + s + '</span><div class="bar"><i id="bar-' + s + '"></i></div><span id="cnt-' + s + '" class="muted">–</span></div>').join('');
  for (const k of ['sCalls', 'sQuestions']) $(k).textContent = '0';
  $('sLatency').textContent = '–';
}
resetStages();

async function send(path, fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') fd.set(k, v);
  const res = await fetch(path, { method: 'POST', body: fd });
  const body = await res.json();
  if (!res.ok) throw new Error(res.status + ' · ' + (body.error || 'request failed'));
  return body;
}

$('createBtn').onclick = async () => {
  $('planErr').textContent = '';
  const picked = $('planFile').files[0];
  const sample = $('planSample').value;
  if (!picked && !sample) { $('planErr').textContent = 'Pick a plan file or a sample.'; return; }
  const file = picked || new File(['sample'], sample);
  try {
    const { unit, plan } = await send('/units', { plan: file, unitId: $('unitId').value.trim() });
    unitId = unit.unitId;
    log('unit ' + unitId + ' created from ' + file.name);
    $('planInfo').innerHTML = '<b>' + esc(unitId) + '</b> · ' + plan.rooms.map((r) => esc(r.name)).join(', ') + ' · ' + plan.surfaces.length + ' surfaces · ceiling ' + plan.ceilingHeightM + ' m' + (plan.warnings.length ? '<br>⚠ ' + plan.warnings.map(esc).join('<br>⚠ ') : '');
    $('baselineBtn').disabled = false; $('moveoutBtn').disabled = false;
    $('statement').textContent = 'Upload a baseline, then a move-out.';
    $('links').innerHTML = ['plan', 'findings?kind=baseline', 'findings?kind=move-out', 'diff', 'statement', 'statement.html'].map((p) => '<a target="_blank" href="/units/' + unitId + '/' + p + '">' + p + '</a>').join('') + '<a target="_blank" href="/units/' + unitId + '">unit</a>';
  } catch (e) { $('planErr').textContent = e.message; }
};

async function uploadWalk(kind) {
  $('walkErr').textContent = '';
  const file = $('videoFile').files[0] || new File(['dummy'], kind + '.mp4');
  try {
    const { jobId, walkthroughId } = await send('/units/' + unitId + '/walkthroughs', { video: file, kind, capturedAt: kind === 'move-out' ? $('moveOutDate').value : undefined });
    log(kind + ' uploaded (' + file.name + ') → ' + jobId + ' / ' + walkthroughId);
    follow(jobId, kind);
  } catch (e) { $('walkErr').textContent = e.message; }
}
$('baselineBtn').onclick = () => uploadWalk('baseline');
$('moveoutBtn').onclick = () => uploadWalk('move-out');

function follow(jobId, kind) {
  resetStages();
  $('jobLabel').textContent = kind + ' · running';
  $('baselineBtn').disabled = $('moveoutBtn').disabled = true;
  const es = new EventSource('/jobs/' + jobId + '/events');
  const finish = (label) => { es.close(); $('jobLabel').textContent = kind + ' · ' + label; $('baselineBtn').disabled = $('moveoutBtn').disabled = false; };
  es.addEventListener('progress', (m) => {
    const e = JSON.parse(m.data);
    $('bar-' + e.stage).style.width = (100 * e.done / e.total) + '%';
    $('cnt-' + e.stage).textContent = e.done + '/' + e.total;
  });
  es.addEventListener('decisions', (m) => {
    const s = JSON.parse(m.data).stats;
    $('sCalls').textContent = s.calls; $('sQuestions').textContent = s.questions;
    $('sLatency').textContent = s.avgLatencyMs + ' / ' + s.lastLatencyMs + ' ms';
  });
  es.addEventListener('done', (m) => {
    const r = JSON.parse(m.data).result;
    log(kind + ' done: ' + r.findings + ' findings' + (r.diffItems !== undefined ? ', ' + r.diffItems + ' diff items' : ''));
    finish('done');
    if (kind === 'move-out') showStatement(); else showFindings();
  });
  es.addEventListener('error', (m) => {
    if (m.data) { log('ERROR ' + JSON.parse(m.data).message); finish('failed'); }
    else if (es.readyState === EventSource.CLOSED) finish('disconnected');
  });
}

async function showFindings() {
  const { findings } = await (await fetch('/units/' + unitId + '/findings?kind=baseline')).json();
  $('statement').innerHTML = '<p class="muted">Move-in record: ' + findings.length + ' existing issue(s). Now upload the move-out.</p><table><tr><th>Surface</th><th>Issue</th><th>Severity</th><th>Confidence</th><th>Decided by</th></tr>' +
    findings.map((f) => '<tr><td>' + esc(f.surfaceId) + '</td><td>' + esc(f.type) + '</td><td>' + f.severity + '</td><td>' + f.confidence + '</td><td>' + esc(f.decidedBy) + '</td></tr>').join('') + '</table>';
}

async function showStatement() {
  const res = await fetch('/units/' + unitId + '/statement');
  if (!res.ok) { $('statement').textContent = 'No statement: ' + (await res.json()).error; return; }
  const s = await res.json();
  const rows = s.items.map((d) => {
    const np = d.reason.toLowerCase().startsWith('not provable');
    return '<tr class="' + (d.costUsd > 0 ? 'charged' : 'free') + '"><td>' + esc(d.surfaceId) + '</td><td><span class="pill">' + (np ? 'not provable' : esc(d.verdict)) + '</span></td><td>' + esc(d.reason) + '</td><td class="num">$' + (d.costUsd || 0).toFixed(2) + '</td></tr>';
  }).join('');
  $('statement').innerHTML = '<p>Move-out <b>' + s.moveOutDate + '</b> · send by <b>' + s.dueBy + '</b> · <span class="total">$' + s.totalUsd.toFixed(2) + '</span></p><table><tr><th>Surface</th><th>Verdict</th><th>Why</th><th class="num">Charge</th></tr>' + rows + '</table><p class="muted">' + esc(s.disclaimer) + ' · <a target="_blank" href="/units/' + unitId + '/statement.html">printable version</a></p>';
}
</script>
</body></html>
`;
