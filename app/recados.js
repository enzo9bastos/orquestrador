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
// Agente → agente: enviar --para <projeto|agente>; o app escreve no painel do outro.
// Vez passada: o agente deixa onde parou, o que falta e o que não funcionou;
// outro agente pega com pegar <id>. Quem decide quem pegou é o app, então só
// um pega, uma vez (registro em vezes.jsonl).
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
const TIPOS = ['pergunta', 'aviso', 'pronto', 'travado', 'vez'];
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

// --- vezes passadas (handoff com dono: só um agente pega, uma vez) ----------
const arquivoVezes = () => path.join(pasta(), 'vezes.jsonl');
function lerVezes(max = 500) {
  let texto = '';
  try { texto = fs.readFileSync(arquivoVezes(), 'utf8'); } catch { return []; }
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
function gravarVez(linha) { fs.mkdirSync(pasta(), { recursive: true }); fs.appendFileSync(arquivoVezes(), JSON.stringify(linha) + '\n'); }
// A vez é para este agente? Sem destino: qualquer agente do app pega.
const vezServe = (v, f) => v.estado === 'aberta' && !(v.de.alvo === alvoDe(f) && v.de.nome === f.nome)
  && (!v.para || acharFrente([f], v.para).length > 0);

// Resposta do app a um pedido do agente (pegar a vez): o script espera este arquivo.
function responderAgente(dir, req, dados) {
  if (!/^[\w-]{1,64}$/.test(String(req || ''))) return;
  const p = path.join(dir, '.orq', 'recados', 'entrada');
  fs.mkdirSync(p, { recursive: true });
  const tmp = path.join(p, `.${req}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(dados) + '\n');
  fs.renameSync(tmp, path.join(p, `${req}.json`));
}

// Freio: conta os recados recentes de um projeto (ao orquestrador) ou de uma
// dupla de agentes (nos dois sentidos).
function freio(lista, r, agora) {
  const desde = agora - JANELA_MS;
  const mesmos = lista.filter((x) => x.ts >= desde && x.estado !== 'recusado' && x.de.tipo === 'agente' && (r.para.tipo === 'orquestrador'
    ? x.para.tipo === 'orquestrador' && x.de.alvo === r.de.alvo
    : x.para.tipo === 'agente' && ((x.de.nome === r.de.nome && x.para.nome === r.para.nome) || (x.de.nome === r.para.nome && x.para.nome === r.de.nome))));
  return mesmos.length >= LIMITE;
}

// Recolhe o que os agentes deixaram em .orq/recados/saida/: recados (ao
// orquestrador ou a outro agente), vezes passadas e pedidos de pegar a vez.
// frentes: as do coletor.estado(). Devolve os recados novos registrados.
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
      let recusa = null;
      if (!doProjeto.length) recusa = 'nenhum agente do app neste projeto (veio de um terminal de fora?)';
      else if (sessao && comSessao.length && !comSessao.some((x) => x.sessaoClaude === sessao)) recusa = 'sessão que o app não acompanha (terminal de fora)';
      const de = { tipo: 'agente', alvo: p.alvo, nome: quem ? quem.nome : `Agente de ${p.proj}`, sessao };
      const acao = ['vez', 'pegar'].includes(m.acao) ? m.acao : 'recado';
      const mover = () => { try { fs.renameSync(arq, path.join(lidos, f)); } catch { /* fica para a próxima volta */ } };

      if (acao === 'pegar') {
        const v = lerVezes(5000).find((x) => x.id === String(m.vez || ''));
        let resp;
        if (recusa) resp = { ok: false, erro: recusa };
        else if (!v) resp = { ok: false, erro: 'vez não encontrada' };
        else if (v.estado !== 'aberta') resp = { ok: false, erro: `essa vez já foi pega por ${v.pegaPor ? v.pegaPor.nome : 'outro agente'}` };
        else if (!vezServe(v, quem)) resp = { ok: false, erro: 'essa vez é para outro agente' };
        else {
          gravarVez({ id: v.id, mudanca: { estado: 'pega', pegaPor: { alvo: de.alvo, nome: de.nome }, pegaEm: agora } });
          resp = { ok: true, vez: { ...v, estado: 'pega' } };
        }
        responderAgente(p.dir, m.req, resp);
        mover();
        continue;
      }

      if (acao === 'vez') {
        const v = {
          id: novoId(), ts: agora, de: { alvo: de.alvo, nome: de.nome },
          para: m.para ? String(m.para).slice(0, 120) : null,
          texto: String(m.texto || '').slice(0, 4000), falta: String(m.falta || '').slice(0, 2000), falhou: String(m.falhou || '').slice(0, 2000),
          estado: recusa ? 'recusada' : 'aberta', motivo: recusa,
        };
        gravarVez(v);
        // O orquestrador fica sabendo de toda vez passada (pode ter de abrir quem pega).
        const r = { id: novoId(), ts: agora, de, para: { tipo: 'orquestrador' }, tipo: 'vez',
          texto: `${v.texto}${v.falta ? `\nFalta: ${v.falta}` : ''}${v.falhou ? `\nNão funcionou: ${v.falhou}` : ''}\n(vez ${v.id}${v.para ? `, para ${v.para}` : ', para qualquer agente'})`,
          estado: recusa ? 'recusado' : 'novo', motivo: recusa, vez: v.id };
        acrescentar(r);
        novos.push(r);
        mover();
        continue;
      }

      // Recado: ao orquestrador, ou a outro agente com --para.
      let para = { tipo: 'orquestrador' };
      if (m.para && !recusa) {
        const alvo = acharFrente(frentes, m.para).filter((x) => !(x.dir === p.dir && x.nome === de.nome));
        if (alvo.length === 1) para = { tipo: 'agente', alvo: alvoDe(alvo[0]), nome: alvo[0].nome };
        else {
          para = { tipo: 'agente', alvo: String(m.para).slice(0, 120), nome: String(m.para).slice(0, 120) };
          recusa = alvo.length ? `"${m.para}" tem ${alvo.length} agentes; use o nome do agente` : `nenhum agente do app em "${m.para}" (veja .orq/bin/orq-recado agentes)`;
        }
      }
      const r = { id: novoId(), ts: agora, de, para, tipo: TIPOS.includes(m.tipo) ? m.tipo : 'aviso', texto: String(m.texto || '').slice(0, 2000), estado: 'novo', motivo: null };
      if (recusa) { r.estado = 'recusado'; r.motivo = recusa; }
      else if (freio([...recentes, ...novos], r, agora)) {
        r.estado = 'segurado';
        r.motivo = r.para.tipo === 'orquestrador' ? `mais de ${LIMITE} recados em 10 min: o app segurou para você conferir` : `mais de ${LIMITE} recados entre esses dois agentes em 10 min: o app segurou para você conferir`;
      }
      acrescentar(r);
      novos.push(r);
      mover();
    }
  }
  return novos;
}

const semAspas = (s) => String(s || '').replace(/["<>\n]/g, ' ').trim();
// Como o recado aparece para o orquestrador: o texto do agente e como responder.
function embrulho(r) {
  const corpo = String(r.texto).replace(/<\/?orq-recado[^>]*>/g, '');
  const tipo = { pergunta: 'Pergunta', aviso: 'Aviso', pronto: 'Terminou', travado: 'Travado, precisa de ajuda', vez: 'Passou a vez' }[r.tipo] || 'Recado';
  return `<orq-recado id="${semAspas(r.id)}" de="${semAspas(r.de.nome)}" projeto="${semAspas(r.de.alvo)}" tipo="${semAspas(r.tipo)}">\n`
    + `${tipo} de ${r.de.nome} (${r.de.alvo}):\n${corpo}\n\n`
    + (r.tipo === 'vez' ? 'Se ninguém do app pode pegar essa vez, abra um agente para ela; ele pega com .orq/bin/orq-recado pegar <id>. Lista: orq-recado vezes. ' : '')
    + `Para responder a este agente: orq-recado para "${semAspas(r.de.alvo)}" "sua resposta". `
    + `Memória do projeto: orq-recado memoria "${semAspas(r.de.alvo)}".\n</orq-recado>`;
}

// Entrega os recados novos: ao orquestrador, se a conversa dele estiver viva
// (sem ele vivo, esperam: não acorda o orquestrador por conta própria); ao
// agente, escrevendo no painel dele (sem o agente aberto, esperam).
// obterFrentes só roda se houver recado esperando um agente.
function entregar(conversa, obterFrentes = () => [], { tmux = tmuxPadrao } = {}) {
  let o = null;
  try { o = conversa.lista().find((x) => x.orquestrador); } catch { /* sem conversas */ }
  let n = 0;
  let frentes = null;
  for (const r of ler(1000)) {
    if (r.estado !== 'novo') continue;
    if (r.para.tipo === 'orquestrador') {
      if (!(o && o.vivo)) continue;
      conversa.mandar(o.id, embrulho(r));
      mudar(r.id, { estado: 'entregue' });
      n++;
    } else if (r.para.tipo === 'agente' && r.de.tipo === 'agente') {
      if (!frentes) frentes = obterFrentes();
      const f = frentes.find((x) => alvoDe(x) === r.para.alvo && x.nome === r.para.nome);
      if (!f) continue;
      escreverNoPainel(f, `[recado de ${r.de.nome} (${r.de.alvo})] ${r.texto} — Para responder: .orq/bin/orq-recado enviar "texto" --para "${r.de.nome}".`, tmux);
      mudar(r.id, { estado: 'entregue' });
      n++;
    }
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

// Quadro de cada projeto com o script instalado: quem está aberto no app
// (.orq/recados/agentes.json) e as vezes que ele pode pegar (vezes.json). O
// agente lê com orq-recado agentes / vezes. Só grava quando muda.
function escreverQuadros(projetos, frentes) {
  const agentes = frentes.map((f) => ({ nome: f.nome, projeto: alvoDe(f), estado: f.estado || null, tarefa: f.tarefa || null }));
  const vezes = lerVezes(2000).filter((v) => v.estado === 'aberta');
  let n = 0;
  for (const p of projetos) {
    if (!fs.existsSync(path.join(p.dir, '.orq', 'bin', 'orq-recado'))) continue;
    const meus = frentes.filter((f) => f.dir === p.dir);
    const servem = vezes.filter((v) => (meus.length ? meus.some((f) => vezServe(v, f)) : !v.para))
      .map((v) => ({ id: v.id, de: v.de.nome, projeto: v.de.alvo, para: v.para, texto: v.texto, falta: v.falta, falhou: v.falhou, ts: v.ts }));
    const base = path.join(p.dir, '.orq', 'recados');
    for (const [nome, dados] of [['agentes.json', agentes.map((a) => ({ ...a, voce: meus.some((f) => f.nome === a.nome && alvoDe(f) === a.projeto) }))], ['vezes.json', servem]]) {
      const arq = path.join(base, nome);
      const texto = JSON.stringify(dados, null, 1) + '\n';
      let atual = null;
      try { atual = fs.readFileSync(arq, 'utf8'); } catch { /* ainda não tem */ }
      if (atual === texto) continue;
      fs.mkdirSync(base, { recursive: true });
      const tmp = `${arq}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, texto);
      fs.renameSync(tmp, arq);
      n++;
    }
  }
  return n;
}

// Acha a frente pelo projeto ("grupo/projeto" ou só "projeto") ou pelo nome.
function acharFrente(frentes, alvo) {
  const a = String(alvo || '').trim().toLowerCase();
  if (!a) return [];
  const exato = frentes.filter((f) => alvoDe(f).toLowerCase() === a || f.nome.toLowerCase() === a);
  return exato.length ? exato : frentes.filter((f) => f.proj.toLowerCase() === a);
}

const tmuxPadrao = (args) => execFileSync('tmux', args, { stdio: 'ignore', timeout: 4000 });
function escreverNoPainel(frente, linha, tmux) {
  if (!/^%\d+$/.test(frente.pane)) throw new Error('painel inválido');
  tmux(['send-keys', '-t', frente.pane, 'C-u']);
  tmux(['send-keys', '-t', frente.pane, '-l', String(linha).replace(/\s+/g, ' ').trim()]);
  tmux(['send-keys', '-t', frente.pane, 'C-m']);
}
// Escreve o recado do orquestrador no painel do agente, numa linha só (Enter manda), e registra.
function mandarAoAgente(frente, texto, { tipo = 'aviso', tmux = tmuxPadrao } = {}) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('recado vazio');
  if (!/^%\d+$/.test(frente.pane)) throw new Error('painel inválido');
  const instalacao = instalar(frente.dir);
  const rotulo = { pergunta: 'pergunta', aviso: 'recado', pronto: 'recado', travado: 'recado' }[tipo] || 'recado';
  escreverNoPainel(frente, `[${rotulo} do orquestrador] ${t} — Para responder ou avisar o orquestrador: .orq/bin/orq-recado enviar "texto" --tipo pergunta|aviso|pronto|travado. Outros agentes: .orq/bin/orq-recado agentes; enviar "texto" --para <agente>. Memória do projeto: .orq/bin/orq-recado memoria | buscar "termo" | lembrar "título" "texto".`, tmux);
  const r = {
    id: novoId(), ts: Date.now(),
    de: { tipo: 'orquestrador' },
    para: { tipo: 'agente', alvo: alvoDe(frente), nome: frente.nome },
    tipo: TIPOS.includes(tipo) ? tipo : 'aviso', texto: t.slice(0, 2000), estado: 'entregue', motivo: null,
  };
  acrescentar(r);
  return { recado: r, instalacao };
}

// --- memória dividida entre cópias do mesmo projeto ---------------------------
// Cópias do mesmo repositório (git worktree) dividem a memória; a configuração
// memoriaGrupos junta outras pastas. O app copia para cada pasta do grupo as
// notas que faltam nela (nunca sobrescreve, nunca apaga): cada agente continua
// lendo só a própria .orq/memoria, que é o que o container dele enxerga.
const cacheGit = new Map(); // dir → { comum, em }
function repositorioDe(dir, agora = Date.now()) {
  const c = cacheGit.get(dir);
  if (c && agora - c.em < 5 * 60 * 1000) return c.comum;
  let comum = null;
  try {
    comum = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { /* não é repositório */ }
  cacheGit.set(dir, { comum, em: agora });
  return comum;
}

// Grupos de pastas (só os com 2 ou mais) que dividem a memória.
function gruposDeMemoria(projetos, memoriaGrupos = []) {
  const porChave = new Map();
  const juntar = (chave, p) => { if (!porChave.has(chave)) porChave.set(chave, new Set()); porChave.get(chave).add(p.dir); };
  for (const p of projetos) { const r = repositorioDe(p.dir); if (r) juntar(`git:${r}`, p); }
  (memoriaGrupos || []).forEach((g, i) => {
    for (const alvo of g) { const p = projetos.find((x) => x.alvo === alvo); if (p) juntar(`cfg:${i}`, p); }
  });
  // Grupos que se tocam viram um só (uma pasta em dois grupos liga os dois).
  const grupos = [];
  for (const s of porChave.values()) {
    const junto = grupos.find((g) => [...s].some((d) => g.has(d)));
    if (junto) for (const d of s) junto.add(d); else grupos.push(new Set(s));
  }
  return grupos.filter((g) => g.size >= 2).map((g) => [...g].sort());
}

function sincronizarMemoria(grupos) {
  let copiadas = 0;
  for (const g of grupos) {
    const notas = new Map(); // nome → pasta de origem
    for (const dir of g) {
      try { for (const n of fs.readdirSync(path.join(dir, '.orq', 'memoria'))) if (n.endsWith('.md') && !notas.has(n)) notas.set(n, dir); } catch { /* sem memória ainda */ }
    }
    if (!notas.size) continue;
    for (const dir of g) {
      const destino = path.join(dir, '.orq', 'memoria');
      for (const [n, origem] of notas) {
        if (origem === dir || fs.existsSync(path.join(destino, n))) continue;
        fs.mkdirSync(destino, { recursive: true });
        try { fs.copyFileSync(path.join(origem, '.orq', 'memoria', n), path.join(destino, n), fs.constants.COPYFILE_EXCL); copiadas++; } catch { /* outra volta copia */ }
      }
    }
  }
  return copiadas;
}

// Põe o script em todo projeto com agente aberto no app (e atualiza o do app).
function instalarNosAgentes(frentes) {
  const r = {};
  for (const dir of new Set(frentes.map((f) => f.dir))) { try { r[dir] = instalar(dir); } catch (e) { r[dir] = `erro: ${e.message}`; } }
  return r;
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
    lista.push({ nome: nome.slice(0, -3), tipo: m.tipo || 'nota', titulo: m.titulo || nome.slice(0, -3), quando: m.quando || '', autor: m.autor || '', origem: m.origem || '', texto: corpo });
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
  const cab = ['---', `tipo: ${tipo}`, `titulo: ${tit}`, `quando: ${data} ${dois(d.getHours())}:${dois(d.getMinutes())}`, `autor: ${autor}`, `origem: ${path.basename(dir)}`, '---'].join('\n');
  for (let n = 1; n < 100; n++) {
    const arq = path.join(p, `${data}-${hora}-${slug}${n > 1 ? `-${n}` : ''}.md`);
    try {
      fs.writeFileSync(arq, `${cab}\n\n# ${tit}\n\n${String(texto).trim().slice(0, 8000)}\n`, { flag: 'wx' }); // nunca sobrescreve
      return path.basename(arq, '.md');
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('não achei um nome livre para a nota');
}

module.exports = { ler, lerVezes, recolher, entregar, embrulho, liberar, instalar, escreverQuadros, gruposDeMemoria, sincronizarMemoria, instalarNosAgentes, acharFrente, mandarAoAgente, memoria, lembrar, arquivoLog, arquivoVezes, LIMITE, MARCA };
