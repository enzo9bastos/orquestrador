// Área: conversa (autocompletar dos comandos /: a parte urgente do 0.B7)
// "/" + Enter completava o primeiro da lista, que era o /exit: mais um Enter
// fechava o app. Agora o /exit nunca é o primeiro nem fica pré-selecionado, e o
// Enter não o completa (Tab ou clique, sim; digitado inteiro, o Enter manda).
// Nas conversas Codex, a lista não oferece os comandos próprios do Claude.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { abrirApp } = require('./app');

const CLAUDE_FALSO = path.join(__dirname, '..', 'unit', 'claude-falso.js');
const CODEX_FALSO = path.join(__dirname, '..', 'unit', 'codex-falso.js');
const sugestoes = "[...document.querySelectorAll('#sugestoes li')].map((li) => li.querySelector('.nome-comando').textContent.split(' ')[0])";
const selecionada = "(document.querySelector('#sugestoes li[aria-selected=\"true\"] .nome-comando') || {}).textContent || null";

async function digitar(app, texto) {
  await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = ''; e.focus(); })()");
  await app.texto(texto);
  await app.esperar("!document.getElementById('sugestoes').hidden");
}

test('autocompletar dos comandos: /exit nunca é o primeiro nem vai pelo Enter', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orq-claude-falso-')), 'log.jsonl');
  const app = await abrirApp({ config: { iasCaminhos: { claude: CLAUDE_FALSO } } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');

  await t.test('"/" abre a lista sem o /exit em primeiro nem selecionado', async () => {
    await digitar(app, '/');
    const lista = await app.avaliar(sugestoes);
    assert.ok(lista.includes('/exit'), 'o /exit continua na lista');
    assert.notStrictEqual(lista[0], '/exit');
    assert.doesNotMatch(String(await app.avaliar(selecionada)), /^\/exit/);
  });

  await t.test('"/" + Enter não leva ao /exit', async () => {
    await app.tecla('Enter', 'Enter', 13);
    assert.doesNotMatch(await app.avaliar("document.getElementById('entrada').value"), /^\/exit/);
  });

  await t.test('"/ex": o /exit vem por último, fora da seleção; o Enter completa outro', async () => {
    await digitar(app, '/ex');
    const lista = await app.avaliar(sugestoes);
    assert.strictEqual(lista.at(-1), '/exit');
    assert.ok(lista.length > 1, '"ex" também casa com /context');
    assert.doesNotMatch(String(await app.avaliar(selecionada)), /^\/exit/);
    await app.tecla('Enter', 'Enter', 13);
    assert.doesNotMatch(await app.avaliar("document.getElementById('entrada').value"), /^\/exit/);
  });

  await t.test('"/exi": só o /exit, nada selecionado, e o Enter não completa', async () => {
    await digitar(app, '/exi');
    assert.deepStrictEqual(await app.avaliar(sugestoes), ['/exit']);
    assert.strictEqual(await app.avaliar(selecionada), null);
    await app.tecla('Enter', 'Enter', 13);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '/exi');
  });

  await t.test('com seta até o /exit, o Enter também não completa; Tab completa', async () => {
    await digitar(app, '/ex');
    await app.tecla('ArrowUp', 'ArrowUp', 38); // do primeiro para o último (o /exit)
    assert.match(String(await app.avaliar(selecionada)), /^\/exit/);
    await app.tecla('Enter', 'Enter', 13);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '/ex');
    await app.tecla('Tab', 'Tab', 9);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '/exit ');
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = ''; e.dispatchEvent(new Event('input')); })()");
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('autocompletar dos comandos numa conversa Codex: sem os comandos próprios do Claude', async (t) => {
  process.env.CODEX_FALSO_LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orq-codex-falso-')), 'log.jsonl');
  const app = await abrirApp({
    config: { iaOrquestrador: 'codex', iasCaminhos: { codex: CODEX_FALSO } },
    arquivos: { '.codex/skills/rodada-x/SKILL.md': '---\nname: rodada-x\ndescription: Skill do Codex\n---\nx' },
  });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  await app.esperar("(document.getElementById('entrada').placeholder || '').length > 0");

  await t.test('"/" mostra as skills do Codex e os comandos do app, nada do Claude', async () => {
    await digitar(app, '/');
    const lista = await app.avaliar(sugestoes);
    for (const doClaude of ['/compact', '/context', '/cost', '/clear', '/mcp', '/memory', '/hooks', '/help', '/init', '/review', '/doctor', '/usage']) {
      assert.ok(!lista.includes(doClaude), `${doClaude} não é do Codex`);
    }
    assert.ok(lista.includes('/rodada-x'), 'a skill do Codex aparece');
    assert.ok(lista.includes('/exit'), 'o /exit do app continua');
    assert.notStrictEqual(lista[0], '/exit');
  });

  await t.test('a paleta (Ctrl+K) também não oferece os comandos do Claude', async () => {
    await app.avaliar("window.orqPaleta.abrir()");
    const titulos = await app.avaliar("[...document.querySelectorAll('.paleta-lista .paleta-item .titulo')].map((x) => x.textContent)");
    assert.ok(titulos.includes('/exit'));
    assert.ok(!titulos.includes('/compact') && !titulos.includes('/context'), 'nada do Claude na paleta da conversa Codex');
    await app.tecla('Escape', 'Escape', 27);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
