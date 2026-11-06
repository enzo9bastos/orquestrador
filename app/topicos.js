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
const md = require('./demandas-md');
const config = require('./config');

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
    // Demanda com .md: o nome do arquivo na pasta Demandas e o título que deu
    // nome a ele (mudar o título dentro da nota não renomeia o arquivo).
    arquivo: typeof t.arquivo === 'string' && /^[^/\\]+\.md$/.test(t.arquivo) ? t.arquivo : undefined,
    nomeBase: typeof t.nomeBase === 'string' && t.nomeBase.trim() ? t.nomeBase.slice(0, MAX_TITULO) : undefined,
  };
}

// --- demandas em .md ----------------------------------------------------------
// Cada demanda aprovada (aberta, esperando ou concluída) é um .md em
// <primeira pasta de notas>/Demandas, que o usuário abre e edita na aba Notas.
// O .md manda no conteúdo (título, estado, etapas, resumo, anotações); o
// topicos.json é o índice (número → arquivo) e guarda sugeridas e recusadas,
// que só viram arquivo quando aprovadas. Sem pasta de notas: só o json.
const COM_ARQUIVO = ['aberto', 'esperando', 'concluido'];
function pastaDemandas() {
  try {
    const c = config.ler();
    const lista = Array.isArray(c.pastasNotas) && c.pastasNotas.length ? c.pastasNotas : c.pastaNotas ? [{ caminho: c.pastaNotas }] : [];
    const raiz = lista[0] && String(lista[0].caminho || '').replace(/^~(?=$|\/)/, os.homedir());
    return raiz && fs.existsSync(raiz) ? path.join(raiz, 'Demandas') : null;
  } catch { return null; }
}
const versoesMd = () => path.join(versoes(), 'demandas');
function guardarVersaoMd(abs) {
  if (!fs.existsSync(abs)) return;
  fs.mkdirSync(versoesMd(), { recursive: true });
  const base = `${new Date().toISOString().replace(/[:.]/g, '-')}-${path.basename(abs)}`;
  let destino = path.join(versoesMd(), base);
  for (let n = 2; fs.existsSync(destino); n++) destino = path.join(versoesMd(), `${n}-${base}`);
  fs.copyFileSync(abs, destino);
}
// Nome livre na pasta: nunca escreve por cima de outro arquivo.
function nomeLivre(pasta, nome, meu) {
  if (nome === meu || !fs.existsSync(path.join(pasta, nome))) return nome;
  const base = nome.replace(/\.md$/, '');
  for (let n = 2; ; n++) { const c = `${base} (${n}).md`; if (c === meu || !fs.existsSync(path.join(pasta, c))) return c; }
}
// Puxa do .md o que o usuário (ou outra gravação) mudou lá.
function juntarDoMd(t, pasta) {
  if (!pasta || !t.arquivo || !COM_ARQUIVO.includes(t.estado)) return t;
  let txt, st;
  try { txt = fs.readFileSync(path.join(pasta, t.arquivo), 'utf8'); st = fs.statSync(path.join(pasta, t.arquivo)); } catch { return t; }
  const l = md.ler(txt);
  if (l.titulo) t.titulo = texto(l.titulo, MAX_TITULO) || t.titulo;
  if (l.estado) {
    if (l.estado === 'concluido' && t.estado !== 'concluido') t.concluido = t.concluido || Date.now();
    if (l.estado !== 'concluido') delete t.concluido;
    t.estado = l.estado;
  }
  if (l.codigo !== null || l.agentes !== null) { t.codigo = l.codigo || undefined; t.agentes = l.agentes || []; }
  if (l.resumo !== null) t.resumo = l.resumo || undefined;
  if (l.itens !== null) t.itens = l.itens;
  t.anotacoes = l.anotacoes;
  t.atualizado = Math.max(Number(t.atualizado) || 0, Math.round(st.mtimeMs));
  return t;
}
// Grava o .md de cada demanda que tem (ou passa a ter) arquivo: cria, troca o
// nome ao concluir/reabrir e reescreve só se o conteúdo mudou. Devolve os
// nomes criados.
function sincronizarMd(lista, pasta) {
  const criados = [];
  if (!pasta) return criados;
  for (const t of lista) {
    if (!COM_ARQUIVO.includes(t.estado)) continue;
    fs.mkdirSync(pasta, { recursive: true });
    if (!t.nomeBase) t.nomeBase = t.titulo;
    let atual = t.arquivo && fs.existsSync(path.join(pasta, t.arquivo)) ? t.arquivo : null;
    // Ligação perdida (um app antigo regravou o índice sem o nome do arquivo):
    // adota a nota de demanda (tem a linha "Estado:") com o nome deste título
    // em vez de criar outra.
    if (!atual) {
      for (const cand of [md.nomeArquivo(t.nomeBase, 'aberto'), md.nomeArquivo(t.nomeBase, 'concluido')]) {
        try {
          const l = md.ler(fs.readFileSync(path.join(pasta, cand), 'utf8'));
          if (l.estado && (!l.titulo || l.titulo === t.titulo) && !lista.some((o) => o !== t && o.arquivo === cand)) { atual = cand; break; }
        } catch { /* não existe */ }
      }
      if (atual && t.anotacoes == null) t.anotacoes = md.ler(fs.readFileSync(path.join(pasta, atual), 'utf8')).anotacoes;
    }
    let anotacoes = t.anotacoes;
    if (anotacoes == null) anotacoes = atual ? md.ler(fs.readFileSync(path.join(pasta, atual), 'utf8')).anotacoes : (t.notas || '');
    const desejado = nomeLivre(pasta, md.nomeArquivo(t.nomeBase, t.estado), atual);
    if (atual && atual !== desejado) { fs.renameSync(path.join(pasta, atual), path.join(pasta, desejado)); }
    if (!atual) criados.push(desejado);
    t.arquivo = desejado;
    const abs = path.join(pasta, desejado);
    const novo = md.formatar(t, anotacoes);
    let velho = null;
    try { velho = fs.readFileSync(abs, 'utf8'); } catch { /* novo */ }
    if (velho !== null && md.ler(velho) && JSON.stringify(md.ler(velho)) === JSON.stringify(md.ler(novo))) continue;
    guardarVersaoMd(abs);
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, novo);
    fs.renameSync(tmp, abs);
  }
  return criados;
}

// Arquivo estragado não é tratado como vazio: gravar por cima apagaria tudo.
function ler() {
  let cru;
  try { cru = fs.readFileSync(arq(), 'utf8'); } catch { return []; }
  let d;
  try { d = JSON.parse(cru); } catch { throw new Error(`${arq()} está estragado (JSON inválido); conserte ou restaure de ${versoes()}`); }
  const pasta = pastaDemandas();
  return (Array.isArray(d.topicos) ? d.topicos : []).filter((t) => t && t.id != null).map(limpar).map((t) => juntarDoMd(t, pasta));
}

function gravarArquivo(lista) {
  sincronizarMd(lista, pastaDemandas());
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
  fs.writeFileSync(tmp, JSON.stringify({ topicos: lista.map(({ anotacoes, ...t }) => t) }, null, 2) + '\n');
  fs.renameSync(tmp, a);
}

// Trava entre processos (o app e o orq-topico gravam o mesmo arquivo): um
// arquivo .lock criado com 'wx' (só um consegue). Quem não consegue espera e
// tenta de novo; uma trava esquecida por um processo que morreu (mais velha
// que TRAVA_VELHA) é retomada. Sem isso, dois lendo ao mesmo tempo gravam por
// cima um do outro e o tópico de um some.
const TRAVA_ESPERA = 5000;
const TRAVA_VELHA = 15000;
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function comTrava(fn) {
  const trava = `${arq()}.lock`;
  fs.mkdirSync(path.dirname(trava), { recursive: true });
  const limite = Date.now() + TRAVA_ESPERA;
  let fd;
  for (;;) {
    try { fd = fs.openSync(trava, 'wx'); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(trava).mtimeMs > TRAVA_VELHA) { fs.rmSync(trava, { force: true }); continue; } } catch { continue; }
      if (Date.now() > limite) throw new Error(`os tópicos estão travados por outro processo (${trava}); tente de novo`);
      dormir(10 + Math.random() * 20);
    }
  }
  try { fs.writeSync(fd, String(process.pid)); return fn(); } finally {
    fs.closeSync(fd);
    fs.rmSync(trava, { force: true });
  }
}

// Lê, muda um tópico e grava. Devolve o tópico como ficou.
function mudar(id, fn) { return comTrava(() => mudarSemTrava(id, fn)); }
function mudarSemTrava(id, fn) {
  const lista = ler();
  const chave = String(id ?? '').replace(/^#/, '');
  const t = lista.find((x) => x.id === chave);
  if (!t) throw new Error(`não existe tópico ${chave || '(sem id)'}`);
  fn(t);
  t.atualizado = Date.now();
  const i = lista.indexOf(t);
  const anotacoes = t.anotacoes;
  lista[i] = limpar(t);
  if (anotacoes != null) lista[i].anotacoes = anotacoes;
  gravarArquivo(lista);
  return lista[i];
}

// Ids curtos e em sequência ("1", "2"…): o orquestrador digita no terminal.
function abrir({ titulo, codigo, agente } = {}) {
  if (!texto(titulo, MAX_TITULO)) throw new Error('o tópico precisa de um título');
  return comTrava(() => {
  const lista = ler();
  const id = String(lista.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0) + 1);
  const agora = Date.now();
  const t = limpar({ id, titulo, codigo, agentes: agente ? [agente] : [], estado: 'aberto', itens: [], criado: agora, atualizado: agora });
  lista.push(t);
  gravarArquivo(lista);
  return t;
  });
}

// Sugestão do orquestrador: nasce "sugerido", com o resumo e as etapas
// previstas, e só vira trabalho quando o usuário aprova.
function sugerir({ titulo, resumo, codigo, agente, itens } = {}) {
  if (!texto(titulo, MAX_TITULO)) throw new Error('o tópico precisa de um título');
  return comTrava(() => {
  const lista = ler();
  const id = String(lista.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0) + 1);
  const agora = Date.now();
  const etapas = (Array.isArray(itens) ? itens : itens ? [itens] : []).filter((i) => texto(i, MAX_TEXTO))
    .map((i, n) => ({ id: `i${n + 1}`, texto: i, feito: false }));
  const t = limpar({ id, titulo, resumo, codigo, agentes: agente ? [agente] : [], estado: 'sugerido', itens: etapas, criado: agora, atualizado: agora });
  lista.push(t);
  gravarArquivo(lista);
  return t;
  });
}

// Resumo troca o anterior (é um parágrafo só); vazio tira o resumo.
function resumo(id, txt) {
  return mudar(id, (t) => { t.resumo = String(txt ?? ''); });
}

function renomear(id, novo) {
  if (!texto(novo, MAX_TITULO)) throw new Error('o tópico precisa de um título');
  return mudar(id, (t) => { t.titulo = novo; t.nomeBase = novo; });
}

// Aprovar: só o que está sugerido (ou recusado, se reconsiderou direto). O
// título pode vir corrigido pelo usuário na hora de aprovar.
function aprovar(id, { titulo } = {}) {
  return mudar(id, (t) => {
    if (t.estado !== 'sugerido' && t.estado !== 'recusado') throw new Error(`o tópico ${t.id} não está sugerido (está ${t.estado})`);
    if (texto(titulo, MAX_TITULO)) t.titulo = titulo;
    t.nomeBase = t.titulo;
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
  return mudar(id, (t) => {
    // Com .md: a linha entra no fim das Anotações. Sem: no campo notas.
    if (pastaDemandas() && COM_ARQUIVO.includes(t.estado)) t.anotacoes = t.anotacoes ? `${t.anotacoes}\n${linha}` : linha;
    else t.notas = t.notas ? `${t.notas}\n${linha}` : linha;
  });
}

// Vigia a pasta (o arquivo é trocado por rename, então vigiar só o arquivo
// perderia a troca) e avisa com a lista nova, juntando rajadas de mudança.
// Migração: grava o .md de toda demanda que ainda não tem. Rodar de novo
// não cria nada. O topicos.json continua (é o índice e o backup).
function migrarParaNotas() {
  const pasta = pastaDemandas();
  if (!pasta) return { criados: [], pasta: null };
  return comTrava(() => {
    const lista = ler();
    const antes = JSON.stringify(lista.map((t) => [t.id, t.arquivo, t.nomeBase]));
    const criados = sincronizarMd(lista, pasta);
    // Grava o índice se ligou algum arquivo (criado ou adotado).
    if (JSON.stringify(lista.map((t) => [t.id, t.arquivo, t.nomeBase])) !== antes) gravarArquivo(lista);
    return { criados, pasta };
  });
}

// Onde a nota de uma demanda está (para a tela abrir na aba Notas).
function ondeNota(id) {
  const t = ler().find((x) => x.id === String(id));
  const pasta = pastaDemandas();
  if (!t || !t.arquivo || !pasta) return null;
  return { pasta, arquivo: t.arquivo, abs: path.join(pasta, t.arquivo) };
}

function vigiar(aoMudar) {
  const pasta = path.dirname(arq());
  fs.mkdirSync(pasta, { recursive: true });
  let espera;
  const avisar = () => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      try { aoMudar({ topicos: ler() }); } catch (e) { aoMudar({ topicos: null, erro: e.message }); }
    }, 120);
  };
  const w = fs.watch(pasta, (_tipo, nome) => { if (!nome || nome === 'topicos.json') avisar(); });
  // A pasta Demandas também: editar a nota na aba Notas atualiza o painel.
  // Ela só existe depois da primeira demanda com nota (nunca é criada vazia):
  // enquanto não existe, vigia a pasta de notas até ela aparecer.
  let wd = null, wr = null;
  const pd = pastaDemandas();
  const vigiarDemandas = () => {
    if (wd || !pd || !fs.existsSync(pd)) return;
    try { wd = fs.watch(pd, (_tipo, nome) => { if (!nome || /\.md$/.test(nome)) avisar(); }); } catch { wd = null; }
    if (wd && wr) { wr.close(); wr = null; }
  };
  vigiarDemandas();
  if (pd && !wd) { try { wr = fs.watch(path.dirname(pd), (_tipo, nome) => { if (nome === path.basename(pd)) { vigiarDemandas(); avisar(); } }); } catch { /* sem pasta de notas */ } }
  return () => { clearTimeout(espera); w.close(); if (wd) wd.close(); if (wr) wr.close(); };
}

module.exports = { ESTADOS, arq, versoes, pastaDemandas, migrarParaNotas, ondeNota, ler, abrir, sugerir, resumo, renomear, aprovar, recusar, reconsiderar, marcarBastidor, avisarOrquestrador, item, marcar, pendentes, concluir, estado, agente, nota, vigiar };
