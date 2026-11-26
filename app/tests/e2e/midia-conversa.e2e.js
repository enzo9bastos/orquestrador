// Área: conversa (imagem, GIF e vídeo do computador mostrados na conversa)
// Pedido de 26/11: "seria bom ele mesmo poder mandar em tela cheia ou prévia imagens, vídeos, gifs,
// aí eu vejo pelo próprio app, ao invés de ele ficar abrindo na minha tela".
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { abrirApp } = require('./app');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(16)]);

test('conversa: imagem, GIF e vídeo do computador aparecem na própria conversa, com tela cheia no clique', async (t) => {
  const app = await abrirApp({ arquivos: { 'site/tela.png': PNG, 'site/anim.gif': GIF, 'site/demo.mp4': MP4, 'site/falso.png': 'não sou imagem', '.ssh/chave.png': PNG } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const c = (rel) => path.join(app.casa, rel);
  const desenhar = (texto) => app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify({ tipo: 'assistant', message: { content: [{ type: 'text', text: texto } ] } })})`);
  const figuras = () => app.avaliar("[...document.querySelectorAll('#mensagens .midia-conversa')].map((f) => ({ caminho: f.dataset.caminho, img: !!f.querySelector('img'), video: !!f.querySelector('video'), legenda: (f.querySelector('figcaption') || {}).textContent || '', falha: f.classList.contains('midia-falhou') ? f.textContent.replace(/\\s+/g, ' ').trim() : '' }))");

  await t.test('resposta do Claude com ![legenda](/caminho): a imagem, o GIF e o vídeo aparecem no lugar', async () => {
    await desenhar(`Ficou assim:\n\n![Tela do formulário](${c('site/tela.png')})\n\nA animação: ![](${c('site/anim.gif')}) e o vídeo:\n\n![Demonstração](${c('site/demo.mp4')})`);
    await app.esperar("document.querySelectorAll('#mensagens .midia-conversa:not(.carregando)').length === 3", 8000);
    const f = await figuras();
    assert.deepStrictEqual(f.map((x) => [x.img, x.video, x.legenda, x.falha]), [[true, false, 'Tela do formulário', ''], [true, false, 'anim.gif', ''], [false, true, 'Demonstração', '']]);
    await app.esperar("(() => { const i = document.querySelector('#mensagens .midia-conversa img'); return i && i.complete && i.naturalWidth === 1; })()", 8000);
    assert.ok(await app.avaliar("(() => { const v = document.querySelector('#mensagens .midia-conversa video'); return v.muted && v.loop && v.autoplay; })()"), 'o vídeo na conversa roda sozinho, sem som e repetindo, como um GIF');
    assert.match(await app.avaliar("document.querySelector('#mensagens .midia-conversa img').src"), /^orqmidia:\/\/local\//);
  });

  await t.test('clicar abre em tela cheia no próprio app: imagem com zoom, vídeo com os controles', async () => {
    await app.avaliar("document.querySelector('#mensagens .midia-conversa img').click()");
    assert.deepStrictEqual(await app.avaliar('(() => { const e = window.orqVisor.estado(); return [e.aberto, e.video]; })()'), [true, null]);
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    assert.strictEqual(await app.avaliar('window.orqVisor.estado().aberto'), false);
    await app.avaliar("document.querySelector('#mensagens .midia-conversa video').click()");
    const e = await app.avaliar('window.orqVisor.estado()');
    assert.strictEqual(e.aberto, true);
    assert.match(e.video, /^orqmidia:\/\/local\/.*demo\.mp4$/);
    assert.ok(await app.avaliar("document.querySelector('#visor-imagem video').controls"));
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    assert.strictEqual(await app.avaliar('window.orqVisor.estado().aberto'), false);
  });

  await t.test('o que não pode ser mostrado aparece com o motivo, sem quebrar a resposta', async () => {
    await desenhar(`![](${c('site/falso.png')}) ![](${c('.ssh/chave.png')}) ![](${c('site/sumiu.gif')})`);
    await app.esperar("[...document.querySelectorAll('#mensagens .midia-conversa')].filter((f) => f.classList.contains('midia-falhou')).length === 3", 8000);
    const f = (await figuras()).slice(3).map((x) => x.falha);
    assert.match(f[0], /Não deu para mostrar falso\.png: o conteúdo não bate com a extensão/);
    assert.match(f[1], /Não deu para mostrar chave\.png: pasta protegida/);
    assert.match(f[2], /Não deu para mostrar sumiu\.gif: arquivo não encontrado/);
  });

  await t.test('caminho dentro de bloco de código continua sendo texto', async () => {
    await desenhar('Exemplo de como escrever:\n\n```\n![legenda](' + c('site/tela.png') + ')\n```\n\ne em linha: `![x](' + c('site/tela.png') + ')`');
    await app.espera(400);
    assert.strictEqual((await figuras()).length, 6, 'nenhuma prévia nova');
    assert.match(await app.avaliar("[...document.querySelectorAll('#mensagens .texto-claude')].pop().textContent"), /!\[legenda\]\(/);
  });

  await t.test('recado de agente com --mostrar: a prévia fica à vista, mesmo com o recado fechado', async () => {
    const msg = `<orq-recado id="r9" de="Agente 3 (site)" projeto="site" tipo="aviso">\nAviso de Agente 3 (site) (site):\na animação está pronta\n![anim.gif](${c('site/anim.gif')})\n\nAs linhas ![nome](/caminho) acima o usuário já vê no app.\n</orq-recado>`;
    await app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify({ tipo: 'user', local: true, message: { role: 'user', content: msg } })})`);
    await app.esperar("!!document.querySelector('#mensagens .msg-bastidor-midias .midia-conversa img')", 8000);
    assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens details.msg-bastidor-recado')].pop().open"), false, 'o recado continua fechado');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-bastidor-midias .midia-conversa').length"), 1, 'só a linha de verdade vira prévia (o exemplo "![nome](/caminho)" do aviso não)');
  });

  assert.deepStrictEqual(app.erros, []);
});
