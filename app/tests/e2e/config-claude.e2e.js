// Área: conversa (popup do /config do P1: chaves do próprio Claude, com o valor atual)
// Plano 2.5. As chaves vêm do texto "Usage: /config" do CLI (33 no 2.1.326), em
// grupos, com busca. O valor atual aparece onde o Claude informa (get_settings
// e o modo vivo); as chaves que só mudam a tela do terminal dizem isso.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('popup do /config do Claude Code', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false }, arquivos: { '.claude/settings.json': JSON.stringify({ outputStyle: 'Concise', language: 'português' }) } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const mandadas = () => linhas(log).filter((o) => o.type === 'user').map((o) => (typeof o.message.content === 'string' ? o.message.content : ''));
  const enviar = async (texto) => {
    await app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(texto)}; e.dispatchEvent(new Event('input')); })()`);
    await app.tecla('Escape', 'Escape', 27);
    await app.avaliar("document.getElementById('compositor').requestSubmit()");
  };
  const valor = (k) => app.avaliar(`document.querySelector('#popup-corpo [data-config="${k}"]').value`);
  const fechar = () => app.avaliar("document.getElementById('fechar-popup').click()");

  await t.test('/config abre as 33 chaves do Claude em grupos, sem as que saíram do CLI', async () => {
    await enviar('/config');
    await app.esperar("!document.getElementById('popup').hidden && document.querySelectorAll('#popup-corpo [data-config]').length === 33", 8000);
    assert.strictEqual(await app.avaliar("document.getElementById('popup-titulo').textContent"), 'Configurações do Claude Code');
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#popup-corpo .config-secao')].map((h) => h.textContent)"), ['Modelo e permissões', 'Respostas', 'Conversa e arquivos', 'Tela do terminal']);
    assert.ok(await app.avaliar("!document.querySelector('#popup-corpo [data-config=remoteControl]') && !!document.querySelector('#popup-corpo [data-config=idleCompaction]')"));
    assert.strictEqual(await app.visivel('#popup .config'), 'ok');
  });

  await t.test('o valor atual aparece onde o Claude informa; onde não informa, fica "—"', async () => {
    await app.esperar("document.querySelector('#popup-corpo [data-config=outputStyle]').value === 'Concise'", 8000);
    assert.strictEqual(await valor('language'), 'português');
    assert.strictEqual(await valor('permissionMode'), 'auto', 'o modo vivo da conversa');
    assert.strictEqual(await valor('theme'), '', 'sem informação: não adivinha');
    assert.ok(linhas(log).some((o) => o.type === 'control_request' && o.request.subtype === 'get_settings'));
  });

  await t.test('as chaves que só mudam a tela do terminal dizem isso', async () => {
    const nota = await app.avaliar("document.querySelector('#popup-corpo [data-config=theme]').closest('.popup-linha').innerText");
    assert.match(nota, /só na tela do terminal/);
    assert.doesNotMatch(await app.avaliar("document.querySelector('#popup-corpo [data-config=model]').closest('.popup-linha').innerText"), /só na tela do terminal/);
  });

  await t.test('a busca acha pelo nome em português e pelo nome técnico', async () => {
    const visiveis = () => app.avaliar("[...document.querySelectorAll('#popup-corpo .popup-linha')].filter((l) => !l.hidden).map((l) => l.querySelector('[data-config]').dataset.config)");
    await app.avaliar("(() => { const b = document.getElementById('busca-config-claude'); b.value = 'tema'; b.dispatchEvent(new Event('input')); })()");
    assert.deepStrictEqual(await visiveis(), ['theme']);
    await app.avaliar("(() => { const b = document.getElementById('busca-config-claude'); b.value = 'gitignore'; b.dispatchEvent(new Event('input')); })()");
    assert.deepStrictEqual(await visiveis(), ['gitignore']);
    await app.avaliar("(() => { const b = document.getElementById('busca-config-claude'); b.value = ''; b.dispatchEvent(new Event('input')); })()");
    assert.strictEqual((await visiveis()).length, 33);
  });

  await t.test('mudar manda "/config chave=valor"; valor com espaço vai entre aspas e aspas de dentro vão escapadas', async () => {
    await app.avaliar("(() => { const s = document.querySelector('#popup-corpo [data-config=switchModelsOnFlag]'); s.value = 'Ask each time'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
    for (let i = 0; i < 50 && !mandadas().some((m) => m.startsWith('/config switchModelsOnFlag')); i++) await app.espera(100);
    assert.ok(mandadas().includes('/config switchModelsOnFlag="Ask each time"'), JSON.stringify(mandadas()));
    await app.avaliar("(() => { const s = document.querySelector('#popup-corpo [data-config=language]'); s.value = 'diga \"oi\"'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
    for (let i = 0; i < 50 && !mandadas().some((m) => m.startsWith('/config language')); i++) await app.espera(100);
    assert.ok(mandadas().includes('/config language="diga \\\\"oi\\\\""'.replace(/\\\\/g, '\\')), JSON.stringify(mandadas()));
    assert.ok(await app.avaliar("document.querySelector('#popup-corpo [data-config=language]').closest('.popup-linha').classList.contains('mudou')"));
  });

  await t.test('o rodapé leva às Configurações do app (a outra engrenagem)', async () => {
    await app.avaliar("document.querySelector('#popup-corpo [data-abrir-config-app]').click()");
    await app.esperar("document.getElementById('popup').hidden && !document.getElementById('config').hidden");
    await app.avaliar("document.getElementById('fechar-config').click()");
  });

  await t.test('quando o Claude mostra um "Usage: /config" diferente, a lista passa a ser a dele', async () => {
    const uso = 'Usage: /config key=value [key=value ...]\n  model=default|opus\n  chaveNova=a|b|c';
    await app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify({ tipo: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: uso }] } })})`);
    await app.avaliar('window.__orqTeste.abrirPopupConfig()');
    await app.esperar("document.querySelectorAll('#popup-corpo [data-config]').length === 2", 8000);
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#popup-corpo .config-secao')].map((h) => h.textContent)"), ['Modelo e permissões', 'Outras']);
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#popup-corpo [data-config=chaveNova] option')].map((o) => o.value)"), ['', 'a', 'b', 'c']);
    await fechar();
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
