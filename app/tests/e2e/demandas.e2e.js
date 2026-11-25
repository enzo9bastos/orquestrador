// Área: demandas [sozinho] (painel resumido que abre a nota .md na aba Notas)
// [sozinho] desde 16/11: com outros apps de teste rodando ao mesmo tempo, o
// subteste "✓ no cartão" falhava: a demanda nova chegava ao disco certa na hora, o
// cartão aparecia, mas o progresso dele não chegava a "1/2" em 8 s (sozinho, em
// menos de 0,5 s). Não era o limite de inotify (medido: pico de 92 de 128) nem o
// claude de verdade (os testes já não o sobem).
// Causa achada em 25/11, quando passou a falhar sempre, também sozinho: o teste lia o
// texto pintado do cartão (innerText) com a aba Notas na frente. Fora da conversa as
// colunas recolhem, e a coluna recolhida fica invisível depois de uma transição de
// 0,16 s; texto invisível vem vazio. Só dava certo enquanto a janela de teste não
// avançava essa transição (ela nem sempre avança). O app sempre esteve certo: os dados
// chegavam ao cartão. Agora, com a coluna recolhida, o teste lê o conteúdo do cartão
// (textContent); e o que é para ver, ele vê com a coluna aberta, na aba da conversa.
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
    // Espera o estado final: o painel atualiza logo depois de cada orq-topico.
    await app.esperar("/1\\/2/.test(document.querySelector('.topico-resumido')?.innerText || '')", 8000);
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
    // A nota está na frente: a coluna das demandas está recolhida (invisível). Aqui vale o
    // conteúdo do cartão, não o texto pintado.
    assert.strictEqual((await app.avaliar('window.orqColunas.estado()')).demandas, false, 'com a nota na frente, a coluna das demandas está recolhida');
    await app.esperar("/2\\/2/.test(document.querySelector('.topico-resumido').textContent)", 8000);
  });

  // Pedido de 2026-11-12: concluir pelo próprio cartão, sem abrir a nota.
  await t.test('✓ no cartão conclui em dois cliques, avisa o que falta e não abre a nota', async () => {
    const idC = orq('abrir', 'Trocar o certificado').match(/\d+/)[0];
    orq('item', idC, 'Gerar'); orq('item', idC, 'Instalar'); orq('marcar', idC, '1');
    const sel = `[data-topico="${idC}"] [data-concluir-cartao]`;
    // O cartão é para ser visto: volta à conversa, onde a coluna das demandas fica aberta.
    await app.avaliar("document.querySelector('[data-aba=aba-orquestrador]').click()");
    assert.strictEqual((await app.avaliar('window.orqColunas.estado()')).demandas, true, 'na conversa, a coluna das demandas está aberta');
    await app.esperar(`!!document.querySelector('${sel}')`, 8000);
    await app.esperar(`/1\\/2/.test(document.querySelector('[data-topico="${idC}"]').innerText)`, 8000);
    await app.avaliar(`document.querySelector('${sel}').click()`);
    await app.esperar(`/Faltam 1\\. Concluir\\?/.test(document.querySelector('${sel}').textContent)`);
    assert.ok(!orq('listar', '--estado', 'concluido').includes('Trocar o certificado'), 'o primeiro clique não conclui');
    assert.ok(!(await app.avaliar("document.getElementById('aba-notas').classList.contains('ativa')")), 'não abre a nota');
    await app.avaliar(`document.querySelector('${sel}').click()`);
    await app.esperar(`!!document.querySelector('#lista-concluidos [data-topico="${idC}"]')`, 8000);
    assert.ok(fs.existsSync(path.join(app.casa, 'orq', 'Demandas', 'Trocar o certificado - Concluída.md')));
    assert.ok(!(await app.avaliar(`!!document.querySelector('#lista-concluidos [data-topico="${idC}"] [data-concluir-cartao]')`)), 'concluída não tem ✓');
  });

  await t.test('concluída fica com " - Concluída" no nome e vai para a lista de concluídas', async () => {
    orq('concluir', id);
    assert.ok(fs.existsSync(path.join(app.casa, 'orq', 'Demandas', 'Revisar os backups - Concluída.md')));
    await app.esperar("document.querySelector('#lista-concluidos .topico-resumido') !== null", 8000);
  });

  await t.test('apagar: a lixeirinha mostra no cartão o que some, em números; Cancelar não apaga; Apagar manda a nota para a lixeira', async () => {
    const idN = orq('abrir', 'Demanda errada').match(/\d+/)[0];
    const arq = path.join(app.casa, 'orq', 'Demandas', 'Demanda errada.md');
    assert.ok(fs.existsSync(arq));
    const bytes = fs.statSync(arq).size;
    const sel = `[data-topico="${idN}"] [data-apagar-topico]`;
    const custo = `[data-topico="${idN}"] [data-apagar-custo]`;
    await app.esperar(`!!document.querySelector('${sel}')`, 8000);
    await app.avaliar("document.querySelector('[data-aba=aba-orquestrador]').click()");
    await app.avaliar(`document.querySelector('${sel}').click()`);
    await app.esperar(`!!document.querySelector('${custo}')`, 8000);
    const txt = (await app.avaliar(`document.querySelector('${custo}').innerText`)).replace(/\s+/g, ' ');
    assert.match(txt, /Apagar esta demanda\?/);
    assert.ok(txt.includes(`Vai para a lixeira do sistema: «Demanda errada.md» (1 arquivo, ${bytes} bytes)`), txt);
    assert.match(txt, /Dá para restaurar pela lixeira/);
    assert.match(txt, /A lista de antes fica guardada/);
    assert.match(txt, /Sem apagar: concluir a demanda/);
    assert.ok(fs.existsSync(arq), 'mostrar o custo não apaga');
    assert.ok(!(await app.avaliar("document.getElementById('aba-notas').classList.contains('ativa')")), 'não abre a nota');
    assert.strictEqual(await app.avaliar('document.activeElement && document.activeElement.textContent'), 'Cancelar', 'o foco fica no Cancelar');
    // Clicar no texto do custo não abre a nota do cartão.
    await app.avaliar(`document.querySelector('${custo} li').click()`);
    assert.ok(!(await app.avaliar("document.getElementById('aba-notas').classList.contains('ativa')")), 'clicar no custo não abre a nota');
    // Cancelar: some o custo, fica tudo.
    await app.avaliar(`document.querySelector('${custo} [data-cancelar-apagar]').click()`);
    await app.esperar(`!document.querySelector('${custo}')`);
    assert.ok(fs.existsSync(arq), 'Cancelar não apaga');
    assert.ok(orq('listar', '--todos').includes('Demanda errada'));
    // De novo, agora até o fim.
    await app.avaliar(`document.querySelector('${sel}').click()`);
    await app.esperar(`!!document.querySelector('${custo}')`, 8000);
    await app.avaliar(`document.querySelector('${custo} [data-confirmar-apagar]').click()`);
    await app.esperar(`!document.querySelector('[data-topico="${idN}"]')`, 8000);
    assert.ok(!fs.existsSync(arq), 'a nota saiu da pasta (foi para a lixeira)');
    assert.ok(!orq('listar', '--todos').includes('Demanda errada'));
    const reg = fs.readFileSync(path.join(app.casa, '.local/share/orq-app/registro-apagar.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
    assert.deepStrictEqual([reg.operacao, reg.tipo, reg.resultado, reg.destino, reg.arquivos, reg.bytes], ['apagar', 'demanda', 'ok', 'lixeira', 1, bytes]);
  });

  // O Esc da conversa (que para o motor) nunca age com o foco no painel de demandas:
  // ali o Esc cancela a confirmação de apagar, mesmo com o motor trabalhando.
  await t.test('apagar: com o custo aberto e o motor trabalhando, o Esc cancela a confirmação e não para o motor', async () => {
    const idE = orq('abrir', 'Esc no custo').match(/\d+/)[0];
    const arq = path.join(app.casa, 'orq', 'Demandas', 'Esc no custo.md');
    const custo = `[data-topico="${idE}"] [data-apagar-custo]`;
    await app.esperar(`!!document.querySelector('[data-topico="${idE}"] [data-apagar-topico]')`, 8000);
    await app.avaliar("window.__orqTeste.desenharInfo({ pasta: '/casa', modelo: 'claude-opus-5-5', esforco: 'high', ocupado: true })");
    await app.avaliar(`document.querySelector('[data-topico="${idE}"] [data-apagar-topico]').click()`);
    await app.esperar(`!!document.querySelector('${custo}')`, 8000);
    assert.strictEqual(await app.avaliar('document.activeElement && document.activeElement.textContent'), 'Cancelar');
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!document.querySelector('${custo}')`, 8000);
    assert.ok(fs.existsSync(arq), 'nada foi apagado');
    assert.ok(!(await app.avaliar("[...document.querySelectorAll('#mensagens .aviso-conversa')].some((e) => /Interrompido por você/.test(e.innerText))")), 'o Esc do painel não é parada do motor');
    assert.ok(await app.avaliar("!document.getElementById('parar').hidden"), 'o motor continua trabalhando');
    await app.avaliar("window.__orqTeste.desenharInfo({ pasta: '/casa', modelo: 'claude-opus-5-5', esforco: 'high', ocupado: false })");
  });

  await t.test('apagar: sem o comprovante do custo, o processo principal recusa (a tela não apaga sozinha)', async () => {
    const idS = orq('abrir', 'Sem comprovante').match(/\d+/)[0];
    const arq = path.join(app.casa, 'orq', 'Demandas', 'Sem comprovante.md');
    await app.esperar(`!!document.querySelector('[data-topico="${idS}"]')`, 8000);
    for (const falso of ['undefined', "'x'", `'${'a'.repeat(48)}'`]) {
      const r = await app.avaliar(`window.orq.topicos.apagar(${JSON.stringify(idS)}, ${falso})`);
      assert.match(r.erro, /não há confirmação válida/);
    }
    // O comprovante de uma demanda não serve para outra.
    const idO = orq('abrir', 'Outra demanda').match(/\d+/)[0];
    const p = await app.avaliar(`window.orq.topicos.prepararApagar(${JSON.stringify(idO)})`);
    assert.match((await app.avaliar(`window.orq.topicos.apagar(${JSON.stringify(idS)}, ${JSON.stringify(p.comprovante)})`)).erro, /de outra demanda/);
    assert.ok(fs.existsSync(arq));
    assert.ok(orq('listar').includes('Sem comprovante') && orq('listar').includes('Outra demanda'));
  });

  await t.test('apagar pedido pelo orquestrador (orq-topico apagar): nada some; o cartão avisa e o usuário decide', async () => {
    const idP = orq('abrir', 'Pedida pelo orquestrador').match(/\d+/)[0];
    const arq = path.join(app.casa, 'orq', 'Demandas', 'Pedida pelo orquestrador.md');
    const saida = orq('apagar', idP);
    assert.match(saida, /Nada foi apagado/);
    assert.ok(fs.existsSync(arq), 'o comando não apaga');
    assert.match(orq('listar'), /pedido de apagar: esperando o usuário decidir/);
    const pedido = `[data-topico="${idP}"] [data-pedido-apagar]`;
    await app.esperar(`!!document.querySelector('${pedido}')`, 8000);
    assert.match(await app.avaliar(`document.querySelector('${pedido}').innerText`), /O orquestrador pediu para apagar esta demanda\. Nada foi apagado\./);
    // Manter: o aviso some e a demanda fica como estava.
    await app.avaliar(`document.querySelector('${pedido} [data-manter-topico]').click()`);
    await app.esperar(`!document.querySelector('${pedido}')`, 8000);
    assert.ok(fs.existsSync(arq));
    assert.doesNotMatch(orq('listar'), /pedido de apagar/);
    // Pedido de novo; agora o usuário apaga, vendo o custo.
    orq('apagar', idP);
    await app.esperar(`!!document.querySelector('${pedido}')`, 8000);
    await app.avaliar(`document.querySelector('${pedido} [data-apagar-topico]').click()`);
    const custo = `[data-topico="${idP}"] [data-apagar-custo]`;
    await app.esperar(`!!document.querySelector('${custo}')`, 8000);
    assert.ok(!(await app.avaliar(`!!document.querySelector('${pedido}')`)), 'com o custo aberto, o aviso dá lugar a ele');
    assert.ok(fs.existsSync(arq), 'ver o custo não apaga');
    await app.avaliar(`document.querySelector('${custo} [data-confirmar-apagar]').click()`);
    await app.esperar(`!document.querySelector('[data-topico="${idP}"]')`, 8000);
    assert.ok(!fs.existsSync(arq));
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
