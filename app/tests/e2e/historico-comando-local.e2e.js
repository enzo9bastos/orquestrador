// Área: conversa (histórico ao reabrir: comando local e a saída dele; plano 3.4)
// O Claude grava o comando local (/rename, /memory…) e a saída como linhas de
// sistema no transcript (forma do 2.1.326). Ao reabrir, a tela mostra o mesmo
// que mostrou ao vivo: o balão do comando, a saída e, no comando que só existe
// no terminal, o aviso em português com o botão.
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { abrirApp } = require('./app');

const CLAUDE_FALSO = path.join(__dirname, '..', 'unit', 'claude-falso.js');

test('histórico ao reabrir: comando local, saída e aviso de "só no terminal" voltam como ao vivo', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  const ENV = { CLAUDE_FALSO_LOG: log, CLAUDE_FALSO_INIT_NA_SUBIDA: '1', CLAUDE_FALSO_SESSAO_REAL: '1' };
  Object.assign(process.env, ENV);
  const app = await abrirApp({
    config: { iasCaminhos: { claude: CLAUDE_FALSO } },
    arquivos: { '.cache/orq-app/conversas-teste.json': JSON.stringify([{ id: 'orquestrador', titulo: 'Orquestrador', sessao: 'S1', orquestrador: true }]) },
  });
  t.after(() => { for (const k of Object.keys(ENV)) delete process.env[k]; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const l = (o) => JSON.stringify(o);
  const sis = (uuid, content, mais = {}) => l({ parentUuid: null, isSidechain: false, type: 'system', subtype: 'local_command', content, level: 'info', timestamp: '2026-11-17T09:35:56.906Z', uuid, isMeta: false, ...mais });
  const projeto = app.casa.replace(/[^A-Za-z0-9]/g, '-');
  fs.mkdirSync(path.join(app.casa, '.claude/projects', projeto), { recursive: true });
  app.escrever(`.claude/projects/${projeto}/S1.jsonl`, [
    l({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'primeira pergunta' } }),
    l({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta um' }] } }),
    sis('s1', '/memory abc'),
    sis('s2', "<local-command-stdout>/memory isn't available in this environment.</local-command-stdout>", { commandOutcome: { kind: 'unavailable_headless' } }),
    l({ type: 'user', uuid: 'm1', isMeta: true, message: { role: 'user', content: '<local-command-caveat>The command below was run directly…</local-command-caveat>' } }),
    l({ type: 'user', uuid: 'u2', message: { role: 'user', content: '<command-name>/rename</command-name>\n<command-message>rename</command-message>\n<command-args>teste</command-args>' } }),
    sis('s3', '<local-command-stdout>Session renamed to: teste</local-command-stdout>'),
  ].join('\n') + '\n');
  // Reabre a conversa para a tela ler o histórico.
  await app.avaliar("window.orq.conversa.reiniciar('orquestrador')");
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].some((e) => /resposta um/.test(e.textContent))", 8000);
  const textos = (sel) => app.avaliar(`[...document.querySelectorAll('#mensagens ${sel}')].map((e) => e.textContent.trim())`);

  await t.test('o balão de cada comando e a saída dele aparecem, na ordem', async () => {
    assert.deepStrictEqual(await textos('.msg-voce .balao.comando'), ['/memory abc', '/rename teste']);
    const claude = await textos('.texto-claude');
    assert.deepStrictEqual(claude.filter((x) => /isn't available|Session renamed/.test(x)), ["/memory isn't available in this environment.", 'Session renamed to: teste']);
  });

  await t.test('comando não ganha o lápis de voltar: só a mensagem digitada', async () => {
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].map((b) => b.dataset.texto)"), ['primeira pergunta']);
  });

  await t.test('o aviso em português do comando só de terminal volta, e o botão abre com o comando inteiro', async () => {
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .aviso-indisponivel').length"), 1, 'só o /memory; o /rename rodou');
    assert.match(await app.avaliar("document.querySelector('#mensagens .aviso-indisponivel').innerText"), /\/memory[\s\S]*só existe na tela do terminal do Claude/);
    await app.avaliar('window.__colado = []; window.orqTerminal = { colar: async (t) => { window.__colado.push(t); return true; } }');
    await app.avaliar("document.querySelector('#mensagens .aviso-indisponivel [data-abrir-terminal]').click()");
    await app.esperar('window.__colado.length === 1');
    const linha = await app.avaliar('window.__colado[0]');
    assert.ok(linha.endsWith("--fork-session '/memory abc'"), linha);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
