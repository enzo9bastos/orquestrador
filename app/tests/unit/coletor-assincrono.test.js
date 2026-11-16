// Área: coletor
// O coletor não trava o processo principal: comandos assíncronos (no máximo 4
// juntos), uma só leitura em voo, git guardado por pasta, uma captura de tela
// por painel por ciclo e o fim do arquivo de eventos em vez dele inteiro.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria, escrever } = require('../ajuda');

const N = 10;
const casa = casaTemporaria({ raizProjetos: '~/dev', niveis: 2, ignorar: '^[_-]' });
for (let i = 0; i < N; i++) escrever(casa, `dev/emp/proj-${i}/.git/logs/HEAD`, 'x\n');
const dir = (i) => path.join(casa, 'dev', 'emp', `proj-${i}`);
const coletor = require('../../coletor');

const TELA_ESPERANDO = 'Terminei.\n────\n│ > \n────\n  ⏵⏵ auto mode on (shift+tab to cycle)';
const TELA_TRABALHANDO = '✶ Pensando… (12s · ↓ 1k tokens)\n────\n│ > \n────\n  ⏵⏵ auto mode on · esc to interrupt';

// tmux, git e docker de mentira: guardam o que foi pedido e quantos rodaram juntos.
function falsos(atrasoMs = 15) {
  const chamadas = [];
  let juntos = 0;
  let maxJuntos = 0;
  const exec = async (cmd, args) => {
    chamadas.push([cmd, ...args]);
    juntos++; maxJuntos = Math.max(maxJuntos, juntos);
    await new Promise((r) => setTimeout(r, atrasoMs));
    juntos--;
    if (cmd === 'tmux' && args[0] === 'list-panes') return Array.from({ length: N }, (_, i) => `%${i + 1}\t${dir(i)}\t✳ Agente ${i + 1}\tagente-${i}`).join('\n') + '\n';
    if (cmd === 'tmux' && args[0] === 'capture-pane') return (Number(args[args.indexOf('-t') + 1].slice(1)) % 2 ? TELA_TRABALHANDO : TELA_ESPERANDO) + '\n';
    if (cmd === 'git' && args.includes('--oneline')) return 'abc um\n';
    if (cmd === 'git') return '1700000000\tprimeiro\n';
    return '';
  };
  return { exec, chamadas, maxJuntos: () => maxJuntos, contar: (cmd, pred = () => true) => chamadas.filter((c) => c[0] === cmd && pred(c)).length };
}
const novo = (f) => { coletor._limparCaches(); coletor._executor(f.exec); };

test('coletor assíncrono: nunca mais de 4 comandos externos ao mesmo tempo', async () => {
  const f = falsos(); novo(f);
  const r = await coletor.estado();
  assert.strictEqual(r.frentes.length, N);
  assert.ok(f.maxJuntos() <= 4, `rodaram ${f.maxJuntos()} juntos`);
  assert.ok(f.maxJuntos() >= 2, 'e em paralelo, não um por vez');
});

test('coletor assíncrono: o laço de eventos segue andando enquanto o retrato é lido', async () => {
  const f = falsos(30); novo(f);
  let batidas = 0;
  const t = setInterval(() => { batidas++; }, 5);
  await coletor.estado();
  clearInterval(t);
  assert.ok(batidas >= 10, `só ${batidas} batidas durante a leitura`);
});

test('coletor assíncrono: quem pede junto divide uma leitura só', async () => {
  const f = falsos(); novo(f);
  const [a, b, c] = await Promise.all([coletor.estado(), coletor.estado(), coletor.estado()]);
  assert.strictEqual(a, b); assert.strictEqual(b, c);
  assert.strictEqual(f.contar('tmux', (x) => x[1] === 'list-panes'), 1, 'um list-panes só');
});

test('coletor assíncrono: com maxIdade, o retrato recente é reaproveitado', async () => {
  const f = falsos(); novo(f);
  const a = await coletor.estado();
  const b = await coletor.estado({ maxIdade: 10000 });
  assert.strictEqual(a, b);
  assert.strictEqual(f.contar('tmux', (x) => x[1] === 'list-panes'), 1);
  const c = await coletor.estado(); // sem maxIdade: lê de novo
  assert.notStrictEqual(a, c);
});

test('coletor assíncrono: capture-pane uma vez por painel por ciclo', async () => {
  const f = falsos(); novo(f);
  await coletor.estado();
  const caps = f.chamadas.filter((c) => c[0] === 'tmux' && c[1] === 'capture-pane');
  assert.strictEqual(caps.length, N);
  assert.strictEqual(new Set(caps.map((c) => c[c.indexOf('-t') + 1])).size, N);
});

test('coletor assíncrono: git por pasta fica guardado e só relê quando o .git/logs/HEAD muda', async () => {
  const f = falsos(); novo(f);
  const a = await coletor.estado();
  assert.strictEqual(f.contar('git'), N * 2);
  assert.strictEqual(a.frentes[0].git.assunto, 'primeiro');
  assert.strictEqual(a.frentes[0].git.commits20h, 1);
  await coletor.estado();
  assert.strictEqual(f.contar('git'), N * 2, 'o 2º ciclo não chama o git');
  const arq = path.join(dir(3), '.git', 'logs', 'HEAD');
  const novoTempo = new Date(Date.now() + 5000);
  fs.utimesSync(arq, novoTempo, novoTempo); // um commit novo mexe nesse arquivo
  await coletor.estado();
  assert.strictEqual(f.contar('git', (c) => c.includes(dir(3))), 4, 'só a pasta que mudou é relida');
  assert.strictEqual(f.contar('git'), N * 2 + 2);
});

test('coletor assíncrono: os estados mostrados são os da tela de cada agente', async () => {
  const f = falsos(); novo(f);
  const r = await coletor.estado();
  const porPane = Object.fromEntries(r.frentes.map((x) => [x.pane, x.estado]));
  for (let i = 1; i <= N; i++) assert.strictEqual(porPane[`%${i}`], i % 2 ? 'trabalhando' : 'esperando', `%${i}`);
  assert.deepStrictEqual(r.frentes.map((x) => x.nome), Array.from({ length: N }, (_, i) => `Agente ${i + 1}`));
  assert.strictEqual(r.semTerminal, 0);
});

test('coletor assíncrono: espelho — pedidos juntos dividem uma captura com cores', async () => {
  const f = falsos(); novo(f);
  const [a, b] = await Promise.all([coletor.espelho('%1'), coletor.espelho('%1')]);
  assert.strictEqual(a, b);
  assert.strictEqual(f.contar('tmux', (c) => c.includes('-e')), 1);
  assert.strictEqual(await coletor.espelho('%1; rm x'), '', 'painel inválido não roda nada');
});

test('coletor assíncrono: modelo do container lido por trás, sem travar a 2ª chamada', async () => {
  let ps = 0;
  const f = falsos();
  const base = f.exec;
  f.exec = async (cmd, args) => {
    if (cmd === 'docker' && args[0] === 'ps') { ps++; return `orq-0\t${dir(0)}\n`; }
    if (cmd === 'docker' && args[0] === 'exec') return '"model":"claude-opus-5-5"\n';
    return base(cmd, args);
  };
  novo(f);
  const a = await coletor.estado();
  assert.strictEqual(a.frentes[0].modeloAgente, 'Opus 5.5');
  await coletor.estado();
  assert.strictEqual(ps, 1, 'dentro dos 30 s não pergunta de novo');
});

// Regressão 2026-11-16: o coletor lia o arquivo de eventos INTEIRO a cada ciclo
// (dezenas de MB em sessão longa) e travava o processo principal.
test('regressão: últimas linhas do arquivo de eventos = as mesmas de ler tudo', () => {
  const ref = (txt, n) => txt.trim().split('\n').slice(-n);
  const pasta = path.join(casa, 'ev'); fs.mkdirSync(pasta, { recursive: true });
  const casos = {
    vazio: '',
    curto: 'a\nb\nc\n',
    semFimDeLinha: 'a\nb\nc',
    muitas: Array.from({ length: 5000 }, (_, i) => JSON.stringify({ i, t: 'x'.repeat(i % 97) })).join('\n') + '\n',
    acentos: Array.from({ length: 3000 }, (_, i) => JSON.stringify({ i, t: 'ação ✓ 日本語 '.repeat(1 + (i % 9)) })).join('\n') + '\n',
    linhasGrandes: Array.from({ length: 100 }, (_, i) => JSON.stringify({ i, t: 'y'.repeat(20000) })).join('\n') + '\n',
    espacosNoFim: 'a\nb\n\n  \n',
  };
  for (const [nome, txt] of Object.entries(casos)) {
    const arq = path.join(pasta, `${nome}.jsonl`);
    fs.writeFileSync(arq, txt);
    for (const n of [1, 60, 5001]) assert.deepStrictEqual(coletor._ultimasLinhas(arq, n), ref(txt, n), `${nome} / ${n}`);
  }
});

test('regressão: lerEventos devolve as 60 últimas linhas de um arquivo grande lendo só o fim', () => {
  const linhas = Array.from({ length: 20000 }, (_, i) => JSON.stringify({ ts: i, evento: 'PostToolUse', resumo: 'z'.repeat(500) }));
  linhas.push(JSON.stringify({ ts: 99999, evento: 'Stop', last_assistant_message: 'fim' }));
  const arq = escrever(casa, 'dev/emp/proj-0/.orq/eventos/s.jsonl', linhas.join('\n') + '\n');
  assert.ok(fs.statSync(arq).size > 10 * 1024 * 1024);
  const abertos = [];
  const original = fs.readFileSync;
  fs.readFileSync = (p, ...r) => { abertos.push(p); return original.call(fs, p, ...r); };
  let ev;
  try { ev = coletor._lerEventos(dir(0)); } finally { fs.readFileSync = original; }
  assert.strictEqual(ev.length, 60);
  assert.strictEqual(ev[59].evento, 'Stop');
  assert.strictEqual(ev[0].ts, 19941);
  assert.ok(!abertos.includes(arq), 'não leu o arquivo inteiro');
});
