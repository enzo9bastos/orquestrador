// Área: demandas (painel resumido que abre a nota .md na aba Notas)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { abrirApp } = require('./app');

test('demandas: cartão resumido abre a nota na aba Notas', async (t) => {
  const app = await abrirApp({ config: { pastasNotas: [{ nome: 'Orquestração', caminho: '~/orq' }] }, arquivos: { 'orq/leia.md': '# leia' } });
  t.after(() => app.fechar());
  await app.esperar('!!window.orqNotas');
  const cli = path.join(__dirname, '..', '..', 'bin', 'orq-topico');
  const orq = (...a) => execFileSync(process.execPath, [cli, ...a], { env: { ...process.env, HOME: app.casa }, encoding: 'utf8' }).trim();
  const id = orq('abrir', 'Revisar os backups', '--codigo', 'T-2001', '--agente', 'Agente 1').match(/\d+/)[0];
  orq('item', id, 'Conferir ontem'); orq('item', id, 'Testar restauração'); orq('marcar', id, '1');

  await t.test('o cartão mostra só título, estado, código, agentes e progresso', async () => {
    await app.esperar("!!document.querySelector('.topico-resumido')", 8000);
    const txt = await app.avaliar("document.querySelector('.topico-resumido').innerText");
    assert.match(txt, /Revisar os backups/);
    assert.match(txt, /T-2001/);
    assert.match(txt, /Agente 1/);
    assert.match(txt, /1\/2/);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.topico-resumido input, .topico-resumido form').length"), 0, 'sem checklist nem campos no cartão');
  });

  await t.test('setinha expande e mostra só o que falta; não abre a nota', async () => {
    assert.strictEqual(await app.avaliar("!!document.querySelector('.topico-resumido .lista-falta')"), false, 'começa recolhido');
    await app.avaliar("document.querySelector('.topico-resumido [data-expandir-topico]').click()");
    await app.esperar("!!document.querySelector('.topico-resumido .lista-falta')");
    const falta = await app.avaliar("[...document.querySelectorAll('.topico-resumido .lista-falta li')].map((l) => l.innerText.trim())");
    assert.deepStrictEqual(falta, ['Testar restauração'], 'só a etapa que falta');
    assert.ok(!(await app.avaliar("document.getElementById('aba-notas').classList.contains('ativa')")), 'a setinha não abre a nota');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-expandir-topico]').getAttribute('aria-expanded')"), 'true');
    await app.avaliar("document.querySelector('.topico-resumido [data-expandir-topico]').click()");
    await app.esperar("!document.querySelector('.topico-resumido .lista-falta')");
  });

  await t.test('clicar abre a nota da demanda na aba Notas', async () => {
    await app.avaliar("document.querySelector('.topico-resumido .topico-titulo').click()");
    await app.esperar("document.getElementById('aba-notas').classList.contains('ativa')", 5000);
    await app.esperar("document.getElementById('titulo-nota').textContent === 'Revisar os backups'", 5000);
    assert.match(await app.avaliar("document.getElementById('caminho-nota').textContent"), /Orquestração \/ Demandas \/ Revisar os backups/);
  });

  await t.test('editar a nota (marcar etapa) atualiza o cartão', async () => {
    const arq = path.join(app.casa, 'orq', 'Demandas', 'Revisar os backups.md');
    fs.writeFileSync(arq, fs.readFileSync(arq, 'utf8').replace('- [ ] Testar restauração', '- [x] Testar restauração'));
    await app.esperar("/2\\/2/.test(document.querySelector('.topico-resumido').innerText)", 8000);
  });

  await t.test('concluída fica com " - Concluída" no nome e vai para a lista de concluídas', async () => {
    orq('concluir', id);
    assert.ok(fs.existsSync(path.join(app.casa, 'orq', 'Demandas', 'Revisar os backups - Concluída.md')));
    await app.esperar("document.querySelector('#lista-concluidos .topico-resumido') !== null", 8000);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
