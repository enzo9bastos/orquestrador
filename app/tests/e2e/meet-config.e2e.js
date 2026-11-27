// Área: voz (modo reunião: quem falou, pelo Google Meet)
// Pedido de 26/11 (caminho A): Configurações › Voz e reuniões ganha "Nomes no Google Meet", que
// prepara o navegador para a extensão e diz quando ela falou com o app pela última vez.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { abrirApp } = require('./app');

const estado = (app) => app.avaliar("[document.getElementById('config-meet-estado').textContent, document.getElementById('config-meet-estado').dataset.situacao]");

test('Configurações: "Nomes no Google Meet" diz qual passo falta e fica verde só quando a extensão fala com o app', async (t) => {
  const app = await abrirApp({ arquivos: { '.config/BraveSoftware/Brave-Browser/Local State': '{}' } });
  t.after(() => app.fechar());
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.avaliar("document.querySelector('[data-secao-config=\"voz\"]').click()");
  await app.esperar("!/Olhando/.test(document.getElementById('config-meet-estado').textContent)", 10000);
  assert.deepStrictEqual(await estado(app), ['Falta o passo 1: aperte “Preparar o navegador” (Brave).', 'falta']);
  // Âmbar fixo, mesmo com outra cor de destaque escolhida (pedido de 26/11: não azul nem roxo).
  await app.avaliar("document.documentElement.style.setProperty('--esperando', '#8b5cf6'); 1");
  assert.strictEqual(await app.avaliar("getComputedStyle(document.getElementById('config-meet-estado')).color"), 'rgb(245, 158, 11)');
  await app.avaliar("document.getElementById('config-meet-preparar').click()");
  await app.esperar("/^Falta carregar a extensão/.test(document.getElementById('config-meet-estado').textContent)", 10000);
  // Relato de 27/11: só com o "Preparar" a linha ficava verde, a extensão nunca tinha sido
  // carregada no navegador, e a reunião saiu com "Outros". Agora continua âmbar, com o passo que falta.
  assert.deepStrictEqual(await estado(app), ['Falta carregar a extensão no navegador (passos 2 e 3). O app está pronto em Brave, mas a extensão nunca falou com ele; até lá, a nota sai com “Outros”.', 'falta']);
  const arq = path.join(app.casa, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.orquestrador.meet.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(arq, 'utf8')).path, path.join(__dirname, '../../extensao-meet/orq-meet-host.py'));
  assert.ok(!fs.existsSync(path.join(app.casa, '.config/google-chrome')), 'navegador que não existe não ganha pasta');
  assert.strictEqual(await app.avaliar("document.querySelectorAll('.config-meet-passos li').length"), 3, 'os três passos à vista');
  // A extensão falou com o programa (ele anota a hora): verde, com o sinal de certo.
  fs.mkdirSync(path.join(app.casa, '.local/share/orq-app/meet'), { recursive: true });
  fs.writeFileSync(path.join(app.casa, '.local/share/orq-app/meet/contato.json'), JSON.stringify({ ts: new Date(2026, 10, 26, 10, 32).getTime() }));
  await app.avaliar("document.getElementById('fechar-config').click()");
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.esperar("/^Funcionando/.test(document.getElementById('config-meet-estado').textContent)", 10000);
  const [texto, situacao] = await estado(app);
  assert.match(texto, /^Funcionando: a extensão falou com o app pela última vez em 26\/11\/2026,? 10:32\.$/);
  assert.strictEqual(situacao, 'pronto');
  assert.notStrictEqual(await app.avaliar("getComputedStyle(document.getElementById('config-meet-estado')).color"), await app.avaliar("getComputedStyle(document.querySelector('.config-meet span')).color"), 'a cor da linha é outra que a do texto de explicação');
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
  assert.match((await estado(app))[0], /^Falta o passo 1/);
  assert.deepStrictEqual(app.erros, []);
});
