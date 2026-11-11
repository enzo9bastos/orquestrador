// Recados entre os agentes e o orquestrador, e a memória de cada projeto.
//
// Só participa quem o app acompanha: um agente é uma frente do coletor (painel
// do tmux com o Claude, na pasta de um projeto). Um Claude, Codex ou OpenCode
// aberto num terminal fora do app não vira frente, então o recado dele é
// recusado. Não é uma barreira contra um agente mal-intencionado (a pasta do
// projeto é gravável para ele); é o que separa "do app" de "de fora".
//
// Agente → orquestrador: o agente roda .orq/bin/orq-recado enviar, que deixa um
// .json em <projeto>/.orq/recados/saida/. O app recolhe (a pasta é a mesma no
// container e no host), registra e entrega na conversa do orquestrador,
// embrulhado em <orq-recado> (aparece "por trás", como os workflows).
// Orquestrador → agente: bin/orq-recado para <projeto> "texto" escreve no
// painel do agente (como o orq send) e registra.
// Memória: <projeto>/.orq/memoria/*.md, uma nota por arquivo, só acrescenta.
//
// Registro: ~/.local/share/orq-app/recados/recados.jsonl, uma linha por recado
// e uma por mudança de estado ({ id, estado }). Nada é apagado: o arquivo do
// agente vai de saida/ para lidos/.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MARCA = '# (arquivo do App de Orquestração: o app instala e atualiza esta cópia)';
const SCRIPT = path.join(__dirname, '..', 'hooks', 'orq-recado.sh');
// Freio contra conversa em loop: a partir do 7º recado do mesmo projeto em
// 10 min, o app segura e espera o usuário liberar na aba Recados.
const LIMITE = 6;
const JANELA_MS = 10 * 60 * 1000;
const TIPOS = ['pergunta', 'aviso', 'pronto', 'travado'];
const TIPOS_NOTA = ['decisao', 'falhou', 'onde', 'aviso'];

const pasta = () => path.join(os.homedir(), '.local', 'share', 'orq-app', 'recados');
const arquivoLog = () => path.join(pasta(), 'recados.jsonl');

function acrescentar(linha) {
  fs.mkdirSync(pasta(), { recursive: true });
  fs.appendFileSync(arquivoLog(), JSON.stringify(linha) + '\n');
}

// Todos os recados, com o estado mais recente de cada um, do mais antigo ao
// mais novo (os últimos `max`).
function ler(max = 500) {
  let texto = '';
  try { texto = fs.readFileSync(arquivoLog(), 'utf8'); } catch { return []; }
  const porId = new Map();
  for (const l of texto.split('\n')) {
    if (!l.trim()) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (o.de) porId.set(o.id, o);
    else if (o.id && porId.has(o.id)) Object.assign(porId.get(o.id), o.mudanca || {});
  }
  return [...porId.values()].sort((a, b) => a.ts - b.ts).slice(-max);
}

function mudar(id, mudanca) { acrescentar({ id, mudanca: { ...mudanca, mudouEm: Date.now() } }); }

const novoId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const alvoDe = (f) => (f.emp ? `${f.emp}/${f.proj}` : f.proj);

// Recolhe os recados deixados pelos agentes. frentes: as do coletor.estado().
// Devolve os recados novos registrados (aceitos, segurados ou recusados).
function recolher(projetos, frentes, agora = Date.now()) {
  const novos = [];
  const recentes = ler(1000);
  for (const p of projetos) {
    const saida = path.join(p.dir, '.orq', 'recados', 'saida');
    let arquivos;
    try { arquivos = fs.readdirSync(saida).filter((f) => f.endsWith('.json')).sort(); } catch { continue; }
    if (!arquivos.length) continue;
    const lidos = path.join(p.dir, '.orq', 'recados', 'lidos');
    fs.mkdirSync(lidos, { recursive: true });
    const doProjeto = frentes.filter((f) => f.dir === p.dir);
    for (const f of arquivos) {
      const arq = path.join(saida, f);
      let m;
      try { m = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { continue; } // ainda sendo gravado
      const sessao = typeof m.sessao === 'string' && m.sessao ? m.sessao : null;
      const comSessao = doProjeto.filter((x) => x.sessaoClaude);
      const quem = (sessao && doProjeto.find((x) => x.sessaoClaude === sessao)) || doProjeto[0] || null;
      let estado = 'novo';
      let motivo = null;
      if (!doProjeto.length) { estado = 'recusado'; motivo = 'nenhum agente do app neste projeto (veio de um terminal de fora?)'; }
      else if (sessao && comSessao.length && !comSessao.some((x) => x.sessaoClaude === sessao)) { estado = 'recusado'; motivo = 'sessão que o app não acompanha (terminal de fora)'; }
      else {
        const desde = agora - JANELA_MS;
        const doMesmo = [...recentes, ...novos].filter((r) => r.de.tipo === 'agente' && r.de.alvo === p.alvo && r.ts >= desde && r.estado !== 'recusado');
        if (doMesmo.length >= LIMITE) { estado = 'segurado'; motivo = `mais de ${LIMITE} recados em 10 min: o app segurou para você conferir`; }
      }
      const r = {
        id: novoId(), ts: agora, // a hora de chegada (a do arquivo vem do agente)
        de: { tipo: 'agente', alvo: p.alvo, nome: quem ? quem.nome : `Agente de ${p.proj}`, sessao },
        para: { tipo: 'orquestrador' },
        tipo: TIPOS.includes(m.tipo) ? m.tipo : 'aviso',
        texto: String(m.texto || '').slice(0, 2000),
        estado, motivo,
      };
      acrescentar(r);
      novos.push(r);
      try { fs.renameSync(arq, path.join(lidos, f)); } catch { /* fica para a próxima volta */ }
    }
  }
  return novos;
}

const semAspas = (s) => String(s || '').replace(/["<>\n]/g, ' ').trim();
// Como o recado aparece para o orquestrador: o texto do agente e como responder.
function embrulho(r) {
  const corpo = String(r.texto).replace(/<\/?orq-recado[^>]*>/g, '');
  const tipo = { pergunta: 'Pergunta', aviso: 'Aviso', pronto: 'Terminou', travado: 'Travado, precisa de ajuda' }[r.tipo] || 'Recado';
  return `<orq-recado id="${semAspas(r.id)}" de="${semAspas(r.de.nome)}" projeto="${semAspas(r.de.alvo)}" tipo="${semAspas(r.tipo)}">\n`
    + `${tipo} de ${r.de.nome} (${r.de.alvo}):\n${corpo}\n\n`
    + `Para responder a este agente: orq-recado para "${semAspas(r.de.alvo)}" "sua resposta". `
    + `Memória do projeto: orq-recado memoria "${semAspas(r.de.alvo)}".\n</orq-recado>`;
}

// Entrega os recados novos ao orquestrador, se a conversa dele estiver viva.
// Sem ele vivo, esperam (não acorda o orquestrador por conta própria).
function entregar(conversa) {
  let o;
  try { o = conversa.lista().find((x) => x.orquestrador); } catch { return 0; }
  if (!(o && o.vivo)) return 0;
  let n = 0;
  for (const r of ler(1000)) {
    if (r.estado !== 'novo' || r.para.tipo !== 'orquestrador') continue;
    conversa.mandar(o.id, embrulho(r));
    mudar(r.id, { estado: 'entregue' });
    n++;
  }
  return n;
}

// Recado segurado pelo freio: o usuário libera e ele volta para a fila.
function liberar(id) {
  const r = ler(5000).find((x) => x.id === id);
  if (!r) throw new Error('recado não encontrado');
  if (r.estado !== 'segurado') throw new Error('este recado não está segurado');
  mudar(id, { estado: 'novo', motivo: null });
}

// Põe (ou atualiza) .orq/bin/orq-recado no projeto. Arquivo com o mesmo nome
// que não foi o app que pôs fica como está.
function instalar(dir) {
  const destino = path.join(dir, '.orq', 'bin', 'orq-recado');
  const novo = fs.readFileSync(SCRIPT, 'utf8');
  let atual = null;
  try { atual = fs.readFileSync(destino, 'utf8'); } catch { /* ainda não tem */ }
  if (atual === novo) return 'igual';
  if (atual !== null && !atual.includes(MARCA)) return 'alheio';
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, novo, { mode: 0o755 });
  fs.renameSync(tmp, destino);
  return atual === null ? 'instalado' : 'atualizado';
}

// Acha a frente pelo projeto ("grupo/projeto" ou só "projeto") ou pelo nome.
function acharFrente(frentes, alvo) {
  const a = String(alvo || '').trim().toLowerCase();
  if (!a) return [];
  const exato = frentes.filter((f) => alvoDe(f).toLowerCase() === a || f.nome.toLowerCase() === a);
  return exato.length ? exato : frentes.filter((f) => f.proj.toLowerCase() === a);
}

const tmuxPadrao = (args) => execFileSync('tmux', args, { stdio: 'ignore', timeout: 4000 });
// Escreve o recado no painel do agente, numa linha só (Enter manda), e registra.
function mandarAoAgente(frente, texto, { tipo = 'aviso', tmux = tmuxPadrao } = {}) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('recado vazio');
  if (!/^%\d+$/.test(frente.pane)) throw new Error('painel inválido');
  const instalacao = instalar(frente.dir);
  const rotulo = { pergunta: 'pergunta', aviso: 'recado', pronto: 'recado', travado: 'recado' }[tipo] || 'recado';
  const linha = `[${rotulo} do orquestrador] ${t} — Para responder ou avisar o orquestrador: .orq/bin/orq-recado enviar "texto" --tipo pergunta|aviso|pronto|travado. Memória do projeto: .orq/bin/orq-recado memoria | buscar "termo" | lembrar "título" "texto".`;
  tmux(['send-keys', '-t', frente.pane, 'C-u']);
  tmux(['send-keys', '-t', frente.pane, '-l', linha]);
  tmux(['send-keys', '-t', frente.pane, 'C-m']);
  const r = {
    id: novoId(), ts: Date.now(),
    de: { tipo: 'orquestrador' },
    para: { tipo: 'agente', alvo: alvoDe(frente), nome: frente.nome },
    tipo: TIPOS.includes(tipo) ? tipo : 'aviso', texto: t.slice(0, 2000), estado: 'entregue', motivo: null,
  };
  acrescentar(r);
  return { recado: r, instalacao };
}

// --- memória do projeto -------------------------------------------------------
function cabecalho(texto) {
  const meta = {};
  if (texto.startsWith('---\n')) {
    const fim = texto.indexOf('\n---', 4);
    for (const l of texto.slice(4, fim < 0 ? 4 : fim).split('\n')) {
      const i = l.indexOf(':');
      if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
  }
  return meta;
}

function memoria(dir, { termo = '', max = 200 } = {}) {
  const p = path.join(dir, '.orq', 'memoria');
  let nomes;
  try { nomes = fs.readdirSync(p).filter((n) => n.endsWith('.md')).sort().reverse(); } catch { return []; }
  const t = String(termo).toLowerCase().trim();
  const lista = [];
  for (const nome of nomes) {
    let texto;
    try { texto = fs.readFileSync(path.join(p, nome), 'utf8'); } catch { continue; }
    if (t && !texto.toLowerCase().includes(t)) continue;
    const m = cabecalho(texto);
    const corpo = texto.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^\s*# .*\n/, '').trim();
    lista.push({ nome: nome.slice(0, -3), tipo: m.tipo || 'nota', titulo: m.titulo || nome.slice(0, -3), quando: m.quando || '', autor: m.autor || '', texto: corpo });
    if (lista.length >= max) break;
  }
  return lista;
}

function lembrar(dir, { titulo, texto, tipo = 'decisao', autor = 'orquestrador' }) {
  const tit = String(titulo || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!tit || !String(texto || '').trim()) throw new Error('nota precisa de título e texto');
  if (!TIPOS_NOTA.includes(tipo)) throw new Error(`tipo inválido: ${tipo} (${TIPOS_NOTA.join('|')})`);
  const p = path.join(dir, '.orq', 'memoria');
  fs.mkdirSync(p, { recursive: true });
  const d = new Date();
  const dois = (n) => String(n).padStart(2, '0');
  const data = `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
  const hora = `${dois(d.getHours())}${dois(d.getMinutes())}${dois(d.getSeconds())}`;
  const slug = tit.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'nota';
  const cab = ['---', `tipo: ${tipo}`, `titulo: ${tit}`, `quando: ${data} ${dois(d.getHours())}:${dois(d.getMinutes())}`, `autor: ${autor}`, '---'].join('\n');
  for (let n = 1; n < 100; n++) {
    const arq = path.join(p, `${data}-${hora}-${slug}${n > 1 ? `-${n}` : ''}.md`);
    try {
      fs.writeFileSync(arq, `${cab}\n\n# ${tit}\n\n${String(texto).trim().slice(0, 8000)}\n`, { flag: 'wx' }); // nunca sobrescreve
      return path.basename(arq, '.md');
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('não achei um nome livre para a nota');
}

module.exports = { ler, recolher, entregar, embrulho, liberar, instalar, acharFrente, mandarAoAgente, memoria, lembrar, arquivoLog, LIMITE, MARCA };
