#!/usr/bin/env node
// Codex falso para os testes: fala o protocolo do `codex app-server`
// (JSON-RPC por linha) e anota tudo o que recebe em $CODEX_FALSO_LOG.
const fs = require('fs');
const readline = require('readline');
const log = (o) => fs.appendFileSync(process.env.CODEX_FALSO_LOG, JSON.stringify(o) + '\n');
const sai = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const nota = (method, params) => sai({ method, params });
log({ args: process.argv.slice(2) });
// $CODEX_FALSO_SAI: escreve o texto no stderr e sai com código 1 antes de
// responder qualquer coisa (o Codex que cai ao retomar).
if (process.env.CODEX_FALSO_SAI) { process.stderr.write(process.env.CODEX_FALSO_SAI + '\n'); process.exit(1); }
// $CODEX_FALSO_RECUSA: com um turno ativo, recusa o turn/steer e o turn/start.
const RECUSA = !!process.env.CODEX_FALSO_RECUSA;
// $CODEX_FALSO_RECUSA_POLITICA: o thread/start e o thread/resume respondem erro com este
// texto (uma organização que limita as políticas do Codex; o binário do 0.167.1 traz
// allowed_approval_policies e a frase "is not in the allowed set").
const RECUSA_POLITICA = process.env.CODEX_FALSO_RECUSA_POLITICA || '';
// O initialize trouxe capabilities.experimentalApi? Como no Codex de verdade
// (conferido no 0.167.1), os métodos experimentais só atendem a quem declarou.
let experimental = false;
const semCapacidade = (d) => sai({ id: d.id, error: { code: -32600, message: `${d.method} requires experimentalApi capability` } });
// $CODEX_FALSO_PEDE_HORA: depois de abrir a conversa, pede a hora ao app
// (currentTime/read, pedido que o Codex só faz a quem declarou a capacidade).
const pedirHora = (threadId) => { if (experimental && process.env.CODEX_FALSO_PEDE_HORA) sai({ id: 77, method: 'currentTime/read', params: { threadId } }); };

let esperandoResposta = null;
let idDoPedido = 99; // o pedido que o turno mandou ao app (99, como sempre; os pedidos escolhidos pelo texto contam de 200)
let pedidosPeloTexto = 199;
let turnoAtivo = null; // turno começado e ainda não terminado (segurado pela pergunta)
readline.createInterface({ input: process.stdin }).on('line', (l) => {
  const d = JSON.parse(l);
  log(d);
  if (d.id != null && !d.method) { if (esperandoResposta && d.id === idDoPedido) { const f = esperandoResposta; esperandoResposta = null; f(); } return; }
  const ok = (result) => sai({ id: d.id, result });
  switch (d.method) {
    case 'initialize': experimental = !!(d.params && d.params.capabilities && d.params.capabilities.experimentalApi); return ok({ userAgent: 'falso' });
    case 'initialized': return undefined;
    case 'thread/start':
      if (RECUSA_POLITICA) return sai({ id: d.id, error: { code: -32600, message: RECUSA_POLITICA } });
      ok({ thread: { id: 'th-novo', turns: [] }, model: 'gpt-falso', cwd: '/casa', reasoningEffort: 'medium' }); return pedirHora('th-novo');
    case 'thread/resume':
      if (d.params.threadId !== 'th-velho') return sai({ id: d.id, error: { code: -32600, message: 'thread not found' } });
      ok({ thread: { id: 'th-velho', turns: [{ startedAt: 1700000000, items: [
        { type: 'userMessage', id: 'u0', content: [{ type: 'text', text: 'oi antigo' }] },
        { type: 'commandExecution', id: 'c0', command: "/bin/bash -lc 'ls'", commandActions: [{ type: 'listFiles', command: 'ls' }], status: 'completed', aggregatedOutput: 'a b', exitCode: 0 },
        { type: 'agentMessage', id: 'a0', text: 'resposta antiga' },
      ] }] }, model: 'gpt-falso', cwd: '/casa' });
      return pedirHora('th-velho');
    case 'turn/interrupt': return ok({});
    // Comando do usuário ("!"), como no Codex de verdade (conferido no 0.167.1): responde {}
    // e abre um turno próprio com um commandExecution de source "userShell", sem chamar o modelo.
    case 'thread/shellCommand': {
      ok({});
      const cmd = String(d.params.command || '');
      const item = { type: 'commandExecution', id: 'sh1', command: `/bin/bash -lc '${cmd}'`, cwd: '/casa', source: 'userShell', status: 'inProgress', commandActions: [{ type: 'unknown', command: cmd }], aggregatedOutput: null, exitCode: null };
      const falha = /exit 2/.test(cmd);
      nota('turn/started', { threadId: d.params.threadId, turn: { id: 'tu-sh', status: 'inProgress' } });
      nota('item/started', { item });
      nota('item/commandExecution/outputDelta', { threadId: d.params.threadId, turnId: 'tu-sh', itemId: 'sh1', delta: `saída falsa de: ${cmd}\n` });
      nota('item/completed', { item: { ...item, status: falha ? 'failed' : 'completed', aggregatedOutput: `saída falsa de: ${cmd}\n`, exitCode: falha ? 2 : 0 } });
      nota('turn/completed', { threadId: d.params.threadId, turn: { id: 'tu-sh', status: 'completed', durationMs: 5 } });
      return undefined;
    }
    // Métodos dos comandos do "/" que o app faz numa conversa Codex.
    case 'thread/compact/start': return ok({});
    case 'review/start': return ok({ turn: { id: 'tu-rev', status: 'inProgress' }, reviewThreadId: d.params.threadId });
    case 'thread/name/set': return ok({});
    case 'thread/archive': return ok({});
    case 'thread/fork': return ok({ thread: { id: 'th-velho', turns: [] }, model: 'gpt-falso', cwd: '/casa' });
    case 'thread/list': return ok({ data: [{ id: 'th-velho', preview: 'oi antigo', updatedAt: 1700000000 }], nextCursor: null });
    case 'account/rateLimits/read': return ok({ rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300 }, secondary: { usedPercent: 40, windowDurationMins: 10080 } } });
    case 'mcpServerStatus/list': return ok({ data: [{ name: 'falso-mcp', status: 'ready' }], nextCursor: null });
    case 'skills/list': return ok({ data: [{ cwd: '/casa', skills: [{ name: 'rodada-x' }] }] });
    case 'hooks/list': return ok({ data: [] });
    case 'config/read': return ok({ config: { model: 'gpt-falso' } });
    case 'thread/backgroundTerminals/list':
      if (!experimental) return semCapacidade(d);
      return ok({ data: [{ itemId: 'it1', processId: 'p1', command: 'npm run dev', cwd: '/casa', osPid: 4242, cpuPercent: 0.5, rssKb: 1024 }], nextCursor: null });
    case 'thread/backgroundTerminals/clean': return experimental ? ok({}) : semCapacidade(d);
    case 'turn/steer':
      if (RECUSA || !turnoAtivo || d.params.expectedTurnId !== turnoAtivo) return sai({ id: d.id, error: { code: -32600, message: 'no active turn to steer' } });
      return ok({ turnId: turnoAtivo });
    case 'turn/start': {
      if (RECUSA && turnoAtivo) return sai({ id: d.id, error: { code: -32600, message: 'turn already in progress' } });
      turnoAtivo = 'tu1';
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
        turnoAtivo = null;
        nota('turn/completed', { threadId: 'th', turn: { id: 'tu1', status: 'completed', durationMs: 5 } });
      };
      // Em vez da pergunta, o turno manda um pedido de aprovação (formas do esquema do 0.167.1):
      // comando, comando-sem-comeco, comando-docker, comando-aberto, arquivo, acesso, acesso-torto,
      // mcp, mcp-url. Escolhido por $CODEX_FALSO_PEDIDO ou pelo texto da mensagem ("pedido:nome";
      // assim um mesmo app pede vários, cada um com o seu número de pedido).
      const PEDIDOS = {
        'comando-sem-comeco': ['item/commandExecution/requestApproval', { itemId: 'c9', startedAtMs: 1, command: "/bin/bash -lc 'ls -la relatorios'", commandActions: [{ type: 'unknown', command: 'ls -la relatorios' }] }],
        'comando-aberto': ['item/commandExecution/requestApproval', { itemId: 'c9', startedAtMs: 1, command: "/bin/bash -lc 'make relatorio'", commandActions: [{ type: 'unknown', command: 'make relatorio' }], proposedExecpolicyAmendment: ['bash'] }],
        'acesso-torto': ['item/permissions/requestApproval', { itemId: 'p9', startedAtMs: 1, cwd: '/casa', reason: 'preciso de mais', permissions: { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: '/casa/site/dist' } }, { access: 'executar', path: { type: 'path', path: '/usr/bin' } }] } } }],
        comando: ['item/commandExecution/requestApproval', { itemId: 'c9', startedAtMs: 1, command: "/bin/bash -lc 'git commit -m ajuste'", commandActions: [{ type: 'unknown', command: 'git commit -m ajuste' }], reason: 'risco médio: grava no histórico do repositório', proposedExecpolicyAmendment: ['git', 'commit'] }],
        'comando-docker': ['item/commandExecution/requestApproval', { itemId: 'c9', startedAtMs: 1, command: "/bin/bash -lc 'docker compose restart web'", commandActions: [{ type: 'unknown', command: 'docker compose restart web' }], reason: 'risco alto', proposedExecpolicyAmendment: ['docker', 'compose'] }],
        arquivo: ['item/fileChange/requestApproval', { itemId: 'f9', startedAtMs: 1, grantRoot: '/casa/projeto', reason: 'alterar 2 arquivos' }],
        acesso: ['item/permissions/requestApproval', { itemId: 'p9', startedAtMs: 1, cwd: '/casa', reason: 'copiar o resultado e baixar uma dependência', permissions: { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: '/projetos/site/dist' } }, { access: 'read', path: { type: 'path', path: '/casa/docs' } }] }, network: { enabled: true } } }],
        mcp: ['mcpServer/elicitation/request', { serverName: 'cofre-da-equipe', message: 'Informe o código para liberar a consulta.', mode: 'form', requestedSchema: { type: 'object', required: ['codigo'], properties: { codigo: { type: 'string', title: 'Código de verificação', minLength: 6, maxLength: 6 } } } }],
        'mcp-url': ['mcpServer/elicitation/request', { serverName: 'agenda', message: 'Entre na sua conta.', mode: 'url', elicitationId: 'e1', url: 'https://contas.exemplo.com/autorizar?cliente=agenda' }],
      };
      const peloTexto = (/pedido:([\w-]+)/.exec(JSON.stringify((d.params || {}).input || '')) || [])[1];
      const qual = process.env.CODEX_FALSO_PEDIDO || peloTexto;
      idDoPedido = 99;
      if (qual && PEDIDOS[qual]) {
        const [metodo, params] = PEDIDOS[qual];
        if (peloTexto && !process.env.CODEX_FALSO_PEDIDO) idDoPedido = ++pedidosPeloTexto;
        sai({ id: idDoPedido, method: metodo, params: { ...t, ...params } });
        return undefined;
      }
      // CODEX_FALSO_PERGUNTAS (JSON): troca as perguntas do pedido (ex.: uma com isSecret).
      const perguntas = process.env.CODEX_FALSO_PERGUNTAS ? JSON.parse(process.env.CODEX_FALSO_PERGUNTAS)
        : [{ id: 'q1', header: 'Cor', question: 'Qual cor?', isOther: true, isSecret: false, options: [{ label: 'Azul', description: 'a' }, { label: 'Verde', description: 'v' }] }];
      sai({ id: 99, method: 'item/tool/requestUserInput', params: { ...t, itemId: 'q', isBlocking: true, questions: perguntas } });
      return undefined;
    }
    default: return sai({ id: d.id, error: { code: -32601, message: 'desconhecido' } });
  }
});
