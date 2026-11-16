// Área: recados
// Anexos do canal na aba Recados: miniatura do que vai sair (com o aviso do
// link), imagem e PDF que chegaram, anexo que falhou; e o ciclo todo contra um
// servidor ntfy FALSO daqui mesmo (receber e baixar, aprovar e enviar).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { abrirApp } = require('./app');
const ex = require('../unit/imagens-exemplo');

const TOKEN = 'tk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PNG = ex.png(160, 100, [], [60, 120, 200]);
const recebidos = [];
const downloads = [];
const fila = []; // mensagens que a caixa para-ana entrega ao conectar
const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'PUT' || req.method === 'POST') {
    const partes = [];
    req.on('data', (d) => partes.push(d));
    req.on('end', () => { recebidos.push({ metodo: req.method, caixa: u.pathname.slice(1), h: req.headers, corpo: Buffer.concat(partes) }); res.writeHead(200); res.end('{"id":"ok"}'); });
    return;
  }
  if (u.pathname === '/para-ana/json') {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end('{}'); }
    const desde = u.searchParams.get('since');
    const i = fila.findIndex((m) => m.id === desde);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write('{"event":"open"}\n');
    for (const m of (i >= 0 ? fila.slice(i + 1) : fila)) res.write(JSON.stringify({ event: 'message', ...m }) + '\n');
    return res.end();
  }
  downloads.push({ url: u.pathname, auth: req.headers.authorization || null });
  if (u.pathname === '/file/print.png') { res.writeHead(200, { 'Content-Length': PNG.length }); return res.end(PNG); }
  res.writeHead(404); return res.end('{}');
});
let HOST;
test.before(() => new Promise((ok) => servidor.listen(0, '127.0.0.1', () => { HOST = `http://127.0.0.1:${servidor.address().port}`; ok(); })));
test.after(() => servidor.close());

const agora = Date.now();
const linhas = (casa) => {
  const saida = path.join(casa, '.local/share/orq-app/recados/anexos-saida/s1');
  const rec = path.join(casa, '.local/share/orq-app/anexos-canal/2026-11-16');
  fs.mkdirSync(saida, { recursive: true }); fs.mkdirSync(rec, { recursive: true });
  fs.writeFileSync(path.join(saida, '1-captura.png'), PNG);
  fs.writeFileSync(path.join(saida, '2-relatorio.pdf'), ex.pdf());
  fs.writeFileSync(path.join(rec, 'erro-da-tela.png'), PNG);
  fs.writeFileSync(path.join(rec, 'resumo.pdf'), ex.pdf());
  const de = { tipo: 'externo', nome: 'Bruno', verificado: false };
  return [
    { id: 's1', ts: agora - 5000, canal: true, de: { tipo: 'orquestrador' }, para: { tipo: 'externo', nome: 'Bruno', caixa: 'para-bruno' }, tipo: 'externo', texto: 'Segue o erro e o relatório', titulo: 'Erro na tela', classe: 'informacao', estado: 'aguardando',
      motivo: 'vai sair deste computador; tem 2 anexos: espera você ver e aprovar', anexos: [
        { nome: 'captura.png', tipo: 'png', bytes: PNG.length, arquivo: path.join(saida, '1-captura.png'), sha256: require('crypto').createHash('sha256').update(PNG).digest('hex'), retirado: [] },
        { nome: 'relatorio.pdf', tipo: 'pdf', bytes: ex.pdf().length, arquivo: path.join(saida, '2-relatorio.pdf'), sha256: require('crypto').createHash('sha256').update(ex.pdf()).digest('hex'), retirado: [] }] },
    { id: 'r1', ts: agora - 4000, canal: true, canalId: 'n1', de, para: { tipo: 'orquestrador' }, tipo: 'externo', texto: 'veja o erro', titulo: null, estado: 'entregue', motivo: null,
      anexo: { estado: 'ok', nome: 'erro-da-tela.png', tipo: 'png', bytes: PNG.length, caminho: path.join(rec, 'erro-da-tela.png') } },
    { id: 'r2', ts: agora - 3000, canal: true, canalId: 'n2', de, para: { tipo: 'orquestrador' }, tipo: 'externo', texto: 'o resumo', titulo: null, estado: 'entregue', motivo: null,
      anexo: { estado: 'ok', nome: 'resumo.pdf', tipo: 'pdf', bytes: ex.pdf().length, caminho: path.join(rec, 'resumo.pdf') } },
    { id: 'r3', ts: agora - 2000, canal: true, canalId: 'n3', de, para: { tipo: 'orquestrador' }, tipo: 'externo', texto: 'mandei um print ontem', titulo: null, estado: 'entregue', motivo: null,
      anexo: { estado: 'falhou', nome: 'antigo.png', erro: 'o anexo expirou no servidor (ele guarda por 7 dias)' } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
};

async function abrirComRecados(config) {
  const app = await abrirApp({ config });
  fs.mkdirSync(path.join(app.casa, '.local/share/orq-app/recados'), { recursive: true });
  fs.writeFileSync(path.join(app.casa, '.local/share/orq-app/recados/recados.jsonl'), linhas(app.casa));
  await app.esperar('!!window.__orqRecados');
  await app.avaliar("document.querySelector('[data-aba=\"aba-recados\"]').click()");
  await app.esperar("document.querySelectorAll('#recados-aprovar-linha .recado, #recados-linha .recado').length === 4", 10000);
  return app;
}

test('aba Recados: miniatura do que vai sair, aviso do link, imagem e PDF recebidos, anexo que falhou', async (t) => {
  const app = await abrirComRecados({ canalContatos: [{ nome: 'Bruno', caixa: 'para-bruno' }] });
  t.after(() => app.fechar());

  await t.test('o cartão "Para aprovar" mostra a miniatura da imagem, o PDF com nome e tamanho, e o aviso em destaque', async () => {
    await app.esperar("(document.querySelector('[data-id=\"s1\"] img.recado-miniatura') || {}).naturalWidth === 160", 10000);
    const c = await app.avaliar(`(() => { const li = document.querySelector('#recados-aprovar-linha [data-id="s1"]'); return { img: li.querySelector('img').src.slice(0, 22), nomes: [...li.querySelectorAll('.recado-anexo')].map((x) => x.innerText.replace(/\\s+/g, ' ').trim()), aviso: li.querySelector('.recado-aviso-anexo').innerText, alerta: li.querySelector('.recado-aviso-anexo').getAttribute('role'), aprovar: !!li.querySelector('[data-rc-decidir][data-aprovar="1"]') }; })()`);
    assert.strictEqual(c.img, 'data:image/png;base64,');
    assert.match(c.nomes[0], /^captura\.png · \d+(\.\d)? (B|KB)$/);
    assert.match(c.nomes[1], /relatorio\.pdf · \d+ B Abrir no explorador$/);
    assert.match(c.aviso, /^Quem tiver o link abre por 7 dias: não mande print com senha, token ou dado pessoal ou de cliente; recorte a tela antes\.\nCada arquivo pode ter até 5 MB\. Das imagens, o app tira os metadados \(EXIF, GPS, texto\); o PDF vai como está\.$/);
    assert.deepStrictEqual([c.alerta, c.aprovar], ['alert', true]);
  });

  await t.test('imagem e PDF que chegaram aparecem pelo arquivo local; nada remoto é carregado na tela', async () => {
    await app.esperar("(document.querySelector('[data-id=\"r1\"] img') || {}).naturalWidth === 160", 10000);
    const r = await app.avaliar(`(() => ({ pdf: document.querySelector('[data-id="r2"] .recado-anexo-pdf').innerText.replace(/\\s+/g, ' ').trim(),
      externos: [...document.querySelectorAll('#aba-recados [src], #aba-recados [href]')].map((e) => e.getAttribute('src') || e.getAttribute('href')).filter((u) => !/^data:image\\//.test(u) && !/^#/.test(u)),
      avisoSoNoQueSai: document.querySelectorAll('.recado-aviso-anexo').length }))()`);
    assert.match(r.pdf, /^📄 resumo\.pdf · \d+ B Abrir no explorador$/);
    assert.deepStrictEqual(r.externos, [], 'só data: de arquivo local; nenhum link nem imagem remota');
    assert.strictEqual(r.avisoSoNoQueSai, 1, 'o aviso é do que vai sair, não do que chegou');
  });

  await t.test('anexo que expirou ou falhou: o recado aparece e diz o motivo', async () => {
    const f = await app.avaliar("document.querySelector('[data-id=\"r3\"] .recado-anexo-falha').innerText.replace(/\\s+/g, ' ')");
    assert.match(f, /^Anexo que não chegou: antigo\.png — o anexo expirou no servidor \(ele guarda por 7 dias\)$/);
    assert.match(await app.avaliar("document.querySelector('[data-id=\"r3\"] .recado-texto').textContent"), /mandei um print ontem/);
  });

  await t.test('"Abrir no explorador" do PDF não dá erro (nos testes não abre o explorador de verdade)', async () => {
    await app.avaliar("document.querySelector('[data-id=\"r2\"] [data-rc-abrir]').click()");
    await app.espera(300);
  });

  await t.test('na conversa do orquestrador não há cartão de aprovar para recado com anexo (só na aba, com a miniatura)', async () => {
    await app.avaliar("document.querySelector('[data-aba=\"aba-orquestrador\"]').click()");
    await app.espera(800);
    assert.strictEqual(await app.avaliar("!!document.querySelector('#mensagens [data-aprovacao=\"s1\"]')"), false);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('aba Recados em inglês: o aviso e os rótulos dos anexos', async (t) => {
  const app = await abrirComRecados({ idioma: 'en', canalContatos: [{ nome: 'Bruno', caixa: 'para-bruno' }] });
  t.after(() => app.fechar());
  await app.esperar("window.orqI18n && window.orqI18n.idioma() === 'en'", 15000);
  await app.esperar("/Anyone with the link/.test(document.querySelector('.recado-aviso-anexo').innerText)", 10000);
  const aviso = await app.avaliar("document.querySelector('.recado-aviso-anexo').innerText");
  assert.strictEqual(aviso, "Anyone with the link can open it for 7 days: don't send a screenshot with a password, token, or personal or customer data; crop the screen first.\nEach file can be up to 5 MB. The app strips the metadata (EXIF, GPS, text) from images; a PDF goes as it is.");
  assert.match(await app.avaliar("document.querySelector('[data-id=\"r2\"] .recado-anexo-pdf').innerText.replace(/\\s+/g, ' ').trim()"), /^📄 resumo\.pdf · \d+ B Show in file manager$/);
  assert.match(await app.avaliar("document.querySelector('[data-id=\"r3\"] .recado-anexo-falha').innerText.replace(/\\s+/g, ' ')"), /^Attachment that didn't arrive: antigo\.png — the attachment expired on the server \(it keeps them for 7 days\)$/);
  assert.match(await app.avaliar("document.querySelector('[data-id=\"s1\"] .recado-motivo').innerText"), /^leaves this computer; has 2 attachment\(s\): waits for you to see and approve$/);
  assert.deepStrictEqual(app.erros, []);
});

test('ciclo com servidor falso: a mensagem com anexo chega, é baixada e mostrada; aprovar manda os arquivos sem metadados', async (t) => {
  fila.length = 0;
  fila.push({ id: 'm1', time: Math.floor(Date.now() / 1000), topic: 'para-ana', title: 'Erro', message: 'veja o print', tags: ['de-bruno'],
    attachment: { name: 'print.png', type: 'image/png', size: PNG.length, url: `${HOST}/file/print.png`, expires: Math.floor(Date.now() / 1000) + 86400 } });
  const app = await abrirApp({ config: { canalServidor: HOST, canalMinhaCaixa: 'para-ana', canalMeuNome: 'Ana', canalContatos: [{ nome: 'Bruno', caixa: 'para-bruno' }] },
    arquivos: { '.config/ntfy/client.yml': `default-host: ${HOST}\ndefault-token: ${TOKEN}\n` } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqRecados');
  await app.avaliar("document.querySelector('[data-aba=\"aba-recados\"]').click()");

  await t.test('baixou sem token, guardou em 600 e a tela mostra a imagem do arquivo local', async () => {
    await app.esperar("!!document.querySelector('#recados-linha img.recado-miniatura')", 20000);
    await app.avaliar('window.__orqRecados.carregar()');
    await app.esperar("(document.querySelector('#recados-linha img.recado-miniatura') || {}).naturalWidth === 160", 10000);
    assert.deepStrictEqual(downloads.map((d) => d.auth), [null]);
    const dia = fs.readdirSync(path.join(app.casa, '.local/share/orq-app/anexos-canal'));
    assert.strictEqual(dia.length, 1);
    const arq = path.join(app.casa, '.local/share/orq-app/anexos-canal', dia[0], 'print.png');
    assert.ok(fs.readFileSync(arq).equals(PNG));
    assert.deepStrictEqual([fs.statSync(arq).mode & 0o777, fs.statSync(path.dirname(arq)).mode & 0o777], [0o600, 0o700]);
  });

  await t.test('aprovar o recado com anexos manda um PUT por arquivo, sem metadados, ligados pelo mesmo id', async () => {
    const com = ex.pngComMetadados();
    const saida = path.join(app.casa, '.local/share/orq-app/recados/anexos-saida/s9');
    fs.mkdirSync(saida, { recursive: true, mode: 0o700 });
    const limpo = require('../../canal-anexo').limparMetadados(com, 'png').buf;
    fs.writeFileSync(path.join(saida, '1-tela.png'), limpo);
    fs.writeFileSync(path.join(saida, '2-doc.pdf'), ex.pdf());
    const h = (b) => require('crypto').createHash('sha256').update(b).digest('hex');
    const rec = { id: 's9', ts: Date.now(), canal: true, de: { tipo: 'orquestrador' }, para: { tipo: 'externo', nome: 'Bruno', caixa: 'para-bruno' }, tipo: 'externo', texto: 'segue o print', titulo: 'Assunto', classe: 'decisao', estado: 'aguardando', motivo: 'x',
      anexos: [{ nome: 'tela.png', tipo: 'png', bytes: limpo.length, arquivo: path.join(saida, '1-tela.png'), sha256: h(limpo), retirado: [] }, { nome: 'doc.pdf', tipo: 'pdf', bytes: ex.pdf().length, arquivo: path.join(saida, '2-doc.pdf'), sha256: h(ex.pdf()), retirado: [] }] };
    fs.appendFileSync(path.join(app.casa, '.local/share/orq-app/recados/recados.jsonl'), JSON.stringify(rec) + '\n');
    await app.avaliar('window.__orqRecados.carregar()');
    await app.esperar("!!document.querySelector('#recados-aprovar-linha [data-id=\"s9\"] [data-rc-decidir][data-aprovar=\"1\"]')", 10000);
    await app.avaliar("document.querySelector('[data-rc-decidir=\"s9\"][data-aprovar=\"1\"]').click()");
    await app.esperar('true', 100);
    for (let i = 0; i < 100 && recebidos.length < 2; i++) await app.espera(200);
    assert.strictEqual(recebidos.length, 2);
    assert.deepStrictEqual(recebidos.map((x) => [x.metodo, x.caixa, x.h.filename, x.h['content-type']]), [['PUT', 'para-bruno', 'tela.png', 'image/png'], ['PUT', 'para-bruno', 'doc.pdf', 'application/pdf']]);
    assert.ok(!recebidos[0].corpo.includes('FakeCam-EXIF-7788'), 'o que saiu não tem metadados');
    assert.strictEqual(recebidos[0].h.tags, recebidos[1].h.tags);
    assert.match(recebidos[0].h.tags, /^de-ana,rc-s9$/);
    await app.esperar("(document.querySelector('[data-id=\"s9\"] .recado-selo-estado') || {}).textContent === 'entregue'", 15000);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
