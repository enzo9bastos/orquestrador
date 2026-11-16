// Área: conversa
// /resume do Claude: a lista das sessões anteriores sai da pasta de transcripts
// da pasta das conversas. Na junção do 0.C (16/11) o caminho dessa pasta era
// tirado de arqTranscript('x'), que passou a devolver null (procura pelo id):
// a lista quebrava. E a lista não pode ler os transcripts inteiros.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { abrirApp } = require('./app');

test('/resume do Claude lista as sessões da pasta das conversas (sem ler o transcript inteiro)', async (t) => {
  const app = await abrirApp({ config: {} });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const pasta = path.join(app.casa, '.claude', 'projects', app.casa.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(pasta, { recursive: true });
  const msg = (texto) => JSON.stringify({ type: 'user', message: { role: 'user', content: texto } });
  fs.writeFileSync(path.join(pasta, 's-curta.jsonl'), msg('organizar as notas da semana') + '\n');
  // Sessão grande: a primeira mensagem no começo, depois ~30 MB de resposta.
  const grande = path.join(pasta, 's-grande.jsonl');
  fs.writeFileSync(grande, msg('revisar o relatório de vendas') + '\n');
  const linha = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(100000) }] } }) + '\n';
  for (let i = 0; i < 300; i++) fs.appendFileSync(grande, linha);

  const r = await app.avaliar("window.orq.comandos.sessoes('orquestrador')");
  assert.ok(Array.isArray(r), `a lista do /resume quebrou: ${JSON.stringify(r)}`);
  const ids = r.map((s) => s.sessao).sort();
  assert.deepStrictEqual(ids, ['s-curta', 's-grande']);
  const g = r.find((s) => s.sessao === 's-grande');
  assert.match(JSON.stringify(g), /revisar o relatório de vendas/);
  assert.deepStrictEqual(app.erros, []);
});
