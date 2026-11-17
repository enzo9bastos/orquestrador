// Área: conversa
// O orquestrador conduzido pelo Codex (conversa-codex.js), com um Codex falso
// que fala o protocolo do `codex app-server`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria, escrever } = require('../ajuda');

const FALSO = path.join(__dirname, 'codex-falso.js');
const casa = casaTemporaria({ iasCaminhos: { codex: FALSO }, iaOrquestrador: 'codex' });
const LOG = path.join(casa, 'codex-falso.log');
process.env.CODEX_FALSO_LOG = LOG;
escrever(casa, '.codex/skills/orquestrar-app/SKILL.md', '---\nname: orquestrar-app\ndescription: Rodada pelo app\n---\nx');
const conversa = require('../../conversa');
const codex = require('../../conversa-codex');
const t = codex._t;

const recebidos = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const telas = [];
conversa.ligar((canal, dado) => telas.push({ canal, ...dado }));
const avisos = [];
conversa.ligarAvisos((a) => avisos.push(a));
async function ate(cond, ms = 8000) {
  for (let i = 0; i < ms / 20; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('não aconteceu a tempo');
}

test('codex: comando sem o invólucro do bash', () => {
  assert.strictEqual(t.comandoLimpo({ command: "/bin/bash -lc 'tmux ls | wc -l'" }), 'tmux ls | wc -l');
  assert.strictEqual(t.comandoLimpo({ command: "/bin/bash -lc 'echo '\\''a'\\'''" }), "echo 'a'");
  assert.strictEqual(t.comandoLimpo({ command: 'x', commandActions: [{ command: 'orq peek a' }] }), 'orq peek a');
});

test('codex: pergunta com opções vira o cartão do AskUserQuestion e a resposta volta pelo id', () => {
  const params = { questions: [{ id: 'q1', header: 'Cor', question: 'Qual cor?', options: [{ label: 'Azul', description: 'a' }] }, { id: 'q2', header: 'X', question: 'Outra?', options: null }] };
  const p = t.pedidoDaTela('item/tool/requestUserInput', params);
  assert.strictEqual(p.ferramenta, 'AskUserQuestion');
  // Desde a 0.A3 o cartão leva também o id, isSecret e isOther de cada pergunta.
  assert.deepStrictEqual(p.entrada.questions[0], { id: 'q1', question: 'Qual cor?', header: 'Cor', multiSelect: false, isSecret: false, isOther: false, options: [{ label: 'Azul', description: 'a' }] });
  assert.deepStrictEqual(t.respostaAoServidor('item/tool/requestUserInput', params, { permitir: true, respostas: { 'Qual cor?': 'Azul' } }),
    { answers: { q1: { answers: ['Azul'] }, q2: { answers: [] } } });
  assert.deepStrictEqual(t.respostaAoServidor('item/tool/requestUserInput', params, { permitir: false }), { answers: { q1: { answers: [] }, q2: { answers: [] } } });
});

test('codex: aprovação de comando vira "Permitir?" e a decisão vira accept/decline', () => {
  const p = t.pedidoDaTela('item/commandExecution/requestApproval', { command: "/bin/bash -lc 'docker ps'", reason: 'fora do sandbox' });
  // (Desde 17/11/2026 o cartão leva também o que pode ser oferecido; docker é da lista de recusa.)
  assert.deepStrictEqual(p, { ferramenta: 'Bash', entrada: { command: 'docker ps' }, motivo: 'fora do sandbox', codex: { tipo: 'comando', sessao: false, prefixo: null, recusa: 'docker, tmux ou ssh' } });
  assert.deepStrictEqual(t.respostaAoServidor('item/commandExecution/requestApproval', {}, { permitir: true }), { decision: 'accept' });
  assert.deepStrictEqual(t.respostaAoServidor('item/commandExecution/requestApproval', {}, { permitir: false }), { decision: 'decline' });
  assert.strictEqual(t.pedidoDaTela('item/tool/call', {}), null, 'pedido desconhecido não vira cartão');
});

test('codex: cota do plano: janela curta no "5 h", a longa com o tamanho dela', () => {
  assert.deepStrictEqual(t.cotaDaConta({ primary: { usedPercent: 12.4, windowDurationMins: 300 }, secondary: { usedPercent: 40, windowDurationMins: 10080 } }), { uso5h: 12, uso7d: 40, rotuloLongo: '7 dias' });
  assert.deepStrictEqual(t.cotaDaConta({ primary: { usedPercent: 2, windowDurationMins: 43200 }, secondary: null }), { uso7d: 2, rotuloLongo: '30 dias' });
});

test('codex: "/skill" vira entrada de skill quando ela existe; senão é texto', () => {
  const e = t.entradaDoTexto('/orquestrar-app');
  assert.deepStrictEqual(e[0], { type: 'skill', name: 'orquestrar-app', path: path.join(casa, '.codex', 'skills', 'orquestrar-app', 'SKILL.md') });
  assert.strictEqual(e[1].text, '/orquestrar-app');
  assert.deepStrictEqual(t.entradaDoTexto('/nao-existe oi'), [{ type: 'text', text: '/nao-existe oi', text_elements: [] }]);
  assert.strictEqual(t.entradaDoTexto('', [{ tipo: 'image/png', dados: 'QUJD' }])[0].url, 'data:image/png;base64,QUJD');
  assert.deepStrictEqual(codex.comandosDoCodex().map((c) => [c.nome, c.descricao]), [['orquestrar-app', 'Rodada pelo app']]);
});

test('codex: uma rodada inteira com o Codex falso', async (t2) => {
  const c = new conversa._Conversa({ id: 'cx', titulo: 'Orquestrador', orquestrador: true });
  t2.after(() => c.parar());
  assert.strictEqual(c.motor, 'claude', 'nasce como estava guardada');
  c.mandar('/orquestrar-app');
  assert.strictEqual(c.motor, 'codex', 'ao subir, segue a IA do orquestrador da configuração');
  await ate(() => c.pendentes.size === 1);

  // Sobe com a proteção escolhida e a pergunta ligada.
  const r = recebidos();
  assert.deepStrictEqual(r[0].args, ['app-server', '--enable', 'default_mode_request_user_input', '-c', 'suppress_unstable_features_warning=true']);
  const inicio = r.find((x) => x.method === 'thread/start').params;
  assert.deepStrictEqual([inicio.approvalPolicy, inicio.approvalsReviewer, inicio.sandbox], ['untrusted', 'auto_review', 'danger-full-access']);
  const turno = r.find((x) => x.method === 'turn/start').params;
  assert.strictEqual(turno.threadId, 'th-novo');
  assert.strictEqual(turno.input[0].type, 'skill', 'o comando inicial vai como skill do Codex');
  assert.strictEqual(c.sessao, 'th-novo');

  // Texto, comando e pergunta chegam à tela no formato do Claude.
  const ev = c.eventos;
  assert.ok(ev.some((e) => e.tipo === 'assistant' && e.message.content[0].text === 'Olá'));
  const uso = ev.find((e) => e.tipo === 'assistant' && e.message.content[0].type === 'tool_use').message.content[0];
  assert.deepStrictEqual([uso.name, uso.input.command], ['Bash', 'orq send x']);
  assert.ok(ev.some((e) => e.tipo === 'user' && e.message.content[0].type === 'tool_result' && e.message.content[0].content === 'enviado'));
  assert.ok(telas.some((x) => x.canal === 'conversa:parcial' && x.dado === 'Ol'));
  const pedido = [...c.pendentes.values()][0];
  assert.strictEqual(pedido.ferramenta, 'AskUserQuestion');
  assert.deepStrictEqual(avisos.at(-1).texto, 'Cor: Qual cor?');

  // A resposta do cartão volta ao Codex; o turno termina.
  c.responder(pedido.id, { permitir: true, respostas: { 'Qual cor?': 'Verde' } });
  await ate(() => c.eventos.some((e) => e.tipo === 'resultado'));
  assert.deepStrictEqual(recebidos().find((x) => x.id === 99 && !x.method).result, { answers: { q1: { answers: ['Verde'] } } });
  assert.match(c.eventos.find((e) => e.tipo === 'erro').texto, /revisor do Codex negou um comando \(risco high\): apagaria arquivos/);
  assert.deepStrictEqual([c.info.contexto, c.info.janela, c.info.uso7d, c.info.rotuloLongo, c.info.ocupado], [1234, 200000, 3, '30 dias', false]);
  assert.strictEqual(avisos.at(-1).tipo, 'resposta');
  assert.strictEqual(avisos.at(-1).texto, 'Olá');

  // Esforço vai no próximo turno ("Máximo" vira o maior do Codex); modelo não troca.
  assert.strictEqual(c.configurar({ modelo: 'opus' }), false);
  assert.strictEqual(c.configurar({ esforco: 'max' }), true);
  c.mandar('de novo');
  await ate(() => recebidos().filter((x) => x.method === 'turn/start').length === 2);
  assert.strictEqual(recebidos().filter((x) => x.method === 'turn/start')[1].params.effort, 'xhigh');
  assert.throws(() => c.voltar(0, 'de novo'), /ainda não funciona com o Codex/);
  c.parar();
});

test('codex: retomar traz o histórico; conversa sumida começa outra e guarda a velha', async () => {
  const velha = new conversa._Conversa({ id: 'cv', titulo: 'V', motor: 'codex', sessao: 'th-velho' });
  velha.iniciar();
  try {
    await ate(() => velha.eventos.length >= 4);
    const resumo = (c) => (typeof c === 'string' ? c : c[0].text || c[0].type);
    assert.deepStrictEqual(velha.eventos.map((e) => [e.tipo, e.antigo, resumo(e.message.content)]),
      [['user', true, 'oi antigo'], ['assistant', true, 'tool_use'], ['user', true, 'tool_result'], ['assistant', true, 'resposta antiga']]);
  } finally { velha.parar(); }

  const sumida = new conversa._Conversa({ id: 'cs', titulo: 'S', motor: 'codex', sessao: 'th-sumiu' });
  sumida.iniciar();
  try {
    await ate(() => sumida.sessao === 'th-novo');
    assert.deepStrictEqual(sumida.anteriores, ['th-sumiu']);
  } finally { sumida.parar(); }
});

test('codex: /ps e /stop funcionam: o app declara no initialize a capacidade que o Codex exige para os terminais em segundo plano', async () => {
  const c = new conversa._Conversa({ id: 'cp', titulo: 'P', motor: 'codex', sessao: 'th-velho' });
  c.iniciar();
  try {
    await ate(() => c.eventos.length >= 4);
    const lista = await c.codex('thread/backgroundTerminals/list', {});
    assert.deepStrictEqual(lista.data.map((x) => [x.command, x.cwd]), [['npm run dev', '/casa']]);
    assert.deepStrictEqual(await c.codex('thread/backgroundTerminals/clean', {}), {});
    const r = recebidos();
    assert.deepStrictEqual(r.filter((x) => x.method === 'initialize').at(-1).params.capabilities, { experimentalApi: true });
    assert.strictEqual(r.filter((x) => x.method === 'thread/backgroundTerminals/list').at(-1).params.threadId, 'th-velho');
    assert.strictEqual(r.filter((x) => x.method === 'thread/backgroundTerminals/clean').at(-1).params.threadId, 'th-velho');
  } finally { c.parar(); }
});

test('codex: o pedido de hora que o Codex faz a quem declara a capacidade é atendido (segundos inteiros)', async () => {
  process.env.CODEX_FALSO_PEDE_HORA = '1';
  const c = new conversa._Conversa({ id: 'ch', titulo: 'H', motor: 'codex', sessao: 'th-velho' });
  c.iniciar();
  try {
    await ate(() => recebidos().some((x) => x.id === 77 && !x.method));
    const r = recebidos().find((x) => x.id === 77 && !x.method);
    assert.ok(!r.error, `o app recusou o pedido de hora: ${JSON.stringify(r.error)}`);
    assert.ok(Number.isInteger(r.result.currentTimeAt), 'segundos inteiros');
    assert.ok(Math.abs(r.result.currentTimeAt - Date.now() / 1000) < 5, 'a hora de agora');
  } finally { delete process.env.CODEX_FALSO_PEDE_HORA; c.parar(); }
});

// Plano 4.2 (X9): o "!" no Codex vai por thread/shellCommand (o próprio Codex roda, na
// pasta da conversa, sem chamar o modelo). Só pelo caminho próprio; mandar() nunca usa.
test('codex: "!" roda por thread/shellCommand, vira o bloco "você rodou" e não conta como resposta do Codex', async () => {
  const c = new conversa._Conversa({ id: 'cxsh', titulo: 'X', motor: 'codex' });
  const antes = recebidos().length;
  try {
    const r = c.rodarShell('echo oi; exit 2');
    assert.ok(r.id);
    await ate(() => c.eventos.some((e) => e.tipo === 'shell' && e.estado === 'fim'));
    const ev = c.eventos.filter((e) => e.tipo === 'shell');
    assert.strictEqual(ev.length, 1);
    assert.deepStrictEqual([ev[0].comando, ev[0].saida, ev[0].codigo], ['echo oi; exit 2', 'saída falsa de: echo oi; exit 2\n', 2]);
    await ate(() => c.info.shell === false && !c.shellRodando);
    const meus = recebidos().slice(antes);
    const pedido = meus.find((x) => x.method === 'thread/shellCommand');
    assert.deepStrictEqual([pedido.params.command, pedido.params.timeoutMs > 0], ['echo oi; exit 2', true]);
    assert.ok(!meus.some((x) => x.method === 'turn/start'), 'o modelo não foi acionado');
    assert.ok(!c.eventos.some((e) => e.tipo === 'resultado'), 'não é uma resposta do Codex: sem aviso de "respondeu"');
    assert.ok(!c.eventos.some((e) => e.tipo === 'assistant' && JSON.stringify(e.message).includes('tool_use')), 'não aparece como "o Codex rodou"');
    assert.strictEqual(c.info.ocupado, false);
    // Pelo mandar, "!" é texto: vai ao modelo por turn/start, nunca por shellCommand.
    c.mandar('!echo por-texto');
    await ate(() => recebidos().slice(antes).some((x) => x.method === 'turn/start'));
    assert.strictEqual(recebidos().slice(antes).filter((x) => x.method === 'thread/shellCommand').length, 1);
  } finally { c.parar(); }
});

// Plano 8.2 e 8.3 (cartões do Codex, protótipo P2 aprovado em 17/11/2026): as respostas que o
// Codex aceita (formas do esquema do 0.167.1). "Nesta conversa" e "sempre por prefixo" nunca
// valem para comando da lista de recusa; "sempre" só existe se o Codex propôs o prefixo.
test('codex: pedido de permissão de comando vira cartão com o que pode ser oferecido', () => {
  const M = 'item/commandExecution/requestApproval';
  const p = t.pedidoDaTela(M, { command: "/bin/bash -lc 'git commit -m ajuste'", commandActions: [{ type: 'unknown', command: 'git commit -m ajuste' }], reason: 'risco médio', proposedExecpolicyAmendment: ['git', 'commit'] });
  assert.deepStrictEqual([p.ferramenta, p.entrada.command, p.motivo], ['Bash', 'git commit -m ajuste', 'risco médio']);
  assert.deepStrictEqual(p.codex, { tipo: 'comando', sessao: true, prefixo: 'git commit', recusa: null, arquivo: t.arquivoDeRegras().exibir });
  assert.match(p.codex.arquivo, /rules\/default\.rules$/);
  // Sem prefixo proposto pelo Codex: não há "sempre".
  assert.deepStrictEqual(t.pedidoDaTela(M, { command: "/bin/bash -lc 'ls -la'" }).codex, { tipo: 'comando', sessao: true, prefixo: null, recusa: null });
  // Lista de recusa: nem "nesta conversa" nem "sempre", com o motivo.
  assert.deepStrictEqual(t.pedidoDaTela(M, { commandActions: [{ type: 'unknown', command: 'docker compose restart web' }], proposedExecpolicyAmendment: ['docker', 'compose'] }).codex,
    { tipo: 'comando', sessao: false, prefixo: null, recusa: 'docker, tmux ou ssh' });
  // Comando comum com prefixo aberto demais: pode "nesta conversa", não pode "sempre".
  assert.deepStrictEqual(t.pedidoDaTela(M, { commandActions: [{ type: 'unknown', command: 'npm test' }], proposedExecpolicyAmendment: ['bash'] }).codex,
    { tipo: 'comando', sessao: true, prefixo: null, recusa: 'roda outros programas' });
  for (const torto of [['git', 5], 'git', [], [''], null]) assert.strictEqual(t.pedidoDaTela(M, { commandActions: [{ type: 'unknown', command: 'git status' }], proposedExecpolicyAmendment: torto }).codex.prefixo, null, JSON.stringify(torto));
});

test('codex: cada resposta do cartão de comando volta na forma que o Codex aceita', () => {
  const M = 'item/commandExecution/requestApproval';
  const comum = { commandActions: [{ type: 'unknown', command: 'git commit -m ajuste' }], proposedExecpolicyAmendment: ['git', 'commit'] };
  assert.deepStrictEqual(t.respostaAoServidor(M, comum, { permitir: true }), { decision: 'accept' });
  assert.deepStrictEqual(t.respostaAoServidor(M, comum, { permitir: true, sessao: true }), { decision: 'acceptForSession' });
  assert.deepStrictEqual(t.respostaAoServidor(M, comum, { permitir: true, sempre: true }), { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'commit'] } } });
  assert.deepStrictEqual(t.respostaAoServidor(M, comum, { permitir: false }), { decision: 'decline' });
  assert.deepStrictEqual(t.respostaAoServidor(M, comum, { permitir: false, parar: true }), { decision: 'cancel' });
  // Lista de recusa: pedir "nesta conversa" ou "sempre" vale só desta vez.
  const docker = { commandActions: [{ type: 'unknown', command: 'docker compose restart web' }], proposedExecpolicyAmendment: ['docker', 'compose'] };
  assert.deepStrictEqual(t.respostaAoServidor(M, docker, { permitir: true, sessao: true }), { decision: 'accept' });
  assert.deepStrictEqual(t.respostaAoServidor(M, docker, { permitir: true, sempre: true }), { decision: 'accept' });
  // Sem prefixo proposto, "sempre" vale só desta vez.
  assert.deepStrictEqual(t.respostaAoServidor(M, { command: "/bin/bash -lc 'ls'" }, { permitir: true, sempre: true }), { decision: 'accept' });
  // Mudança de arquivo: sem regra permanente.
  const F = 'item/fileChange/requestApproval';
  assert.deepStrictEqual(t.pedidoDaTela(F, { grantRoot: '/casa/projeto', reason: 'alterar' }).codex, { tipo: 'arquivo', sessao: true, prefixo: null, recusa: null });
  assert.deepStrictEqual(t.respostaAoServidor(F, {}, { permitir: true, sessao: true }), { decision: 'acceptForSession' });
  assert.deepStrictEqual(t.respostaAoServidor(F, {}, { permitir: true, sempre: true }), { decision: 'accept' });
  assert.deepStrictEqual(t.respostaAoServidor(F, {}, { permitir: false, parar: true }), { decision: 'cancel' });
});

test('codex: pedido de acesso a mais lista o que ele quer, e a resposta diz por quanto tempo vale', () => {
  const M = 'item/permissions/requestApproval';
  const params = { cwd: '/casa', reason: 'copiar e baixar', permissions: { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: '/casa/site/dist' } }, { access: 'read', path: { type: 'glob_pattern', pattern: '/casa/docs/**' } },
    { access: 'deny', path: { type: 'path', path: '/casa/site/dist/segredo' } }, { access: 'read', path: { type: 'special', value: { kind: 'project_roots', subpath: 'docs' } } }, { access: 'write', path: { type: 'special', value: { kind: 'slash_tmp' } } }],
    write: ['/casa/saida'], read: ['/casa/entrada'], globScanMaxDepth: 3 }, network: { enabled: true } } };
  const p = t.pedidoDaTela(M, params);
  assert.deepStrictEqual([p.tipo, p.motivo, p.ok], ['codex-acesso', 'copiar e baixar', true]);
  assert.deepStrictEqual(p.itens, [{ acao: 'escrever', onde: '/casa/site/dist' }, { acao: 'ler', onde: '/casa/docs/**' }, { acao: 'bloquear', onde: '/casa/site/dist/segredo' },
    { acao: 'ler', onde: 'as pastas do projeto, em docs' }, { acao: 'escrever', onde: '/tmp' }, { acao: 'escrever', onde: '/casa/saida' }, { acao: 'ler', onde: '/casa/entrada' }, { acao: 'rede' }]);
  assert.deepStrictEqual(t.respostaAoServidor(M, params, { permitir: true }), { permissions: params.permissions, scope: 'turn' });
  assert.deepStrictEqual(t.respostaAoServidor(M, params, { permitir: true, sessao: true }), { permissions: params.permissions, scope: 'session' });
  assert.deepStrictEqual(t.respostaAoServidor(M, params, { permitir: false }), { permissions: {} });
  assert.deepStrictEqual(t.pedidoDaTela(M, { permissions: { network: { enabled: true } } }).itens, [{ acao: 'rede' }]);
});

// Liberar concede o pedido inteiro. Então o app só deixa liberar o que mostrou por inteiro:
// com qualquer parte que ele não saiba mostrar, o cartão só nega (e a resposta nunca concede).
test('codex: pedido de acesso com uma parte que o app não sabe mostrar só pode ser negado', () => {
  const M = 'item/permissions/requestApproval';
  const bom = { access: 'write', path: { type: 'path', path: '/casa/a' } };
  const tortos = {
    'entrada nula': { fileSystem: { entries: [bom, null] } },
    'entrada sem caminho': { fileSystem: { entries: [bom, { access: 'write' }] } },
    'acesso desconhecido': { fileSystem: { entries: [bom, { access: 'executar', path: { type: 'path', path: '/a' } }] } },
    'tipo de caminho desconhecido': { fileSystem: { entries: [bom, { access: 'read', path: { type: 'regex', pattern: '.*' } }] } },
    'especial desconhecido': { fileSystem: { entries: [bom, { access: 'read', path: { type: 'special', value: { kind: 'unknown', path: 'x' } } }] } },
    'campo a mais na entrada': { fileSystem: { entries: [{ ...bom, recursivo: true }] } },
    'campo a mais nas pastas': { fileSystem: { entries: [bom], tudo: true } },
    'campo a mais na rede': { fileSystem: { entries: [bom] }, network: { enabled: true, hosts: ['*'] } },
    'campo a mais no pedido': { fileSystem: { entries: [bom] }, processos: true },
    'caminho com quebra de linha': { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: '/casa/a\n/etc' } }] } },
    'caminho que não é texto': { fileSystem: { write: [bom.path] } },
    'itens demais': { fileSystem: { entries: Array.from({ length: 31 }, (_, i) => ({ access: 'read', path: { type: 'path', path: `/casa/${i}` } })) } },
    'nada pedido': {},
    'rede desligada, sem pasta': { network: { enabled: false } },
    'pedido que não é objeto': 'tudo',
  };
  for (const [caso, permissions] of Object.entries(tortos)) {
    assert.strictEqual(t.pedidoDaTela(M, { permissions }).ok, false, caso);
    assert.deepStrictEqual(t.respostaAoServidor(M, { permissions }, { permitir: true, sessao: true }), { permissions: {} }, caso);
  }
  assert.strictEqual(t.pedidoDaTela(M, {}).ok, false);
  // O que dá para mostrar aparece mesmo assim (a pessoa vê o que foi pedido antes de negar).
  assert.deepStrictEqual(t.pedidoDaTela(M, { permissions: tortos['entrada nula'] }).itens, [{ acao: 'escrever', onde: '/casa/a' }]);
});

// O ajudante da área de trabalho só mostra "Permitir" e "Negar": para o pedido de acesso a mais
// e para o pedido de dado do MCP ele só avisa, e a resposta é dada no cartão do app.
test('codex: o ajudante não responde pedido de acesso a mais nem pedido de dado do MCP', () => {
  const ajudante = require('../../ajudante');
  const orq = { id: 'orquestrador', orquestrador: true, titulo: 'Orquestrador' };
  const acesso = { id: 'cx-7', ...t.pedidoDaTela('item/permissions/requestApproval', { permissions: { network: { enabled: true } } }) };
  const a = ajudante.pendenciaDeConversa(orq, acesso);
  assert.deepStrictEqual([a.item, a.texto], [null, 'O orquestrador pede acesso a mais (pastas ou rede): responda no app']);
  assert.strictEqual(ajudante.pendenciaDeConversa({ id: 'c1', orquestrador: false, titulo: 'Testes' }, acesso).texto, '"Testes" pede acesso a mais (pastas ou rede): responda no app');
  const mcp = { id: 'cx-8', ...t.pedidoDaTela('mcpServer/elicitation/request', { serverName: 's', message: 'm', mode: 'form', requestedSchema: { type: 'object', properties: { nome: { type: 'string' } } } }) };
  assert.strictEqual(ajudante.pendenciaDeConversa(orq, mcp).item, null);
  // O pedido de comando continua indo ao ajudante, como permissão comum.
  const cmd = { id: 'cx-9', ...t.pedidoDaTela('item/commandExecution/requestApproval', { commandActions: [{ type: 'unknown', command: 'git status' }] }) };
  assert.deepStrictEqual([ajudante.pendenciaDeConversa(orq, cmd).item.tipo, ajudante.pendenciaDeConversa(orq, cmd).item.comando], ['permissao', 'git status']);
});

test('codex: pedido de dado de um servidor MCP usa o mesmo cartão do Claude', () => {
  const M = 'mcpServer/elicitation/request';
  const p = t.pedidoDaTela(M, { serverName: 'cofre-da-equipe', message: 'Informe o código.', mode: 'form', requestedSchema: { type: 'object', required: ['codigo'], properties: { codigo: { type: 'string', title: 'Código de verificação' } } } });
  assert.deepStrictEqual([p.tipo, p.servidor, p.modo, p.ok, p.campos.map((c) => [c.nome, c.secreto])], ['elicitacao', 'cofre-da-equipe', 'form', true, [['codigo', true]]]);
  const u = t.pedidoDaTela(M, { serverName: 'agenda', message: 'Entre.', mode: 'url', elicitationId: 'e1', url: 'https://contas.exemplo.com/x' });
  assert.deepStrictEqual([u.modo, u.site, u.ok], ['url', 'contas.exemplo.com', true]);
  // Formulário de um tipo que o app não mostra: o cartão existe, só para recusar.
  assert.strictEqual(t.pedidoDaTela(M, { serverName: 's', message: 'm', mode: 'openai/form', requestedSchema: { qualquer: 'coisa' } }).ok, false);
});

test('codex: trocar a IA do orquestrador guarda a conversa de cada motor', () => {
  const cfg = path.join(casa, '.config', 'orq-app', 'config.json');
  const c = new conversa._Conversa({ id: 'ct', titulo: 'Orquestrador', orquestrador: true, sessao: 'sessao-claude' });
  c.acertarMotor();
  assert.deepStrictEqual([c.motor, c.sessao, c.sessoesMotor.claude], ['codex', null, 'sessao-claude']);
  c.sessao = 'th-x';
  fs.writeFileSync(cfg, JSON.stringify({ iasCaminhos: { codex: FALSO }, iaOrquestrador: 'claude' }));
  c.acertarMotor();
  assert.deepStrictEqual([c.motor, c.sessao, c.sessoesMotor.codex], ['claude', 'sessao-claude', 'th-x']);
  fs.writeFileSync(cfg, JSON.stringify({ iasCaminhos: { codex: FALSO }, iaOrquestrador: 'codex' }));
});
