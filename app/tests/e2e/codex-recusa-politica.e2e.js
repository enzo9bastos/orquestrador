// Área: conversa (Codex que recusa abrir a conversa: falhar fechado; plano 8.8)
// Uma organização pode limitar as políticas do Codex. Se ele recusa a do app, a
// conversa não abre, o app não tenta outra política, a tela diz por quê, o texto
// volta para a caixa e a faixa "trabalhando" some.
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { abrirApp } = require('./app');

const FALSO = path.join(__dirname, '..', 'unit', 'codex-falso.js');
const RECUSA = 'invalid value for `approval_policy`: `untrusted` is not in the allowed set [on-request, never]';

test('Codex recusa a política do app: a conversa não abre e a tela explica', async (t) => {
  const LOG = path.join(pastaTemporaria('orq-codex-falso-'), 'log.jsonl');
  process.env.CODEX_FALSO_LOG = LOG;
  process.env.CODEX_FALSO_RECUSA_POLITICA = RECUSA;
  const app = await abrirApp({ config: { iaOrquestrador: 'codex', iasCaminhos: { codex: FALSO } } });
  t.after(() => { delete process.env.CODEX_FALSO_RECUSA_POLITICA; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const recebidos = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const erro = "([...document.querySelectorAll('#mensagens .aviso-conversa.erro')].pop() || {}).innerText || ''";

  await app.avaliar("(() => { const e = document.getElementById('entrada'); e.focus(); e.value = 'roda os testes do projeto'; e.dispatchEvent(new Event('input')); document.getElementById('compositor').requestSubmit(); })()");
  await app.esperar(`/O Codex não abriu a conversa/.test(${erro})`, 10000);

  await t.test('a tela diz o motivo do Codex e que o app não afrouxa a política', async () => {
    const texto = await app.avaliar(erro);
    assert.ok(texto.includes('is not in the allowed set'), texto);
    assert.match(texto, /não tenta abrir com uma política mais frouxa/);
    assert.match(texto, /Nada foi enviado; o seu texto voltou para a caixa\./);
  });

  await t.test('o texto volta para a caixa e a faixa "trabalhando" some', async () => {
    await app.esperar("document.getElementById('entrada').value === 'roda os testes do projeto'", 8000);
    await app.esperar("document.getElementById('parar').hidden", 8000);
  });

  // O app tenta abrir ao subir e de novo quando a pessoa escreve: sempre com a mesma política.
  await t.test('toda tentativa usa a política do app (nunca outra); nada foi ao modelo', async () => {
    await app.espera(400);
    const politicas = recebidos().filter((x) => x.method === 'thread/start').map((x) => `${x.params.approvalPolicy}+${x.params.approvalsReviewer}+${x.params.sandbox}`);
    assert.ok(politicas.length >= 1 && politicas.length <= 2, `tentativas: ${politicas.length}`);
    assert.deepStrictEqual([...new Set(politicas)], ['untrusted+auto_review+danger-full-access']);
    assert.ok(!recebidos().some((x) => x.method === 'turn/start'));
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
