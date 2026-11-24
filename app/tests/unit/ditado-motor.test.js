// Área: voz (ditado: o recorte do motor, voz/ditado.py)
// Pedido de 24/11. O motor de verdade usa o faster-whisper; aqui ele roda com --ensaio, que troca
// o modelo por um faz de conta: "fala" é onde o som passa de um limiar, e o "texto" é uma letra
// pela altura do som (b = 2500, c = 3500…) seguida do tamanho da fala em décimos de segundo, com
// "!" quando o trecho foi fechado. O que se testa é o recorte de verdade: quando sai a prévia,
// quando o trecho fecha, o corte da fala comprida, parar, largar e cortar.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { quadro } = require('../../ditado');

const VOZ = path.join(__dirname, '..', '..', 'voz');
const SCRIPT = path.join(VOZ, 'ditado.py');
const semPython = spawnSync('python3', ['--version']).status !== 0 && 'sem python3 neste computador';
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const som = (seg, altura) => { const b = Buffer.alloc(Math.round(seg * 16000) * 2); for (let i = 0; i < b.length; i += 2) b.writeInt16LE(altura, i); return b; };
const ALTURA = { b: 2500, c: 3500, d: 4500, e: 5500 };

function motor(t, extras = [], env = {}) {
  const p = spawn('python3', ['-B', SCRIPT, '--ensaio', '--passo', '0.1', '--pausa', '0.3', '--margem', '0.1', '--aberto', '2', '--duro', '4', ...extras], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
  t.after(() => p.kill());
  const eventos = [];
  let resto = '';
  p.stdout.on('data', (d) => { resto += d; const l = resto.split('\n'); resto = l.pop(); for (const x of l) { try { eventos.push(JSON.parse(x)); } catch { /* outra saída */ } } });
  const saiu = new Promise((r) => p.on('close', r));
  const cmd = (o) => p.stdin.write(quadro('C', Buffer.from(JSON.stringify(o))));
  // O som chega em pedaços de 0,1 s, com uma pausa curta entre eles, como viria do microfone.
  const tocar = async (...partes) => {
    for (const b of partes) for (let i = 0; i < b.length; i += 3200) { p.stdin.write(quadro('A', b.subarray(i, i + 3200))); await dorme(12); }
  };
  const espera = async (fn, ms = 8000) => { for (let i = 0; i < ms / 10; i++) { const r = eventos.find(fn); if (r) return r; await dorme(10); } throw new Error(`não chegou: ${fn}\n${JSON.stringify(eventos)}`); };
  const textos = (tipo) => eventos.filter((e) => e.t === tipo).map((e) => e.texto);
  return { p, eventos, cmd, tocar, espera, textos, saiu };
}

test('motor do ditado: fala seguida de pausa → prévias que crescem e o trecho fechado; silêncio não vira texto', { skip: semPython }, async (t) => {
  const m = motor(t);
  const pronto = await m.espera((e) => e.t === 'pronto');
  assert.deepStrictEqual([pronto.modelo, pronto.aparelho], ['small', 'ensaio']);
  m.cmd({ t: 'comecar', id: 7, contexto: '' });
  await m.tocar(som(1, 0));
  await dorme(150);
  assert.deepStrictEqual(m.eventos.filter((e) => e.t !== 'pronto'), [], 'só silêncio: nada sai');
  await m.tocar(som(1, ALTURA.b), som(0.6, 0));
  const final = await m.espera((e) => e.t === 'final');
  assert.match(final.texto, /^b(9|10|11)!$/);
  assert.deepStrictEqual([final.id, final.epoca], [7, 0]);
  const previas = m.textos('parcial');
  assert.ok(previas.length >= 2, `prévias: ${previas}`);
  assert.ok(previas.every((x) => /^b\d+$/.test(x)), `prévia é a fala até ali, sem o "!": ${previas}`);
  const tamanhos = previas.map((x) => Number(x.slice(1)));
  assert.deepStrictEqual(tamanhos, [...tamanhos].sort((a, b) => a - b), 'a prévia só cresce');
  assert.ok(m.eventos.indexOf(final) > m.eventos.findIndex((e) => e.t === 'parcial'), 'a prévia vem antes do fecho');
  m.cmd({ t: 'parar' });
  await m.espera((e) => e.t === 'parou' && e.id === 7);
  assert.strictEqual(m.textos('final').length, 1, 'nada aberto: o parar não inventa trecho');
});

test('motor do ditado: parar fecha o trecho aberto; largar termina sem fechar', { skip: semPython }, async (t) => {
  const m = motor(t);
  m.cmd({ t: 'comecar', id: 1, contexto: '' });
  await m.tocar(som(0.2, 0), som(0.6, ALTURA.c));
  m.cmd({ t: 'parar' });
  await m.espera((e) => e.t === 'parou' && e.id === 1);
  assert.strictEqual(m.textos('final').length, 1);
  assert.match(m.textos('final')[0], /^c[567]!$/);
  assert.strictEqual(m.eventos[m.eventos.length - 1].t, 'parou', 'o "parou" é o último');
  // Outro ditado no mesmo motor, largado no meio.
  m.cmd({ t: 'comecar', id: 2, contexto: '' });
  await m.tocar(som(0.6, ALTURA.d));
  m.cmd({ t: 'largar' });
  await m.espera((e) => e.t === 'parou' && e.id === 2);
  assert.ok(m.eventos.filter((e) => e.id === 2 && e.t === 'final').length === 0, 'largado: nenhum trecho fechado');
  // Som que chega sem ditado nenhum é jogado fora.
  await m.tocar(som(0.5, ALTURA.b), som(0.5, 0));
  await dorme(200);
  assert.strictEqual(m.eventos[m.eventos.length - 1].t, 'parou');
});

test('motor do ditado: fala comprida sem pausa é fechada aos poucos, no começo da última frase', { skip: semPython }, async (t) => {
  const m = motor(t);
  m.cmd({ t: 'comecar', id: 1, contexto: '' });
  // Quatro "frases" coladas (a altura muda), 3,2 s sem nenhuma pausa; o limite aberto é 2 s.
  await m.tocar(som(0.8, ALTURA.b), som(0.8, ALTURA.c), som(0.8, ALTURA.d), som(0.8, ALTURA.e));
  const primeiro = await m.espera((e) => e.t === 'final');
  assert.match(primeiro.texto, /^b\d+! c\d+!( d\d+!)?$/, 'fecha as primeiras frases e deixa a última aberta');
  await m.tocar(som(0.6, 0));
  await m.espera((e) => e.t === 'final' && /e\d+!$/.test(e.texto));
  assert.match(m.textos('final').join(' '), /^b[789]! c[789]! d[789]! e[789]!$/, 'nada se perde nem se repete no corte');
  assert.ok(m.textos('final').length >= 2);
});

test('motor do ditado: uma frase só, sem pausa nem divisão, é fechada no limite duro', { skip: semPython }, async (t) => {
  const m = motor(t);
  m.cmd({ t: 'comecar', id: 1, contexto: '' });
  await m.tocar(som(4.6, ALTURA.b));
  const primeiro = await m.espera((e) => e.t === 'final');
  assert.match(primeiro.texto, /^b(3\d|4\d)!$/);
  m.cmd({ t: 'parar' });
  await m.espera((e) => e.t === 'parou');
  const total = m.textos('final').reduce((s, x) => s + Number(x.slice(1, -1)), 0);
  assert.ok(total >= 44 && total <= 47, `os 4,6 s de fala saíram inteiros: ${m.textos('final')}`);
});

test('motor do ditado: cortar larga o trecho aberto e os eventos seguintes levam a época nova', { skip: semPython }, async (t) => {
  const m = motor(t);
  m.cmd({ t: 'comecar', id: 1, contexto: '' });
  await m.tocar(som(0.6, ALTURA.b));
  await m.espera((e) => e.t === 'parcial' && /^b/.test(e.texto));
  m.cmd({ t: 'cortar', epoca: 3, contexto: 'já escrito' });
  await m.tocar(som(0.2, 0), som(0.5, ALTURA.c), som(0.6, 0));
  const final = await m.espera((e) => e.t === 'final');
  assert.match(final.texto, /^c[456]!$/);
  assert.strictEqual(final.epoca, 3);
  assert.ok(m.textos('final').every((x) => !/b/.test(x)), 'o trecho cortado nunca é fechado');
  assert.ok(m.eventos.filter((e) => e.epoca === 0).every((e) => m.eventos.indexOf(e) < m.eventos.findIndex((x) => x.epoca === 3)), 'depois do corte, nada mais sai na época antiga');
});

test('motor do ditado: sair encerra; a entrada fechada também', { skip: semPython }, async (t) => {
  const a = motor(t);
  await a.espera((e) => e.t === 'pronto');
  a.cmd({ t: 'sair' });
  assert.strictEqual(await a.saiu, 0);
  const b = motor(t);
  await b.espera((e) => e.t === 'pronto');
  b.p.stdin.end();
  assert.strictEqual(await b.saiu, 0);
});

// Correção por trás (--revisor): um modelo maior refaz o que o pequeno já fechou. No ensaio, a
// "correção" devolve as mesmas palavras em maiúscula. Um trecho comprido é corrigido sozinho; um
// curto vai junto com o som do bloco anterior; curto e sem nada antes, fica como está.
const COM_REVISOR = ['--aberto', '4', '--duro', '8', '--revisor', 'grande'];
test('motor do ditado: a correção por trás troca o texto dos trechos fechados; o curto vai junto com o anterior', { skip: semPython }, async (t) => {
  const m = motor(t, COM_REVISOR);
  const pronto = await m.espera((e) => e.t === 'pronto');
  assert.strictEqual(pronto.revisor, 'grande');
  m.cmd({ t: 'comecar', id: 4, contexto: '' });
  // 1) curto e sem nada antes: fica como está.
  await m.tocar(som(0.2, 0), som(0.6, ALTURA.b), som(0.6, 0));
  const r0 = await m.espera((e) => e.t === 'revisao');
  assert.deepStrictEqual(r0, { t: 'revisao', id: 4, epoca: 0, de: 0, ate: 0, igual: true });
  assert.deepStrictEqual(m.eventos.filter((e) => e.t === 'final').map((e) => [e.n, /^b[567]!$/.test(e.texto)]), [[0, true]]);
  // 2) comprido: corrigido sozinho.
  await m.tocar(som(2.5, ALTURA.c), som(0.6, 0));
  const r1 = await m.espera((e) => e.t === 'revisao' && e.ate === 1);
  assert.deepStrictEqual([r1.de, r1.ate, r1.epoca], [1, 1, 0]);
  assert.match(r1.texto, /^C(24|25|26)$/);
  // 3) curto depois de um comprido: os dois são corrigidos juntos (o texto novo vale pelos dois).
  await m.tocar(som(0.6, ALTURA.d), som(0.6, 0));
  const r2 = await m.espera((e) => e.t === 'revisao' && e.ate === 2);
  assert.strictEqual(r2.de, 1);
  assert.match(r2.texto, /^C(24|25|26) D[567]$/);
  // A correção de um trecho vem depois do fecho dele.
  for (const r of m.eventos.filter((e) => e.t === 'revisao')) assert.ok(m.eventos.indexOf(r) > m.eventos.findIndex((e) => e.t === 'final' && e.n === r.ate));
  // 4) parar: o que falta corrigir sai antes do "parou".
  await m.tocar(som(2.2, ALTURA.e));
  m.cmd({ t: 'parar' });
  await m.espera((e) => e.t === 'parou');
  const fim = m.eventos.slice(-3).map((e) => e.t);
  assert.deepStrictEqual(fim, ['final', 'revisao', 'parou']);
  assert.match(m.eventos[m.eventos.length - 2].texto, /^E(21|22|23)$/);
});

test('motor do ditado: cortar e largar jogam fora a correção que estava esperando; sem --revisor não há correção', { skip: semPython }, async (t) => {
  const m = motor(t, COM_REVISOR, { ORQ_DITADO_ENSAIO_REV_MS: '400' });
  m.cmd({ t: 'comecar', id: 1, contexto: '' });
  await m.tocar(som(2.2, ALTURA.b), som(0.5, 0));
  await m.espera((e) => e.t === 'final' && e.n === 0);
  m.cmd({ t: 'cortar', epoca: 1, contexto: '' }); // a pessoa mexeu no texto: a correção do que já estava lá não vale mais
  await m.tocar(som(2.2, ALTURA.c), som(0.5, 0));
  const r = await m.espera((e) => e.t === 'revisao');
  assert.deepStrictEqual([r.epoca, r.de, r.ate], [1, 1, 1], 'só o trecho de depois do corte é corrigido');
  assert.match(r.texto, /^C(21|22|23)$/);
  assert.strictEqual(m.eventos.filter((e) => e.t === 'revisao' && e.epoca === 0).length, 0);
  // Largar no meio de uma correção: termina na hora, e a correção atrasada não sai.
  await m.tocar(som(2.2, ALTURA.d), som(0.5, 0));
  await m.espera((e) => e.t === 'final' && e.n === 2);
  m.cmd({ t: 'largar' });
  await m.espera((e) => e.t === 'parou');
  await dorme(700);
  assert.strictEqual(m.eventos.filter((e) => e.t === 'revisao').length, 1);
  assert.strictEqual(m.eventos[m.eventos.length - 1].t, 'parou');
  // Sem o modelo de correção: os fechos têm o número do trecho e não há correção nenhuma.
  const s = motor(t, ['--aberto', '4', '--duro', '8']);
  const pronto = await s.espera((e) => e.t === 'pronto');
  assert.strictEqual(pronto.revisor, null);
  s.cmd({ t: 'comecar', id: 1, contexto: '' });
  await s.tocar(som(2.2, ALTURA.b), som(0.5, 0), som(1.5, ALTURA.c));
  s.cmd({ t: 'parar' });
  await s.espera((e) => e.t === 'parou');
  assert.deepStrictEqual(s.eventos.filter((e) => e.t === 'final').map((e) => e.n), [0, 1]);
  assert.strictEqual(s.eventos.filter((e) => e.t === 'revisao').length, 0);
});

// Defeito de 24/11, visto no uso de verdade: a prévia acertava "teste" e, ao fechar a frase, o texto
// trocava por uma palavra errada, que dali em diante se repetia. O fecho entregava ao modelo o texto
// anterior como contexto, e o modelo copiava o contexto para dentro das falas curtas. Aqui o modelo
// é um boneco que só anota o que recebeu: nada do texto anterior pode chegar a ele.
test('motor do ditado: ao fechar um trecho, o texto que veio antes não é entregue ao modelo', { skip: semPython }, () => {
  const codigo = `
import json, sys, threading
sys.path.insert(0, ${JSON.stringify(VOZ)})
import ditado as d
recebido = []
class Boneco:
    def transcribe(self, a, **k):
        recebido.append({"contexto": k.get("initial_prompt"), "anterior": k.get("condition_on_previous_text"), "feixe": k.get("beam_size")})
        return [], None
m = d.MotorWhisper.__new__(d.MotorWhisper)
m.m, m.idioma, m.curta, m.aqui = Boneco(), "pt", False, threading.local()
m.feixe, m.folga = {False: 1, True: 5}, {False: 1.5, True: 3.0}
m._float = lambda pcm: [0.0] * (len(pcm) // 2)
som = bytes(32000)
m.transcrever(som, True, "E aí a gente aplica direto, pode ser? Taishe.")
m.transcrever(som, False, "E aí a gente aplica direto, pode ser? Taishe.")
print(json.dumps(recebido))`;
  const r = spawnSync('python3', ['-B', '-c', codigo], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), [{ contexto: null, anterior: false, feixe: 5 }, { contexto: null, anterior: false, feixe: 1 }]);
});

test('motor do ditado: a limpeza do texto (frase inventada em cima de ruído, reticências, frase e palavra em laço)', { skip: semPython }, () => {
  const codigo = `
import json, sys
sys.path.insert(0, ${JSON.stringify(VOZ)})
import ditado as d
print(json.dumps({
  "fantasma": [d.limpar("Obrigado por assistir."), d.limpar(" Legendas pela comunidade Amara.org "), d.limpar("Obrigado por assistir ao relatório.")],
  "reticencias": d.limpar("vai ver como... ... ... ..."),
  "laco": d.limpar("Quando chegar a hora, feche o cartão. Quando chegar a hora, feche o cartão. Quando chegar a hora, feche o cartão. Depois envie."),
  "curta": d.limpar("Sim. Sim. Não."),
  "palavra": d.limpar("Contração Contração Contração Contração Contração Contra"),
  "pergunta": d.limpar("tudo dentro do sistema. O que é isso? O que é isso? O que é isso? O que é isso? O que é"),
  "agora": d.limpar("na junta. Agora... Agora... Agora... Agora... Agora"),
  "duas": d.limpar("muito muito bom, de vez em quando, de vez em quando ele volta"),
  "voltou": d.limpar("Está funcionando, falou que chegou um ticket novo. Um ticket novo. Está funcionando, falou que chegou um ticket novo."),
  "dobrou": d.limpar("É calculado sozinho. O último dia útil de cada trimestre, o último dia útil de cada trimestre,"),
  "outra": d.limpar("Quero um ticket novo. Um ticket novo para a equipe. Sim. Sim."),
  "aparar": [d.aparar("você vai ver como funciona."), d.aparar("você vai..."), d.aparar("pode ser?"), d.aparar("")],
}, ensure_ascii=False))`;
  const r = spawnSync('python3', ['-B', '-c', codigo], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), {
    fantasma: ['', '', 'Obrigado por assistir ao relatório.'],
    reticencias: 'vai ver como...',
    laco: 'Quando chegar a hora, feche o cartão. Depois envie.',
    curta: 'Sim. Sim. Não.',
    palavra: 'Contração Contra',
    pergunta: 'tudo dentro do sistema. O que é isso?',
    agora: 'na junta. Agora...',
    duas: 'muito muito bom, de vez em quando, de vez em quando ele volta',
    voltou: 'Está funcionando, falou que chegou um ticket novo.',
    dobrou: 'É calculado sozinho. O último dia útil de cada trimestre,',
    outra: 'Quero um ticket novo. Um ticket novo para a equipe. Sim. Sim.',
    aparar: ['você vai ver como funciona', 'você vai', 'pode ser?', ''],
  });
});
