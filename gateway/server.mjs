#!/usr/bin/env node
/**
 * ClawRoom v2.1 — Thin HTTP adapter for Hermes Agent + ClaudeCode
 *
 * Agent chat: Direct StepFun API call (step-3.5-flash) with SOUL.md as system prompt
 * Pipeline control: tmux-based launcher for /github-hunt and /blog-maintenance
 * Mailbox: Read/write Hermes inter-agent mailbox
 */

import express from 'express';
import cors from 'cors';
import { spawn, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import https from 'node:https';

const app = express();
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '18790');
const HOME = homedir();
const SHARED = join(HOME, '.hermes/shared');
const PIPELINES = join(SHARED, 'pipelines');
const MAIL_BIN = join(SHARED, 'scripts/mail.mjs');
const PROFILES = join(HOME, '.hermes/profiles');

// StepFun API config (for 5 MainAgents: lacia, methode, satonus, snowdrop, kouka)
const STEPFUN_API_KEY = process.env.STEPFUN_API_KEY || (() => {
  try {
    const env = readFileSync(join(HOME, '.hermes/.env'), 'utf-8');
    const match = env.match(/STEPFUN_API_KEY=(.+)/);
    return match ? match[1].trim() : '';
  } catch { return ''; }
})();
const STEPFUN_BASE = 'https://api.stepfun.com';
const STEPFUN_MODEL = 'step-3.5-flash';

// Load SOUL.md for each agent as system prompt
function loadSoul(agent) {
  const path = join(PROFILES, agent, 'SOUL.md');
  try { return readFileSync(path, 'utf-8'); } catch { return `You are ${agent}.`; }
}
const SOUL_CACHE = {};
const getSoul = (agent) => {
  if (!SOUL_CACHE[agent]) SOUL_CACHE[agent] = loadSoul(agent);
  return SOUL_CACHE[agent];
};

const AGENTS = [
  { id: 'aoi', name: 'Aoi', role: 'Dispatcher', model: 'MiniMax M2.7' },
  { id: 'lacia', name: 'Lacia', role: 'Strategy', model: 'Step 3.5 Flash' },
  { id: 'methode', name: 'Methode', role: 'Execution', model: 'Step 3.5 Flash' },
  { id: 'satonus', name: 'Satonus', role: 'Review', model: 'Step 3.5 Flash' },
  { id: 'snowdrop', name: 'Snowdrop', role: 'Research', model: 'Step 3.5 Flash' },
  { id: 'kouka', name: 'Kouka', role: 'Delivery', model: 'Step 3.5 Flash' },
];

app.use(cors());
app.use(express.json());

// --- Health ---
app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// --- Agents ---
app.get('/api/agents', (_, res) => res.json(AGENTS));

// --- Chat (SSE streaming via direct StepFun API) ---
app.post('/api/chat', async (req, res) => {
  const { agent = 'lacia', message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const soul = getSoul(agent);
  console.log(`[chat/${agent}] StepFun API call, msg="${message.substring(0, 60)}..."`);

  try {
    const apiRes = await fetch('https://api.stepfun.com/step_plan/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STEPFUN_API_KEY}`,
      },
      body: JSON.stringify({
        model: STEPFUN_MODEL,
        messages: [
          { role: 'system', content: soul },
          { role: 'user', content: message },
        ],
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const data = await apiRes.json();
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || '(no response)';
    console.log(`[chat/${agent}] response: ${content.substring(0, 100)}...`);

    // Send as SSE lines
    for (const line of content.split('\n')) {
      res.write(`data: ${JSON.stringify({ type: 'content', text: line })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done', exit_code: 0 })}\n\n`);
    res.end();
  } catch (err) {
    console.error(`[chat/${agent}] API error:`, err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// --- Pipeline Run ---
app.post('/api/pipeline/run', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const runScript = join(PIPELINES, name, 'test-run.sh');
  if (!existsSync(runScript)) return res.status(404).json({ error: `pipeline ${name} not found` });
  try { execSync(`tmux has-session -t ${name} 2>/dev/null`); return res.json({ status: 'already_running', name }); } catch {}
  try { execSync(`bash ${runScript}`, { timeout: 10000 }); res.json({ status: 'launched', name }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Pipeline Status ---
app.get('/api/pipeline/:name/status', (req, res) => {
  const stateFile = join(PIPELINES, req.params.name, 'state.json');
  if (!existsSync(stateFile)) return res.status(404).json({ error: 'pipeline not found' });
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    let running = false;
    try { execSync(`tmux has-session -t ${req.params.name} 2>/dev/null`); running = true; } catch {}
    res.json({ ...state, running });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- List pipelines ---
app.get('/api/pipelines', (_, res) => {
  const names = ['github-hunt', 'blog-maintenance'];
  const pipelines = names.map((name) => {
    const stateFile = join(PIPELINES, name, 'state.json');
    let state = { status: 'UNKNOWN' };
    try { state = JSON.parse(readFileSync(stateFile, 'utf-8')); } catch {}
    let running = false;
    try { execSync(`tmux has-session -t ${name} 2>/dev/null`); running = true; } catch {}
    return { name, ...state, running };
  });
  res.json(pipelines);
});

// --- Mailbox ---
app.get('/api/mailbox/:agent', (req, res) => {
  try {
    const output = execSync(`node ${MAIL_BIN} read --agent ${req.params.agent} --limit ${req.query.limit || '20'}`, { timeout: 5000, encoding: 'utf-8' });
    res.json({ agent: req.params.agent, messages: JSON.parse(output || '[]') });
  } catch (err) { res.json({ agent: req.params.agent, messages: [], error: err.message }); }
});

app.post('/api/mailbox/send', (req, res) => {
  const { from, to, type, subject, body } = req.body;
  if (!from || !to || !type || !subject) return res.status(400).json({ error: 'from, to, type, subject required' });
  try {
    const output = execSync(`node ${MAIL_BIN} send --from ${from} --to ${to} --type ${type} --subject "${subject}" --body '${JSON.stringify(body || '')}'`, { timeout: 5000, encoding: 'utf-8' });
    res.json(JSON.parse(output));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`ClawRoom v2.1 listening on http://localhost:${PORT}`);
  console.log(`  StepFun API: ${STEPFUN_API_KEY ? 'configured' : 'MISSING'}`);
  console.log(`  Agents: ${AGENTS.map(a => a.id).join(', ')}`);
  console.log(`  Pipelines: github-hunt, blog-maintenance`);
});
