// Área: leitura (transcript de 120 MB abre rápido, recados sem releitura, transcript achado pelo id)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({});
const cfg = path.join(casa, 'cfg-claude');
process.env.CLAUDE_CONFIG_DIR = cfg; // nunca o ~/.claude de verdade
const conversa = require('../../conversa');
const recados = require('../../recados');
const j = (o) => JSON.stringify(o);

// Conta os bytes que o código lê de arquivos que casam com `re` (qualquer jeito de ler).
function espiar(re) {
  const fds = new Map();
  const o = { open: fs.openSync, read: fs.readSync, file: fs.readFileSync };
  const r = { bytes: 0, inteiras: 0 };
  fs.openSync = (p, ...a) => { const fd = o.open(p, ...a); fds.set(fd, String(p)); return fd; };
  fs.readSync = (fd, ...a) => { const n = o.read(fd, ...a); if (re.test(fds.get(fd) || '')) r.bytes += n; return n; };
  fs.readFileSync = (p, ...a) => { const t = o.file(p, ...a); if (typeof p === 'string' && re.test(p)) { r.bytes += Buffer.byteLength(t); r.inteiras++; } return t; };
  r.parar = () => { fs.openSync = o.open; fs.readSync = o.read; fs.readFileSync = o.file; };
  return r;
}

// Transcript sintético de ~mb MB (gerado aqui, em pasta temporária; nunca vai para o git).
function gerar(arq, mb) {
  const fd = fs.openSync(arq, 'w');
  const alvo = mb * 1024 * 1024;
  let tam = 0; let i = 0; let lote = [];
  const gravar = () => { const b = Buffer.from(lote.join('')); fs.writeSync(fd, b); tam += b.length; lote = []; };
  while (tam + lote.length * 1500 < alvo) {
    lote.push(i % 2 === 0
      ? j({ type: 'user', uuid: `u${i}`, timestamp: '2026-11-16T10:00:00.000Z', message: { role: 'user', content: `pergunta ${i}` } }) + '\n'
      : j({ type: 'assistant', uuid: `a${i}`, timestamp: '2026-11-16T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: (i % 400 === 399 ? 'x'.repeat(300000) : 'palavra '.repeat(180)) + ` #${i}` }] } }) + '\n');
    i++;
    if (lote.length >= 2000) gravar();
  }
  gravar();
  fs.closeSync(fd);
  return { linhas: i, bytes: tam };
}
const pastaDe = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

test('transcript de 120 MB: abre o histórico em até 50 ms, lendo só o fim', async (t) => {
  const proj = path.join(cfg, 'projects', pastaDe(casa));
  fs.mkdirSync(proj, { recursive: true });
  const arq = path.join(proj, 'S120.jsonl');
  const g = gerar(arq, 120);
  t.after(() => { try { fs.truncateSync(arq, 0); } catch { /* sobra pequena */ } }); // não deixa 120 MB em /tmp
  assert.ok(g.bytes > 119 * 1024 * 1024);
  const sp = espiar(/S120\.jsonl$/);
  let r; let ms;
  try { const t0 = process.hrtime.bigint(); r = conversa._historico('S120'); ms = Number(process.hrtime.bigint() - t0) / 1e6; } finally { sp.parar(); }
  assert.strictEqual(r.length, 600, 'as últimas 600 mensagens, como antes');
  const ult = g.linhas - 1;
  assert.strictEqual(r.at(-1).tipo, ult % 2 ? 'assistant' : 'user', 'a última da lista é a última do arquivo');
  assert.ok(JSON.stringify(r.at(-1).message).includes(ult % 2 ? `#${ult}` : `pergunta ${ult}`));
  assert.ok(JSON.stringify(r[0].message).includes(`${(g.linhas - 600) % 2 ? '#' : 'pergunta '}${g.linhas - 600}`), 'e a primeira é a 600ª do fim');
  assert.ok(sp.bytes < 16 * 1024 * 1024, `leu ${sp.bytes} bytes de ${g.bytes}`);
  assert.ok(ms <= 50, `abrir levou ${ms.toFixed(1)} ms (limite 50)`);

  // ✎ voltar na última mensagem do usuário: acha o corte sem ler o arquivo inteiro.
  const ultimoUser = g.linhas - 1 - ((g.linhas - 1) % 2); // índice par = usuário
  const sp2 = espiar(/S120\.jsonl$/);
  let p; let ms2;
  try { const t0 = process.hrtime.bigint(); p = conversa._pontoDeVoltaArquivo('S120', 0, `pergunta ${ultimoUser}`); ms2 = Number(process.hrtime.bigint() - t0) / 1e6; } finally { sp2.parar(); }
  assert.deepStrictEqual(p, { ate: `a${ultimoUser - 1}`, texto: `pergunta ${ultimoUser}` });
  assert.ok(sp2.bytes < 16 * 1024 * 1024, `voltar leu ${sp2.bytes} bytes`);
  assert.ok(ms2 <= 50, `voltar levou ${ms2.toFixed(1)} ms (limite 50)`);
});

test('histórico de conversa voltada (ate): para na linha pedida, como o transcript inteiro fazia', () => {
  const proj = path.join(cfg, 'projects', pastaDe(casa));
  fs.mkdirSync(proj, { recursive: true });
  const ls = [];
  for (let i = 0; i < 10; i++) ls.push(j({ type: i % 2 ? 'assistant' : 'user', uuid: `x${i}`, message: { role: 'user', content: `m${i}` } }));
  fs.writeFileSync(path.join(proj, 'S-ate.jsonl'), ls.join('\n') + '\n');
  assert.deepStrictEqual(conversa._historico('S-ate', 'x5').map((e) => e.message.content), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  assert.strictEqual(conversa._historico('S-ate', 'nao-existe').length, 10, 'uuid que não existe: o arquivo todo, como antes');
  assert.strictEqual(conversa._historico('S-ate').length, 10);
});

test('recados: N ciclos de leitura não relêem o registro inteiro, só o que entrou', () => {
  const log = path.join(casa, '.local', 'share', 'orq-app', 'recados', 'recados.jsonl');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  let s = '';
  for (let i = 0; i < 1500; i++) {
    s += j({ id: `r${i}`, de: { tipo: 'agente', nome: 'A' }, para: { tipo: 'orquestrador' }, tipo: 'aviso', texto: 'x'.repeat(120), ts: 1000 + i, estado: 'novo' }) + '\n';
    if (i % 3 === 0) s += j({ id: `r${i}`, mudanca: { estado: 'entregue' } }) + '\n';
  }
  fs.writeFileSync(log, s);
  assert.ok(fs.statSync(log).size > 250 * 1024);
  const sp = espiar(/recados\.jsonl$/);
  try {
    const primeira = recados.ler(2000);
    assert.strictEqual(primeira.length, 1500);
    assert.strictEqual(primeira.find((r) => r.id === 'r3').estado, 'entregue', 'o estado mais recente de cada um');
    const depoisDaPrimeira = sp.bytes;
    // 20 ciclos de 3 s, 5 leituras cada.
    for (let c = 0; c < 20; c++) for (let k = 0; k < 5; k++) recados.ler(1000);
    assert.ok(sp.bytes - depoisDaPrimeira < 20 * 5 * 128, `ciclos releram ${sp.bytes - depoisDaPrimeira} bytes (esperado ~0)`);
    assert.strictEqual(sp.inteiras, 0, 'nenhuma leitura do arquivo inteiro de uma vez');
    // Entrou um recado e uma mudança: só isso é lido.
    const marca = sp.bytes;
    const novo = j({ id: 'novo', de: { tipo: 'agente', nome: 'A' }, para: { tipo: 'orquestrador' }, tipo: 'aviso', texto: 'oi', ts: 99999999, estado: 'novo' }) + '\n' + j({ id: 'r0', mudanca: { estado: 'lido' } }) + '\n';
    fs.appendFileSync(log, novo);
    const lista = recados.ler(2000);
    assert.ok(sp.bytes - marca < 64 + Buffer.byteLength(novo) + 1, `leu ${sp.bytes - marca} bytes para ${Buffer.byteLength(novo)} novos`);
    assert.strictEqual(lista.at(-1).id, 'novo');
    assert.strictEqual(lista.find((r) => r.id === 'r0').estado, 'lido', 'a mudança nova vale sobre um recado já indexado');
  } finally { sp.parar(); }
  // Quem muda o que recebeu não estraga o índice.
  recados.ler(5)[0].estado = 'estragado';
  assert.notStrictEqual(recados.ler(5)[0].estado, 'estragado');
});

test('recados: registro trocado ou menor que o já lido recomeça do zero', () => {
  const log = path.join(casa, '.local', 'share', 'orq-app', 'recados', 'recados.jsonl');
  const um = (id, ts) => j({ id, de: { tipo: 'agente', nome: 'A' }, para: { tipo: 'orquestrador' }, tipo: 'aviso', texto: id, ts, estado: 'novo' }) + '\n';
  fs.writeFileSync(log, um('b1', 1));
  assert.deepStrictEqual(recados.ler().map((r) => r.id), ['b1']);
  fs.writeFileSync(log, um('c1', 1) + um('c2', 2) + um('c3', 3));
  assert.deepStrictEqual(recados.ler().map((r) => r.id), ['c1', 'c2', 'c3']);
  fs.writeFileSync(log, um('d1', 1));
  assert.deepStrictEqual(recados.ler().map((r) => r.id), ['d1'], 'registro menor: nada do anterior sobra');
});

test('transcript em pasta de nome longo: achado pelo id, com CLAUDE_CONFIG_DIR', () => {
  // O CLI corta o nome da pasta acima de 200 caracteres e acrescenta um hash.
  const longa = pastaDe(path.join(casa, 'p'.repeat(250)));
  const cortada = longa.slice(0, 200) + '-' + 'a1b2c3';
  const proj = path.join(cfg, 'projects', cortada);
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'S-longa.jsonl'), j({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'oi da pasta longa' } }) + '\n');
  assert.strictEqual(conversa._historico('S-longa')[0].message.content, 'oi da pasta longa');
  assert.strictEqual(conversa._arqTranscript('S-longa'), path.join(proj, 'S-longa.jsonl'));
  // Sessão que não existe: vazio, sem erro. Id esquisito nunca vira caminho.
  assert.deepStrictEqual(conversa._historico('S-nao-existe'), []);
  assert.strictEqual(conversa._arqTranscript('../../etc/passwd'), null);
});

test('CLAUDE_CONFIG_DIR vale; sem ele, ~/.claude da casa', () => {
  const sem = path.join(casa, '.claude', 'projects', pastaDe(casa));
  fs.mkdirSync(sem, { recursive: true });
  fs.writeFileSync(path.join(sem, 'S-padrao.jsonl'), j({ type: 'user', uuid: 'u', message: { role: 'user', content: 'do padrão' } }) + '\n');
  assert.deepStrictEqual(conversa._historico('S-padrao'), [], 'com CLAUDE_CONFIG_DIR apontando para outra pasta, ela é a que vale');
  const guardado = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  try { assert.strictEqual(conversa._historico('S-padrao')[0].message.content, 'do padrão'); } finally { process.env.CLAUDE_CONFIG_DIR = guardado; }
});

// O ✎ voltar não pode cortar no lugar errado: a leitura de trás para frente dá o
// mesmo ponto que a de cima para baixo (a antiga, sobre as linhas todas), em
// transcripts embaralhados, com linhas maiores que a página e mensagens de bastidor.
test('voltar: ler o arquivo de trás para frente dá o mesmo ponto que ler as linhas todas', () => {
  const proj = path.join(cfg, 'projects', pastaDe(casa));
  fs.mkdirSync(proj, { recursive: true });
  let semente = 7;
  const sorteio = (n) => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente % n; };
  for (let rodada = 0; rodada < 40; rodada++) {
    const ls = [];
    const textos = [];
    for (let i = 0; i < 5 + sorteio(40); i++) {
      const k = sorteio(7);
      if (k <= 1) { const t = `fala ${rodada}-${i}`; textos.push(t); ls.push(j({ type: 'user', uuid: `u${i}`, message: { role: 'user', content: t } })); }
      else if (k <= 3) ls.push(j({ type: 'assistant', uuid: `a${i}`, message: { role: 'assistant', content: [{ type: 'text', text: sorteio(5) ? 'ok' : 'y'.repeat(300 * 1024) }] } }));
      else if (k === 4) ls.push(j({ type: 'assistant', uuid: `s${i}`, isSidechain: true, message: { role: 'assistant', content: 'sub' } }));
      else if (k === 5) ls.push(j({ type: 'user', uuid: `m${i}`, message: { role: 'user', content: '<system-reminder>bastidor</system-reminder>' } }));
      else ls.push('{"type":"user","uuid":"quebrada');
    }
    const sessao = `S-prop-${rodada}`;
    fs.writeFileSync(path.join(proj, `${sessao}.jsonl`), ls.join('\n') + (rodada % 2 ? '\n' : ''));
    for (let ordem = 0; ordem < 4; ordem++) {
      for (const texto of [textos.at(-1 - ordem), textos[0], 'texto que não existe', '']) {
        const esperado = (() => { try { return conversa._pontoDeVolta(ls, ordem, texto || ''); } catch (e) { return e.message; } })();
        const obtido = (() => { try { return conversa._pontoDeVoltaArquivo(sessao, ordem, texto || ''); } catch (e) { return e.message; } })();
        assert.deepStrictEqual(obtido, esperado, `rodada ${rodada}, ordem ${ordem}, texto ${texto}`);
      }
    }
  }
});
