// Área: repertorio
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('repertorio', async (t) => {
  const app = await abrirApp({
    config: { detectarFerramentas: false, pastasNotas: [{ nome: 'N', caminho: '~/n' }], fontesRepertorio: [{ nome: 'Claude', ferramenta: 'claude', caminho: '~/c' }, { nome: 'Outra', ferramenta: 'agentes', caminho: '~/o' }] },
    arquivos: { 'c/revisar/SKILL.md': '---\nname: revisar\ndescription: Revisa\n---\nx', 'o/publicar/SKILL.md': '---\nname: publicar\ndescription: Publica\n---\nINSTRUCOES-DA-SKILL', 'n/plano.md': '# Plano\n\nCONTEUDO-DA-NOTA\n' },
  });
  t.after(() => app.fechar());
  const digitar = async (v) => { await app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(v)}; e.setSelectionRange(e.value.length, e.value.length); e.dispatchEvent(new Event('input')); })()`); await app.espera(400); };
  const lista = () => app.avaliar("document.getElementById('sugestoes').hidden ? '' : document.getElementById('sugestoes').innerText");

  await t.test('// mostra o repertório inteiro (as duas ferramentas)', async () => {
    await digitar('olha isso //');
    await app.esperar("!document.getElementById('sugestoes').hidden", 4000);
    const l = await lista();
    assert.match(l, /\/\/revisar/); assert.match(l, /\/\/publicar/);
  });

  await t.test('@ sugere nota: e workflow:; @nota: lista as notas', async () => {
    await digitar('veja @');
    assert.match(await lista(), /@nota:[\s\S]*@workflow:/);
    await digitar('veja @nota:pla');
    assert.match(await lista(), /@nota:N\/plano/);
  });

  await t.test('ao enviar: skill do Claude vira /nome, outra vai com instruções, nota vai com conteúdo', async () => {
    await app.avaliar("document.querySelector('[data-aba=aba-notas]').click()");
    await app.esperar("!!document.querySelector('.linha-nota')");
    await app.avaliar("document.querySelector('[data-aba=aba-orquestrador]').click()");
    const r = await app.avaliar("window.__orqTeste.expandir('use //revisar e //publicar com @nota:N/plano')");
    assert.match(r.enviar, /^use \/revisar e \(skill «publicar»/);
    assert.match(r.enviar, /INSTRUCOES-DA-SKILL/);
    assert.match(r.enviar, /CONTEUDO-DA-NOTA/);
    assert.strictEqual(r.exibir, 'use //revisar e //publicar com @nota:N/plano', 'o balão mostra o que foi escrito');
  });

  await t.test('aba Repertório: mostra a skill e cria atalho com tecla', async () => {
    await app.avaliar("document.querySelector('[data-aba=aba-repertorio]').click()");
    await app.esperar("!!document.querySelector('.item-repertorio[data-id=\"claude:skill:revisar\"]')");
    await app.avaliar("document.querySelector('.item-repertorio[data-id=\"claude:skill:revisar\"]').click()");
    await app.esperar("/\\/\\/revisar/.test(document.getElementById('detalhe-repertorio').innerText)");
    await app.avaliar("document.getElementById('novo-atalho').click()");
    await app.avaliar("(() => { const f = document.querySelector('.form-atalho'); f.nome.value = 'Conferir Tudo'; f.texto.value = 'confira tudo'; f.tecla.value = '4'; f.requestSubmit(); })()");
    await app.esperar("!!document.querySelector('.item-repertorio[data-tipo=\"atalho\"]')");
    assert.match(app.ler('.config/orq-app/repertorio.json'), /"conferir-tudo"[\s\S]*"tecla": "4"/);
  });
});
