// [Alex] Hand test: runs real scenarios against a RUNNING api and prints a readable report.
//   pnpm --filter @ledger/api dev        (terminal 1)
//   pnpm --filter @ledger/api try        (terminal 2)   API=http://localhost:3001 by default
const API = process.env.API ?? 'http://localhost:3001';
let failures = 0;
const ok = (cond: boolean, label: string) => {
  if (!cond) failures++;
  console.log(`   ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}`);
};
const file = (name: string) => new File([new Uint8Array([0x4c, 0x45, 0x44])], name);
async function post(path: string, fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const res = await fetch(API + path, { method: 'POST', body: fd });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const get = async (path: string) => {
  const res = await fetch(API + path);
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? ((await res.json()) as Record<string, unknown>) : await res.text() };
};

type Ev = { type: string; stage?: string; stats?: { calls: number; questions: number; avgLatencyMs: number }; message?: string };
async function follow(jobId: string): Promise<Ev[]> {
  const res = await fetch(`${API}/jobs/${jobId}/events`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const events: Ev[] = [];
  let buf = '';
  let lastStage = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.startsWith('data: ') || line.length <= 6) continue;
      const e = JSON.parse(line.slice(6)) as Ev;
      events.push(e);
      if (e.type === 'progress' && e.stage !== lastStage) process.stdout.write(`${lastStage ? ' → ' : '   stages: '}${(lastStage = e.stage!)}`);
    }
  }
  process.stdout.write('\n');
  return events;
}
const lastStats = (ev: Ev[]) => ev.filter((e) => e.type === 'decisions').at(-1)?.stats;
const growing = (ev: Ev[]) => ev.filter((e) => e.type === 'decisions').every((e, i, a) => i === 0 || e.stats!.calls > a[i - 1]!.stats!.calls);

type Item = { verdict: string; surfaceId: string; costUsd?: number; reason: string };
type Statement = { dueBy: string; totalUsd: number; items: Item[] };

async function scenario(planFile: string) {
  const unitId = `try-${planFile.split('.')[0]}-${Date.now().toString(36)}`;
  console.log(`\n\x1b[1m▶ ${planFile}\x1b[0m  (unit ${unitId})`);
  const u = await post('/units', { plan: file(planFile), unitId });
  const plan = u.body.plan as { rooms: { name: string }[]; surfaces: { id: string }[] };
  ok(u.status === 201, `plan parsed: ${plan.rooms.map((r) => r.name).join(', ')} · ${plan.surfaces.length} surfaces`);

  const b = await post(`/units/${unitId}/walkthroughs`, { video: file('baseline.mp4'), kind: 'baseline' });
  ok(b.status === 202, `baseline accepted (job ${String(b.body.jobId)})`);
  const bev = await follow(String(b.body.jobId));
  ok(bev.at(-1)?.type === 'done', 'baseline job finished');

  const m = await post(`/units/${unitId}/walkthroughs`, { video: file('moveout.mov'), kind: 'move-out', capturedAt: '2026-11-21' });
  const mev = await follow(String(m.body.jobId));
  const s = lastStats(mev);
  ok(mev.at(-1)?.type === 'done', 'move-out job finished');
  ok(growing(mev), `Decisions counter only grows: ${s?.calls} calls, ${s?.questions} questions, avg ${s?.avgLatencyMs} ms`);

  const st = (await get(`/units/${unitId}/statement`)).body as Statement;
  for (const it of st.items) console.log(`     ${(it.costUsd ?? 0) > 0 ? '\x1b[31m' : '\x1b[90m'}${it.verdict.padEnd(13)} ${it.surfaceId.padEnd(22)} $${(it.costUsd ?? 0).toFixed(2).padStart(7)}\x1b[0m  ${it.reason.slice(0, 58)}`);
  const sum = st.items.reduce((a, it) => a + Math.round((it.costUsd ?? 0) * 100), 0) / 100;
  ok(st.totalUsd === sum, `total $${st.totalUsd} = sum of lines`);
  ok(st.items.every((it) => it.verdict === 'new-damage' || !it.costUsd), 'only new damage is charged');
  ok(st.items.filter((it) => it.reason.startsWith('Not provable')).every((it) => !it.costUsd), 'not-provable lines are $0');
  ok(st.dueBy === '2026-12-05', `send by ${st.dueBy}`);
  console.log(`   📄 ${API}/units/${unitId}/statement.html`);
}

async function errors() {
  console.log('\n\x1b[1m▶ things that must be refused\x1b[0m');
  const id = `try-err-${Date.now().toString(36)}`;
  ok((await post('/units', { plan: file('notes.txt'), unitId: id })).status === 400, 'a .txt plan → 400');
  ok((await post('/units', { plan: file('p.png'), unitId: '../hack' })).status === 400, 'unit id "../hack" → 400');
  await post('/units', { plan: file('p.png'), unitId: id });
  ok((await post('/units', { plan: file('p.png'), unitId: id })).status === 409, 'same unit id twice → 409');
  ok((await post(`/units/${id}/walkthroughs`, { video: file('v.mp4'), kind: 'move-out' })).status === 409, 'move-out before baseline → 409');
  ok((await post(`/units/${id}/walkthroughs`, { video: file('v.avi'), kind: 'baseline' })).status === 400, 'an .avi video → 400');
  ok((await post(`/units/${id}/walkthroughs`, { video: file('v.mp4'), kind: 'checkout' })).status === 400, 'kind "checkout" → 400');
  ok((await get(`/units/${id}/statement`)).status === 404, 'statement before move-out → 404');
  ok((await get('/jobs/nope/events')).status === 404, 'unknown job → 404');
}

const health = await get('/health').catch(() => null);
if (!health || health.status !== 200) {
  console.error(`API not reachable at ${API}. Start it first: pnpm --filter @ledger/api dev`);
  process.exit(1);
}
console.log(`API ${API} · ${JSON.stringify(health.body)}`);
for (const plan of process.argv.slice(2).length ? process.argv.slice(2) : ['demo-table.png', 'studio-l.png', 'one-bed-railroad.pdf']) await scenario(plan);
await errors();
console.log(failures ? `\n\x1b[31m${failures} check(s) failed\x1b[0m` : '\n\x1b[32mAll checks passed\x1b[0m');
process.exit(failures ? 1 : 0);
