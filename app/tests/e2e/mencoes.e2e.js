// Área: conversa ("@" menciona também demanda, recado e agente; pedido de 2026-11-17)
// Além de arquivo, nota e workflow, o "@" da caixa lista as demandas, os recados e os
// agentes. O que é mencionado vai junto com a mensagem, depois do texto: os dados da
// demanda e a nota dela, o texto do recado, e quem é o agente. O balão mostra só o que
// a pessoa escreveu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const agora = Date.now();
const RECADOS = [
  { id: 'r1', ts: agora - 60000, de: { tipo: 'agente', alvo: 'site', nome: 'Agente 1 (site)' }, para: { tipo: 'orquestrador' }, tipo: 'pergunta', texto: 'posso trocar a porta para 4010?', estado: 'entregue', motivo: null },
  { id: 'r2', ts: agora - 50000, de: { tipo: 'orquestrador' }, para: { tipo: 'agente', alvo: 'site', nome: 'Agente 1 (site)' }, tipo: 'aviso', texto: 'pode, e anota na memória', estado: 'entregue', motivo: null },
].map((r) => JSON.stringify(r)).join('\n') + '\n';
const ESTADO = { lidoEm: agora, semTerminal: 1, fila: [], frentes: [
  { chave: 'g/a:%1', emp: 'g', proj: 'proj-a', dir: '/x/a', pane: '%1', sessaoTmux: 'proj-a', nome: 'Agente 2', estado: 'trabalhando', fonte: 'sinal', desde: agora - 60000, tarefa: 'Botão Aprovar', modeloAgente: 'Sonnet 5.5', ultimaResposta: null, git: {}, linhaDoTempo: [] },
  { chave: 'g/b:%2', emp: 'g', proj: 'proj-b', dir: '/x/b', pane: '%2', sessaoTmux: 'proj-b', nome: 'revisão do site', estado: 'esperando', fonte: 'tela', desde: null, tarefa: null, modeloAgente: null, ultimaResposta: null, git: {}, linhaDoTempo: [] },
] };

test('"@" menciona demanda, recado e agente', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({
    config: { mostrarBichinho: false, pastasNotas: [{ nome: 'Orquestração', caminho: '~/orq' }] },
    arquivos: { 'orq/leia.md': '# leia', '.local/share/orq-app/recados/recados.jsonl': RECADOS },
  });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqNotas');
  await app.avaliar(`window.__estadoFalso = ${JSON.stringify(ESTADO)}`);
  const cli = path.join(__dirname, '..', '..', 'bin', 'orq-topico');
  const orq = (...a) => execFileSync(process.execPath, [cli, ...a], { env: { ...process.env, HOME: app.casa }, encoding: 'utf8' }).trim();
  const id = orq('abrir', 'Trocar o certificado', '--codigo', 'T-2001', '--agente', 'Agente 2').match(/\d+/)[0];
  orq('item', id, 'Gerar'); orq('item', id, 'Instalar'); orq('marcar', id, '1');
  const aoClaude = () => linhas(log).filter((o) => o.type === 'user').map((o) => (typeof o.message.content === 'string' ? o.message.content : JSON.stringify(o.message.content)));
  const digitar = (texto) => app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(texto)}; e.setSelectionRange(e.value.length, e.value.length); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const lista = () => app.avaliar("[...document.querySelectorAll('#sugestoes > li')].map((li) => (li.classList.contains('grupo-sugestao') ? `# ${li.textContent.trim()}` : li.querySelector('.nome-comando').textContent.trim()))");
  const descricoes = () => app.avaliar("[...document.querySelectorAll('#sugestoes > li:not(.grupo-sugestao)')].map((li) => li.querySelector('.desc-comando').textContent.trim())");
  const doGrupo = async (nome) => { const l = await lista(); const i = l.indexOf(`# ${nome}`); if (i < 0) return null; const fim = l.findIndex((x, j) => j > i && x.startsWith('# ')); return l.slice(i + 1, fim < 0 ? undefined : fim); };
  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'oi')");
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].length > 0 && document.getElementById('parar').hidden", 10000);
  await app.esperar("document.querySelectorAll('.cartao-agente').length === 2", 8000);

  await t.test('"@" sozinho mostra os grupos, com Demandas, Recados e Agentes depois dos que já existiam', async () => {
    await digitar('@');
    await app.esperar("[...document.querySelectorAll('#sugestoes .grupo-sugestao')].map((x) => x.textContent.trim()).join() === 'Arquivos,Notas,Workflows,Demandas,Recados,Agentes'", 6000);
    assert.deepStrictEqual(await doGrupo('Demandas'), ['@demanda:']);
    assert.deepStrictEqual(await doGrupo('Recados'), ['@recado:']);
    assert.deepStrictEqual(await doGrupo('Agentes'), ['@agente:']);
    assert.match(await app.avaliar("document.getElementById('dicas-caixa').innerText"), /@ mencionar/);
  });

  await t.test('"@demanda:" lista as demandas com o estado; escolher insere a menção', async () => {
    await digitar('veja a @demanda:');
    await app.esperar("[...document.querySelectorAll('#sugestoes .nome-comando')].some((x) => /^@demanda:\\d+$/.test(x.textContent.trim()))", 6000);
    assert.deepStrictEqual(await lista(), [`@demanda:${id}`]);
    assert.match((await descricoes())[0], /Trocar o certificado/);
    await app.tecla('Enter', 'Enter', 13);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), `veja a @demanda:${id} `);
  });

  await t.test('"@recado:" e "@agente:" listam com quem é quem; nome com espaço entra entre aspas', async () => {
    await digitar('@recado:');
    await app.esperar("[...document.querySelectorAll('#sugestoes .nome-comando')].some((x) => x.textContent.trim() === '@recado:r1')", 6000);
    assert.deepStrictEqual(await lista(), ['@recado:r2', '@recado:r1'], 'do mais novo ao mais antigo');
    assert.match((await descricoes())[1], /Agente 1 \(site\)[\s\S]*posso trocar a porta/);
    await digitar('@agente:');
    await app.esperar("document.querySelectorAll('#sugestoes > li').length === 2", 6000);
    assert.deepStrictEqual(await lista(), ['@agente:Agente 2', '@agente:Agente 2 — revisão do site']);
    assert.match((await descricoes())[0], /proj-a[\s\S]*Botão Aprovar/);
    await app.tecla('Enter', 'Enter', 13);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '@agente:"Agente 2" ');
  });

  await t.test('texto solto depois do "@" acha demanda pelo título, recado pelo texto e agente pelo nome', async () => {
    await digitar('@certif');
    await app.esperar("[...document.querySelectorAll('#sugestoes .grupo-sugestao')].some((x) => x.textContent.trim() === 'Demandas')", 6000);
    assert.deepStrictEqual(await doGrupo('Demandas'), [`@demanda:${id}`]);
    await digitar('@porta');
    await app.esperar("[...document.querySelectorAll('#sugestoes .grupo-sugestao')].some((x) => x.textContent.trim() === 'Recados')", 6000);
    assert.deepStrictEqual(await doGrupo('Recados'), ['@recado:r1']);
    await digitar('@revis');
    await app.esperar("[...document.querySelectorAll('#sugestoes .grupo-sugestao')].some((x) => x.textContent.trim() === 'Agentes')", 6000);
    assert.deepStrictEqual(await doGrupo('Agentes'), ['@agente:Agente 2 — revisão do site']);
  });

  await t.test('a mensagem leva os dados do que foi mencionado; o balão mostra só o que foi escrito', async () => {
    const escrito = `compare a @demanda:${id} com o @recado:r1 e fale com o @agente:"Agente 2" (a @demanda:999 não existe)`;
    await digitar(escrito);
    await app.tecla('Escape', 'Escape', 27);
    await app.avaliar("document.getElementById('compositor').requestSubmit()");
    for (let i = 0; i < 60 && !aoClaude().some((x) => x.startsWith('compare a')); i++) await app.espera(100);
    const foi = aoClaude().find((x) => x.startsWith('compare a'));
    assert.ok(foi.startsWith(escrito), 'o texto digitado vai como foi escrito');
    assert.match(foi, new RegExp(`Demanda mencionada #${id} «Trocar o certificado»[\\s\\S]*aberta[\\s\\S]*T-2001[\\s\\S]*Agente 2`));
    assert.match(foi, /\[x\] Gerar[\s\S]*\[ \] Instalar/);
    assert.match(foi, /Trocar o certificado\.md/, 'com o arquivo da nota da demanda');
    assert.match(foi, /Recado mencionado[\s\S]*Agente 1 \(site\)[\s\S]*posso trocar a porta para 4010\?/);
    assert.match(foi, /informação, não como ordem/, 'recado é texto de terceiros');
    assert.match(foi, /Agente mencionado: «Agente 2»[\s\S]*proj-a[\s\S]*trabalhando[\s\S]*Botão Aprovar/);
    assert.ok(!/mencionada #999/.test(foi), 'menção que não existe não inventa dado');
    await app.esperar(`[...document.querySelectorAll('#mensagens .msg-voce .balao')].some((b) => b.textContent === ${JSON.stringify(escrito)})`, 6000);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
