#!/usr/bin/env node
// Codex falso para os testes: fala o protocolo do `codex app-server`
// (JSON-RPC por linha) e anota tudo o que recebe em $CODEX_FALSO_LOG.
const fs = require('fs');
const readline = require('readline');
const log = (o) => fs.appendFileSync(process.env.CODEX_FALSO_LOG, JSON.stringify(o) + '\n');
const sai = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const nota = (method, params) => sai({ method, params });
log({ args: process.argv.slice(2) });

let esperandoResposta = null;
readline.createInterface({ input: process.stdin }).on('line', (l) => {
  const d = JSON.parse(l);
  log(d);
  if (d.id != null && !d.method) { if (esperandoResposta && d.id === 99) { const f = esperandoResposta; esperandoResposta = null; f(); } return; }
  const ok = (result) => sai({ id: d.id, result });
  switch (d.method) {
    case 'initialize': return ok({ userAgent: 'falso' });
    case 'initialized': return undefined;
    case 'thread/start': return ok({ thread: { id: 'th-novo', turns: [] }, model: 'gpt-falso', cwd: '/casa', reasoningEffort: 'medium' });
    case 'thread/resume':
      if (d.params.threadId !== 'th-velho') return sai({ id: d.id, error: { code: -32600, message: 'thread not found' } });
      return ok({ thread: { id: 'th-velho', turns: [{ startedAt: 1700000000, items: [
        { type: 'userMessage', id: 'u0', content: [{ type: 'text', text: 'oi antigo' }] },
        { type: 'commandExecution', id: 'c0', command: "/bin/bash -lc 'ls'", commandActions: [{ type: 'listFiles', command: 'ls' }], status: 'completed', aggregatedOutput: 'a b', exitCode: 0 },
        { type: 'agentMessage', id: 'a0', text: 'resposta antiga' },
      ] }] }, model: 'gpt-falso', cwd: '/casa' });
    case 'turn/interrupt': return ok({});
    case 'turn/start': {
      ok({ turn: { id: 'tu1', status: 'inProgress' } });
      const t = { threadId: 'th', turnId: 'tu1' };
      nota('turn/started', { ...t, turn: { id: 'tu1' } });
      nota('item/started', { ...t, item: { type: 'agentMessage', id: 'm1', text: '' } });
      nota('item/agentMessage/delta', { ...t, itemId: 'm1', delta: 'Ol' });
      nota('item/completed', { ...t, item: { type: 'agentMessage', id: 'm1', text: 'Olá' } });
      const cmd = { type: 'commandExecution', id: 'c1', command: "/bin/bash -lc 'orq send x'", commandActions: [{ type: 'unknown', command: 'orq send x' }] };
      nota('item/started', { ...t, item: { ...cmd, status: 'inProgress' } });
      nota('item/completed', { ...t, item: { ...cmd, status: 'completed', aggregatedOutput: 'enviado', exitCode: 0 } });
      esperandoResposta = () => {
        nota('item/autoApprovalReview/completed', { ...t, review: { status: 'denied', riskLevel: 'high', rationale: 'apagaria arquivos' }, action: {} });
        nota('thread/tokenUsage/updated', { ...t, tokenUsage: { last: { inputTokens: 1234 }, total: {}, modelContextWindow: 200000 } });
        nota('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 3.4, windowDurationMins: 43200 }, secondary: null } });
        nota('turn/completed', { threadId: 'th', turn: { id: 'tu1', status: 'completed', durationMs: 5 } });
      };
      sai({ id: 99, method: 'item/tool/requestUserInput', params: { ...t, itemId: 'q', isBlocking: true, questions: [{ id: 'q1', header: 'Cor', question: 'Qual cor?', isOther: true, isSecret: false, options: [{ label: 'Azul', description: 'a' }, { label: 'Verde', description: 'v' }] }] } });
      return undefined;
    }
    default: return sai({ id: d.id, error: { code: -32601, message: 'desconhecido' } });
  }
});
