// Área: cli-real
// 0.D2: o conferidor de contrato (scripts/contrato-cli.js) que roda à mão a
// cada atualização do Claude ou do Codex. Aqui ele roda contra o Claude falso
// e o Codex falso, para o `npm test` cobrir o script sem o CLI de verdade: a
// lógica de comparação, as travas (casa falsa, ambiente montado do zero, sem
// rede) e o retrato que não muda de uma execução para outra.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { casaTemporaria } = require('../ajuda');

const RAIZ = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'contrato-cli.js');
const C = require(SCRIPT);
const CONTRATO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'scripts', 'contrato-cli.json'), 'utf8'));
const CLAUDE_FALSO = path.join(__dirname, 'claude-falso.js');
const CODEX_FALSO = path.join(__dirname, 'codex-falso.js');
const casa = casaTemporaria();
// Sem `unshare` (algumas máquinas de CI), só os proxies: os falsos não usam rede.
const comUnshare = ['-cn', '-rn'].some((f) => spawnSync('unshare', [f, 'true'], { stdio: 'ignore' }).status === 0);
const REDE = comUnshare ? [] : ['--rede=proxy'];

let n = 0;
function conferir(args = [], env = {}) {
  const pasta = path.join(casa, `rodada-${++n}`);
  fs.mkdirSync(pasta, { recursive: true });
  const r = spawnSync(process.execPath, [SCRIPT, '--claude', CLAUDE_FALSO, '--codex', CODEX_FALSO, '--saida', path.join(casa, 'retratos'), '--json', '--espera', '5000', ...REDE, ...args], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, HOME: casa, CODEX_FALSO_LOG: path.join(pasta, 'codex.log'), CLAUDE_FALSO_LOG: path.join(pasta, 'claude.log'),
      CLAUDE_FALSO_FALHA_RESUME: 'No conversation found with session ID: x', ...env },
  });
  assert.ok(r.stdout.trim(), `o conferidor não imprimiu nada: ${r.stderr}`);
  const saida = JSON.parse(r.stdout);
  const linha = (cli, id) => saida.clis.find((c) => c.cli === cli).linhas.find((l) => l.id === id);
  return { codigo: r.status, saida, linha, stderr: r.stderr };
}

test('contrato: o contrato é dado, e cada item tem id único, tipo conhecido e onde no app', () => {
  for (const cli of ['claude', 'codex']) {
    const ids = CONTRATO[cli].itens.map((i) => i.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${cli}: id repetido`);
    for (const i of CONTRATO[cli].itens) {
      assert.ok(['flags', 'estatico', 'controle', 'evento', 'transcript', 'args', 'metodo', 'notificacao-cliente', 'notificacao', 'item', 'pedido-servidor'].includes(i.tipo), `${i.id}: tipo ${i.tipo}`);
      assert.ok(i.onde, `${i.id}: sem "onde"`);
      if (i.vivo === false) assert.ok(i.porque, `${i.id}: não vai ao vivo sem dizer por quê`);
    }
  }
  // Os pedidos de controle que o main.js libera para a tela estão todos no contrato.
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const liberados = JSON.parse(/const CONTROLES = (\[[^\]]+\])/.exec(main)[1].replace(/'/g, '"').replace(/\s+/g, ' '));
  const noContrato = new Set(CONTRATO.claude.itens.filter((i) => i.tipo === 'controle').map((i) => i.pedido.subtype));
  for (const s of liberados) assert.ok(noContrato.has(s), `o main.js libera ${s} e o contrato não confere`);
  const metodos = JSON.parse(/const METODOS_CODEX = (\[[^\]]+\])/.exec(main)[1].replace(/'/g, '"').replace(/\s+/g, ' '));
  const metodosNoContrato = new Set(CONTRATO.codex.itens.map((i) => i.metodo));
  for (const m of metodos) assert.ok(metodosNoContrato.has(m), `o main.js libera ${m} e o contrato não confere`);
});

test('contrato: caminho de campo (lista, qualquer chave, alternativa, opcional, lista vazia)', () => {
  const v = { a: { b: [{ c: 1 }, { d: 2 }] }, vazio: [], m: { x: { w: 1 } }, n: null };
  assert.strictEqual(C.verCampo(v, C.partes('a.b[].c')), 'sim');
  assert.strictEqual(C.verCampo(v, C.partes('a.b[].z')), 'nao');
  assert.strictEqual(C.verCampo(v, C.partes('vazio[].c')), 'vazio');
  assert.strictEqual(C.verCampo(v, C.partes('m.*.w')), 'sim');
  assert.strictEqual(C.verCampo(v, C.partes('n.x')), 'vazio');
  const r = C.conferirCampos([v], ['a.b[].z|a.b[].d', 'falta', 'falta?', 'vazio[].c', 'vazio[].c?']);
  assert.deepStrictEqual(r, { faltam: ['falta'], semComoVer: ['vazio[].c'], opcionaisAusentes: ['falta?'] });
});

test('contrato: o esquema do Codex (campo por variante, valores aceitos, parâmetros do app)', () => {
  const defs = {
    Item: { oneOf: [
      { type: 'object', properties: { type: { enum: ['agentMessage'] }, text: { type: 'string' } } },
      { type: 'object', properties: { type: { const: 'commandExecution' }, status: { $ref: '#/definitions/Status' } } }] },
    Status: { type: 'string', enum: ['completed', 'failed'] },
    Params: { type: 'object', required: ['threadId'], additionalProperties: false, properties: { threadId: { type: 'string' }, limit: { anyOf: [{ type: 'integer' }, { type: 'null' }] } } },
  };
  assert.strictEqual(C.noEsquema(defs, defs.Item, ['[type=agentMessage]', 'text']), 'sim');
  assert.strictEqual(C.noEsquema(defs, defs.Item, ['[type=agentMessage]', 'status']), 'nao');
  assert.strictEqual(C.noEsquema(defs, defs.Item, ['[type=webSearch]']), 'nao');
  assert.deepStrictEqual(C.valoresNoEsquema(defs, defs.Item, ['[type=commandExecution]', 'status']), ['completed', 'failed']);
  assert.deepStrictEqual(C.validar(defs, defs.Params, { threadId: 'x', limit: 40 }), []);
  assert.match(C.validar(defs, defs.Params, { limit: 40 }).join(), /falta threadId/);
  assert.match(C.validar(defs, defs.Params, { threadId: 'x', cwd: '/' }).join(), /campo desconhecido cwd/);
  assert.match(C.validar(defs, defs.Params, { threadId: 'x', limit: 'muito' }).join(), /tipo string/);
});

test('contrato: a comparação reprova o que o app usa e o CLI não tem, e só isso', () => {
  const contrato = { itens: [
    { id: 'a', tipo: 'controle', pedido: { subtype: 'get_status' }, campos: ['sections[].title'] },
    { id: 'b', tipo: 'controle', pedido: { subtype: 'get_plan' }, campos: ['exists'] },
    { id: 'c', tipo: 'controle', pedido: { subtype: 'get_skills_dialog' }, campos: ['skills[].name'] },
    { id: 'd', tipo: 'controle', pedido: { subtype: 'get_task_output' }, campos: ['output'] },
    { id: 'e', tipo: 'controle', depende: false, pedido: { subtype: 'mcp_status' }, campos: [] },
    { id: 'f', tipo: 'controle', vivo: false, porque: 'chama o modelo', pedido: { subtype: 'side_question' }, estatico: ['side_question'] },
    { id: 'g', tipo: 'controle', inexistente: true, pedido: { subtype: 'x' }, errorCode: 'unsupported_request' },
  ] };
  const obs = { rodou: true, casa: '/tmp/c', eventos: [], estatico: new Set(), controles: {
    a: { subtype: 'error', error: 'Unsupported control request subtype: get_status', error_code: 'unsupported_request' },
    b: { subtype: 'success', response: { content: 'x' } },
    c: { subtype: 'success', response: { skills: [] } },
    d: { subtype: 'error', error: 'no task with that id' },
    e: null,
    g: { subtype: 'error', error: 'Unsupported control request subtype: x', error_code: 'unsupported_request' },
  } };
  const l = Object.fromEntries(C.avaliarClaude(contrato, obs).map((x) => [x.id, x]));
  assert.strictEqual(l.a.existe, C.NAO, 'subtipo que o CLI não conhece');
  assert.strictEqual(l.b.formato, C.NAO, 'campo de que o app depende sumiu');
  assert.strictEqual(l.c.formato, C.NAO_SEI, 'lista vazia: não dá para saber');
  assert.deepStrictEqual([l.d.existe, l.d.formato], [C.ATENDE, C.NAO_SEI], 'existe, mas recusou o pedido de teste');
  assert.strictEqual(l.e.existe, C.NAO, 'sem resposta');
  assert.strictEqual(l.f.existe, C.NAO, 'não mandado e o nome sumiu dos arquivos do CLI');
  assert.deepStrictEqual([l.g.existe, l.g.formato], [C.ATENDE, C.ATENDE]);
  assert.strictEqual(C.codigoDeSaida(Object.values(l)), 1);
  // Só o que não depende (mcp_status) falhando: código 0.
  assert.strictEqual(C.codigoDeSaida([l.e, l.g]), 0);
});

test('contrato: método do Codex que só atende com capacidade que o app não declara reprova (achado no 0.167.1)', () => {
  const contrato = { itens: [
    { id: 'ps', tipo: 'metodo', metodo: 'thread/backgroundTerminals/list', params: { threadId: '$thread' }, campos: [] },
    { id: 'sem conta', tipo: 'metodo', metodo: 'account/rateLimits/read', params: {}, campos: ['rateLimits.primary.usedPercent'] },
    { id: 'resume', tipo: 'metodo', metodo: 'thread/resume', params: {}, erro: 'no rollout found|not found', campos: [] },
    { id: 'resume2', tipo: 'metodo', metodo: 'thread/resume', params: {}, erro: 'no rollout found|not found', campos: [] },
    { id: 'parametro', tipo: 'metodo', metodo: 'config/read', params: { threadId: '$thread' }, campos: [] },
  ] };
  const obs = { rodou: true, iniciou: true, casa: '/tmp/c', notificacoes: {}, esquema: null, estatico: new Set(), respostas: {
    ps: { error: { code: -32600, message: 'thread/backgroundTerminals/list requires experimentalApi capability' } },
    'sem conta': { error: { code: -32600, message: 'codex account authentication required to read rate limits' } },
    resume: { error: { code: -32600, message: 'no rollout found for thread id 0000' } },
    resume2: { error: { code: -32600, message: 'internal error' } },
    parametro: { error: { code: -32600, message: 'Invalid request: unknown field `threadId`' } },
  } };
  const l = Object.fromEntries(C.avaliarCodex(contrato, obs).map((x) => [x.id, x]));
  assert.deepStrictEqual([l.ps.existe, l.ps.formato], [C.ATENDE, C.NAO]);
  assert.match(l.ps.detalhe, /experimentalApi/);
  assert.deepStrictEqual([l['sem conta'].existe, l['sem conta'].formato], [C.ATENDE, C.NAO_SEI]);
  assert.strictEqual(l.resume.formato, C.ATENDE, 'o erro que o app reconhece');
  assert.strictEqual(l.resume2.formato, C.NAO, 'erro que o NAO_ACHOU do app não reconhece');
  assert.strictEqual(l.parametro.formato, C.NAO, 'recusou o threadId que o app manda');
});

test('contrato: contra os falsos, o que eles fazem atende e o retrato não muda de uma execução para outra', () => {
  const a = conferir();
  for (const id of ['flags', 'controle:get_status', 'controle:get_workspace_diff', 'controle:set_permission_mode', 'evento:system/init', 'evento:system/status', 'evento:conversation_reset', 'evento:system/session_title_changed']) {
    const l = a.linha('claude', id);
    assert.deepStrictEqual([l.existe, l.formato], [C.ATENDE, C.ATENDE], `claude ${id}: ${l.detalhe}`);
  }
  for (const id of ['args do app-server', 'metodo:initialize', 'metodo:thread/start', 'metodo:thread/list', 'metodo:thread/fork', 'metodo:thread/resume (conversa que não existe)', 'metodo inexistente']) {
    const l = a.linha('codex', id);
    assert.deepStrictEqual([l.existe, l.formato], [C.ATENDE, C.ATENDE], `codex ${id}: ${l.detalhe}`);
  }
  assert.strictEqual(a.linha('claude', 'controle:side_question').fonte, 'estático', 'o que chamaria o modelo nunca vai ao vivo');
  const claude = a.saida.clis.find((c) => c.cli === 'claude');
  assert.strictEqual(claude.versao, '9.9.9');
  assert.strictEqual(claude.retrato.situacao, 'novo');
  const antes = fs.readFileSync(claude.retrato.arquivo, 'utf8');
  assert.ok(!antes.includes(os.tmpdir()), 'o retrato não guarda caminho da casa temporária');

  const b = conferir();
  for (const c of b.saida.clis) assert.strictEqual(c.retrato.situacao, 'igual', `${c.cli}: o retrato mudou sem o CLI mudar`);
  assert.strictEqual(fs.readFileSync(claude.retrato.arquivo, 'utf8'), antes);
  // O que o Claude falso recebeu: só pedidos de controle e os dois comandos locais.
  const recebidos = fs.readFileSync(path.join(casa, 'rodada-1', 'claude.log'), 'utf8').trim().split('\n').map((x) => JSON.parse(x));
  const mensagens = recebidos.filter((x) => x.type === 'user').map((x) => x.message.content);
  assert.deepStrictEqual(mensagens, CONTRATO.claude.turnoLocal);
  assert.ok(!recebidos.some((x) => x.type === 'control_request' && ['side_question', 'submit_feedback'].includes(x.request.subtype)), 'mandou pedido que chama o modelo ou a rede');
});

test('contrato: um Claude que não conhece os pedidos dos comandos reprova (código 1) e a tabela diz quais', () => {
  const r = conferir(['--so', 'claude'], { CLAUDE_FALSO_SEM_CONTROLES: '1' });
  assert.strictEqual(r.codigo, 1, r.stderr);
  for (const id of ['controle:get_workspace_diff', 'controle:export_conversation', 'controle:get_skills_dialog']) assert.strictEqual(r.linha('claude', id).existe, C.NAO, id);
  assert.strictEqual(r.linha('claude', 'controle:set_model (padrão)').existe, C.ATENDE);
  const t = C.tabela(r.saida.clis[0].linhas);
  assert.match(t, /✗ controle:get_workspace_diff\s+NÃO ATENDE/);
  assert.strictEqual(r.saida.clis.length, 1, '--so claude não confere o Codex');
});

test('contrato: travas — casa falsa, ambiente do zero (nenhuma chave desce), sem rede, casa apagada no fim', () => {
  const espiao = path.join(casa, 'espiao.js');
  const log = path.join(casa, 'espiao.log');
  fs.writeFileSync(espiao, `const fs = require('fs');
let dev = ''; try { dev = fs.readFileSync('/proc/net/dev', 'utf8'); } catch {}
fs.appendFileSync(process.env.CLAUDE_FALSO_ESPIAO, JSON.stringify({ env: process.env, cwd: process.cwd(), dev }) + '\\n');
process.exit(1);
`);
  const r = conferir(['--so', 'claude', '--claude', espiao], { CLAUDE_FALSO_ESPIAO: log, ANTHROPIC_API_KEY: 'sk-teste-nao-pode-descer', OPENAI_API_KEY: 'sk-teste-nao-pode-descer' });
  const vistos = fs.readFileSync(log, 'utf8').trim().split('\n').map((x) => JSON.parse(x));
  assert.ok(vistos.length >= 2, 'o espião não rodou');
  for (const v of vistos) {
    const e = v.env;
    assert.ok(e.HOME.startsWith(path.join(os.tmpdir(), 'orq-contrato-')), `HOME fora da casa falsa: ${e.HOME}`);
    assert.notStrictEqual(e.HOME, casa);
    assert.strictEqual(e.CLAUDE_CONFIG_DIR, path.join(e.HOME, '.claude'));
    assert.strictEqual(e.CODEX_HOME, path.join(e.HOME, '.codex'));
    assert.ok(v.cwd.startsWith(e.HOME), 'o CLI roda dentro da casa falsa');
    assert.strictEqual(e.ANTHROPIC_API_KEY, undefined, 'chave do ambiente desceu para o CLI');
    assert.strictEqual(e.OPENAI_API_KEY, undefined, 'chave do ambiente desceu para o CLI');
    assert.strictEqual(e.HTTPS_PROXY, 'http://127.0.0.1:9');
    assert.strictEqual(e.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9');
    if (comUnshare) {
      const interfaces = v.dev.split('\n').slice(2).map((x) => x.split(':')[0].trim()).filter(Boolean);
      assert.deepStrictEqual(interfaces, ['lo'], 'o CLI viu a rede da máquina');
    }
    assert.ok(!fs.existsSync(e.HOME), `a casa temporária ficou: ${e.HOME}`);
  }
  // CLI que não abre: o que só se vê ao vivo fica "não deu para saber" (o
  // estático continua valendo e pode reprovar).
  const st = r.linha('claude', 'controle:get_status');
  assert.deepStrictEqual([st.existe, st.formato], [C.NAO_SEI, C.NAO_SEI]);
  assert.match(st.detalhe, /saiu logo ao abrir/);
});
