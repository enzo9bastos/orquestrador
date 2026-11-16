// Área: conversa
// O app aberto pelos testes de tela não pode mandar notificação do sistema para
// a tela do usuário (a janela de teste fica escondida, então toda resposta
// virava "O orquestrador respondeu"). Em teste, o aviso vai para um arquivo na
// casa temporária, onde o teste confere que ele teria saído.
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirApp } = require('./app');

const CLAUDE_FALSO = path.join(__dirname, '..', 'unit', 'claude-falso.js');

test('app de teste não notifica o sistema: o aviso fica no arquivo da casa temporária', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  const app = await abrirApp({ config: { iasCaminhos: { claude: CLAUDE_FALSO } } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'oi')");
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].some((e) => e.textContent.trim() === 'ok')", 10000);
  const arq = path.join(app.casa, '.cache', 'orq-app', 'notificacoes-teste.jsonl');
  for (let i = 0; i < 30 && !fs.existsSync(arq); i++) await app.espera(100);
  assert.ok(fs.existsSync(arq), 'o aviso da resposta não passou pelo caminho de teste (teria ido para a tela do usuário)');
  const avisos = fs.readFileSync(arq, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(avisos.some((a) => /respondeu/.test(a.title)), JSON.stringify(avisos));
  assert.deepStrictEqual(app.erros, []);
});
