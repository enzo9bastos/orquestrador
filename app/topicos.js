// Tópicos: cada demanda em andamento (título, código do ticket, agentes,
// estado e o checklist do que falta). Quem mantém é o orquestrador, pelo
// bin/orq-topico; a tela mostra e deixa marcar à mão. Os dois gravam o mesmo
// arquivo, sempre relendo antes, e cada gravação guarda a versão anterior.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Caminhos calculados na hora: os testes trocam o HOME depois de carregar.
const arq = () => path.join(os.homedir(), '.config', 'orq-app', 'topicos.json');
const versoes = () => path.join(os.homedir(), '.local', 'share', 'orq-app', 'versoes', 'topicos');

const ESTADOS = ['aberto', 'esperando', 'concluido'];
const MAX_TITULO = 200;
const MAX_TEXTO = 1000;

const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function limpar(t) {
  return {
    id: String(t.id),
    titulo: texto(t.titulo, MAX_TITULO) || 'Tópico sem título',
    codigo: texto(t.codigo, 60) || undefined,
    agentes: [...new Set((Array.isArray(t.agentes) ? t.agentes : []).map((a) => texto(a, 80)).filter(Boolean))],
    estado: ESTADOS.includes(t.estado) ? t.estado : 'aberto',
    itens: (Array.isArray(t.itens) ? t.itens : []).filter((i) => i && texto(i.texto, MAX_TEXTO))
      .map((i) => ({ id: String(i.id), texto: texto(i.texto, MAX_TEXTO), feito: i.feito === true })),
    notas: typeof t.notas === 'string' && t.notas.trim() ? t.notas.slice(0, 20000) : undefined,
    criado: Number(t.criado) || Date.now(),
    atualizado: Number(t.atualizado) || Date.now(),
    concluido: t.estado === 'concluido' ? (Number(t.concluido) || Date.now()) : undefined,
  };
}

// Arquivo estragado não é tratado como vazio: gravar por cima apagaria tudo.
function ler() {
  let cru;
  try { cru = fs.readFileSync(arq(), 'utf8'); } catch { return []; }
  let d;
  try { d = JSON.parse(cru); } catch { throw new Error(`${arq()} está estragado (JSON inválido); conserte ou restaure de ${versoes()}`); }
  return (Array.isArray(d.topicos) ? d.topicos : []).filter((t) => t && t.id != null).map(limpar);
}

function gravarArquivo(lista) {
  const a = arq();
  if (fs.existsSync(a)) {
    fs.mkdirSync(versoes(), { recursive: true });
    // Nome único mesmo com duas gravações no mesmo milissegundo.
    const base = new Date().toISOString().replace(/[:.]/g, '-');
    let destino = path.join(versoes(), `${base}.json`);
    for (let n = 2; fs.existsSync(destino); n++) destino = path.join(versoes(), `${base}-${n}.json`);
    fs.copyFileSync(a, destino);
  }
  fs.mkdirSync(path.dirname(a), { recursive: true });
  // tmp com o pid: o app e o orq-topico podem gravar ao mesmo tempo.
  const tmp = `${a}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ topicos: lista }, null, 2) + '\n');
  fs.renameSync(tmp, a);
}

// Lê, muda um tópico e grava. Devolve o tópico como ficou.
function mudar(id, fn) {
  const lista = ler();
  const chave = String(id ?? '').replace(/^#/, '');
  const t = lista.find((x) => x.id === chave);
  if (!t) throw new Error(`não existe tópico ${chave || '(sem id)'}`);
  fn(t);
  t.atualizado = Date.now();
  const i = lista.indexOf(t);
  lista[i] = limpar(t);
  gravarArquivo(lista);
  return lista[i];
}

// Ids curtos e em sequência ("1", "2"…): o orquestrador digita no terminal.
function abrir({ titulo, codigo, agente } = {}) {
  if (!texto(titulo, MAX_TITULO)) throw new Error('o tópico precisa de um título');
  const lista = ler();
  const id = String(lista.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0) + 1);
  const agora = Date.now();
  const t = limpar({ id, titulo, codigo, agentes: agente ? [agente] : [], estado: 'aberto', itens: [], criado: agora, atualizado: agora });
  lista.push(t);
  gravarArquivo(lista);
  return t;
}

function item(id, txt) {
  if (!texto(txt, MAX_TEXTO)) throw new Error('o item precisa de um texto');
  return mudar(id, (t) => {
    const n = t.itens.reduce((m, i) => Math.max(m, Number(String(i.id).replace(/^i/, '')) || 0), 0) + 1;
    t.itens.push({ id: `i${n}`, texto: txt, feito: false });
  });
}

// qual: o id do item ("i3") ou o número dele na lista, contando de 1.
function marcar(id, qual, feito = true) {
  return mudar(id, (t) => {
    const q = String(qual ?? '');
    const it = t.itens.find((i) => i.id === q) || (/^\d+$/.test(q) ? t.itens[Number(q) - 1] : null);
    if (!it) throw new Error(`o tópico ${t.id} não tem o item ${q}`);
    it.feito = feito !== false;
  });
}

function pendentes(t) { return t.itens.filter((i) => !i.feito); }

// Concluir com item em aberto só com "mesmoAssim": o combinado é concluir
// quando tudo estiver feito.
function concluir(id, { mesmoAssim = false } = {}) {
  return mudar(id, (t) => {
    const falta = pendentes(t);
    if (falta.length && !mesmoAssim) throw new Error(`o tópico ${t.id} ainda tem ${falta.length} item(ns) por fazer: ${falta.map((i) => i.texto).join('; ')}`);
    t.estado = 'concluido';
    t.concluido = Date.now();
  });
}

function estado(id, novo, opc = {}) {
  if (!ESTADOS.includes(novo)) throw new Error(`estado deve ser ${ESTADOS.join(', ')}`);
  if (novo === 'concluido') return concluir(id, opc);
  return mudar(id, (t) => { t.estado = novo; delete t.concluido; });
}

function agente(id, nome) {
  if (!texto(nome, 80)) throw new Error('falta o nome do agente');
  return mudar(id, (t) => { t.agentes.push(nome); });
}

// Nota acrescenta uma linha; nunca troca o que já estava escrito.
function nota(id, txt) {
  const linha = String(txt ?? '').trim();
  if (!linha) throw new Error('a nota precisa de um texto');
  return mudar(id, (t) => { t.notas = t.notas ? `${t.notas}\n${linha}` : linha; });
}

// Vigia a pasta (o arquivo é trocado por rename, então vigiar só o arquivo
// perderia a troca) e avisa com a lista nova, juntando rajadas de mudança.
function vigiar(aoMudar) {
  const pasta = path.dirname(arq());
  fs.mkdirSync(pasta, { recursive: true });
  let espera;
  const w = fs.watch(pasta, (_tipo, nome) => {
    if (nome && nome !== 'topicos.json') return;
    clearTimeout(espera);
    espera = setTimeout(() => {
      try { aoMudar({ topicos: ler() }); } catch (e) { aoMudar({ topicos: null, erro: e.message }); }
    }, 120);
  });
  return () => { clearTimeout(espera); w.close(); };
}

module.exports = { ESTADOS, arq, versoes, ler, abrir, item, marcar, pendentes, concluir, estado, agente, nota, vigiar };
