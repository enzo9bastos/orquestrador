// Área: voz (modo reunião: quem falou, pelo Google Meet)
// Pedido de 26/11 (caminho A): Configurações › Voz e reuniões ganha "Nomes no Google Meet", que
// prepara o navegador para a extensão e diz quando ela falou com o app pela última vez.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { abrirApp } = require('./app');

test('Configurações: "Nomes no Google Meet" prepara o navegador que existe e mostra o estado', async (t) => {
  const app = await abrirApp({ arquivos: { '.config/BraveSoftware/Brave-Browser/Local State': '{}' } });
  t.after(() => app.fechar());
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.avaliar("document.querySelector('[data-secao-config=\"voz\"]').click()");
  await app.esperar("!/Olhando/.test(document.getElementById('config-meet-estado').textContent)", 10000);
  assert.strictEqual(await app.avaliar("document.getElementById('config-meet-estado').textContent"), 'Ainda não preparado (Brave). A extensão ainda não falou com o app (ela fala quando há uma ligação do Meet aberta).');
  assert.strictEqual(await app.avaliar("document.getElementById('config-meet-estado').dataset.situacao"), 'falta', 'falta preparar: a linha fica em âmbar');
  await app.avaliar("document.getElementById('config-meet-preparar').click()");
  await app.esperar("/^Pronto em: Brave\\./.test(document.getElementById('config-meet-estado').textContent)", 10000);
  assert.strictEqual(await app.avaliar("document.getElementById('config-meet-estado').dataset.situacao"), 'pronto', 'pronto: a linha fica verde, com o sinal de certo');
  assert.notStrictEqual(await app.avaliar("getComputedStyle(document.getElementById('config-meet-estado')).color"), await app.avaliar("getComputedStyle(document.querySelector('.config-meet span')).color"), 'a cor da linha é outra que a do texto de explicação');
  const arq = path.join(app.casa, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.orquestrador.meet.json');
  const m = JSON.parse(fs.readFileSync(arq, 'utf8'));
  assert.strictEqual(m.path, path.join(__dirname, '../../extensao-meet/orq-meet-host.py'));
  assert.ok(!fs.existsSync(path.join(app.casa, '.config/google-chrome')), 'navegador que não existe não ganha pasta');
  // Quando a extensão fala com o programa, ele anota a hora; as Configurações mostram.
  fs.mkdirSync(path.join(app.casa, '.local/share/orq-app/meet'), { recursive: true });
  fs.writeFileSync(path.join(app.casa, '.local/share/orq-app/meet/contato.json'), JSON.stringify({ ts: new Date(2026, 10, 26, 10, 32).getTime() }));
  await app.avaliar("document.querySelector('[data-secao-config=\"voz\"]').click()");
  await app.esperar("/última vez em 26\\/11\\/2026/.test(document.getElementById('config-meet-estado').textContent)", 10000);
  assert.match(await app.avaliar("document.getElementById('config-meet-estado').textContent"), /^Pronto em: Brave\. A extensão falou com o app pela última vez em 26\/11\/2026,? 10:32\.$/);
  assert.deepStrictEqual(app.erros, []);
});
