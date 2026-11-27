// Área: voz (modo reunião: quem falou, pelo Google Meet)
// Pedido de 26/11 (caminho A): Configurações › Voz e reuniões ganha "Nomes no Google Meet", que
// prepara o navegador para a extensão e diz quando ela falou com o app pela última vez.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { abrirApp } = require('./app');

const estado = (app) => app.avaliar("[document.getElementById('config-meet-estado').textContent, document.getElementById('config-meet-estado').dataset.situacao]");

// Pedido de 27/11: "ao invés de seguir todos esses passos faça o app fazer isso sozinho, mesmo que
// precise da ajuda da pessoa". Um botão prepara, abre a página de extensões e copia o caminho; o guia
// acompanha ao vivo e a linha só fica verde quando a extensão dá sinal.
test('Configurações: "Ligar no navegador" faz o que dá sozinho e guia o resto, ao vivo', async (t) => {
  const anotado = path.join(require('../temporarias').pastaTemporaria('orq-navegador-falso-'), 'abriu.json');
  const navegadorFalso = [process.execPath, '-e', "require('fs').writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))", anotado];
  const app = await abrirApp({
    arquivos: { '.config/BraveSoftware/Brave-Browser/Local State': '{}', '.config/BraveSoftware/Brave-Browser/Default/Preferences': JSON.stringify({ extensions: { ui: { developer_mode: false } } }) },
    env: { ORQ_MEET_NAVEGADOR: JSON.stringify(navegadorFalso) },
  });
  t.after(() => app.fechar());
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.avaliar("document.querySelector('[data-secao-config=\"voz\"]').click()");
  await app.esperar("!/Olhando/.test(document.getElementById('config-meet-estado').textContent)", 10000);
  assert.deepStrictEqual(await estado(app), ['Ainda não ligado: aperte “Ligar no navegador”.', 'falta']);
  // Âmbar fixo, mesmo com outra cor de destaque escolhida (pedido de 26/11: não azul nem roxo).
  await app.avaliar("document.documentElement.style.setProperty('--esperando', '#8b5cf6'); 1");
  assert.strictEqual(await app.avaliar("getComputedStyle(document.getElementById('config-meet-estado')).color"), 'rgb(245, 158, 11)');

  await app.avaliar("document.getElementById('config-meet-ligar').click()");
  await app.esperar("!document.getElementById('config-meet-guia').hidden", 10000);
  // O que o app fez sozinho: o arquivo no navegador, a página de extensões aberta e o caminho copiado.
  const arq = path.join(app.casa, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.orquestrador.meet.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(arq, 'utf8')).path, path.join(__dirname, '../../extensao-meet/orq-meet-host.py'));
  for (let i = 0; i < 50 && !fs.existsSync(anotado); i++) await app.espera(100);
  assert.match(JSON.parse(fs.readFileSync(anotado, 'utf8')).pop(), /^(brave:\/\/extensions\/|)$/, 'o navegador abre na página de extensões');
  const pasta = path.join(__dirname, '../../extensao-meet');
  assert.ok((await app.avaliar("document.getElementById('config-meet-guia').textContent")).includes(pasta), 'o guia mostra o caminho copiado');
  const marcas = () => app.avaliar("[...document.querySelectorAll('#config-meet-guia .guia-marca')].map((m) => m.dataset.ok)");
  assert.deepStrictEqual(await marcas(), ['1', '0', '0']);
  assert.match(await app.avaliar("document.getElementById('config-meet-guia').textContent"), /Ligue o “Modo do desenvolvedor”[\s\S]*Ctrl\+L, cole com Ctrl\+V/);
  assert.deepStrictEqual(await estado(app), ['Falta carregar a extensão no navegador: aperte “Ligar no navegador” e siga o passo que aparece. Até lá, a nota sai com “Outros”.', 'falta'], 'só preparar não deixa verde (relato de 27/11)');

  // A pessoa liga o modo do desenvolvedor: o guia vê sozinho.
  fs.writeFileSync(path.join(app.casa, '.config/BraveSoftware/Brave-Browser/Default/Preferences'), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
  await app.esperar("document.querySelectorAll('#config-meet-guia .guia-marca[data-ok=\"1\"]').length === 2", 5000);
  // A extensão foi carregada e deu "oi" ao programa (ele anota a hora): tudo verde, sem esperar uma ligação.
  fs.mkdirSync(path.join(app.casa, '.local/share/orq-app/meet'), { recursive: true });
  fs.writeFileSync(path.join(app.casa, '.local/share/orq-app/meet/contato.json'), JSON.stringify({ ts: Date.now() }));
  await app.esperar("/^Funcionando/.test(document.getElementById('config-meet-estado').textContent)", 5000);
  assert.deepStrictEqual(await marcas(), ['1', '1', '1']);
  assert.strictEqual((await estado(app))[1], 'pronto');
  assert.doesNotMatch(await app.avaliar("document.getElementById('config-meet-guia').textContent"), /Esperando/);
  assert.deepStrictEqual(app.erros, []);
});

// Relato de 27/11: a linha ficou em "Olhando…". As Configurações abrem na última seção usada; quem
// chegava a "Voz e reuniões" sem clicar nela (abrindo direto, ou pelas setas) nunca via o estado,
// nem o do motor de transcrição ("Procurando…").
test('Configurações: abrindo direto em "Voz e reuniões" (ou chegando pelas setas), o estado aparece', async (t) => {
  const app = await abrirApp({ arquivos: { '.config/BraveSoftware/Brave-Browser/Local State': '{}' } });
  t.after(() => app.fechar());
  await app.avaliar("document.getElementById('abrir-config').click()");
  // Pelas setas, sem clicar na seção.
  for (let i = 0; i < 12 && !(await app.avaliar("!document.getElementById('config-sec-voz').hidden")); i++) {
    await app.avaliar("document.querySelector('#config-nav [aria-selected=\"true\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))");
  }
  assert.ok(await app.avaliar("!document.getElementById('config-sec-voz').hidden"), 'chegou a Voz e reuniões pelas setas');
  await app.esperar("!/Olhando/.test(document.getElementById('config-meet-estado').textContent)", 10000);
  await app.esperar("!/Procurando/.test(document.getElementById('config-voz-motor').textContent)", 15000);
  // Fecha e abre de novo: a janela volta direto nesta seção (é a última usada) e olha de novo.
  await app.avaliar("document.getElementById('fechar-config').click()");
  await app.avaliar("document.getElementById('config-meet-estado').textContent = 'Olhando…'; 1");
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.esperar("!/Olhando/.test(document.getElementById('config-meet-estado').textContent)", 10000);
  assert.match((await estado(app))[0], /^Ainda não ligado/);
  assert.deepStrictEqual(app.erros, []);
});
