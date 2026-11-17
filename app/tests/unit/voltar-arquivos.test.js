// Área: conversa (voltar os arquivos junto com a conversa; plano 7.1)
// O módulo confere o que o Claude responde ao rewind_files, descobre que arquivo foi
// alterado depois da última edição do Claude e guarda a cópia de como os arquivos estão
// agora, sem nunca escrever por cima de outra cópia.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const va = require('../../voltar-arquivos');

test('voltar arquivos: a resposta do Claude é conferida; lista que não dá para conferir não vale', () => {
  assert.deepStrictEqual(va.conferirResposta({ canRewind: true, filesChanged: ['a.js', 'docs/b.md', 'a.js'], insertions: 17, deletions: 42 }),
    { pode: true, lista: ['a.js', 'docs/b.md'], mais: 17, menos: 42, erro: null });
  assert.deepStrictEqual(va.conferirResposta({ canRewind: true }), { pode: true, lista: [], mais: 0, menos: 0, erro: null });
  assert.deepStrictEqual(va.conferirResposta({ canRewind: false, error: 'No file checkpoint found for this message.\u001b[0m' }), { pode: false, lista: [], mais: 0, menos: 0, erro: 'No file checkpoint found for this message.' });
  for (const torta of [null, 'sim', {}, { canRewind: 'true', filesChanged: ['a'] }, { canRewind: 1 }]) assert.strictEqual(va.conferirResposta(torta).pode, false, JSON.stringify(torta));
  // Qualquer item estranho na lista invalida a lista inteira (senão a cópia ficaria incompleta).
  for (const lista of ['a.js', [5], [''], ['a\nb'], [null], Array.from({ length: va.MAX_ARQUIVOS + 1 }, (_, i) => `f${i}`)]) {
    const r = va.conferirResposta({ canRewind: true, filesChanged: lista });
    assert.deepStrictEqual([r.pode, r.lista], [false, []], JSON.stringify(lista).slice(0, 40));
    assert.match(r.erro, /não sabe conferir/);
  }
  assert.deepStrictEqual(va.conferirResposta({ canRewind: true, filesChanged: ['a'], insertions: -3, deletions: '9' }), { pode: true, lista: ['a'], mais: 0, menos: 0, erro: null });
});

test('voltar arquivos: a cópia guarda os arquivos como estão agora, numa pasta nova, sem escrever por cima', () => {
  const pasta = pastaTemporaria('orq-volta-');
  const fora = pastaTemporaria('orq-volta-fora-');
  fs.mkdirSync(path.join(pasta, 'src'), { recursive: true });
  fs.writeFileSync(path.join(pasta, 'src', 'botao.css'), 'azul\n');
  fs.writeFileSync(path.join(pasta, 'LEIAME.md'), 'como está agora\n');
  fs.writeFileSync(path.join(fora, 'outro.txt'), 'de fora\n');
  fs.symlinkSync(path.join(pasta, 'LEIAME.md'), path.join(pasta, 'atalho.md'));
  const raiz = path.join(pastaTemporaria('orq-volta-copias-'), 'rewind-1');
  const lista = ['src/botao.css', path.join(pasta, 'LEIAME.md'), path.join(fora, 'outro.txt'), 'nao-existe.txt', 'atalho.md', 'src'];
  assert.strictEqual(va.tamanho(lista, pasta), 5 + 17 + 8); // "á" ocupa 2 bytes
  const r = va.copiar(lista, pasta, raiz);
  assert.deepStrictEqual(r, { ok: true, pasta: raiz, bytes: 30, copiados: 3 });
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'src', 'botao.css'), 'utf8'), 'azul\n');
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'LEIAME.md'), 'utf8'), 'como está agora\n');
  assert.strictEqual(fs.readFileSync(path.join(raiz, '_fora_da_pasta', fora.replace(/^\/+/, ''), 'outro.txt'), 'utf8'), 'de fora\n');
  assert.ok(!fs.existsSync(path.join(raiz, 'atalho.md')), 'link não é copiado');
  // Os originais não mudam.
  assert.strictEqual(fs.readFileSync(path.join(pasta, 'src', 'botao.css'), 'utf8'), 'azul\n');
  // A mesma pasta de novo: recusa, e a cópia que estava lá continua igual.
  fs.writeFileSync(path.join(pasta, 'src', 'botao.css'), 'verde\n');
  const de_novo = va.copiar(lista, pasta, raiz);
  assert.strictEqual(de_novo.ok, false);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'src', 'botao.css'), 'utf8'), 'azul\n');
  assert.match(path.basename(va.destinoNovo(new Date(2026, 10, 17, 7, 12, 5))), /^rewind-2026-11-17-071205$/);
});

test('voltar arquivos: "mexido por fora" compara a hora do arquivo com a última escrita do Claude', () => {
  const pasta = pastaTemporaria('orq-volta-');
  const arq = path.join(pastaTemporaria('orq-volta-tr-'), 'S.jsonl');
  const l = (o) => JSON.stringify(o);
  const T = Date.parse('2026-11-17T10:00:00.000Z');
  const iso = (ms) => new Date(ms).toISOString();
  fs.writeFileSync(arq, [
    l({ type: 'assistant', uuid: 'a0', timestamp: iso(T - 60000), message: { role: 'assistant', content: [{ type: 'tool_use', id: 't0', name: 'Edit', input: { file_path: path.join(pasta, 'antigo.txt') } }] } }),
    l({ type: 'user', uuid: 'u2', timestamp: iso(T), message: { role: 'user', content: 'troca o botão para azul' } }),
    l({ type: 'assistant', uuid: 'a1', timestamp: iso(T + 1000), message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: path.join(pasta, 'botao.css') } }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }] } }),
    // O resultado chega 5 minutos depois (a pessoa demorou para permitir): a escrita é dessa hora.
    l({ type: 'user', uuid: 'r1', timestamp: iso(T + 300000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    l({ type: 'assistant', uuid: 'a2', timestamp: iso(T + 310000), message: { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: 'LEIAME.md' } }] } }),
    l({ type: 'user', uuid: 'r3', timestamp: iso(T + 311000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }] } }),
    'linha quebrada {',
  ].join('\n') + '\n');
  const escritas = va.ultimasEscritas(arq, 'u2', pasta);
  assert.deepStrictEqual([...escritas.entries()].sort(), [[path.join(pasta, 'LEIAME.md'), T + 311000], [path.join(pasta, 'botao.css'), T + 300000]].sort());
  assert.ok(!escritas.has(path.join(pasta, 'antigo.txt')), 'o que veio antes da mensagem escolhida não conta');
  const por = (nome, ms) => { fs.writeFileSync(path.join(pasta, nome), 'x'); fs.utimesSync(path.join(pasta, nome), ms / 1000, ms / 1000); };
  por('botao.css', T + 300500); // a hora da escrita do Claude
  por('LEIAME.md', T + 900000); // alterado dez minutos depois
  por('sem-registro.txt', T + 900000);
  assert.strictEqual(va.mexido('botao.css', escritas, pasta), false);
  assert.strictEqual(va.mexido('LEIAME.md', escritas, pasta), true);
  assert.strictEqual(va.mexido('sem-registro.txt', escritas, pasta), false, 'sem saber a hora da escrita, não afirma');
  assert.strictEqual(va.mexido('sumiu.txt', escritas, pasta), false);
  assert.deepStrictEqual([...va.ultimasEscritas(null, 'u2', pasta)], []);
});
