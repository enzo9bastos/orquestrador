// Área: conversa (comandos do "/": tudo o que funciona no Claude Code ou no
// Codex funciona no app. Cada jeito tem pelo menos um teste que executa o
// comando e confere a tela: (a) texto, (b) pedido de controle, (c) arquivo,
// (d) estado da sessão, (e) equivalente do app, (t) terminal.)
// O que mexe em arquivo do usuário roda na casa temporária e confere o arquivo.
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { abrirApp } = require('./app');
const { CATALOGO } = require('../../comandos');

const CLAUDE_FALSO = path.join(__dirname, '..', 'unit', 'claude-falso.js');
const CODEX_FALSO = path.join(__dirname, '..', 'unit', 'codex-falso.js');
const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const pedidos = (log, subtype) => linhas(log).filter((o) => o.type === 'control_request' && o.request && o.request.subtype === subtype);
const popupDe = (cmd) => `document.querySelector('#popup:not([hidden]) .cmd-popup[data-cmd="${cmd}"]')`;
const textoPopup = "document.getElementById('popup-corpo').innerText";
const ultimoAviso = "([...document.querySelectorAll('#mensagens .aviso-conversa')].pop() || {}).innerText || ''";

async function enviar(app, texto) {
  await app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(texto)}; e.dispatchEvent(new Event('input')); })()`);
  await app.tecla('Escape', 'Escape', 27);
  await app.avaliar("document.getElementById('compositor').requestSubmit()");
}
async function fecharPopup(app) { await app.avaliar("document.getElementById('fechar-popup').click()"); }
const avisos = (app) => app.avaliar("document.querySelectorAll('#mensagens .aviso-conversa').length");

test('comandos do Claude: cada jeito funciona de verdade', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  process.env.CLAUDE_FALSO_COMANDOS = JSON.stringify(['compact', 'agents', 'fast', 'heapdump', 'workflow-launch-exec', 'doctor']);
  const settings = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo antes' }, { type: 'command', command: 'echo depois' }] }] } };
  const app = await abrirApp({
    config: { iasCaminhos: { claude: CLAUDE_FALSO } },
    arquivos: {
      '.claude/CLAUDE.md': '# Regras da Ana\n',
      '.claude/settings.json': JSON.stringify(settings, null, 2),
      '.claude/agents/revisor.md': '---\nname: revisor\ndescription: Revisa código\n---\n\nRevise.\n',
      '.claude/skills/usa-revisor/SKILL.md': '---\nname: usa-revisor\ndescription: x\n---\nChame o revisor.\n',
      '.claude/cache/changelog.md': '# Changelog\n\n## 9.9.9\n\n- Coisa nova da 9.9.9\n\n## 9.9.8\n\n- Coisa velha\n',
    },
  });
  t.after(() => { delete process.env.CLAUDE_FALSO_COMANDOS; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'oi')");
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].some((e) => e.textContent.trim() === 'ok')", 10000);

  await t.test('a lista do "/" tem o catálogo inteiro + o que o init trouxe, nenhum cinza', async () => {
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.focus(); e.value = '/'; e.dispatchEvent(new Event('input')); })()");
    await app.esperar("!document.getElementById('sugestoes').hidden");
    const nomes = await app.avaliar("[...document.querySelectorAll('#sugestoes li .nome-comando')].map((e) => e.textContent.split(' ')[0])");
    for (const c of CATALOGO.claude) assert.ok(nomes.includes(`/${c.nome}`), `/${c.nome} fora da lista`);
    assert.ok(nomes.includes('/doctor'), 'a skill do init sumiu');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#sugestoes li.bloqueado, #sugestoes .dica-bloqueado').length"), 0);
    await app.tecla('Escape', 'Escape', 27);
  });

  await t.test('(a) /compact vai como texto ao Claude', async () => {
    await enviar(app, '/compact');
    await app.espera(300);
    await app.espera(300);
    assert.ok(linhas(log).some((o) => o.type === 'user' && o.message.content === '/compact'));
  });

  await t.test('(a) /heapdump pede confirmação antes; confirmado, vai e a saída aparece', async () => {
    await enviar(app, '/heapdump');
    await app.esperar(popupDe('heapdump'));
    assert.match(await app.avaliar(textoPopup), /credenciais/);
    assert.ok(!linhas(log).some((o) => o.type === 'user' && o.message.content === '/heapdump'), 'foi antes de confirmar');
    await app.avaliar(`${popupDe('heapdump')}.querySelector('[data-sim]').click()`);
    await app.esperar("[...document.querySelectorAll('#mensagens .saida-comando')].some((e) => /Heap dump written/.test(e.textContent))", 8000);
  });

  await t.test('(b) /status mostra as seções do get_status', async () => {
    await enviar(app, '/status');
    await app.esperar(`${popupDe('status')} && /ana@exemplo.com/.test(${textoPopup})`, 8000);
    assert.match(await app.avaliar(textoPopup), /Versão[\s\S]*9\.9\.9/);
    assert.strictEqual(pedidos(log, 'get_status').length, 1);
    await fecharPopup(app);
  });

  await t.test('(b) /btw: pergunta de lado vira cartão com a resposta, sem entrar na conversa', async () => {
    await enviar(app, '/btw qual o arquivo?');
    await app.esperar("[...document.querySelectorAll('.cartao-btw .cartao-resposta')].some((e) => /resposta de lado para: qual o arquivo\\?/.test(e.textContent))", 8000);
    assert.strictEqual(pedidos(log, 'side_question')[0].request.question, 'qual o arquivo?');
    assert.ok(!linhas(log).some((o) => o.type === 'user' && /btw/.test(JSON.stringify(o.message.content))), 'o /btw foi como mensagem');
  });

  await t.test('(b) /skill-doctor ordena as skills pelo custo em tokens', async () => {
    await enviar(app, '/skill-doctor');
    await app.esperar(`${popupDe('skills')} && /pesada/.test(${textoPopup})`, 8000);
    const t1 = await app.avaliar(textoPopup);
    assert.ok(t1.indexOf('pesada') < t1.indexOf('rodada'), 'a skill mais cara não veio primeiro');
    await fecharPopup(app);
  });

  await t.test('(b) /plan liga o modo plano por set_permission_mode; /plan open mostra o plano', async () => {
    await enviar(app, '/plan');
    await app.esperar(`/Modo plano ligado/.test(${ultimoAviso})`, 8000);
    assert.strictEqual(pedidos(log, 'set_permission_mode').at(-1).request.mode, 'plan');
    await enviar(app, '/plan open');
    await app.esperar(`${popupDe('plan')} && /Plano falso/.test(${textoPopup})`, 8000);
    await fecharPopup(app);
  });

  await t.test('(c) /memory abre o CLAUDE.md do usuário, grava e guarda a versão anterior', async () => {
    await enviar(app, '/memory');
    await app.esperar(`${popupDe('memory')} && !!document.querySelector('#popup-corpo [data-i]')`, 8000);
    await app.avaliar("document.querySelector('#popup-corpo [data-i=\"0\"]').click()");
    await app.esperar("!!document.querySelector('#popup-corpo textarea.cmd-editor')");
    assert.strictEqual(await app.avaliar("document.querySelector('#popup-corpo textarea').value"), '# Regras da Ana\n');
    await app.avaliar("(() => { const t = document.querySelector('#popup-corpo textarea'); t.value = '# Regras da Ana\\n- nova regra\\n'; document.querySelector('#popup-corpo [data-gravar]').click(); })()");
    await app.esperar(`/Gravado/.test(${ultimoAviso})`);
    assert.strictEqual(app.ler('.claude/CLAUDE.md'), '# Regras da Ana\n- nova regra\n');
    const copias = fs.readdirSync(path.join(app.casa, '.local/share/orq-app/versoes/claude-arquivos'));
    assert.ok(copias.some((c) => c.endsWith('CLAUDE.md')), 'sem cópia da versão anterior');
  });

  await t.test('(c) /hooks: tirar um hook mostra o custo; confirmado, grava só o bloco hooks', async () => {
    await enviar(app, '/hooks');
    await app.esperar(`${popupDe('hooks')} && /echo antes/.test(${textoPopup}) && /Plugin falso/.test(${textoPopup})`, 8000);
    await app.avaliar("document.querySelector('#popup-corpo [data-editar=\"0\"]').click()");
    await app.esperar("!!document.querySelector('#popup-corpo textarea.cmd-editor')");
    const so1 = JSON.stringify({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo antes' }] }] });
    await app.avaliar(`(() => { document.querySelector('#popup-corpo textarea').value = ${JSON.stringify(so1)}; document.querySelector('#popup-corpo [data-gravar]').click(); })()`);
    await app.esperar(`${popupDe('hooks')} && /1 hook\\(s\\) somem/.test(${textoPopup})`);
    assert.match(app.ler('.claude/settings.json'), /echo depois/, 'gravou antes de confirmar');
    await app.avaliar("document.querySelector('#popup-corpo [data-sim]').click()");
    await app.esperar(`/Hooks gravados/.test(${ultimoAviso})`);
    const s = JSON.parse(app.ler('.claude/settings.json'));
    assert.strictEqual(s.model, 'opus', 'o resto do settings mudou');
    assert.deepStrictEqual(s.hooks.PreToolUse[0].hooks.map((h) => h.command), ['echo antes']);
  });

  await t.test('(c) /agents cria um subagente e apaga outro com o custo e a cópia', async () => {
    await enviar(app, '/agents');
    await app.esperar(`${popupDe('agents')} && /revisor/.test(${textoPopup})`, 8000);
    await app.avaliar("document.querySelector('#popup-corpo [data-novo]').click()");
    await app.avaliar(`(() => { const c = (k) => document.querySelector('#popup-corpo [data-campo="' + k + '"]');
      c('nome').value = 'tradutor'; c('descricao').value = 'Traduz textos'; c('prompt').value = 'Traduza.';
      document.querySelector('#popup-corpo [data-criar]').click(); })()`);
    await app.esperar(`/Subagente criado/.test(${ultimoAviso})`);
    assert.match(app.ler('.claude/agents/tradutor.md'), /name: tradutor\ndescription: Traduz textos/);
    await app.esperar(`/tradutor/.test(${textoPopup})`);
    const i = await app.avaliar("[...document.querySelectorAll('#popup-corpo .cmd-agente')].findIndex((li) => /revisor/.test(li.innerText))");
    await app.avaliar(`document.querySelector('#popup-corpo [data-apagar="${i}"]').click()`);
    await app.esperar(`/1 arquivo some/.test(${textoPopup})`);
    const custo = await app.avaliar(textoPopup);
    assert.match(custo, /usa-revisor/, 'não disse onde o nome é citado (o que fica órfão)');
    assert.ok(fs.existsSync(path.join(app.casa, '.claude/agents/revisor.md')), 'apagou antes de confirmar');
    await app.avaliar("document.querySelector('#popup-corpo [data-sim]').click()");
    await app.esperar(`/Subagente apagado/.test(${ultimoAviso})`);
    assert.ok(!fs.existsSync(path.join(app.casa, '.claude/agents/revisor.md')));
    const copias = fs.readdirSync(path.join(app.casa, '.local/share/orq-app/apagados/agentes'));
    assert.ok(copias.some((c) => c.endsWith('revisor.md')), 'sem a cópia do apagado');
    await fecharPopup(app);
  });

  await t.test('(c) /todos mostra a última lista do TodoWrite do transcript', async () => {
    const e = await app.avaliar("window.orq.comandos.estado('orquestrador')");
    const dir = path.join(app.casa, '.claude', 'projects', app.casa.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    const uso = (todos) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos } }] }, timestamp: '2026-11-16T10:00:00Z' });
    fs.writeFileSync(path.join(dir, `${e.sessao}.jsonl`), [uso([{ content: 'velha', status: 'pending' }]), uso([{ content: 'Ler o código', status: 'completed' }, { content: 'Escrever o teste', status: 'in_progress' }])].join('\n') + '\n');
    await enviar(app, '/todos');
    await app.esperar(`${popupDe('todos')} && /Escrever o teste/.test(${textoPopup})`);
    assert.doesNotMatch(await app.avaliar(textoPopup), /velha/);
    await fecharPopup(app);
  });

  await t.test('(c) /release-notes mostra a seção da versão instalada', async () => {
    await enviar(app, '/release-notes');
    await app.esperar(`${popupDe('release-notes')} && /Coisa nova da 9\\.9\\.9/.test(${textoPopup})`);
    await fecharPopup(app);
  });

  await t.test('(c) /help lista todos os comandos com o jeito de cada um', async () => {
    await enviar(app, '/help');
    await app.esperar(popupDe('help'));
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#popup-corpo .cmd-ajuda tr').length"), await app.avaliar('window.orqConversa.comandos().length'));
    assert.match(await app.avaliar(textoPopup), /abre no terminal/);
    await fecharPopup(app);
  });

  await t.test('(d) /fast liga o modo rápido ao vivo (apply_flag_settings fastMode) e /fast off desliga', async () => {
    await enviar(app, '/fast');
    await app.esperar(`/Modo rápido ligado/.test(${ultimoAviso})`, 8000);
    assert.deepStrictEqual(pedidos(log, 'apply_flag_settings').at(-1).request.settings, { fastMode: true });
    await enviar(app, '/fast off');
    await app.esperar(`/Modo rápido desligado/.test(${ultimoAviso})`, 8000);
    assert.deepStrictEqual(pedidos(log, 'apply_flag_settings').at(-1).request.settings, { fastMode: false });
  });

  await t.test('(d) /add-dir reinicia o Claude com --add-dir, avisando antes', async () => {
    fs.mkdirSync(path.join(app.casa, 'projeto-x'));
    const subidas = linhas(log).filter((o) => o.args).length;
    await enviar(app, `/add-dir ${path.join(app.casa, 'projeto-x')}`);
    await app.esperar(`/Pasta adicionada/.test([...document.querySelectorAll('#mensagens .aviso-conversa')].map((e) => e.innerText).join(' '))`, 8000);
    for (let i = 0; i < 50 && linhas(log).filter((o) => o.args).length === subidas; i++) await app.espera(100);
    const args = linhas(log).filter((o) => o.args).at(-1).args;
    assert.strictEqual(args[args.indexOf('--add-dir') + 1], path.join(app.casa, 'projeto-x'));
    assert.ok(args.includes('--settings'), 'o modo rápido escolhido não voltou no reinício');
  });

  // D16.3 (17/11/2026): o /exit fecha só a conversa, sem perguntar; o app continua aberto.
  await t.test('(e) /exit encerra só esta conversa: a tela limpa, o app continua e dá para voltar à sessão', async () => {
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'antes do exit')");
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].some((b) => b.dataset.texto === 'antes do exit') && document.getElementById('trabalhando').hidden", 10000);
    await enviar(app, '/exit');
    await app.esperar("!!document.querySelector('#mensagens .conversa-encerrada')", 8000);
    assert.strictEqual(await app.avaliar("document.getElementById('popup').hidden"), true, 'sem confirmação de fechar o app');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length"), 0, 'a tela fica limpa');
    assert.match(await app.avaliar("document.querySelector('#mensagens .conversa-encerrada').innerText"), /Conversa encerrada[\s\S]*a próxima mensagem começa uma sessão nova/);
    assert.ok(await app.avaliar('!!document.getElementById("entrada")'), 'o app continua aberto');
    assert.ok(!linhas(log).some((o) => o.type === 'user' && /^\/exit/.test(typeof o.message.content === 'string' ? o.message.content : '')), 'o /exit não vai ao Claude como texto');
    // Voltar à sessão encerrada traz o histórico de volta.
    await app.avaliar("document.querySelector('#mensagens .conversa-encerrada [data-voltar-sessao]').click()");
    await app.esperar("!document.querySelector('#mensagens .conversa-encerrada')", 8000);
    assert.ok(linhas(log).filter((o) => o.args).pop().args.includes('--resume'), 'a sessão anterior foi retomada');
  });

  await t.test('(e) /vim diz o que fez (a caixa não tem modo vim)', async () => {
    await enviar(app, '/vim');
    await app.esperar(`/não tem modo vim/.test(${ultimoAviso})`);
  });

  await t.test('(t) /login cola no terminal do app o Claude com uma cópia da conversa e o comando', async () => {
    await app.avaliar('window.__colado = []; window.orqTerminal = { colar: async (t) => { window.__colado.push(t); return true; } }');
    const e = await app.avaliar("window.orq.comandos.estado('orquestrador')");
    await enviar(app, '/login');
    await app.esperar('window.__colado.length === 1');
    const linha = await app.avaliar('window.__colado[0]');
    assert.ok(linha.includes(`--resume '${e.sessao}' --fork-session '/login'`), linha);
    assert.match(await app.avaliar(ultimoAviso), /terminal do Claude/);
    assert.ok(!linhas(log).some((o) => o.type === 'user' && o.message.content === '/login'), 'o /login foi como texto');
  });

  // Plano 1.4 (K6): comando que não está na lista do app e que o Claude diz só existir
  // na tela do terminal. O texto do Claude fica; o app explica em português e oferece
  // abrir no terminal (nada é colado sem a pessoa pedir).
  await t.test('(t) comando que o Claude diz não existir aqui: o texto dele fica, o app explica em português e o botão abre no terminal', async () => {
    await app.avaliar('window.__colado = []; window.orqTerminal = { colar: async (t) => { window.__colado.push(t); return true; } }');
    const e = await app.avaliar("window.orq.comandos.estado('orquestrador')");
    await enviar(app, '/so-no-terminal agora');
    await app.esperar("!!document.querySelector('#mensagens .aviso-indisponivel')", 8000);
    assert.ok(await app.avaliar("[...document.querySelectorAll('#mensagens .texto-claude')].some((x) => /\\/so-no-terminal isn't available in this environment\\./.test(x.textContent))"), 'o texto do Claude continua na tela');
    const texto = await app.avaliar("document.querySelector('#mensagens .aviso-indisponivel').innerText");
    assert.match(texto, /\/so-no-terminal/);
    assert.match(texto, /só existe na tela do terminal do Claude/);
    assert.strictEqual(await app.avaliar('window.__colado.length'), 0, 'nada é colado sem a pessoa pedir');
    await app.avaliar("document.querySelector('#mensagens .aviso-indisponivel [data-abrir-terminal]').click()");
    await app.esperar('window.__colado.length === 1');
    const linha = await app.avaliar('window.__colado[0]');
    assert.ok(linha.includes(`--resume '${e.sessao}' --fork-session '/so-no-terminal agora'`), linha);
    assert.match(await app.avaliar(ultimoAviso), /colei no terminal do app/);
  });

  await t.test('(b) /tasks mostra a tarefa de fundo, a saída e o Parar', async () => {
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'começa tarefa de fundo')");
    await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].some((e) => /tarefa de fundo começou/.test(e.textContent))", 8000);
    await enviar(app, '/tasks');
    await app.esperar(`${popupDe('tasks')} && /sleep 300/.test(${textoPopup})`);
    await app.avaliar("document.querySelector('#popup-corpo [data-saida]').click()");
    await app.esperar(`/saída da tarefa t-fundo/.test(${textoPopup})`);
    await app.avaliar("document.querySelector('#popup-corpo [data-parar]').click()");
    await app.espera(300);
    for (let i = 0; i < 30 && !pedidos(log, 'stop_task').length; i++) await app.espera(100);
    assert.strictEqual(pedidos(log, 'stop_task')[0].request.task_id, 't-fundo');
    await fecharPopup(app);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('comandos do Claude: sem o pedido de controle, o /status mostra o que o init contou', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_SEM_CONTROLES = '1';
  const app = await abrirApp({ config: { iasCaminhos: { claude: CLAUDE_FALSO } } });
  t.after(() => { delete process.env.CLAUDE_FALSO_SEM_CONTROLES; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'oi')");
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].some((e) => e.textContent.trim() === 'ok')", 10000);
  await t.test('o popup diz que o Claude não respondeu e mostra versão, modelo e MCP do init', async () => {
    await enviar(app, '/status');
    await app.esperar(`${popupDe('status')} && /não respondeu/.test(${textoPopup})`, 8000);
    const tx = await app.avaliar(textoPopup);
    assert.match(tx, /9\.9\.9/);
    assert.match(tx, /falso-mcp/);
  });
  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('comandos do Codex: os do app-server funcionam pelo método dele', async (t) => {
  const log = path.join(pastaTemporaria('orq-codex-falso-'), 'log.jsonl');
  process.env.CODEX_FALSO_LOG = log;
  const app = await abrirApp({ config: { iaOrquestrador: 'codex', iasCaminhos: { codex: CODEX_FALSO } } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  await app.esperar("window.orq.comandos.estado('orquestrador').then((e) => !!e.sessao)", 8000);
  const metodo = (m) => linhas(log).filter((o) => o.method === m);

  await t.test('a lista tem o catálogo do Codex inteiro', async () => {
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.focus(); e.value = '/'; e.dispatchEvent(new Event('input')); })()");
    await app.esperar("!document.getElementById('sugestoes').hidden");
    const nomes = await app.avaliar("[...document.querySelectorAll('#sugestoes li .nome-comando')].map((e) => e.textContent.split(' ')[0])");
    for (const c of CATALOGO.codex) assert.ok(nomes.includes(`/${c.nome}`), `/${c.nome} fora da lista`);
    await app.tecla('Escape', 'Escape', 27);
  });

  await t.test('(b) /compact chama thread/compact/start; nada vai como texto', async () => {
    const n = await avisos(app);
    await enviar(app, '/compact');
    await app.esperar(`document.querySelectorAll('#mensagens .aviso-conversa').length > ${n}`);
    assert.strictEqual(metodo('thread/compact/start')[0].params.threadId, 'th-novo');
    assert.ok(!metodo('turn/start').length, 'o /compact foi como texto');
  });

  await t.test('(b) /review chama review/start com as mudanças não commitadas', async () => {
    await enviar(app, '/review');
    await app.esperar(`/revisando/.test(${ultimoAviso})`);
    assert.deepStrictEqual(metodo('review/start')[0].params.target, { type: 'uncommittedChanges' });
  });

  await t.test('(b) /status mostra o modelo e as janelas de uso (account/rateLimits/read)', async () => {
    await enviar(app, '/status');
    await app.esperar(`${popupDe('status')} && /40% usados/.test(${textoPopup})`, 8000);
    assert.match(await app.avaliar(textoPopup), /gpt-falso/);
    await fecharPopup(app);
  });

  await t.test('(b) /resume lista as conversas (thread/list)', async () => {
    await enviar(app, '/resume');
    await app.esperar(`${popupDe('resume')} && /oi antigo/.test(${textoPopup})`, 8000);
    await fecharPopup(app);
  });

  await t.test('(b) /ps lista os terminais em segundo plano (thread/backgroundTerminals/list)', async () => {
    await enviar(app, '/ps');
    await app.esperar(`${popupDe('ps')} && /npm run dev/.test(${textoPopup})`, 8000);
    assert.strictEqual(metodo('thread/backgroundTerminals/list')[0].params.threadId, 'th-novo');
    await fecharPopup(app);
  });

  await t.test('(b) /stop pede confirmação e só então para os terminais (thread/backgroundTerminals/clean)', async () => {
    await enviar(app, '/stop');
    await app.esperar(`${popupDe('stop')} && /Parar os terminais em segundo plano\?/.test(document.getElementById('popup').innerText)`, 8000);
    assert.strictEqual(metodo('thread/backgroundTerminals/clean').length, 0, 'parou antes de confirmar');
    await app.avaliar(`${popupDe('stop')}.querySelector('[data-sim]').click()`);
    await app.esperar(`/Terminais em segundo plano parados/.test(${ultimoAviso})`, 8000);
    assert.strictEqual(metodo('thread/backgroundTerminals/clean')[0].params.threadId, 'th-novo');
  });

  await t.test('(a) /init manda o pedido do AGENTS.md (o app-server não entende "/init")', async () => {
    await enviar(app, '/init');
    await app.espera(300);
    for (let i = 0; i < 50 && !metodo('turn/start').length; i++) await app.espera(100);
    const txt = JSON.stringify(metodo('turn/start')[0].params.input);
    assert.match(txt, /Generate a file named AGENTS\.md/);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
