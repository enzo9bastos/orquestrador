// Área: recados (voltar atrás num recado para fora que foi negado)
// 23/11: um recado para fora foi negado sem querer e não havia como voltar atrás. Agora o
// recado negado (e o aviso que o orquestrador recebeu sobre ele) tem "Enviar mesmo assim…", que
// abre uma confirmação no próprio item; só o clique de verdade em "Enviar" manda. Vale por 7 dias.
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const agora = Date.now();
const DIA = 24 * 60 * 60 * 1000;
const log = [
  { id: 'n1', ts: agora - 60000, canal: true, de: { tipo: 'orquestrador' }, para: { tipo: 'externo', nome: 'Bruno', caixa: 'para-bruno' }, tipo: 'externo', texto: 'pode mesclar o PR na homologação', titulo: 'Pedido', classe: 'pedido', estado: 'negado', motivo: null, nota: null },
  { id: 'a1', ts: agora - 59000, canal: true, de: { tipo: 'usuario', nome: 'Usuário' }, para: { tipo: 'orquestrador' }, tipo: 'negado', texto: 'O usuário NÃO deixou sair o recado para Bruno: «pode mesclar o PR na homologação»\n(sem motivo)', estado: 'entregue', motivo: null, envio: 'n1', paraNome: 'Bruno' },
  { id: 'v1', ts: agora - 8 * DIA, canal: true, de: { tipo: 'orquestrador' }, para: { tipo: 'externo', nome: 'Bruno', caixa: 'para-bruno' }, tipo: 'externo', texto: 'recado antigo', classe: 'ciente', estado: 'negado', motivo: null },
].map((r) => JSON.stringify(r)).join('\n') + '\n';

for (const idioma of ['pt-BR', 'en']) {
  test(`recado negado: enviar mesmo assim, com confirmação (${idioma})`, async (t) => {
    const app = await abrirApp({
      config: { idioma, mostrarBichinho: false, canalContatos: [{ nome: 'Bruno', caixa: 'para-bruno' }] },
      arquivos: { '.local/share/orq-app/recados/recados.jsonl': log },
    });
    t.after(() => app.fechar());
    await app.esperar('!!window.__orqRecados');
    const en = idioma === 'en';
    const botao = (id) => `document.querySelector('[data-id="${id}"] [data-rc-voltar]')`;
    const registro = () => app.ler('.local/share/orq-app/recados/recados.jsonl');
    const clicarDeVerdade = async (seletor) => {
      const r = await app.avaliar(`(() => { const b = document.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await app.mouse('mousePressed', r.x, r.y); await app.mouse('mouseReleased', r.x, r.y);
    };
    await app.avaliar("document.querySelector('[data-aba=\"aba-recados\"]').click()");
    await app.esperar("document.querySelectorAll('#recados-linha .recado').length === 3");

    await t.test('o recado negado e o aviso sobre ele mostram "Enviar mesmo assim…"; o de mais de 7 dias, não', async () => {
      await app.esperar(`!!${botao('n1')} && !!${botao('a1')}`, 5000);
      assert.strictEqual((await app.avaliar(`${botao('n1')}.textContent`)).trim(), en ? 'Send anyway…' : 'Enviar mesmo assim…');
      assert.strictEqual(await app.avaliar(`!!${botao('v1')}`), false);
    });

    if (en) {
      await app.avaliar(`${botao('n1')}.click()`);
      await app.esperar("!!document.querySelector('[data-id=\"n1\"] .recado-voltar-confirma')", 4000);
      assert.match(await app.avaliar("document.querySelector('[data-id=\"n1\"] .recado-voltar-confirma').innerText"), /This message will leave this computer for\s+Bruno\. Send now\?[\s\S]*Cancel[\s\S]*Send/);
      assert.deepStrictEqual(app.erros, []);
      return;
    }

    await t.test('o clique abre a confirmação no próprio item, dizendo para quem sai; Cancelar fecha e nada muda', async () => {
      await app.avaliar(`${botao('n1')}.click()`);
      await app.esperar("!!document.querySelector('[data-id=\"n1\"] .recado-voltar-confirma')", 4000);
      const c = await app.avaliar("document.querySelector('[data-id=\"n1\"] .recado-voltar-confirma').innerText.replace(/\\s+/g, ' ').trim()");
      assert.strictEqual(c, 'Este recado vai sair deste computador para Bruno. Enviar agora? Cancelar Enviar');
      assert.strictEqual(await app.avaliar("document.activeElement.dataset.rcVoltarEnviar"), 'n1', 'o teclado vai para o Enviar');
      assert.strictEqual(await app.avaliar("!!document.querySelector('[data-id=\"a1\"] .recado-voltar-confirma')"), false, 'só no item clicado');
      await app.avaliar("document.querySelector('[data-rc-voltar-cancelar=\"n1\"]').click()");
      await app.esperar(`!document.querySelector('[data-id="n1"] .recado-voltar-confirma') && !!${botao('n1')}`, 4000);
      assert.doesNotMatch(registro(), /voltouAtras/);
    });

    await t.test('um clique que não veio da pessoa no "Enviar" não manda nada', async () => {
      await app.avaliar(`${botao('n1')}.click()`);
      await app.esperar("!!document.querySelector('[data-rc-voltar-enviar=\"n1\"]')", 4000);
      await app.avaliar("document.querySelector('[data-rc-voltar-enviar=\"n1\"]').click()");
      await app.espera(500);
      assert.doesNotMatch(registro(), /voltouAtras/);
      assert.strictEqual(await app.avaliar("document.querySelector('[data-id=\"n1\"] .recado-selo-estado').textContent"), 'negado');
    });

    await t.test('o clique de verdade em "Enviar" põe na fila, avisa o orquestrador e o aviso antigo diz que você voltou atrás', async () => {
      await clicarDeVerdade('[data-rc-voltar-enviar="n1"]');
      await app.esperar("document.querySelector('[data-id=\"n1\"] .recado-selo-estado').textContent === 'na fila'", 8000);
      assert.match(registro(), /"id":"n1","mudanca":\{"estado":"na-fila","motivo":null,"voltouAtras":\d+/);
      assert.match(registro(), /"tipo":"aviso","texto":"O usuário voltou atrás e deixou sair o recado para Bruno que tinha negado/);
      await app.esperar("/Você voltou atrás depois: o recado saiu\\./.test(document.querySelector('[data-id=\"a1\"]').innerText)", 4000);
      assert.match(await app.avaliar("document.querySelector('[data-id=\"n1\"]').innerText"), /Você tinha negado e voltou atrás: este recado saiu depois\./);
      assert.strictEqual(await app.avaliar(`!!${botao('n1')} || !!${botao('a1')}`), false, 'o botão some depois de enviar');
      assert.deepStrictEqual(app.erros, []);
    });
  });
}
