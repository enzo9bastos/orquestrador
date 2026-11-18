// Área: conversa (pasta por conversa e o cartão de confiança da pasta; plano 3.1)
// Antes toda conversa rodava na pasta pessoal (~). Agora cada conversa tem a sua pasta,
// escolhida ao criar e que não muda depois. Fora da pasta pessoal, o Claude só sobe depois
// de a pessoa aceitar o que a pasta configura (confianca.js): hooks, MCP, regras e
// instruções. Aqui: o motor (conversa.js) com o Claude falso e o Codex falso.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria, escrever } = require('../ajuda');

const FALSO = path.join(__dirname, 'claude-falso.js');
const XFALSO = path.join(__dirname, 'codex-falso.js');
const casa = casaTemporaria({ iasCaminhos: { claude: FALSO, codex: XFALSO } });
let LOG, XLOG, nLog = 0;
function novoLog() {
  nLog++;
  LOG = path.join(casa, `claude-falso-${nLog}.log`);
  XLOG = path.join(casa, `codex-falso-${nLog}.log`);
  process.env.CLAUDE_FALSO_LOG = LOG;
  process.env.CODEX_FALSO_LOG = XLOG;
}
novoLog();
test.beforeEach(() => novoLog());
const conversa = require('../../conversa');
const confianca = require('../../confianca');

const ler = (arq) => (fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const recebidos = () => ler(LOG);
const subidas = () => recebidos().filter((x) => Array.isArray(x.args));
const mensagens = () => recebidos().filter((x) => x.type === 'user').map((x) => (typeof x.message.content === 'string' ? x.message.content : JSON.stringify(x.message.content)));
const telas = [];
conversa.ligar((canal, dado) => telas.push({ canal, ...dado }));
conversa.ligarAvisos(() => {});
async function ate(cond, ms = 6000) {
  for (let i = 0; i < ms / 20; i++) { if (await cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('não aconteceu a tempo');
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const guardada = (id) => JSON.parse(fs.readFileSync(path.join(casa, '.cache', 'orq-app', process.env.ORQ_APP_TESTE === '1' ? 'conversas-teste.json' : 'conversas.json'), 'utf8')).find((x) => x.id === id);
let n = 0;
// Uma pasta de projeto dentro da casa temporária, com o que ela configura.
function projeto(arquivos = {}) {
  const rel = `proj/p${++n}`;
  const dir = path.join(casa, rel);
  fs.mkdirSync(dir, { recursive: true });
  for (const [arq, texto] of Object.entries(arquivos)) escrever(casa, `${rel}/${arq}`, texto);
  return dir;
}
const HOOK = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './scripts/checa.sh' }] }] } });
async function nova(t, o) {
  await espera(3); // o id da conversa nova vem do relógio (ms)
  const id = conversa.nova(o);
  t.after(() => { try { conversa.fechar(id); } catch { /* já fechada no teste */ } });
  return { id, c: conversa._pegar(id) };
}
const cartao = (id) => conversa._pegar(id).estado().pasta;
// A pasta em que o Claude falso está rodando (ele diz no pedido de status).
const pastaDoClaude = async (c) => (await c.controle('get_status')).sections[0].rows.find((r) => r.label === 'Pasta').value;

test('pasta: sem escolher, a conversa roda na pasta pessoal, como antes, e nada de pasta vai para a lista guardada', async (t) => {
  const { id, c } = await nova(t);
  assert.strictEqual(c.pasta, casa);
  c.iniciar();
  await ate(() => c.proc);
  assert.strictEqual(await pastaDoClaude(c), casa);
  assert.strictEqual(cartao(id), null, 'a pasta pessoal não passa pelo cartão');
  assert.strictEqual(guardada(id).pasta, undefined);
  assert.deepStrictEqual({ pasta: c.resumo().pasta, pessoal: c.resumo().pessoal }, { pasta: '~', pessoal: true });
});

test('pasta: a conferência recusa o que não é uma pasta de verdade e devolve o caminho sem links', async (t) => {
  const dir = projeto();
  const arquivo = escrever(casa, 'proj/um-arquivo.txt', 'x');
  fs.symlinkSync(dir, path.join(casa, 'proj', 'atalho-para-o-projeto'));
  assert.strictEqual(conversa.pastaDeConversa(null), casa);
  assert.strictEqual(conversa.pastaDeConversa('~'), casa);
  assert.strictEqual(conversa.pastaDeConversa(dir), dir);
  assert.strictEqual(conversa.pastaDeConversa(`~/${path.relative(casa, dir)}`), dir);
  assert.strictEqual(conversa.pastaDeConversa(path.join(casa, 'proj', 'atalho-para-o-projeto')), dir, 'link vira o caminho de verdade');
  for (const ruim of ['proj/p1', arquivo, path.join(casa, 'nao-existe'), 'a\0b', 5, {}, 'x'.repeat(5000)]) {
    assert.throws(() => conversa.pastaDeConversa(ruim), /pasta|caminho/, String(ruim).slice(0, 30));
    assert.throws(() => conversa.nova({ pasta: ruim }), /pasta|caminho/);
  }
  assert.throws(() => conversa.nova({ motor: 'gemini' }), /motor/);
  void t;
});

test('pasta nova: o Claude NÃO sobe antes do cartão; "confiar" grava o aceite e abre na pasta; da próxima vez abre direto', async (t) => {
  const dir = projeto({ '.claude/settings.json': HOOK });
  const { id, c } = await nova(t, { pasta: dir });
  assert.strictEqual(c.pasta, dir);
  c.iniciar();
  await ate(() => cartao(id));
  assert.strictEqual(c.proc, null, 'o Claude subiu numa pasta que a pessoa ainda não aceitou');
  assert.strictEqual(subidas().length, 0);
  const k = cartao(id);
  assert.strictEqual(k.estado, 'nunca-vista');
  assert.strictEqual(k.exibir, `~/${path.relative(casa, dir)}`);
  assert.strictEqual(k.oQueRoda.hooks.total, 1);
  assert.match(JSON.stringify(k.oQueRoda.hooks.itens), /checa\.sh/);
  assert.ok(telas.some((x) => x.id === id && x.canal === 'conversa:tudo' && x.dado.pasta && x.dado.pasta.estado === 'nunca-vista'), 'a tela recebeu o cartão');
  assert.strictEqual(c.resumo().pedidos, 1, 'a lista da lateral mostra que a conversa espera a pessoa');
  const r = await c.responderPasta('confiar');
  assert.deepStrictEqual(r, { ok: true, aberta: true, lembrado: true });
  await ate(() => c.proc);
  assert.strictEqual(await pastaDoClaude(c), dir, 'o Claude subiu em outra pasta');
  assert.strictEqual(cartao(id), null);
  assert.strictEqual(c.resumo().pedidos, 0);
  assert.strictEqual(guardada(id).pasta, dir);
  assert.strictEqual((await confianca.verificar(dir)).estado, 'aceita');
  // Reiniciada: confere de novo sozinha e sobe sem perguntar.
  c.parar();
  await ate(() => !c.proc);
  c.iniciar();
  await ate(() => c.proc);
  assert.strictEqual(cartao(id), null);
  await ate(() => subidas().length === 2); // o Claude falso anota a subida quando começa a rodar
});

test('pasta que mudou depois do aceite: o cartão volta dizendo o que mudou, e a conversa só sobe com a resposta', async (t) => {
  const dir = projeto({ '.claude/settings.json': HOOK });
  const { id, c } = await nova(t, { pasta: dir });
  c.iniciar();
  await ate(() => cartao(id));
  await c.responderPasta('confiar');
  await ate(() => c.proc);
  c.parar();
  await ate(() => !c.proc);
  escrever(casa, `${path.relative(casa, dir)}/.mcp.json`, JSON.stringify({ mcpServers: { banco: { command: 'npx', args: ['banco-mcp'] } } }));
  const antes = subidas().length;
  c.iniciar();
  await ate(() => cartao(id));
  assert.strictEqual(c.proc, null);
  assert.strictEqual(subidas().length, antes);
  const k = cartao(id);
  assert.strictEqual(k.estado, 'mudou');
  assert.ok(k.mudancas && k.mudancas.itens.length >= 1, 'o cartão não diz o que mudou');
  assert.match(JSON.stringify(k.mudancas), /banco/);
});

test('mensagem mandada com o cartão aberto espera na fila, à vista, e vai uma vez só quando a pasta é aceita', async (t) => {
  const dir = projeto({ 'CLAUDE.md': '# regras\n' });
  const { id, c } = await nova(t, { pasta: dir });
  c.iniciar();
  await ate(() => cartao(id));
  assert.deepStrictEqual(c.daCaixa('primeira mensagem'), { enviada: true });
  assert.strictEqual(c.fila.length, 1, 'a mensagem não ficou na fila');
  assert.strictEqual(c.info.fila[0].texto, 'primeira mensagem');
  assert.strictEqual(mensagens().length, 0, 'a mensagem foi ao Claude antes do aceite');
  assert.ok(!c.eventos.some((e) => e.tipo === 'user'), 'o balão apareceu como enviado');
  await c.responderPasta('confiar');
  await ate(() => mensagens().length === 1);
  assert.deepStrictEqual(mensagens(), ['primeira mensagem']);
  assert.strictEqual(c.fila.length, 0);
  await espera(150);
  assert.strictEqual(mensagens().length, 1, 'a mensagem foi duas vezes');
});

test('cancelar o cartão: a conversa não abre, nada é gravado como aceito e a mensagem continua na fila', async (t) => {
  const dir = projeto({ '.claude/settings.json': HOOK });
  const { id, c } = await nova(t, { pasta: dir });
  c.iniciar();
  await ate(() => cartao(id));
  c.mandar('esperando');
  assert.deepStrictEqual(await c.responderPasta('cancelar'), { ok: true, aberta: false });
  await espera(100);
  assert.strictEqual(c.proc, null);
  assert.strictEqual(subidas().length, 0);
  assert.strictEqual(cartao(id), null);
  assert.strictEqual(c.fila.length, 1);
  assert.strictEqual((await confianca.verificar(dir)).estado, 'nunca-vista');
  assert.strictEqual((await c.responderPasta('confiar')).ok, false, 'sem cartão aberto não há o que responder');
  // Abrir de novo traz o cartão de volta.
  c.iniciar();
  await ate(() => cartao(id));
});

test('abrir sem as configurações do projeto: sobe só com as do usuário, vale nas próximas subidas e não grava aceite', async (t) => {
  const dir = projeto({ '.claude/settings.json': HOOK });
  const { id, c } = await nova(t, { pasta: dir });
  c.iniciar();
  await ate(() => cartao(id));
  assert.deepStrictEqual(await c.responderPasta('sem'), { ok: true, aberta: true });
  await ate(() => c.proc);
  assert.strictEqual(await pastaDoClaude(c), dir);
  const args = subidas()[0].args;
  const i = args.indexOf('--setting-sources');
  assert.ok(i >= 0 && args[i + 1] === 'user', '--setting-sources user não foi');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.strictEqual(guardada(id).semProjeto, true);
  assert.strictEqual((await confianca.verificar(dir)).estado, 'nunca-vista', 'abrir sem o projeto não é confiar na pasta');
  c.parar();
  await ate(() => !c.proc);
  c.iniciar();
  await ate(() => c.proc);
  assert.strictEqual(cartao(id), null, 'perguntou de novo numa conversa aberta sem o projeto');
  await ate(() => subidas().length === 2);
  assert.ok(subidas()[1].args.includes('--strict-mcp-config'));
});

test('a pasta guardada volta igual ao reabrir o app; conversa antiga (sem pasta) continua na pessoal', async (t) => {
  const dir = projeto();
  const de = new conversa._Conversa({ id: 'guardada-1', titulo: 'X', pasta: dir, semProjeto: true });
  assert.deepStrictEqual({ pasta: de.pasta, semProjeto: de.semProjeto }, { pasta: dir, semProjeto: true });
  const antiga = new conversa._Conversa({ id: 'guardada-2', titulo: 'Y' });
  assert.deepStrictEqual({ pasta: antiga.pasta, semProjeto: antiga.semProjeto }, { pasta: casa, semProjeto: false });
  // O orquestrador roda sempre na pasta pessoal, venha o que vier na lista guardada.
  const orq = new conversa._Conversa({ id: 'orquestrador', titulo: 'Orquestrador', orquestrador: true, pasta: dir, semProjeto: true });
  assert.deepStrictEqual({ pasta: orq.pasta, semProjeto: orq.semProjeto }, { pasta: casa, semProjeto: false });
  // Caminho torto na lista guardada não vira pasta de conversa.
  for (const torto of ['relativo/x', 'a\0b', 7, {}]) assert.strictEqual(new conversa._Conversa({ id: 'g3', titulo: 'Z', pasta: torto }).pasta, casa);
  void t;
});

test('pasta que sumiu: erro claro, o Claude não sobe e a conversa NÃO cai para a pasta pessoal', async (t) => {
  const dir = projeto();
  const { id, c } = await nova(t, { pasta: dir });
  c.iniciar();
  await ate(() => cartao(id));
  await c.responderPasta('confiar');
  await ate(() => c.proc);
  c.parar();
  await ate(() => !c.proc);
  const antes = subidas().length;
  fs.renameSync(dir, `${dir}-movida`);
  c.iniciar();
  await espera(200);
  assert.strictEqual(c.proc, null);
  assert.strictEqual(subidas().length, antes);
  const erro = c.eventos.filter((e) => e.tipo === 'erro').pop();
  assert.match(erro.texto, /A pasta desta conversa não existe mais: ~\/proj\//);
  c.mandar('ainda aí?');
  assert.strictEqual(c.fila.length, 1, 'a mensagem sumiu');
  assert.strictEqual(c.eventos.filter((e) => e.tipo === 'erro').length, 1, 'o mesmo erro repetido a cada tentativa');
  assert.strictEqual(c.pasta, dir, 'a pasta da conversa mudou sozinha');
  // A pasta voltou: a conversa abre de novo e a mensagem vai.
  fs.renameSync(`${dir}-movida`, dir);
  c.iniciar();
  await ate(() => c.proc);
  await ate(() => mensagens().includes('ainda aí?'));
});

test('o "!" da caixa e o ramo da conversa usam a pasta da conversa', async (t) => {
  const dir = projeto();
  const { c } = await nova(t, { pasta: dir });
  c.iniciar();
  await ate(() => c.estado().pasta);
  await c.responderPasta('confiar');
  await ate(() => c.proc);
  c.rodarShell('pwd');
  await ate(() => c.eventos.some((e) => e.tipo === 'shell' && e.estado !== 'rodando'));
  const sh = c.eventos.filter((e) => e.tipo === 'shell').pop();
  assert.strictEqual(sh.pasta, dir);
  assert.strictEqual(String(sh.saida || '').trim(), dir);
  c.mandar('oi');
  await ate(() => c.sessao && !c.info.ocupado);
  await espera(3);
  const idRamo = await conversa.ramificar(c.id);
  t.after(() => conversa.fechar(idRamo));
  assert.strictEqual(conversa._pegar(idRamo).pasta, dir);
});

test('conversa do Codex: sobe na pasta escolhida, sem o cartão do Claude', async (t) => {
  const dir = projeto({ '.claude/settings.json': HOOK });
  const { id, c } = await nova(t, { pasta: dir, motor: 'codex' });
  assert.strictEqual(c.motor, 'codex');
  c.iniciar();
  await ate(() => ler(`${XLOG}.ambiente`).length === 1);
  assert.strictEqual(ler(`${XLOG}.ambiente`)[0].cwd, dir);
  assert.strictEqual(cartao(id), null);
  assert.strictEqual(guardada(id).pasta, dir);
});

test('fechar a conversa com a conferência da pasta em andamento não sobe nada depois', async (t) => {
  const dir = projeto({ '.claude/settings.json': HOOK });
  const { id, c } = await nova(t, { pasta: dir });
  await confianca.aceitar(await confianca.verificar(dir));
  c.iniciar(); // a conferência começa (assíncrona)
  conversa.fechar(id);
  await espera(300);
  assert.strictEqual(c.proc, null);
  assert.strictEqual(subidas().length, 0);
});

test('pasta extra: tirar pelo menu tira da conversa e da lista guardada; tirar o que não está não muda nada', async (t) => {
  const dir = projeto();
  const extra = projeto();
  const { id, c } = await nova(t, { pasta: dir });
  c.pastaExtra(extra);
  assert.deepStrictEqual(guardada(id).pastasExtras, [extra]);
  assert.strictEqual(c.resumo().pastasExtras, 1);
  assert.strictEqual(c.tirarPastaExtra(path.join(casa, 'outra-qualquer')), false);
  assert.deepStrictEqual(c.pastasExtras, [extra]);
  assert.strictEqual(c.tirarPastaExtra(extra), true);
  assert.deepStrictEqual(c.pastasExtras, []);
  assert.strictEqual(guardada(id).pastasExtras, undefined);
  assert.strictEqual(c.resumo().pastasExtras, 0);
  assert.match(c.eventos.filter((e) => e.tipo === 'aviso').pop().texto, /^Pasta extra tirada: ~\/proj\/p\d+\. Vale a partir da próxima mensagem\.$/);
});

test('"permitir sempre neste projeto": a regra que a pessoa aprovou não faz o cartão da pasta voltar; qualquer outra mudança faz', async (t) => {
  const dir = projeto({ '.claude/settings.json': HOOK });
  const rel = path.relative(casa, dir);
  const { c } = await nova(t, { pasta: dir });
  c.iniciar();
  await ate(() => c.estado().pasta);
  await c.responderPasta('confiar');
  await ate(() => c.proc);
  const regra = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }];
  // O Claude grava a regra no arquivo local da pasta (aqui o teste faz o papel dele).
  escrever(casa, `${rel}/.claude/settings.local.json`, JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] } }));
  assert.strictEqual((await confianca.verificar(dir)).estado, 'mudou');
  assert.strictEqual(await c.reaceitarDepoisDoSempre(regra, 10), true);
  assert.strictEqual((await confianca.verificar(dir)).estado, 'aceita', 'a regra aprovada pela pessoa fez o cartão voltar');
  // Junto com a regra entrou outra coisa (um hook novo): o aceite não é renovado.
  escrever(casa, `${rel}/.claude/settings.local.json`, JSON.stringify({ permissions: { allow: ['Bash(npm test:*)', 'Bash(npm run lint:*)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'curl exemplo.invalid' }] }] } }));
  const outra = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm run lint:*' }], behavior: 'allow', destination: 'localSettings' }];
  assert.strictEqual(await c.reaceitarDepoisDoSempre(outra, 10), false);
  assert.strictEqual((await confianca.verificar(dir)).estado, 'mudou');
  // Regra diferente da aprovada: também não renova.
  escrever(casa, `${rel}/.claude/settings.local.json`, JSON.stringify({ permissions: { allow: ['Bash(npm test:*)', 'Bash(rm:*)'] } }));
  assert.strictEqual(await c.reaceitarDepoisDoSempre(outra, 10), false);
  // Conversa na pasta pessoal: não há pasta para renovar.
  const pessoal = await nova(t);
  assert.strictEqual(pessoal.c.reaceitarDepoisDoSempre(regra, 10), null);
});

test('pasta de projeto com agente em container: cartão sempre que o app abre; o aceite vale só na memória, e só enquanto a pasta não muda', async (t) => {
  const dir = projeto({ '.claude/settings.json': HOOK });
  const rel = path.relative(casa, dir);
  conversa.ligarContainer(async (p) => p === dir);
  t.after(() => conversa.ligarContainer(null));
  const { id, c } = await nova(t, { pasta: dir });
  c.iniciar();
  await ate(() => cartao(id));
  const k = cartao(id);
  assert.ok(k.motivos.includes('container'));
  assert.strictEqual(k.lembrar, false);
  assert.deepStrictEqual(await c.responderPasta('confiar'), { ok: true, aberta: true, lembrado: false });
  await ate(() => c.proc);
  assert.strictEqual((await confianca.verificar(dir)).estado, 'nunca-vista', 'o aceite de uma pasta com container foi para o disco');
  // Reinício da conversa com o app aberto e a pasta igual: não pergunta de novo.
  c.parar();
  await ate(() => !c.proc);
  c.iniciar();
  await ate(() => c.proc);
  assert.strictEqual(cartao(id), null);
  // A pasta mudou (o agente do container mexeu): pergunta.
  c.parar();
  await ate(() => !c.proc);
  escrever(casa, `${rel}/.claude/settings.json`, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'curl exemplo.invalid' }] }] } }));
  c.iniciar();
  await ate(() => cartao(id));
  assert.strictEqual(c.proc, null);
  assert.match(JSON.stringify(cartao(id).oQueRoda.hooks.itens), /curl exemplo\.invalid/);
  // "App aberto de novo" (a conversa recriada do que ficou guardado): pergunta, mesmo com a pasta igual.
  await c.responderPasta('confiar');
  await ate(() => c.proc);
  c.parar();
  const outra = new conversa._Conversa({ id: 'container-2', titulo: 'X', pasta: dir });
  outra.iniciar();
  await ate(() => outra.estado().pasta);
  assert.strictEqual(outra.proc, null);
  outra.parar();
});

test('sem conseguir saber se a pasta tem container, vale como se tivesse: pergunta e não guarda o aceite', async (t) => {
  const dir = projeto();
  conversa.ligarContainer(async () => { throw new Error('o Docker não respondeu'); });
  t.after(() => conversa.ligarContainer(null));
  const { id, c } = await nova(t, { pasta: dir });
  c.iniciar();
  await ate(() => cartao(id));
  assert.ok(cartao(id).motivos.includes('container'));
  assert.strictEqual((await c.responderPasta('confiar')).lembrado, false);
});

test('/resume: sem sessão ainda, a lista de conversas antigas sai da pasta da conversa, não da pessoal', async (t) => {
  const dir = projeto();
  const pessoal = await nova(t);
  const noProjeto = await nova(t, { pasta: dir });
  const raiz = path.join(casa, '.claude', 'projects');
  assert.strictEqual(conversa.transcriptsDaConversa(pessoal.id), path.join(raiz, casa.replace(/[^A-Za-z0-9]/g, '-')));
  assert.strictEqual(conversa.transcriptsDaConversa(noProjeto.id), path.join(raiz, dir.replace(/[^A-Za-z0-9]/g, '-')));
  assert.strictEqual(conversa.pastaDosTranscripts(), path.join(raiz, casa.replace(/[^A-Za-z0-9]/g, '-')), 'sem argumento continua sendo a da pasta pessoal');
});
