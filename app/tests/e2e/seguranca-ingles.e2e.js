// Área: idioma (os textos novos da Etapa 0.A com a interface em inglês)
// Campo de resposta secreta (0.A3), linha "pedido não suportado" (0.A5), selo
// "não verificado" e motivos novos da aba Recados (0.A1, 0.A4, 0.A7).
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const agora = Date.now();
const log = [
  { id: 'x1', ts: agora - 9000, canal: true, canalId: 'n1', de: { tipo: 'externo', nome: 'Bruno', verificado: false }, para: { tipo: 'orquestrador' }, tipo: 'externo', texto: 'oi', estado: 'entregue', motivo: null },
  { id: 'x2', ts: agora - 8000, de: { tipo: 'agente', alvo: 'proj-a', nome: 'Agente 1', sessao: null }, para: { tipo: 'orquestrador' }, tipo: 'aviso', texto: '', estado: 'recusado',
    motivo: '.orq/recados/lidos é um link simbólico: o app não grava nem segue link dentro do projeto; os recados deste projeto ficam parados até a pasta voltar ao normal' },
  { id: 'x3', ts: agora - 7000, de: { tipo: 'orquestrador' }, para: { tipo: 'agente', alvo: 'proj-a', nome: 'Agente 1' }, tipo: 'aviso', texto: 'pode seguir', estado: 'novo',
    motivo: 'Agente 1 está com uma pergunta ou menu aberto na tela: o recado espera ela ser respondida (o app não digita às cegas num menu)', linha: '[recado do orquestrador] pode seguir' },
  { id: 'x4', ts: agora - 6000, canal: true, de: { tipo: 'orquestrador' }, para: { tipo: 'externo', nome: 'Bruno', caixa: 'para-bruno' }, tipo: 'externo', texto: 'fica pra sexta', classe: 'decisao', estado: 'aguardando',
    motivo: 'vai sair deste computador; decisão: espera você aprovar (a autorização citada não está na sua última mensagem, ou não cita Bruno pelo nome ou pela caixa)' },
].map((r) => JSON.stringify(r)).join('\n') + '\n';

test('textos novos da Etapa 0.A em inglês', async (t) => {
  const app = await abrirApp({ config: { idioma: 'en', canalContatos: [{ nome: 'Bruno', caixa: 'para-bruno' }] }, arquivos: { '.local/share/orq-app/recados/recados.jsonl': log } });
  t.after(() => app.fechar());
  await app.esperar("window.orqI18n && window.orqI18n.idioma() === 'en' && !!window.__orqTeste", 15000);

  await t.test('cartão com resposta secreta', async () => {
    await app.avaliar("window.__orqTeste.cartaoPedido({ id: 'en-1', ferramenta: 'AskUserQuestion', entrada: { questions: [{ id: 'qa', header: 'Acesso', question: 'Qual a senha?', isSecret: true, isOther: true, options: [] }] } })");
    await app.esperar("document.querySelector('[data-pedido=\"en-1\"] .outra').placeholder === 'Secret answer… (Enter answers)'");
    assert.match(await app.avaliar("document.querySelector('[data-pedido=\"en-1\"] .aviso-secreta').textContent"), /^Secret answer: it does not show on screen or in the app's history\./);
  });

  await t.test('linha de pedido não suportado', async () => {
    await app.avaliar("window.__orqTeste.desenharEvento({ tipo: 'aviso', texto: 'Pedido não suportado: elicitation (o app recusou; a conversa segue sem ele)' })");
    await app.esperar("/^Unsupported request: elicitation \\(the app refused it; the conversation goes on without it\\)$/.test([...document.querySelectorAll('#mensagens .aviso-conversa')].pop().textContent)");
  });

  await t.test('aba Messages: selo "unverified" e os motivos novos', async () => {
    await app.avaliar("document.querySelector('[data-aba=\"aba-recados\"]').click()");
    await app.esperar("!!document.querySelector('[data-id=\"x1\"] .recado-selo-nao-verificado')", 10000);
    await app.esperar("document.querySelector('[data-id=\"x1\"] .recado-selo-nao-verificado').textContent === 'unverified'");
    assert.match(await app.avaliar("document.querySelector('[data-id=\"x1\"] .recado-selo-nao-verificado').title"), /^The sender's name comes from a tag/);
    const motivo = (id) => app.avaliar(`document.querySelector('[data-id="${id}"] .recado-motivo').textContent`);
    await app.esperar("/^\\.orq\\/recados\\/lidos is a symbolic link/.test(document.querySelector('[data-id=\"x2\"] .recado-motivo').textContent)");
    assert.match(await motivo('x3'), /^Agente 1 has a question or menu open on screen: the message waits/);
    assert.match(await motivo('x4'), /^leaves this computer; .* \(the quoted authorization isn't in your last message, or doesn't name Bruno or their inbox\)$/);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
