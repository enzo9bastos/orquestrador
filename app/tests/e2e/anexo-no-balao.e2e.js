// Área: conversa (arquivo anexado no balão da mensagem: cartões, como as imagens)
// 23/11: o arquivo anexado aparecia no balão como uma linha "📎 nome" (e, na conversa reaberta, como
// a lista crua de caminhos). Agora são cartões acima do texto, com o tipo colorido e o nome; o clique
// mostra o arquivo na pasta. O texto guardado no balão (para o "voltar") continua o mesmo.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const lerLog = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const ULTIMA = "[...document.querySelectorAll('#mensagens .msg-voce')].pop()";

test('arquivo anexado no balão: cartões acima do texto', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false }, arquivos: { 'docs/Planilha de custos.xlsx': 'x', 'docs/relatorio.pdf': 'x', 'docs/ata, versão 2.docx': 'x' } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i))');
  const docs = path.join(app.casa, 'docs');
  const anexar = (nome) => app.avaliar(`window.__orqTeste.anexarCaminho(${JSON.stringify(nome)}, ${JSON.stringify(path.join(docs, nome))})`);
  const enviar = async (texto) => {
    await app.avaliar(`(() => { const e = document.getElementById('entrada'); e.value = ${JSON.stringify(texto)}; e.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('compositor').requestSubmit(); })()`);
  };
  const cartoes = () => app.avaliar(`[...${ULTIMA}.querySelectorAll('.arquivo-msg')].map((c) => ({ tipo: c.querySelector('.arquivo-tipo').textContent, familia: c.querySelector('.arquivo-tipo').className.replace('arquivo-tipo ', ''), nome: c.querySelector('.arquivo-nome').textContent, caminho: c.dataset.abrirAnexo || '' }))`);
  const aoClaude = () => lerLog(log).filter((o) => o.type === 'user').map((o) => (typeof o.message.content === 'string' ? o.message.content : JSON.stringify(o.message.content)));

  await t.test('na caixa, antes de enviar, o arquivo já mostra o selo do tipo', async () => {
    await anexar('Planilha de custos.xlsx');
    await anexar('relatorio.pdf');
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#anexos .anexo-arquivo')].map((a) => [a.querySelector('.arquivo-tipo').textContent, a.querySelector('.anexo-nome').textContent])"),
      [['XLSX', 'Planilha de custos.xlsx'], ['PDF', 'relatorio.pdf']]);
  });

  await t.test('enviado: um cartão por arquivo (tipo colorido e nome) acima do texto; o texto sem a linha do anexo', async () => {
    await enviar('vamos criar também um campo de valor');
    await app.esperar(`!!${ULTIMA} && ${ULTIMA}.classList.contains('com-arquivos')`, 8000);
    assert.deepStrictEqual(await cartoes(), [
      { tipo: 'XLSX', familia: 'arq-planilha', nome: 'Planilha de custos.xlsx', caminho: path.join(docs, 'Planilha de custos.xlsx') },
      { tipo: 'PDF', familia: 'arq-pdf', nome: 'relatorio.pdf', caminho: path.join(docs, 'relatorio.pdf') }]);
    assert.strictEqual(await app.avaliar(`${ULTIMA}.querySelector('.balao').innerText`), 'vamos criar também um campo de valor');
    assert.doesNotMatch(await app.avaliar(`${ULTIMA}.innerText`), /📎/);
    // Os cartões ficam acima do texto, alinhados à direita como o balão.
    const pos = await app.avaliar(`(() => { const c = ${ULTIMA}.querySelector('.balao-arquivos').getBoundingClientRect(), b = ${ULTIMA}.querySelector('.balao').getBoundingClientRect(); return { acima: c.bottom <= b.top + 1, direita: Math.abs(c.right - b.right) <= 2 }; })()`);
    assert.deepStrictEqual(pos, { acima: true, direita: true });
    // Por baixo nada mudou: o texto do balão (para o "voltar") e o que foi ao Claude.
    assert.strictEqual(await app.avaliar(`${ULTIMA}.dataset.texto`), 'vamos criar também um campo de valor\n📎 Planilha de custos.xlsx, relatorio.pdf');
    await app.esperar("document.getElementById('parar').hidden", 10000);
    assert.strictEqual(aoClaude().pop(), `vamos criar também um campo de valor\n\nArquivos anexados (leia do disco):\n- ${path.join(docs, 'Planilha de custos.xlsx')}\n- ${path.join(docs, 'relatorio.pdf')}`);
    assert.strictEqual(await app.avaliar(`!!${ULTIMA}.querySelector('.editar-msg')`), true, 'o lápis de voltar continua');
  });

  await t.test('só o arquivo, sem texto: o cartão sozinho, sem balão vazio; nome com vírgula continua um cartão só', async () => {
    await anexar('ata, versão 2.docx');
    await enviar('');
    await app.esperar(`${ULTIMA}.dataset.texto === '📎 ata, versão 2.docx'`, 8000);
    assert.deepStrictEqual((await cartoes()).map((c) => [c.tipo, c.familia, c.nome]), [['DOCX', 'arq-texto', 'ata, versão 2.docx']]);
    assert.strictEqual(await app.avaliar(`${ULTIMA}.querySelectorAll('.balao').length`), 0);
    await app.esperar("document.getElementById('parar').hidden", 10000);
  });

  await t.test('o clique no cartão mostra o arquivo na pasta; arquivo que sumiu vira aviso', async () => {
    const avisos = () => app.avaliar("[...document.querySelectorAll('#mensagens .aviso-conversa.erro')].map((a) => a.innerText)");
    await app.avaliar(`${ULTIMA}.querySelector('.arquivo-msg').click()`);
    await app.espera(400);
    assert.deepStrictEqual(await avisos(), []);
    fs.renameSync(path.join(docs, 'ata, versão 2.docx'), path.join(docs, 'ata-movida.docx'));
    await app.avaliar(`${ULTIMA}.querySelector('.arquivo-msg').click()`);
    await app.esperar("document.querySelectorAll('#mensagens .aviso-conversa.erro').length === 1", 5000);
    assert.match((await avisos())[0], /Não achei mais este arquivo: .*ata, versão 2\.docx/);
  });

  await t.test('conversa reaberta: a lista de caminhos vira cartões; mensagem sem anexo fica como sempre foi', async () => {
    await app.avaliar("window.__orqTeste.desenharEvento({ tipo: 'user', antigo: true, message: { role: 'user', content: 'segue o contrato\\n\\nArquivos anexados (leia do disco):\\n- /srv/docs/Contrato final.docx\\n- /srv/docs/dados.csv\\n- /srv/docs/sem-extensao' } })");
    assert.deepStrictEqual(await cartoes(), [
      { tipo: 'DOCX', familia: 'arq-texto', nome: 'Contrato final.docx', caminho: '/srv/docs/Contrato final.docx' },
      { tipo: 'CSV', familia: 'arq-planilha', nome: 'dados.csv', caminho: '/srv/docs/dados.csv' },
      { tipo: '•', familia: 'arq-outro', nome: 'sem-extensao', caminho: '/srv/docs/sem-extensao' }]);
    assert.strictEqual(await app.avaliar(`${ULTIMA}.querySelector('.balao').innerText`), 'segue o contrato');
    assert.match(await app.avaliar(`${ULTIMA}.dataset.texto`), /Arquivos anexados \(leia do disco\):/);
    await app.avaliar("window.__orqTeste.desenharEvento({ tipo: 'user', antigo: true, message: { role: 'user', content: 'mensagem comum, sem anexo' } })");
    assert.strictEqual(await app.avaliar(`${ULTIMA}.classList.contains('com-arquivos') || !!${ULTIMA}.querySelector('.msg-coluna')`), false);
    assert.strictEqual(await app.avaliar(`${ULTIMA}.children.length === 2 && ${ULTIMA}.children[1].className === 'balao' && ${ULTIMA}.children[1].innerText === 'mensagem comum, sem anexo'`), true);
    assert.deepStrictEqual(app.erros, []);
  });
});
