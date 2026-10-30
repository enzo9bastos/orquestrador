// Tópicos: cada demanda em andamento (título, código do ticket, agentes,
// estado e o checklist do que falta). Quem mantém é o orquestrador, pelo
// bin/orq-topico; a tela mostra e deixa marcar à mão. Os dois gravam o mesmo
// arquivo, sempre relendo antes, e cada gravação guarda a versão anterior.
//
// Demanda nova chega como "sugerido": o orquestrador sugere (título, resumo e
// as etapas previstas) e o usuário aprova (vira "aberto") ou recusa (vira
// "recusado"; fica guardado, nunca some, e dá para reconsiderar).
const fs = require('fs');
const os = require('os');
const path = require('path');

// Caminhos calculados na hora: os testes trocam o HOME depois de carregar.
const arq = () => path.join(os.homedir(), '.config', 'orq-app', 'topicos.json');
const versoes = () => path.join(os.homedir(), '.local', 'share', 'orq-app', 'versoes', 'topicos');

const ESTADOS = ['sugerido', 'aberto', 'esperando', 'concluido', 'recusado'];
const MAX_TITULO = 200;
const MAX_TEXTO = 1000;
const MAX_RESUMO = 2000;

const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function limpar(t) {
  return {
    id: String(t.id),
    titulo: texto(t.titulo, MAX_TITULO) || 'Tópico sem título',
    codigo: texto(t.codigo, 60) || undefined,
    agentes: [...new Set((Array.isArray(t.agentes) ? t.agentes : []).map((a) => texto(a, 80)).filter(Boolean))],
    estado: ESTADOS.includes(t.estado) ? t.estado : 'aberto',
    resumo: texto(t.resumo, MAX_RESUMO) || undefined,
    itens: (Array.isArray(t.itens) ? t.itens : []).filter((i) => i && texto(i.texto, MAX_TEXTO))
      .map((i) => ({ id: String(i.id), texto: texto(i.texto, MAX_TEXTO), feito: i.feito === true })),
    notas: typeof t.notas === 'string' && t.notas.trim() ? t.notas.slice(0, 20000) : undefined,
    criado: Number(t.criado) || Date.now(),
    atualizado: Number(t.atualizado) || Date.now(),
    concluido: t.estado === 'concluido' ? (Number(t.concluido) || Date.now()) : undefined,
    aprovado: Number(t.aprovado) || undefined,
    recusado: t.estado === 'recusado' ? (Number(t.recusado) || Date.now()) : undefined,
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

// Sugestão do orquestrador: nasce "sugerido", com o resumo e as etapas
// previstas, e só vira trabalho quando o usuário aprova.
function sugerir({ titulo, resumo, codigo, agente, itens } = {}) {
  if (!texto(titulo, MAX_TITULO)) throw new Error('o tópico precisa de um título');
  const lista = ler();
  const id = String(lista.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0) + 1);
  const agora = Date.now();
  const etapas = (Array.isArray(itens) ? itens : itens ? [itens] : []).filter((i) => texto(i, MAX_TEXTO))
    .map((i, n) => ({ id: `i${n + 1}`, texto: i, feito: false }));
  const t = limpar({ id, titulo, resumo, codigo, agentes: agente ? [agente] : [], estado: 'sugerido', itens: etapas, criado: agora, atualizado: agora });
  lista.push(t);
  gravarArquivo(lista);
  return t;
}

// Resumo troca o anterior (é um parágrafo só); vazio tira o resumo.
function resumo(id, txt) {
  return mudar(id, (t) => { t.resumo = String(txt ?? ''); });
}

function renomear(id, novo) {
  if (!texto(novo, MAX_TITULO)) throw new Error('o tópico precisa de um título');
  return mudar(id, (t) => { t.titulo = novo; });
}

// Aprovar: só o que está sugerido (ou recusado, se reconsiderou direto). O
// título pode vir corrigido pelo usuário na hora de aprovar.
function aprovar(id, { titulo } = {}) {
  return mudar(id, (t) => {
    if (t.estado !== 'sugerido' && t.estado !== 'recusado') throw new Error(`o tópico ${t.id} não está sugerido (está ${t.estado})`);
    if (texto(titulo, MAX_TITULO)) t.titulo = titulo;
    t.estado = 'aberto';
    t.aprovado = Date.now();
    delete t.recusado;
  });
}

function recusar(id) {
  return mudar(id, (t) => {
    if (t.estado !== 'sugerido') throw new Error(`o tópico ${t.id} não está sugerido (está ${t.estado})`);
    t.estado = 'recusado';
    t.recusado = Date.now();
  });
}

// Recusado volta a sugerido: o usuário decide de novo.
function reconsiderar(id) {
  return mudar(id, (t) => {
    if (t.estado !== 'recusado') throw new Error(`o tópico ${t.id} não está recusado (está ${t.estado})`);
    t.estado = 'sugerido';
    delete t.recusado;
  });
}

// Mensagem ao orquestrador quando o usuário aprova ou recusa pela tela. Vai
// embrulhada em <orq-topico> (como as dos workflows): a conversa mostra só uma
// linha discreta e a resposta não vira notificação.
const marcarBastidor = (t, acao) => {
  const tit = String(t.titulo).replace(/["<>]/g, '');
  const corpo = acao === 'aprovado'
    ? `Tópico #${t.id} «${tit}» aprovado pelo usuário: crie as etapas (orq-topico item) e mande um resumo (orq-topico resumo).`
    : `Tópico #${t.id} «${tit}» recusado pelo usuário: não insista nele.`;
  return `<orq-topico id="${String(t.id).replace(/["<>]/g, '')}" acao="${acao}" titulo="${tit}">\n${corpo}\n</orq-topico>`;
};
// Só manda com o processo do orquestrador vivo; senão ele vê no próximo listar.
function avisarOrquestrador(conversa, t, acao) {
  if (!conversa || !t || !['aprovado', 'recusado'].includes(acao)) return false;
  let o;
  try { o = conversa.lista().find((x) => x.orquestrador); } catch { return false; }
  if (!(o && o.vivo)) return false;
  conversa.mandar(o.id, marcarBastidor(t, acao));
  return true;
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
  return mudar(id, (t) => {
    t.estado = novo;
    delete t.concluido;
    if (novo === 'recusado') t.recusado = Date.now();
  });
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

module.exports = { ESTADOS, arq, versoes, ler, abrir, sugerir, resumo, renomear, aprovar, recusar, reconsiderar, marcarBastidor, avisarOrquestrador, item, marcar, pendentes, concluir, estado, agente, nota, vigiar };
