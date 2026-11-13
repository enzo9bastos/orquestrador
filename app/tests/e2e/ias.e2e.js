// Área: ias
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirApp } = require('./app');

// CLIs de mentira numa pasta temporária, primeira no PATH do app. O "claude"
// de mentira só responde a versão (a conversa do orquestrador que o app sobe
// sozinho sai na hora, sem chamar IA nenhuma).
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-ias-bin-'));
function cli(nome, versao) {
  fs.writeFileSync(path.join(bin, nome), `#!/bin/sh\n[ "$1" = --version ] && echo "${versao}"\nexit 0\n`, { mode: 0o755 });
}
cli('claude', '9.8.7 (Claude Code)');
cli('codex', 'codex-cli 0.41.2');

async function abrirComCLIs(config) {
  const antes = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  try { return await abrirApp({ config }); } finally { process.env.PATH = antes; }
}
const cartao = (app, id) => app.avaliar(`(() => { const li = document.querySelector('#config-ias li[data-ia="${id}"]'); return li && { estado: li.querySelector('.estado').textContent.trim(), ok: !!li.querySelector('.ponto.ok'), caminho: (() => { const c = li.querySelector('[data-ia-caminho]'); return c.value || c.placeholder.replace(/ \\(achado no PATH\\)$/, ''); })(), emBreve: !!li.querySelector('.em-breve') }; })()`);

test('ias: IAs conectadas na engrenagem', async (t) => {
  // Escolha guardada que o app ainda não conduz: tem de cair no Claude, com aviso.
  const app = await abrirComCLIs({ iaOrquestrador: 'gemini' });
  t.after(() => app.fechar());
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.esperar("document.querySelectorAll('#config-ias li[data-ia]').length === 7", 15000);

  await t.test('um cartão por CLI, com versão, caminho e o que ainda não é suportado', async () => {
    assert.deepStrictEqual(await cartao(app, 'claude'), { estado: 'instalado v9.8.7', ok: true, caminho: path.join(bin, 'claude'), emBreve: false });
    assert.deepStrictEqual(await cartao(app, 'codex'), { estado: 'instalado v0.41.2', ok: true, caminho: path.join(bin, 'codex'), emBreve: false });
    const gemini = await cartao(app, 'gemini');
    assert.strictEqual(gemini.estado, 'não encontrado');
    assert.strictEqual(gemini.ok, false);
    assert.strictEqual(gemini.emBreve, true);
    await app.avaliar("document.getElementById('config-aba-ias').click()");
    await app.avaliar("document.querySelector('#config-ias li[data-ia=\"claude\"]').scrollIntoView({ block: 'center' })");
    assert.strictEqual(await app.visivel('#config-ias li[data-ia="claude"]'), 'ok');
  });

  await t.test('só dá para escolher o que o app conduz e está instalado', async () => {
    const opcoes = await app.avaliar("[...document.querySelectorAll('#config-ia-orquestrador option')].map((o) => [o.value, o.disabled])");
    assert.deepStrictEqual(Object.fromEntries(opcoes), { claude: false, codex: false, gemini: true, opencode: true, cursor: true, aider: true, qwen: true });
    assert.strictEqual(await app.avaliar("document.getElementById('config-ia-agentes').value"), 'claude', 'sem configuração: claude');
  });

  await t.test('escolha não suportada: o aviso diz que o app usa o Claude', async () => {
    assert.strictEqual(await app.avaliar("document.getElementById('config-ia-orquestrador').value"), 'gemini');
    assert.strictEqual(await app.avaliar("document.getElementById('config-ia-aviso').hidden"), false);
    assert.strictEqual(await app.avaliar("document.getElementById('config-ia-aviso').textContent.trim()"), 'O orquestrador: Gemini CLI ainda não roda aqui; o app usa o Claude Code.');
  });

  await t.test('trocar para o Claude grava e tira o aviso', async () => {
    await app.avaliar("(() => { const s = document.getElementById('config-ia-orquestrador'); s.value = 'claude'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await app.esperar("document.getElementById('config-ia-aviso').hidden");
    assert.strictEqual(JSON.parse(app.ler('.config/orq-app/config.json')).iaOrquestrador, 'claude');
  });

  await t.test('"Detectar de novo" acha um CLI instalado depois', async () => {
    cli('gemini', '0.9.0');
    await app.avaliar("document.getElementById('config-ias-detectar').click()");
    await app.esperar("(document.querySelector('#config-ias li[data-ia=\"gemini\"] .estado') || {}).textContent === 'instalado v0.9.0'", 10000);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('ias: em inglês', async (t) => {
  const app = await abrirComCLIs({ idioma: 'en', iaAgentes: 'gemini' });
  t.after(() => app.fechar());
  await app.esperar("window.orqI18n && window.orqI18n.idioma() === 'en'", 15000);
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.esperar("document.querySelectorAll('#config-ias li[data-ia]').length === 7", 15000);

  await t.test('a seção, os cartões e o aviso aparecem traduzidos', async () => {
    const secoes = await app.avaliar("[...document.querySelectorAll('#config .config-secao')].map((h) => h.textContent.trim())");
    assert.ok(secoes.includes('Connected AIs (CLI)'), secoes.join(' | '));
    await app.esperar("document.querySelector('#config-ias li[data-ia=\"claude\"] .estado').textContent === 'installed v9.8.7'");
    await app.esperar("document.querySelector('#config-ias li[data-ia=\"aider\"] .estado').textContent === 'not found'");
    await app.esperar("document.querySelector('#config-ias li[data-ia=\"gemini\"] .em-breve').textContent === 'coming soon as Orchestrator'");
    await app.esperar("document.querySelector('#config-ia-agentes option[value=\"gemini\"]').textContent === 'Gemini CLI — coming soon'");
    await app.esperar("document.getElementById('config-ia-aviso').textContent.trim() === \"New agents: Gemini CLI doesn't run here yet; the app uses Claude Code.\"");
    assert.strictEqual(await app.avaliar("document.getElementById('config-ias-detectar').textContent.trim()"), 'Detect again');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

// Caminho escolhido: um "claude" de mentira fora do PATH, que anota quando é
// aberto para conversar (sem --version). O PATH do app não tem claude nenhum.
test('ias: caminho escolhido para o CLI', async (t) => {
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-ias-fora-'));
  const falso = path.join(fora, 'claude-meu');
  const marca = path.join(fora, 'abriu.txt');
  fs.writeFileSync(falso, `#!/bin/sh\n[ "$1" = --version ] && { echo "6.5.4 (Claude Code)"; exit 0; }\necho "$@" >> "${marca}"\nexit 0\n`, { mode: 0o755 });
  const antes = process.env.PATH;
  process.env.PATH = '/usr/bin:/bin';
  let app;
  try { app = await abrirApp({ config: { iasCaminhos: { claude: falso } } }); } finally { process.env.PATH = antes; }
  t.after(() => app.fechar());
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.avaliar("document.getElementById('config-aba-ias').click()");
  await app.esperar("document.querySelectorAll('#config-ias li[data-ia]').length === 7", 15000);
  const campo = "document.querySelector('[data-ia-caminho=\"claude\"]')";
  const gravarCampo = (v) => app.avaliar(`(() => { const c = ${campo}; c.value = ${JSON.stringify(v)}; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const nota = () => app.avaliar("(document.querySelector('#config-ias li[data-ia=\"claude\"] .ia-nota') || {}).textContent || ''");
  const gravado = () => JSON.parse(app.ler('.config/orq-app/config.json')).iasCaminhos;

  await t.test('o cartão usa o caminho escolhido, com a versão dele', async () => {
    const c = await cartao(app, 'claude');
    assert.deepStrictEqual(c, { estado: 'instalado v6.5.4', ok: true, caminho: falso, emBreve: false });
    assert.strictEqual(await app.avaliar(`${campo}.value`), falso);
    assert.strictEqual(await nota(), 'Usando o caminho escolhido.');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-ia-detectado=\"claude\"]').hidden"), false);
    assert.strictEqual(await app.avaliar("document.querySelector('[data-ia-detectado=\"codex\"]').hidden"), true);
    await app.avaliar(`${campo}.scrollIntoView({ block: 'center' })`);
    assert.strictEqual(await app.visivel('[data-ia-escolher="claude"]'), 'ok');
  });

  await t.test('a conversa do orquestrador abre o Claude do caminho escolhido', async () => {
    for (let i = 0; i < 100 && !fs.existsSync(marca); i++) await app.espera(100);
    assert.ok(fs.existsSync(marca), 'o claude escolhido não foi aberto');
    assert.match(fs.readFileSync(marca, 'utf8'), /--output-format stream-json/);
  });

  await t.test('caminho que não existe: grava, avisa e volta ao PATH', async () => {
    await gravarCampo(path.join(fora, 'sumiu'));
    await app.esperar("!!document.querySelector('#config-ias li[data-ia=\"claude\"] .ia-nota.problema')", 10000);
    assert.strictEqual(await nota(), 'O caminho escolhido não existe; o app usa o do PATH.');
    assert.strictEqual(gravado().claude, path.join(fora, 'sumiu'));
    assert.strictEqual((await cartao(app, 'claude')).estado, 'não encontrado', 'o PATH do app não tem claude');
  });

  await t.test('caminho relativo não é gravado', async () => {
    await gravarCampo('bin/claude');
    await app.esperar("document.getElementById('config-arquivo').classList.contains('erro')");
    assert.strictEqual(gravado().claude, path.join(fora, 'sumiu'));
  });

  await t.test('"Usar o detectado" tira o caminho escolhido', async () => {
    await app.avaliar("document.querySelector('[data-ia-detectado=\"claude\"]').click()");
    await app.esperar(`${campo}.value === '' && !document.querySelector('#config-ias li[data-ia="claude"] .ia-nota')`, 10000);
    assert.deepStrictEqual(gravado(), {});
    assert.strictEqual(await app.avaliar("document.querySelector('[data-ia-detectado=\"claude\"]').hidden"), true);
  });

  await t.test('~ no campo vira a pasta pessoal', async () => {
    fs.mkdirSync(path.join(app.casa, 'ferramentas'));
    fs.copyFileSync(falso, path.join(app.casa, 'ferramentas', 'claude'));
    fs.chmodSync(path.join(app.casa, 'ferramentas', 'claude'), 0o755);
    await gravarCampo('~/ferramentas/claude');
    await app.esperar("(document.querySelector('#config-ias li[data-ia=\"claude\"] .estado') || {}).textContent === 'instalado v6.5.4'", 10000);
    assert.strictEqual(gravado().claude, path.join(app.casa, 'ferramentas', 'claude'));
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
