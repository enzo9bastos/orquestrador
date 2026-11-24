// No lugar do voz/ditado.py nos testes (ORQ_DITADO_MOTOR = ["node", este arquivo]). Fala o mesmo
// protocolo: quadros na entrada (1 byte de tipo + 4 de tamanho + corpo), uma linha de JSON por
// evento na saída. Não ouve nada: a cada DITADO_FALSO_PASSO bytes de som que chegam, "entende"
// mais uma palavra da fala da vez (DITADO_FALSO_FALAS, uma lista em JSON) e manda a prévia; na
// última palavra, fecha o trecho e passa para a fala seguinte. Depois da última fala, fica quieto.
//
// DITADO_FALSO_ERRO: falha ao carregar. DITADO_FALSO_CARGA_MS: demora para ficar pronto (o que
// chega antes espera, como no motor de verdade). DITADO_FALSO_MUDO: nunca entende nada.
// DITADO_FALSO_SURDO: não responde ao "parar". DITADO_FALSO_LOG: guarda o que recebeu.
// DITADO_FALSO_CONTROLE: um arquivo JSON lido a cada ditado que começa, para o teste trocar o
// comportamento sem reabrir o app: { falas, mudo, erro, revisoes, fimDoParar } (erro: o ditado falha
// ao começar; fimDoParar: um texto que entra no fim do trecho fechado pelo "parar", para o teste
// distinguir esse fecho da prévia que já estava na tela).
// DITADO_FALSO_REVISOR: faz de conta que há um modelo maior corrigindo por trás. Cada trecho fechado
// ganha, DITADO_FALSO_REVISAO_MS depois (150 se não disser), a correção dele: o texto que estiver em
// "revisoes" para aquele fecho ({ "texto do fecho": "texto corrigido" }; com { junto: true, texto },
// a correção vale também pelo trecho anterior); sem nada lá, o aviso de que o trecho fica como está.
// DITADO_FALSO_SEM_PREVIA: faz de conta que o modelo é grande e roda no processador: não há prévia;
// quando a fala acaba sai o aviso "escrevendo" e, DITADO_FALSO_FRASE_MS depois (200 se não disser),
// a frase inteira. Com "juntas" no arquivo de controle ({ "texto da frase": "texto das duas" }), a
// frase sai junto com a anterior (uma "revisao" que vale pelas duas), como a frase curta de verdade.
const fs = require('fs');

const dizer = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const log = (o) => { if (process.env.DITADO_FALSO_LOG) fs.appendFileSync(process.env.DITADO_FALSO_LOG, `${JSON.stringify(o)}\n`); };
log({ pid: process.pid, args: process.argv.slice(2) });
if (process.env.DITADO_FALSO_ERRO) { dizer({ t: 'erro', erro: process.env.DITADO_FALSO_ERRO }); process.exit(4); }

let FALAS = JSON.parse(process.env.DITADO_FALSO_FALAS || '["Bom dia, quero o relatório das vendas.", "Mande para o time até sexta."]');
const FALAS_DE_SEMPRE = FALAS;
const PASSO = Number(process.env.DITADO_FALSO_PASSO) || 3200;
let mudo = !!process.env.DITADO_FALSO_MUDO;
let d = null; // o ditado de agora: { id, epoca, fala, palavras, bytes, som, n }
const REVISOR = !!process.env.DITADO_FALSO_REVISOR;
const REVISAO_MS = Number(process.env.DITADO_FALSO_REVISAO_MS) || 150;
const SEM_PREVIA = !!process.env.DITADO_FALSO_SEM_PREVIA;
const FRASE_MS = Number(process.env.DITADO_FALSO_FRASE_MS) || 200;
let revisoes = {};
let juntas = {};
let fimDoParar = '';
let esperando = []; // o que está a caminho (correções, frases sem prévia): { relogio, sair() }
function corrigir(x) {
  const r = revisoes[x.texto];
  const base = { t: 'revisao', id: x.id, epoca: x.epoca, de: r && r.junto ? Math.max(0, x.n - 1) : x.n, ate: x.n };
  dizer(r ? { ...base, texto: typeof r === 'string' ? r : r.texto } : { ...base, igual: true });
}
// Daqui a "ms", faz "sair"; o "parar" adianta tudo o que está a caminho, o "largar" e o "cortar" jogam fora.
function daqui(ms, sair) {
  const x = { sair };
  x.relogio = setTimeout(() => { esperando = esperando.filter((y) => y !== x); sair(); }, ms);
  esperando.push(x);
}
function soltar(dizendo) {
  const fila = esperando;
  esperando = [];
  for (const x of fila) { clearTimeout(x.relogio); if (dizendo) x.sair(); }
}
const controle = () => { try { return JSON.parse(fs.readFileSync(process.env.DITADO_FALSO_CONTROLE, 'utf8')); } catch { return {}; } };

function fechar(parando) {
  if (!d || !d.palavras) return;
  const p = FALAS[d.fala].split(' ');
  const texto = (d.palavras >= p.length ? FALAS[d.fala] : p.slice(0, d.palavras).join(' ')) + (parando ? fimDoParar : '');
  const n = d.n;
  d.n += 1;
  const x = { id: d.id, epoca: d.epoca, n, texto };
  if (SEM_PREVIA) {
    // Sem prévia: avisa que está escrevendo e a frase sai depois, inteira (ou junto com a anterior).
    dizer({ t: 'escrevendo', id: x.id, epoca: x.epoca, sim: true });
    daqui(FRASE_MS, () => {
      const junto = juntas[texto];
      dizer(junto && n > 0 ? { t: 'revisao', id: x.id, epoca: x.epoca, de: n - 1, ate: n, texto: junto } : { t: 'final', id: x.id, epoca: x.epoca, n, texto });
      dizer({ t: 'escrevendo', id: x.id, epoca: x.epoca, sim: false });
    });
  } else {
    dizer({ t: 'final', id: d.id, epoca: d.epoca, n, texto });
    if (REVISOR) daqui(REVISAO_MS, () => corrigir(x));
  }
  d.fala += 1;
  d.palavras = 0;
}
function palavra() {
  if (mudo || d.fala >= FALAS.length) return;
  const p = FALAS[d.fala].split(' ');
  d.palavras += 1;
  if (d.palavras >= p.length) { fechar(); return; }
  if (!SEM_PREVIA) dizer({ t: 'parcial', id: d.id, epoca: d.epoca, texto: p.slice(0, d.palavras).join(' ').replace(/[.…]+$/, '') });
}
function tratar(tipo, corpo) {
  if (tipo === 'A') {
    if (!d) return;
    d.som += corpo.length;
    d.bytes += corpo.length;
    while (d && d.bytes >= PASSO) { d.bytes -= PASSO; palavra(); }
    return;
  }
  let c;
  try { c = JSON.parse(corpo.toString('utf8')); } catch { return; }
  log({ cmd: c, som: d ? d.som : 0 });
  if (c.t === 'comecar') {
    const k = controle();
    FALAS = Array.isArray(k.falas) ? k.falas : FALAS_DE_SEMPRE;
    mudo = k.mudo === undefined ? !!process.env.DITADO_FALSO_MUDO : !!k.mudo;
    if (k.erro) { dizer({ t: 'erro', erro: k.erro }); return; }
    revisoes = k.revisoes && typeof k.revisoes === 'object' ? k.revisoes : {};
    juntas = k.juntas && typeof k.juntas === 'object' ? k.juntas : {};
    fimDoParar = typeof k.fimDoParar === 'string' ? k.fimDoParar : '';
    soltar(false);
    d = { id: c.id, epoca: 0, fala: 0, palavras: 0, bytes: 0, som: 0, n: 0 };
  }
  else if (c.t === 'cortar' && d) { soltar(false); d.epoca = c.epoca; if (d.palavras) { d.fala += 1; d.palavras = 0; } d.bytes = 0; }
  // Parar: o que falta corrigir sai antes do "parou", como no motor de verdade.
  else if (c.t === 'parar' && d) { if (process.env.DITADO_FALSO_SURDO) return; fechar(true); soltar(true); dizer({ t: 'parou', id: d.id }); d = null; }
  else if (c.t === 'largar' && d) { soltar(false); dizer({ t: 'parou', id: d.id }); d = null; }
  else if (c.t === 'sair') process.exit(0);
}

let pronto = false;
let resto = Buffer.alloc(0);
function andar() {
  while (pronto && resto.length >= 5) {
    const tamanho = resto.readUInt32LE(1);
    if (resto.length < 5 + tamanho) return;
    const tipo = String.fromCharCode(resto[0]);
    const corpo = resto.subarray(5, 5 + tamanho);
    resto = resto.subarray(5 + tamanho);
    tratar(tipo, corpo);
  }
}
process.stdin.on('data', (b) => { resto = Buffer.concat([resto, b]); andar(); });
process.stdin.on('end', () => process.exit(0));
setTimeout(() => {
  pronto = true;
  dizer({ t: 'pronto', modelo: 'falso', previa: !SEM_PREVIA, revisor: REVISOR ? 'falso-grande' : null, aparelho: 'teste', ms: Number(process.env.DITADO_FALSO_CARGA_MS) || 0 });
  andar();
}, Number(process.env.DITADO_FALSO_CARGA_MS) || 0);
