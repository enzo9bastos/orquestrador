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
  { id: 'p1', ts: agora - 9000, de: { tipo: 'orquestrador' }, para: { tipo: 'avulso', motor: 'codex', alvo: 'site', nome: 'Codex avulso' }, tipo: 'pedido', texto: 'crie o ícone do site', escrever: true, estado: 'aguardando', motivo: 'pediu para escrever na pasta do projeto: espera você aprovar' },
  { id: 'p2', ts: agora - 8000, de: { tipo: 'orquestrador' }, para: { tipo: 'avulso', motor: 'claude', alvo: 'site', nome: 'Claude avulso' }, tipo: 'pedido', texto: 'reescreva o README', escrever: true, estado: 'aguardando', motivo: null },
].map((r) => JSON.stringify(r)).join('\n') + '\n';
const vezes = [
  { id: 'v1', ts: agora - 20000, de: { alvo: 'site', nome: 'Agente 1 (site)' }, para: null, texto: 'Parei no passo 3.', falta: 'testes no celular', falhou: 'máscara antiga', estado: 'aberta', motivo: null },
  { id: 'v2', ts: agora - 10000, de: { alvo: 'site', nome: 'Agente 1 (site)' }, para: 'Agente 2', texto: 'Login pronto.', falta: '', falhou: '', estado: 'aberta', motivo: null },
].map((v) => JSON.stringify(v)).join('\n') + '\n' + JSON.stringify({ id: 'v2', mudanca: { estado: 'pega', pegaPor: { alvo: 'api', nome: 'Agente 2 (api)' }, pegaEm: agora } }) + '\n';
const nota = '---\ntipo: onde\ntitulo: Porta do servidor de teste\nquando: 2026-11-11 12:00\nautor: agente\n---\n\n# Porta do servidor de teste\n\nUsa a 4010 desde hoje.\n';

test('recados', async (t) => {
  const app = await abrirApp({
    config: { raizProjetos: '~/projetos', niveis: 1 },
    arquivos: {
      '.local/share/orq-app/recados/recados.jsonl': log,
      '.local/share/orq-app/recados/vezes.jsonl': vezes,
      'projetos/site/.orq/memoria/2026-11-11-120000-porta-do-servidor-de-teste.md': nota,
      'projetos/outro/leia.md': '',
    },
  });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqRecados');
  const itens = () => app.avaliar("[...document.querySelectorAll('#recados-linha .recado')].map((li) => ({ id: li.dataset.id, de: li.querySelector('.recado-de').textContent, para: li.querySelector('.recado-para').textContent, estado: li.querySelector('.recado-selo-estado').textContent, liberar: !!li.querySelector('[data-rc-liberar]') }))");

  await t.test('a aba mostra os recados dos dois lados, do mais novo ao mais antigo', async () => {
    await app.avaliar("document.querySelector('[data-aba=\"aba-recados\"]').click()");
    await app.esperar("document.querySelectorAll('#recados-linha .recado').length === 6");
    const l = await itens();
    assert.deepStrictEqual(l.map((x) => x.id), ['p2', 'p1', 'r4', 'r3', 'r2', 'r1']);
    assert.deepStrictEqual([l[4].de, l[4].para], ['Orquestrador', 'Agente 1 (site)']);
    assert.deepStrictEqual([l[1].de, l[1].para], ['Orquestrador', 'Codex avulso']);
    assert.deepStrictEqual(l.map((x) => x.estado), ['espera você', 'espera você', 'recusado', 'segurado', 'entregue', 'entregue']);
    assert.deepStrictEqual(l.map((x) => x.liberar), [false, false, false, true, false, false], 'só o segurado tem Liberar');
  });

  await t.test('o segurado aparece no contador da aba e sai dele ao liberar', async () => {
    assert.strictEqual(await app.avaliar("document.getElementById('n-recados-atencao').textContent"), '3', '1 segurado + 2 pedidos esperando');
    await app.avaliar("document.querySelector('[data-rc-liberar=\"r3\"]').click()");
    await app.esperar("!document.querySelector('[data-rc-liberar]')");
    assert.strictEqual(await app.avaliar("document.getElementById('n-recados-atencao').textContent"), '2', 'sobram os 2 pedidos');
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

  // Pedido de 2026-11-12: pedido avulso que pede escrita espera você; texto
  // opcional tanto ao aprovar quanto ao negar.
  await t.test('pedido avulso: aprovar com orientação e negar com motivo, no próprio cartão', async () => {
    await app.avaliar("document.querySelector('[data-rc-projeto=\"\"]').click()");
    await app.avaliar("document.querySelector('[data-rc-aba=\"recados\"]').click()");
    await app.esperar("!!document.querySelector('[data-rc-decidir=\"p1\"]')");
    assert.strictEqual(await app.avaliar("document.getElementById('n-recados-atencao').textContent"), '2', 'os dois pedidos contam como esperando você');
    await app.avaliar("(() => { const c = document.querySelector('[data-rc-nota=\"p1\"]'); c.value = 'só PNG, 64x64'; })()");
    await app.avaliar("document.querySelector('[data-rc-decidir=\"p1\"][data-aprovar=\"1\"]').click()");
    await app.esperar("!document.querySelector('[data-rc-decidir=\"p1\"]')");
    await app.avaliar("document.querySelector('[data-rc-nota=\"p2\"]').value = 'o README é meu'");
    await app.avaliar("document.querySelector('[data-rc-decidir=\"p2\"][data-aprovar=\"0\"]').click()");
    await app.esperar("!document.querySelector('[data-rc-decidir]')");
    const fs = require('fs');
    const linhas = fs.readFileSync(require('path').join(app.casa, '.local/share/orq-app/recados/recados.jsonl'), 'utf8');
    assert.match(linhas, /"id":"p1","mudanca":\{"estado":"na-fila","motivo":null,"nota":"só PNG, 64x64"/);
    assert.match(linhas, /"id":"p2","mudanca":\{"estado":"negado","motivo":null,"nota":"o README é meu"/);
    assert.match(linhas, /"tipo":"negado".*Motivo: o README é meu/);
    const p1 = await app.avaliar("document.querySelector('[data-id=\"p1\"]').innerText");
    assert.match(p1, /na fila[\s\S]*sua orientação: só PNG, 64x64/);
    assert.ok(await app.avaliar("document.getElementById('n-recados-atencao').hidden"));
  });

  await t.test('vezes passadas: aberta e pega, com o que falta e o que não funcionou', async () => {
    await app.avaliar("document.querySelector('[data-rc-projeto=\"\"]').click()");
    await app.avaliar("document.querySelector('[data-rc-aba=\"vezes\"]').click()");
    await app.esperar("document.querySelectorAll('#vezes-linha .vez').length === 2");
    const l = await app.avaliar("[...document.querySelectorAll('#vezes-linha .vez')].map((li) => ({ id: li.dataset.id, para: li.querySelector('.recado-para').textContent, estado: li.querySelector('.recado-selo-estado').textContent, texto: li.innerText }))");
    assert.deepStrictEqual(l.map((x) => [x.id, x.para, x.estado]), [['v2', 'Agente 2 (api)', 'pega'], ['v1', 'qualquer agente', 'aberta']]);
    assert.match(l[1].texto, /Falta: testes no celular[\s\S]*Não funcionou: máscara antiga/);
    assert.ok(await app.avaliar("document.getElementById('recados-linha').hidden && document.getElementById('recados-memoria').hidden"));
  });

  await t.test('na conversa, o recado do agente aparece por trás, sem virar balão do usuário', async () => {
    await app.esperar('!!window.__orqTeste');
    const msg = '<orq-recado id="r9" de="Agente 1 (site)" projeto="site" tipo="pergunta">\nPergunta de Agente 1 (site) (site):\nposso subir?\n\nPara responder a este agente: orq-recado para "site" "sua resposta".\n</orq-recado>';
    await app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify({ tipo: 'user', local: true, message: { role: 'user', content: msg } })})`);
    assert.match(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-bastidor-recado summary')].pop().textContent"), /Recado de Agente 1 \(site\) · site/);
    assert.ok(!(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce')].some((b) => b.innerText.includes('posso subir'))")));
  });
});
