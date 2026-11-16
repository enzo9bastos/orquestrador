// Área: envios
// 0.C5 na tela de verdade: 1 000 deltas do Claude falso chegam em lote e a tela
// mostra o texto inteiro, na ordem; a pergunta de permissão aparece sem esperar
// o lote; o terminal continua mostrando a saída.
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirApp } = require('./app');

const CLAUDE_FALSO = path.join(__dirname, '..', 'unit', 'claude-falso.js');

test('envios em lote na tela', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-envios-'), 'log.jsonl');
  const app = await abrirApp({ config: { iasCaminhos: { claude: CLAUDE_FALSO } } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');

  await t.test('1 000 deltas: a tela mostra todos, na ordem, e o texto final fica igual ao de sempre', async () => {
    // Conta os envios por lote que chegam à tela (a ponte entrega item a item).
    await app.avaliar("window.__lotes = 0; window.orq.conversa.aoParcial((id, t) => { if (id === 'orquestrador' && typeof t === 'string') window.__lotes++; })");
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'manda 1000 deltas')");
    const esperado = Array.from({ length: 1000 }, (_, j) => `d${j} `).join('').trim();
    await app.esperar(`[...document.querySelectorAll('#mensagens .md')].some((e) => e.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(esperado)})`, 15000);
    const ocorrencias = await app.avaliar("[...document.querySelectorAll('#mensagens .md')].filter((e) => e.textContent.includes('d999')).length");
    assert.strictEqual(ocorrencias, 1, 'o rascunho some quando a mensagem inteira chega: um só bloco com o texto');
    const entregas = await app.avaliar('window.__lotes');
    assert.ok(entregas <= 40, `${entregas} entregas de texto à tela (eram 1 000)`);
  });

  await t.test('pergunta de permissão aparece na hora, sem esperar o lote', async () => {
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'pede permissão e termina')");
    await app.esperar("document.querySelectorAll('[data-pedido]').length >= 1", 3000);
  });

  assert.deepStrictEqual(app.erros, [], 'sem erro na tela');
});
