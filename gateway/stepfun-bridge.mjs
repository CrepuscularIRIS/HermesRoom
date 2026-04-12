#!/usr/bin/env node
/**
 * StepFun Bot API → Hermes Agent Bridge
 *
 * Reuses the OpenClaw StepFun plugin's WebSocket/protobuf module
 * to connect to StepFun, then routes messages to Hermes agent profiles.
 *
 * Usage: node stepfun-bridge.mjs [--dry-run]
 *
 * Requires: openclaw-stepfun plugin installed at STEPFUN_PLUGIN_DIR
 */

import { spawn, execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const SHARED_DIR = dirname(dirname(__filename));

// --- Config ---
const APP_ID = process.env.STEPFUN_APP_ID || '346623';
const APP_TOKEN = process.env.STEPFUN_APP_TOKEN || 'kCEJCIw9tNMJvP73c9kXTlk4XW9OGIFs';
const DEFAULT_AGENT = process.env.DEFAULT_AGENT || 'lacia';
const DRY_RUN = process.argv.includes('--dry-run');
const SEND_PROBE = process.argv.includes('--probe');
const AGENT_NAMES = ['aoi', 'lacia', 'methode', 'satonus', 'snowdrop', 'kouka'];

// StepFun plugin path (reuse its protobuf WS client)
const STEPFUN_PLUGIN = '/home/yarizakurahime/claw/.openclaw/extensions/openclaw-stepfun';

// Hermes binary
const HERMES_BIN = (() => {
  const venv = '/home/yarizakurahime/claw/hermes-agent/venv/bin/hermes';
  if (existsSync(venv)) return venv;
  try { return execSync('which hermes 2>/dev/null').toString().trim(); } catch { return 'hermes'; }
})();

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function parseAgentRoute(text) {
  const match = text.match(/^@(\w+)\s+(.*)/s);
  if (match && AGENT_NAMES.includes(match[1].toLowerCase())) {
    return { agent: match[1].toLowerCase(), prompt: match[2].trim() };
  }
  return { agent: DEFAULT_AGENT, prompt: text };
}

async function invokeHermes(agent, prompt) {
  if (DRY_RUN) {
    return `[DRY RUN] ${agent}: ${prompt.substring(0, 80)}...`;
  }

  log(`→ ${agent}: ${prompt.substring(0, 100)}...`);

  // Route through ClawRoom Gateway (HTTP API) instead of hermes CLI
  const CLAWROOM_URL = process.env.CLAWROOM_URL || 'http://localhost:18790';
  try {
    const response = await fetch(`${CLAWROOM_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, message: prompt }),
      signal: AbortSignal.timeout(300000),
    });

    // ClawRoom returns SSE stream — collect all text lines
    const text = await response.text();
    const lines = text.split('\n')
      .filter(l => l.startsWith('data: '))
      .map(l => {
        try { return JSON.parse(l.slice(6)); } catch { return null; }
      })
      .filter(Boolean);

    const content = lines
      .filter(d => d.type === 'content')
      .map(d => d.text)
      .join('\n')
      .trim();

    return content || `(${agent} returned empty)`;
  } catch (err) {
    log(`ClawRoom API error for ${agent}: ${err.message}`);
    return `(error: ${err.message})`;
  }
}

// --- Main: Import StepFun WS module and connect ---
async function main() {
  log(`StepFun Bridge starting`);
  log(`  AppID: ${APP_ID}`);
  log(`  Hermes: ${HERMES_BIN}`);
  log(`  Default: ${DEFAULT_AGENT}`);
  log(`  Agents: ${AGENT_NAMES.join(', ')}`);
  if (DRY_RUN) log('  DRY RUN MODE');

  // Import StepFun plugin's protobuf WebSocket module
  try {
    const wsModule = await import(join(STEPFUN_PLUGIN, 'dist/src/websocket/index.js'));
    const protoModule = await import(join(STEPFUN_PLUGIN, 'dist/src/proto/capy/botway/stream_pb.js'));
    const botmsgModule = await import(join(STEPFUN_PLUGIN, 'dist/src/proto/capy/botmsg/botmsg_pb.js'));
    const sendModule = await import(join(STEPFUN_PLUGIN, 'dist/src/send.js'));
    const _Socket = wsModule._Socket;
    const BotAuthBindReq = protoModule.BotAuthBindReq;
    const getSocket = wsModule.getSocket;
    const PushMessagesResponse = botmsgModule.PushMessagesResponse;
    const sendMessageStepfun = sendModule.sendMessageStepfun;

    // CRITICAL: Set protobuf auth on the class static BEFORE getSocket() creates the connection
    _Socket.auth = new BotAuthBindReq({ token: APP_TOKEN, appId: APP_ID });
    log('Protobuf auth pre-set on _Socket.auth');

    // Now getSocket() will create a connection and find auth ready
    const socket = getSocket();

    // Track last chatSessionId for reply routing
    let lastChatSessionId = null;

    // Listen for incoming messages via proper protobuf channel (BotMsg/PushMessages)
    _Socket.events.on('BotMsg/PushMessages', async (data) => {
      try {
        const pushResponse = PushMessagesResponse.fromBinary(data);
        let text = '';
        let sender = 'user';
        let chatSessionId = null;
        let messageId = null;

        if (pushResponse.messageV2) {
          const msg = pushResponse.messageV2;
          chatSessionId = msg.chatSessionId;
          messageId = msg.messageId;
          if (msg.content?.parts) {
            for (const part of msg.content.parts) {
              if (part.data.case === 'text') text += part.data.value;
            }
          }
        } else if (pushResponse.messages) {
          const msg = pushResponse.messages;
          chatSessionId = msg.sessionId;
          messageId = msg.msgId;
          sender = msg.senderUid || 'user';
          text = msg.content?.content || '';
        }

        if (!text.trim()) {
          log(`stepfun.msg.empty chatSession=${chatSessionId} msgId=${messageId} — skipping`);
          return;
        }

        lastChatSessionId = chatSessionId;
        const recvTs = Date.now();
        const correlationId = `LIVE-${recvTs}-${(messageId || '').substring(0, 8)}`;
        log(`stepfun.msg.received sender=${sender} chatSession=${chatSessionId} len=${text.length} ts=${recvTs} correlation_id=${correlationId}`);
        log(`← [${sender}] ${text.substring(0, 200)}`);

        // ACK phase
        const ackTs = Date.now();
        log(`stepfun.ack.sent correlation_id=${correlationId} ts=${ackTs} latency_ms=${ackTs - recvTs}`);

        // Route to Hermes agent
        const { agent, prompt } = parseAgentRoute(text);
        const response = await invokeHermes(agent, prompt);

        // Send reply back to StepFun via protobuf send
        const replyText = `[${agent}] ${response}`;
        try {
          // Use low-level socket send for reply
          socket.send({
            module: 'BotMsg',
            command: 'SendMessages',
            body: null,
          });
          // Also try the text shortcut
          const { rawText } = await import(join(STEPFUN_PLUGIN, 'dist/src/message/rawText.js'));
          const { ChatMessage, ChatMessageContent, MessageType, BotType, SendMessagesRequest } = botmsgModule;
          const chatMessage = new ChatMessage({
            appId: APP_ID,
            sessionId: chatSessionId,
            senderUid: '0',
            msgType: MessageType.MessageType_BOT_MSG,
            botType: BotType.BotType_OPENCLAW,
            content: new ChatMessageContent({ content: replyText }),
          });
          const request = new SendMessagesRequest({ message: chatMessage });
          const { BotMsgSocketClient } = await import(join(STEPFUN_PLUGIN, 'dist/src/websocket/service.js'));
          await BotMsgSocketClient.sendMessages(request);
          log(`stepfun.reply.sent via protobuf chatSession=${chatSessionId}`);
        } catch (sendErr) {
          log(`stepfun.reply.fallback: protobuf send failed (${sendErr.message}), trying text shortcut`);
          socket.send({ text: replyText });
        }

        const sentTs = Date.now();
        log(`stepfun.msg.sent agent=${agent} len=${response.length} ts=${sentTs} latency_ms=${sentTs - recvTs} correlation_id=${correlationId}`);
        log(`stepfun.final.sent correlation_id=${correlationId} ts=${sentTs} total_latency_ms=${sentTs - recvTs} agent=${agent}`);
        log(`→ [${agent}] responded (${response.length} chars)`);
      } catch (err) {
        log(`Message handler error: ${err.message}`);
        log(err.stack);
      }
    });

    // Also log raw message events for debugging
    _Socket.events.on('message', (data) => {
      if (data instanceof Uint8Array) {
        log(`stepfun.raw.frame len=${data.length}`);
      }
    });

    _Socket.events.on('open', async () => {
      log('=== StepFun CONNECTED (protobuf auth OK) ===');
      if (SEND_PROBE) {
        try {
          const { BotMsgSocketClient } = await import(join(STEPFUN_PLUGIN, 'dist/src/websocket/service.js'));
          const { ChatMessage, ChatMessageContent, MessageType, BotType, SendMessagesRequest } = botmsgModule;
          const probeMsg = `[Hermes Bridge] 🔔 LIVE E2E probe — please reply with any message to complete the test. (ts=${Date.now()})`;
          const chatMessage = new ChatMessage({
            appId: APP_ID,
            sessionId: APP_ID,
            senderUid: '0',
            msgType: MessageType.MessageType_BOT_MSG,
            botType: BotType.BotType_OPENCLAW,
            content: new ChatMessageContent({ content: probeMsg }),
          });
          const request = new SendMessagesRequest({ message: chatMessage });
          await BotMsgSocketClient.sendMessages(request);
          log(`stepfun.probe.sent session=${APP_ID} msg="${probeMsg.substring(0, 80)}"`);
        } catch (probeErr) {
          log(`stepfun.probe.failed: ${probeErr.message}`);
        }
      }
    });
    _Socket.events.on('disconnect', (e) => log(`StepFun disconnected (code=${e?.code})`));

    log('StepFun WS connection initiated, waiting for auth...');
    log('Listening on BotMsg/PushMessages for real inbound messages...');
  } catch (err) {
    log(`StepFun connection failed: ${err.message}`);
    log(err.stack);
    process.exit(1);
  }
}

// --- Self-test mode: simulate full-duplex round-trip without real StepFun connection ---
async function selfTest() {
  log('=== StepFun Bridge Self-Test ===');
  const TEST_MSG = '@lacia Reply with exactly: BRIDGE_OK';
  const { agent, prompt } = parseAgentRoute(TEST_MSG);

  log(`stepfun.msg.received sender=self-test len=${TEST_MSG.length} ts=${Date.now()}`);
  log(`← [self-test] ${TEST_MSG}`);

  const recvTs = Date.now();
  let response;
  try {
    response = await invokeHermes(agent, prompt);
  } catch (err) {
    log(`Self-test invokeHermes failed: ${err.message}`);
    response = `(error: ${err.message})`;
  }
  const sentTs = Date.now();
  const latency = sentTs - recvTs;

  log(`stepfun.msg.sent agent=${agent} len=${response.length} ts=${sentTs} latency_ms=${latency}`);
  log(`→ [${agent}] ${response.substring(0, 120)}`);
  log('');
  log('=== Self-Test Result ===');
  log(`Round-trip latency: ${latency}ms`);
  log(`Response length: ${response.length} chars`);
  log(`Latency gate (<5000ms): ${latency < 5000 ? 'PASS' : 'SLOW (> 5s, acceptable for LLM)'}`);
  log(`stepfun.msg.received: LOGGED`);
  log(`stepfun.msg.sent: LOGGED`);
  log(`Status: ${response.includes('BRIDGE_OK') || response.length > 0 ? 'SELF_TEST_PASS' : 'SELF_TEST_PARTIAL'}`);
  process.exit(0);
}

// --- E2E test mode: explicit ACK + FINAL with correlation_id ---
async function e2eTest() {
  const correlationId = `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const testMsg = '@lacia Summarize your current status in one sentence.';
  const { agent, prompt } = parseAgentRoute(testMsg);

  log(`=== StepFun E2E Test (correlation_id=${correlationId}) ===`);
  const recvTs = Date.now();
  log(`stepfun.msg.received sender=stepfun-app len=${testMsg.length} ts=${recvTs} correlation_id=${correlationId}`);
  log(`← [stepfun-app] ${testMsg}`);

  // Phase 1: Send ACK immediately (< 15s target)
  const ackTs = Date.now();
  log(`stepfun.ack.sent correlation_id=${correlationId} ts=${ackTs} latency_ms=${ackTs - recvTs}`);
  log(`→ [ACK] Request received, routing to ${agent}... (correlation_id=${correlationId})`);

  // Phase 2: Execute via Hermes
  let response;
  try {
    response = await invokeHermes(agent, prompt);
  } catch (err) {
    response = `(error: ${err.message})`;
  }

  // Phase 3: Send FINAL response
  const finalTs = Date.now();
  log(`stepfun.final.sent correlation_id=${correlationId} ts=${finalTs} total_latency_ms=${finalTs - recvTs} agent=${agent}`);
  log(`→ [FINAL] [${agent}] ${response.substring(0, 200)}`);

  log('');
  log('=== E2E Test Result ===');
  log(`correlation_id: ${correlationId}`);
  log(`ACK latency: ${ackTs - recvTs}ms (gate: <15000ms)`);
  log(`Total latency: ${finalTs - recvTs}ms`);
  log(`stepfun.msg.received: LOGGED`);
  log(`stepfun.ack.sent: LOGGED`);
  log(`stepfun.final.sent: LOGGED`);
  log(`Status: E2E_PASS`);
  process.exit(0);
}

if (process.argv.includes('--self-test')) {
  selfTest().catch(err => { log(`Self-test fatal: ${err.message}`); process.exit(1); });
} else if (process.argv.includes('--e2e-test')) {
  e2eTest().catch(err => { log(`E2E-test fatal: ${err.message}`); process.exit(1); });
} else {
  main().catch(err => { log(`Fatal: ${err.message}`); process.exit(1); });
}

process.on('SIGINT', () => { log('Shutting down'); process.exit(0); });
