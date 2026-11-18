// Área: conversa (pasta por conversa: janela "Nova conversa", cartão de confiança e a pasta na lateral; plano 3.1)
// Antes o "+ Nova conversa" abria direto, sempre na pasta pessoal. Agora abre uma janela para
// escolher a pasta e o motor; numa pasta que o app ainda não conhece, o Claude só sobe depois
// de a pessoa ver o que a pasta configura e responder o cartão (confiar, abrir sem as
// configurações do projeto ou cancelar). A lateral mostra a pasta de cada conversa.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const P = 'projetos/api-pedidos';
const PROJETO = {
  [`${P}/.claude/settings.json`]: JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './scripts/checa.sh' }] }] }, permissions: { allow: ['Bash(npm run:*)', 'Bash(git status)'] } }, null, 2),
  [`${P}/.mcp.json`]: JSON.stringify({ mcpServers: { banco: { command: 'npx', args: ['banco-mcp', '--so-leitura'] } } }, null, 2),
  [`${P}/CLAUDE.md`]: '# Regras do projeto\n',
  'projetos/vazio/leia.txt': 'nada configurado\n',
};
const lerLog = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const NOVA_ABERTA = "!document.getElementById('menu-nova').hidden && getComputedStyle(document.getElementById('menu-nova')).display !== 'none'";
const PASTAS = "[...document.querySelectorAll('#nova-pastas .nova-pasta')].map((l) => ({ pasta: l.querySelector('code').innerText, quando: l.querySelector('.nova-quando').innerText.trim(), marcada: l.querySelector('input').checked }))";
const LATERAL = "[...document.querySelectorAll('.item-conversa')].map((i) => ({ titulo: i.querySelector('.titulo-conversa').innerText, linha: i.querySelector('.pasta-conversa').innerText.replace(/\\s+/g, ' ').trim(), ativa: i.classList.contains('ativo') }))";
const CARTAO = "document.querySelector('#mensagens .cartao-pasta:not(.pasta-parada)')";
const blocos = (app) => app.avaliar(`[...${CARTAO}.querySelectorAll('.pasta-bloco')].map((b) => ({ titulo: b.querySelector('h4 span').innerText, itens: [...b.querySelectorAll('.pasta-lista li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim()) }))`);

test('pasta por conversa: janela "Nova conversa", cartão de confiança e a lateral', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false }, arquivos: PROJETO });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqPasta');
  const projeto = path.join(app.casa, P);
  const subidas = () => lerLog(log).filter((x) => Array.isArray(x.args));
  const mensagens = () => lerLog(log).filter((x) => x.type === 'user').map((x) => (typeof x.message.content === 'string' ? x.message.content : JSON.stringify(x.message.content)));
  const lateral = () => app.avaliar(LATERAL);
  const clicarDeVerdade = async (seletor) => {
    const r = await app.avaliar(`(() => { const e = document.querySelector(${JSON.stringify(seletor)}); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await app.mouse('mousePressed', r.x, r.y); await app.mouse('mouseReleased', r.x, r.y);
  };
  const abrirNova = async () => {
    await app.avaliar("document.getElementById('nova-conversa').click()");
    await app.esperar(NOVA_ABERTA);
  };
  const escolher = async (pasta) => {
    app.escrever('.orq-e2e-pasta-escolhida', pasta);
    await app.avaliar("document.getElementById('nova-escolher').click()");
  };

  await t.test('a lateral mostra a pasta de cada conversa; a do orquestrador é fixa', async () => {
    const l = await lateral();
    assert.strictEqual(l.length, 1);
    assert.deepStrictEqual([l[0].titulo, l[0].ativa], ['Orquestrador', true]);
    assert.match(l[0].linha, /^~ · pasta fixa · (pronta|pausada)$/);
  });

  await t.test('"+ Nova conversa" abre a janela com a pasta pessoal marcada e o Claude como motor; Esc fecha sem criar nada', async () => {
    assert.strictEqual(await app.avaliar("getComputedStyle(document.getElementById('menu-nova')).display"), 'none');
    await abrirNova();
    assert.deepStrictEqual(await app.avaliar(PASTAS), [{ pasta: '~', quando: 'sua pasta pessoal', marcada: true }]);
    assert.strictEqual(await app.avaliar("document.querySelector('#menu-nova [data-motor=claude]').getAttribute('aria-pressed')"), 'true');
    assert.strictEqual(await app.avaliar("document.getElementById('nova-aviso').hidden"), true);
    assert.strictEqual(await app.visivel('#nova-abrir'), 'ok');
    assert.ok(await app.avaliar("(() => { const m = document.getElementById('menu-nova').getBoundingClientRect(); return m.right <= innerWidth && m.left >= 0 && m.bottom <= innerHeight; })()"), 'a janela saiu da tela');
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!(${NOVA_ABERTA})`);
    assert.strictEqual((await lateral()).length, 1);
    assert.ok(await app.avaliar("document.activeElement === document.getElementById('nova-conversa')"));
  });

  await t.test('confirmar o padrão abre a conversa na pasta pessoal, sem cartão, como antes', async () => {
    await abrirNova();
    await app.avaliar("document.getElementById('nova-abrir').click()");
    await app.esperar("document.querySelectorAll('.item-conversa').length === 2");
    await app.esperar(`!(${NOVA_ABERTA})`);
    const l = await lateral();
    assert.deepStrictEqual({ linha: l[1].linha.replace(/ · (pronta|pausada)$/, ''), ativa: l[1].ativa }, { linha: '~', ativa: true });
    assert.strictEqual(await app.avaliar(`${CARTAO} === null`), true);
    await app.avaliar("window.orq.conversa.mandar(window.orqConversa.ativa(), 'oi da pasta pessoal')");
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /oi da pasta pessoal/.test(m.innerText))", 8000);
    for (let i = 0; i < 80 && !mensagens().length; i++) await new Promise((r) => setTimeout(r, 100)); // o Claude falso anota a mensagem quando a lê
    assert.deepStrictEqual(mensagens(), ['oi da pasta pessoal']);
  });

  await t.test('escolher outra pasta: entra marcada na lista e a janela avisa que é a primeira vez', async () => {
    await abrirNova();
    await escolher(projeto);
    await app.esperar(`(${PASTAS}).length === 2`, 8000);
    const l = await app.avaliar(PASTAS);
    assert.deepStrictEqual(l.map((x) => [x.pasta, x.marcada]), [['~/projetos/api-pedidos', true], ['~', false]]);
    assert.strictEqual(await app.avaliar("document.getElementById('nova-aviso').innerText"), 'Primeira vez nesta pasta: antes de abrir, o app mostra o que ela configura.');
    // Pasta que não serve (um arquivo): a janela diz e não muda a lista.
    await escolher(path.join(projeto, 'CLAUDE.md'));
    await app.esperar("document.getElementById('nova-aviso').classList.contains('erro')");
    assert.match(await app.avaliar("document.getElementById('nova-aviso').innerText"), /Não deu para usar esta pasta: não é uma pasta/);
    assert.strictEqual((await app.avaliar(PASTAS)).length, 2);
  });

  await t.test('abrir numa pasta nova: o cartão de confiança aparece e o Claude NÃO sobe antes da resposta', async () => {
    const antes = subidas().length;
    await app.avaliar("document.getElementById('nova-abrir').click()");
    await app.esperar(`${CARTAO} !== null`, 8000);
    assert.match(await app.avaliar(`${CARTAO}.querySelector('.titulo-pedido').innerText`), /Primeira vez nesta pasta: ~\/projetos\/api-pedidos/);
    const b = await blocos(app);
    assert.deepStrictEqual(b.map((x) => x.titulo), ['Comandos que rodam sozinhos', 'Servidores MCP', 'Regras que já permitem sem perguntar', 'Instruções para o Claude']);
    assert.deepStrictEqual(b[0].itens, ['./scripts/checa.sh antes de cada ferramenta do Claude (Bash)']);
    assert.deepStrictEqual(b[1].itens, ['banco → npx banco-mcp --so-leitura']);
    assert.deepStrictEqual(b[2].itens, ['Bash(npm run:*)', 'Bash(git status)']);
    assert.match(b[3].itens[0], /^CLAUDE\.md /);
    assert.deepStrictEqual(await app.avaliar(`[...${CARTAO}.querySelectorAll('[data-pasta]')].map((x) => x.innerText)`), ['Confiar e abrir', 'Abrir sem as configurações do projeto', 'Cancelar']);
    assert.ok(await app.avaliar(`${CARTAO}.scrollWidth <= ${CARTAO}.clientWidth`), 'o cartão rola para o lado');
    assert.strictEqual(subidas().length, antes, 'o Claude subiu antes de a pessoa responder o cartão');
    const l = await lateral();
    assert.deepStrictEqual({ linha: l[2].linha, ativa: l[2].ativa }, { linha: '~/projetos/api-pedidos · pergunta', ativa: true });
  });

  await t.test('clique por programa em "Confiar e abrir" não vale; só o clique de verdade da pessoa', async () => {
    const antes = subidas().length;
    await app.avaliar(`${CARTAO}.querySelector('[data-pasta=confiar]').click()`);
    await app.avaliar(`${CARTAO}.querySelector('[data-pasta=sem]').click()`);
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(await app.avaliar(`${CARTAO} !== null`), true, 'o cartão sumiu com um clique por programa');
    assert.strictEqual(subidas().length, antes);
  });

  await t.test('mensagem mandada com o cartão aberto espera na fila; confiar de verdade abre na pasta e a mensagem vai', async () => {
    await app.avaliar("window.orq.conversa.daCaixa(window.orqConversa.ativa(), 'primeira no projeto', [], null, {})");
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila').length === 1", 8000);
    const antes = subidas().length;
    await clicarDeVerdade('#mensagens .cartao-pasta [data-pasta=confiar]');
    await app.esperar(`${CARTAO} === null`, 8000);
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /primeira no projeto/.test(m.innerText))", 8000);
    // O Claude falso anota a subida e a mensagem quando as lê: com a máquina cheia isso chega um instante depois do balão.
    for (let i = 0; i < 80 && !(subidas().length === antes + 1 && mensagens().includes('primeira no projeto')); i++) await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(subidas().length, antes + 1);
    assert.ok(mensagens().includes('primeira no projeto'));
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-fila').length"), 0);
    const st = await app.avaliar("window.orq.comandos.controle(window.orqConversa.ativa(), 'get_status')");
    assert.strictEqual(st.sections[0].rows.find((r) => r.label === 'Pasta').value, projeto, 'o Claude não subiu na pasta escolhida');
    assert.match((await lateral())[2].linha, /^~\/projetos\/api-pedidos · /);
  });

  await t.test('da próxima vez a pasta aparece como já usada e abre sem cartão', async () => {
    await abrirNova();
    await app.esperar(`(${PASTAS}).length === 2 && (${PASTAS})[0].quando !== ''`, 8000);
    const l = await app.avaliar(PASTAS);
    assert.deepStrictEqual([l[0].pasta, l[0].quando, l[0].marcada], ['~/projetos/api-pedidos', 'usada agora há pouco', true]);
    await app.esperar("document.getElementById('nova-aviso').hidden", 8000);
    const antes = subidas().length;
    await app.avaliar("document.getElementById('nova-abrir').click()");
    await app.esperar("document.querySelectorAll('.item-conversa').length === 4");
    for (let i = 0; i < 80 && subidas().length !== antes + 1; i++) await new Promise((r) => setTimeout(r, 100)); // o Claude falso anota a subida quando começa a rodar
    assert.strictEqual(subidas().length, antes + 1);
    assert.strictEqual(await app.avaliar(`${CARTAO} === null`), true, 'perguntou de novo numa pasta já aceita e igual');
  });

  await t.test('a pasta mudou: o cartão volta dizendo o que mudou; "Cancelar" deixa a conversa parada, com o caminho de volta', async () => {
    const id = await app.avaliar('window.orqConversa.ativa()');
    await app.avaliar(`window.orq.conversa.mandar(${JSON.stringify(id)}, 'antes de mudar')`);
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /antes de mudar/.test(m.innerText))", 8000);
    await app.esperar("document.getElementById('parar').hidden", 8000);
    app.escrever(`${P}/.claude/settings.json`, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './scripts/checa.sh' }] }], Stop: [{ hooks: [{ type: 'command', command: 'npm run lint' }] }] }, permissions: { allow: ['Bash(npm run:*)', 'Bash(git status)'] } }, null, 2));
    await app.avaliar(`window.orq.conversa.reiniciar(${JSON.stringify(id)})`);
    await app.esperar(`${CARTAO} !== null`, 8000);
    assert.match(await app.avaliar(`${CARTAO}.querySelector('.titulo-pedido').innerText`), /Esta pasta mudou desde que você confiou nela: ~\/projetos\/api-pedidos/);
    const b = await blocos(app);
    assert.strictEqual(b[0].titulo, 'O que mudou desde a última vez');
    assert.ok(b[0].itens.some((x) => /npm run lint novo/.test(x)), JSON.stringify(b[0].itens));
    assert.ok(b[1].itens.some((x) => /npm run lint quando o Claude termina novo desde a última vez/.test(x)), JSON.stringify(b[1].itens));
    assert.ok(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /antes de mudar/.test(m.innerText))"), 'o histórico da conversa sumiu atrás do cartão');
    await app.avaliar(`${CARTAO}.querySelector('[data-pasta=cancelar]').click()`);
    await app.esperar("!!document.querySelector('#mensagens .pasta-parada [data-pasta-conferir]')", 8000);
    assert.strictEqual((await lateral()).length, 4, 'cancelar numa conversa que já existia tirou ela da lista');
    await app.avaliar("document.querySelector('#mensagens .pasta-parada [data-pasta-conferir]').click()");
    await app.esperar(`${CARTAO} !== null`, 8000);
  });

  await t.test('"Abrir sem as configurações do projeto": sobe só com as do usuário e a lateral diz isso', async () => {
    const antes = subidas().length;
    await clicarDeVerdade('#mensagens .cartao-pasta [data-pasta=sem]');
    await app.esperar(`${CARTAO} === null`, 8000);
    for (let i = 0; i < 80 && subidas().length !== antes + 1; i++) await new Promise((r) => setTimeout(r, 100));
    const args = subidas().pop().args;
    assert.ok(args.includes('--strict-mcp-config') && args[args.indexOf('--setting-sources') + 1] === 'user', JSON.stringify(args));
    assert.match((await lateral())[3].linha, /^~\/projetos\/api-pedidos · sem as configurações do projeto · /);
  });

  await t.test('cancelar o cartão de uma conversa que nem começou tira ela da lista e volta ao orquestrador', async () => {
    await abrirNova();
    await escolher(path.join(app.casa, 'projetos/vazio'));
    await app.esperar(`(${PASTAS})[0].pasta === '~/projetos/vazio'`, 8000);
    await app.avaliar("document.getElementById('nova-abrir').click()");
    await app.esperar(`${CARTAO} !== null`, 8000);
    assert.strictEqual(await app.avaliar(`${CARTAO}.querySelector('.pasta-vazia').innerText`), 'Esta pasta não configura nada que rode sozinho, nem instruções para o Claude.');
    assert.strictEqual((await lateral()).length, 5);
    await app.avaliar(`${CARTAO}.querySelector('[data-pasta=cancelar]').click()`);
    await app.esperar("document.querySelectorAll('.item-conversa').length === 4", 8000);
    await app.esperar("window.orqConversa.ativa() === 'orquestrador'");
    assert.match(await app.avaliar("([...document.querySelectorAll('#mensagens .aviso-conversa')].pop() || {}).innerText || ''"), /Cancelado: nenhuma conversa foi aberta\./);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('pasta por conversa em inglês', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  const app = await abrirApp({ config: { idioma: 'en', mostrarBichinho: false }, arquivos: PROJETO });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqPasta');

  await t.test('a janela e o cartão vêm em inglês; caminhos, comandos e regras ficam como são', async () => {
    assert.match(await app.avaliar("document.querySelector('.item-conversa .pasta-conversa').innerText.replace(/\\s+/g, ' ')"), /^~ · fixed folder · /);
    await app.avaliar("document.getElementById('nova-conversa').click()");
    await app.esperar(NOVA_ABERTA);
    assert.strictEqual(await app.avaliar("document.querySelector('#menu-nova .menu-titulo').innerText.toLowerCase()"), 'new conversation');
    assert.strictEqual(await app.avaliar("document.getElementById('nova-escolher').innerText"), 'Choose another folder…');
    assert.strictEqual(await app.avaliar("document.getElementById('nova-abrir').innerText"), 'Open conversation');
    assert.strictEqual(await app.avaliar("document.querySelector('#nova-pastas .nova-quando').innerText"), 'your home folder');
    app.escrever('.orq-e2e-pasta-escolhida', path.join(app.casa, P));
    await app.avaliar("document.getElementById('nova-escolher').click()");
    await app.esperar(`(${PASTAS}).length === 2`, 8000);
    assert.strictEqual(await app.avaliar("document.getElementById('nova-aviso').innerText"), 'First time in this folder: before opening, the app shows what it configures.');
    await app.avaliar("document.getElementById('nova-abrir').click()");
    await app.esperar(`${CARTAO} !== null`, 8000);
    assert.match(await app.avaliar(`${CARTAO}.querySelector('.titulo-pedido').innerText`), /First time in this folder: ~\/projetos\/api-pedidos/);
    const b = await blocos(app);
    assert.deepStrictEqual(b.map((x) => x.titulo), ['Commands that run by themselves', 'MCP servers', 'Rules that already allow without asking', 'Instructions for Claude']);
    assert.deepStrictEqual(b[0].itens, ['./scripts/checa.sh before each Claude tool (Bash)']);
    assert.deepStrictEqual(await app.avaliar(`[...${CARTAO}.querySelectorAll('[data-pasta]')].map((x) => x.innerText)`), ['Trust and open', "Open without the project's settings", 'Cancel']);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('pasta por conversa: o menu do chip da pasta e o Esc com o Claude trabalhando', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false }, arquivos: PROJETO });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqPasta');
  const projeto = path.join(app.casa, P);
  const MENU = "document.getElementById('menu-pasta')";
  const MENU_ABERTO = `!${MENU}.hidden && getComputedStyle(${MENU}).display !== 'none'`;
  const guardadas = () => JSON.parse(app.ler('.cache/orq-app/conversas-teste.json'));
  const clicarDeVerdade = async (seletor) => {
    const r = await app.avaliar(`(() => { const e = document.querySelector(${JSON.stringify(seletor)}); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await app.mouse('mousePressed', r.x, r.y); await app.mouse('mouseReleased', r.x, r.y);
  };
  const abrirMenu = async () => {
    await app.avaliar("document.getElementById('chip-pasta').click()");
    await app.esperar(MENU_ABERTO);
  };

  await t.test('no orquestrador o menu diz que a pasta é fixa e não oferece trocar nem adicionar', async () => {
    assert.strictEqual(await app.avaliar(`getComputedStyle(${MENU}).display`), 'none');
    await abrirMenu();
    await app.esperar(`!!${MENU}.querySelector('.pasta-fixa')`);
    assert.match(await app.avaliar(`${MENU}.querySelector('.pasta-caminho').innerText`), /^~ \(sua pasta pessoal\)$/);
    assert.match(await app.avaliar(`${MENU}.querySelector('.pasta-fixa').innerText`), /^O orquestrador roda sempre na pasta pessoal\./);
    assert.strictEqual(await app.avaliar(`${MENU}.querySelector('#pasta-adicionar')`), null);
    assert.ok(await app.avaliar(`(() => { const m = ${MENU}.getBoundingClientRect(); return m.right <= innerWidth && m.left >= 0 && m.bottom <= innerHeight; })()`), 'o menu saiu da tela');
    await app.avaliar("document.getElementById('chip-pasta').focus()");
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!(${MENU_ABERTO})`);
  });

  await t.test('numa conversa de projeto: mostra a pasta, adiciona uma pasta extra (o chip ganha +1) e tira de novo', async () => {
    const id = await app.avaliar(`window.orq.conversa.nova({ pasta: ${JSON.stringify(projeto)}, motor: 'claude' }).then((i) => window.__orqTeste.trocar(i).then(() => i))`);
    await app.esperar("!!document.querySelector('#mensagens .cartao-pasta [data-pasta=confiar]')", 8000);
    await clicarDeVerdade('#mensagens .cartao-pasta [data-pasta=confiar]');
    await app.esperar("document.querySelector('#mensagens .cartao-pasta') === null", 8000);
    await abrirMenu();
    await app.esperar(`!!${MENU}.querySelector('#pasta-adicionar')`, 8000);
    assert.strictEqual(await app.avaliar(`${MENU}.querySelector('.pasta-caminho').innerText`), '~/projetos/api-pedidos');
    assert.deepStrictEqual(await app.avaliar(`[...${MENU}.querySelectorAll('#pasta-extras li')].map((l) => l.innerText.trim())`), ['nenhuma']);
    assert.strictEqual(await app.avaliar("document.getElementById('info-pasta-extras').hidden"), true);
    app.escrever('.orq-e2e-pasta-escolhida', path.join(app.casa, 'projetos/vazio'));
    await app.avaliar(`${MENU}.querySelector('#pasta-adicionar').click()`);
    await app.esperar(`!!${MENU}.querySelector('[data-tirar]')`, 8000);
    assert.deepStrictEqual(await app.avaliar(`[...${MENU}.querySelectorAll('#pasta-extras li')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim())`), ['~/projetos/vazio Tirar']);
    await app.esperar("document.getElementById('info-pasta-extras').textContent === '+1'", 4000);
    assert.strictEqual(await app.visivel('#info-pasta-extras'), 'ok');
    assert.deepStrictEqual(guardadas().find((c) => c.id === id).pastasExtras, [path.join(app.casa, 'projetos/vazio')]);
    await app.avaliar(`${MENU}.querySelector('[data-tirar]').click()`);
    await app.esperar(`${MENU}.querySelector('[data-tirar]') === null && !!${MENU}.querySelector('#pasta-extras .pasta-mais')`, 8000);
    await app.esperar("document.getElementById('info-pasta-extras').hidden", 4000);
    assert.strictEqual(guardadas().find((c) => c.id === id).pastasExtras, undefined);
    assert.strictEqual(guardadas().find((c) => c.id === id).pasta, projeto, 'a pasta da conversa mudou ao mexer nas extras');
  });

  await t.test('"Abrir conversa nova em": abre outra conversa na pasta escolhida e a atual continua onde está', async () => {
    if (!(await app.avaliar(MENU_ABERTO))) await abrirMenu();
    await app.esperar(`${MENU}.querySelectorAll('[data-nova-em]').length >= 2`, 8000);
    assert.deepStrictEqual(await app.avaliar(`[...${MENU}.querySelectorAll('[data-nova-em]')].map((b) => b.innerText.trim())`), ['~/projetos/api-pedidos', '~']);
    const antes = await app.avaliar("document.querySelectorAll('.item-conversa').length");
    await app.avaliar(`[...${MENU}.querySelectorAll('[data-nova-em]')].pop().click()`);
    await app.esperar(`document.querySelectorAll('.item-conversa').length === ${antes + 1}`, 8000);
    await app.esperar(`!(${MENU_ABERTO})`);
    const l = await app.avaliar(LATERAL);
    assert.deepStrictEqual([l[l.length - 1].ativa, l[l.length - 1].linha.replace(/ · (pronta|pausada)$/, '')], [true, '~']);
    assert.match(l[1].linha, /^~\/projetos\/api-pedidos · /);
  });

  await t.test('com o Claude trabalhando, o Esc fecha a janela "Nova conversa" e o menu da pasta sem parar o Claude', async () => {
    await app.avaliar("window.orq.conversa.mandar(window.orqConversa.ativa(), 'trabalha até parar')");
    await app.esperar("!document.getElementById('parar').hidden", 8000);
    await app.avaliar("document.getElementById('nova-conversa').click()");
    await app.esperar(NOVA_ABERTA);
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!(${NOVA_ABERTA})`);
    await abrirMenu();
    await app.avaliar("document.getElementById('chip-pasta').focus()");
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!(${MENU_ABERTO})`);
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(await app.avaliar("document.getElementById('parar').hidden"), false, 'o Esc dado para fechar o menu parou o Claude');
    assert.ok(!lerLog(log).some((o) => o.type === 'control_request' && o.request.subtype === 'interrupt'));
    // Sem menu aberto, o Esc volta a parar o Claude.
    await app.avaliar("document.getElementById('entrada').focus()");
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar("document.getElementById('parar').hidden", 8000);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('pasta de projeto com agente em container: o cartão diz por que volta sempre e o aceite não vai para o disco', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  // Nos testes de tela o Docker de verdade não roda: a pasta "com container" é a que tem este arquivo.
  const app = await abrirApp({ config: { mostrarBichinho: false }, arquivos: { ...PROJETO, [`${P}/.orq-e2e-container`]: '' } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqPasta');
  const projeto = path.join(app.casa, P);

  await t.test('o cartão explica que o aceite vale só com o app aberto; confiar abre e nada fica guardado como aceito', async () => {
    await app.avaliar(`window.orq.conversa.nova({ pasta: ${JSON.stringify(projeto)}, motor: 'claude' }).then((i) => window.__orqTeste.trocar(i))`);
    await app.esperar(`${CARTAO} !== null`, 8000);
    assert.match(await app.avaliar(`${CARTAO}.querySelector('.pasta-nota').innerText`), /^Esta pasta é de um projeto com agente em container/);
    const r = await app.avaliar(`(() => { const b = ${CARTAO}.querySelector('[data-pasta=confiar]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await app.mouse('mousePressed', r.x, r.y); await app.mouse('mouseReleased', r.x, r.y);
    await app.esperar(`${CARTAO} === null`, 8000);
    let guardado = {};
    try { guardado = JSON.parse(app.ler('.config/orq-app/confianca.json')).pastas || {}; } catch { /* o arquivo nem foi criado */ }
    assert.strictEqual(Object.prototype.hasOwnProperty.call(guardado, projeto), false, 'o aceite de uma pasta com container foi gravado');
    // Reinício com o app aberto e a pasta igual: não pergunta de novo.
    await app.avaliar('window.orq.conversa.reiniciar(window.orqConversa.ativa())');
    await new Promise((x) => setTimeout(x, 800));
    assert.strictEqual(await app.avaliar(`${CARTAO} === null`), true, 'perguntou de novo com o app aberto e a pasta igual');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
