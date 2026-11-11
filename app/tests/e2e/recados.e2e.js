// Área: recados (aba Recados, memória do projeto, recado por trás na conversa)
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const agora = Date.now();
const log = [
  { id: 'r1', ts: agora - 60000, de: { tipo: 'agente', alvo: 'site', nome: 'Agente 1 (site)' }, para: { tipo: 'orquestrador' }, tipo: 'pergunta', texto: 'posso trocar a porta para 4010?', estado: 'entregue', motivo: null },
  { id: 'r2', ts: agora - 50000, de: { tipo: 'orquestrador' }, para: { tipo: 'agente', alvo: 'site', nome: 'Agente 1 (site)' }, tipo: 'aviso', texto: 'pode, e anota na memória', estado: 'entregue', motivo: null },
  { id: 'r3', ts: agora - 40000, de: { tipo: 'agente', alvo: 'site', nome: 'Agente 1 (site)' }, para: { tipo: 'orquestrador' }, tipo: 'aviso', texto: 'sétimo recado seguido', estado: 'segurado', motivo: 'mais de 6 recados em 10 min' },
  { id: 'r4', ts: agora - 30000, de: { tipo: 'agente', alvo: 'site', nome: 'Agente de site' }, para: { tipo: 'orquestrador' }, tipo: 'aviso', texto: 'de um terminal de fora', estado: 'recusado', motivo: 'nenhum agente do app neste projeto' },
].map((r) => JSON.stringify(r)).join('\n') + '\n';
const nota = '---\ntipo: onde\ntitulo: Porta do servidor de teste\nquando: 2026-11-11 12:00\nautor: agente\n---\n\n# Porta do servidor de teste\n\nUsa a 4010 desde hoje.\n';

test('recados', async (t) => {
  const app = await abrirApp({
    config: { raizProjetos: '~/projetos', niveis: 1 },
    arquivos: {
      '.local/share/orq-app/recados/recados.jsonl': log,
      'projetos/site/.orq/memoria/2026-11-11-120000-porta-do-servidor-de-teste.md': nota,
      'projetos/outro/leia.md': '',
    },
  });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqRecados');
  const itens = () => app.avaliar("[...document.querySelectorAll('#recados-linha .recado')].map((li) => ({ id: li.dataset.id, de: li.querySelector('.recado-de').textContent, para: li.querySelector('.recado-para').textContent, estado: li.querySelector('.recado-selo-estado').textContent, liberar: !!li.querySelector('[data-rc-liberar]') }))");

  await t.test('a aba mostra os recados dos dois lados, do mais novo ao mais antigo', async () => {
    await app.avaliar("document.querySelector('[data-aba=\"aba-recados\"]').click()");
    await app.esperar("document.querySelectorAll('#recados-linha .recado').length === 4");
    const l = await itens();
    assert.deepStrictEqual(l.map((x) => x.id), ['r4', 'r3', 'r2', 'r1']);
    assert.deepStrictEqual([l[2].de, l[2].para], ['Orquestrador', 'Agente 1 (site)']);
    assert.deepStrictEqual(l.map((x) => x.estado), ['recusado', 'segurado', 'entregue', 'entregue']);
    assert.deepStrictEqual(l.map((x) => x.liberar), [false, true, false, false], 'só o segurado tem Liberar');
  });

  await t.test('o segurado aparece no contador da aba e sai dele ao liberar', async () => {
    assert.strictEqual(await app.avaliar("document.getElementById('n-recados-atencao').textContent"), '1');
    await app.avaliar("document.querySelector('[data-rc-liberar=\"r3\"]').click()");
    await app.esperar("!document.querySelector('[data-rc-liberar]')");
    assert.ok(await app.avaliar("document.getElementById('n-recados-atencao').hidden"));
    const r3 = (await itens()).find((x) => x.id === 'r3');
    assert.ok(['esperando o orquestrador', 'entregue'].includes(r3.estado), r3.estado);
  });

  await t.test('projetos: só os que têm recado ou memória; a memória mostra a nota', async () => {
    const projetos = await app.avaliar("[...document.querySelectorAll('#recados-projetos [data-rc-projeto]')].map((b) => b.dataset.rcProjeto)");
    assert.deepStrictEqual(projetos, ['', 'site']);
    await app.avaliar("document.querySelector('[data-rc-projeto=\"site\"]').click()");
    await app.avaliar("document.querySelector('[data-rc-aba=\"memoria\"]').click()");
    await app.esperar("document.querySelectorAll('#memoria-notas .memoria-nota').length === 1");
    assert.match(await app.avaliar("document.querySelector('#memoria-notas .memoria-nota').innerText"), /Porta do servidor de teste[\s\S]*Usa a 4010/);
    await app.avaliar("(() => { const i = document.getElementById('filtro-memoria'); i.value = 'nada disso'; i.dispatchEvent(new Event('input')); })()");
    await app.esperar("document.querySelectorAll('#memoria-notas .memoria-nota').length === 0");
  });

  await t.test('na conversa, o recado do agente aparece por trás, sem virar balão do usuário', async () => {
    await app.esperar('!!window.__orqTeste');
    const msg = '<orq-recado id="r9" de="Agente 1 (site)" projeto="site" tipo="pergunta">\nPergunta de Agente 1 (site) (site):\nposso subir?\n\nPara responder a este agente: orq-recado para "site" "sua resposta".\n</orq-recado>';
    await app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify({ tipo: 'user', local: true, message: { role: 'user', content: msg } })})`);
    assert.match(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-bastidor-recado summary')].pop().textContent"), /Recado de Agente 1 \(site\) · site/);
    assert.ok(!(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce')].some((b) => b.innerText.includes('posso subir'))")));
  });
});
