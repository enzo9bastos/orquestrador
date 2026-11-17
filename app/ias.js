// IAs conectadas: acha as ferramentas de IA de linha de comando (CLIs) que
// estão no PATH do app (ou no caminho escolhido na engrenagem), com a versão
// de cada uma. Primeiro passo para o app
// conduzir agentes de outras IAs além do Claude Code: o Claude e o Codex sabem
// ser o orquestrador (conversa.js, conversa-codex.js); as outras aparecem na
// lista.
//
// Cada candidato roda só com --version, sem shell, com tempo curto e o
// ambiente das conversas. Da saída fica só o número da versão: nada do que a
// ferramenta imprimir (que pode ter conta, chave ou caminho) vai para a tela.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

// suportado: o app já sabe conduzir esta IA como orquestrador.
const CANDIDATOS = [
  { id: 'claude', nome: 'Claude Code', comando: 'claude', suportado: true },
  { id: 'codex', nome: 'Codex CLI', comando: 'codex', suportado: true },
  { id: 'gemini', nome: 'Gemini CLI', comando: 'gemini', suportado: false },
  { id: 'opencode', nome: 'OpenCode', comando: 'opencode', suportado: false },
  { id: 'cursor', nome: 'Cursor CLI', comando: 'cursor-agent', suportado: false },
  { id: 'aider', nome: 'Aider', comando: 'aider', suportado: false },
  { id: 'qwen', nome: 'Qwen Code', comando: 'qwen', suportado: false },
];
// Outro nome do mesmo CLI. O instalador do Cursor cria dois atalhos em ~/.local/bin:
// "agent" (o principal) e "cursor-agent" (o legado), os dois para
// ~/.local/share/cursor-agent/versions/<versão>/cursor-agent (conferido no instalador
// oficial em 2026-11-17). "agent" é um nome comum demais para ser executado só por estar
// no PATH: vale só quando o arquivo de verdade é o `arquivo` de dentro da `instalacao`,
// conferido ANTES de rodar qualquer coisa. O nome próprio ("cursor-agent") vale primeiro.
const OUTRO_NOME = {
  cursor: { comando: 'agent', arquivo: 'cursor-agent', instalacao: ['.local', 'share', 'cursor-agent', 'versions'] },
};
const IDS = CANDIDATOS.map((c) => c.id);
const PADRAO = 'claude';
const TEMPO = 5000; // por candidato; rodam todos ao mesmo tempo
const VALIDADE = 60000; // o resultado vale 1 min (o painel abre e fecha muito)

// Primeiro executável com esse nome nas pastas do PATH (como o shell acharia).
function acharNoPath(comando, env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const abs = path.join(dir, comando);
    try {
      if (fs.statSync(abs).isFile()) { fs.accessSync(abs, fs.constants.X_OK); return abs; }
    } catch { /* não está nesta pasta */ }
  }
  return null;
}

// O arquivo de verdade por trás do outro nome, se for o da instalação conhecida
// (<casa>/<instalacao>/<versão>/<arquivo>); senão null, e nada é executado.
function peloOutroNome(id, env) {
  const o = OUTRO_NOME[id];
  const abs = o ? acharNoPath(o.comando, env) : null;
  if (!abs) return null;
  try {
    const real = fs.realpathSync(abs);
    const raiz = fs.realpathSync(path.join(env.HOME || os.homedir(), ...o.instalacao));
    if (path.basename(real) !== o.arquivo || path.dirname(path.dirname(real)) !== raiz) return null;
    return problemaDe(real) ? null : real;
  } catch { return null; /* atalho quebrado ou instalação que não existe */ }
}

// Impressão digital do arquivo reconhecido pelo outro nome: quem for rodá-lo depois
// confere que ainda é o mesmo. Arquivo grande demais fica sem (null).
function impressaoDe(abs) {
  return new Promise((resolve) => {
    try {
      if (fs.statSync(abs).size > 256 * 1024 * 1024) return resolve(null);
      const h = crypto.createHash('sha256');
      fs.createReadStream(abs).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

// Só o número: "2.1.3 (Claude Code)", "codex-cli 0.40.0", "v1.2.3-beta".
function versaoDe(saida) {
  const m = String(saida || '').match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?)/);
  return m ? m[1].slice(0, 40) : null;
}

function perguntarVersao(abs, env) {
  return new Promise((resolve) => {
    const filho = execFile(abs, ['--version'], { env, timeout: TEMPO, maxBuffer: 64 * 1024, windowsHide: true }, (erro, out, err) => {
      clearTimeout(desiste);
      resolve(versaoDe(`${out || ''}\n${err || ''}`) || null);
    });
    // Um neto que segura a saída aberta faria o execFile esperar por ele:
    // passado o tempo, a resposta é "sem versão", com ou sem fim do processo.
    const desiste = setTimeout(() => { try { filho.kill('SIGKILL'); } catch { /* já saiu */ } resolve(null); }, TEMPO + 500);
    desiste.unref();
  });
}

// Executável de verdade: arquivo (não pasta) com permissão de executar.
// Devolve null se estiver tudo certo, ou o motivo: 'nao-existe' ou
// 'nao-executavel'.
function problemaDe(abs) {
  let st;
  try { st = fs.statSync(abs); } catch { return 'nao-existe'; }
  if (!st.isFile()) return 'nao-executavel';
  try { fs.accessSync(abs, fs.constants.X_OK); return null; } catch { return 'nao-executavel'; }
}

// Caminho escolhido na engrenagem para esta IA (iasCaminhos da config), já
// com ~ expandido; só caminho absoluto conta.
function caminhoEscolhido(id, caminhos) {
  const v = caminhos && typeof caminhos === 'object' ? caminhos[id] : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const abs = v.trim().replace(/^~(?=$|\/)/, os.homedir());
  return path.isAbsolute(abs) ? path.normalize(abs) : null;
}

// O que rodar para esta IA: o caminho escolhido, se existir e for
// executável; senão o nome do comando, achado no PATH por quem roda (como
// era antes de haver a escolha). Nunca vai por shell.
function comando(id, caminhos) {
  const c = CANDIDATOS.find((x) => x.id === id);
  const escolhido = caminhoEscolhido(id, caminhos);
  if (escolhido && !problemaDe(escolhido)) return escolhido;
  return c ? c.comando : id;
}

// caminhos: { [id]: '/caminho/absoluto' } escolhidos na engrenagem. Com um
// caminho escolhido e válido, ele é o usado; inválido, o cartão diz o motivo e
// a detecção volta ao PATH (o mesmo que comando() faz na hora de rodar).
async function detectar(env, caminhos) {
  return Promise.all(CANDIDATOS.map(async (c) => {
    const escolhido = caminhoEscolhido(c.id, caminhos);
    const problema = escolhido ? problemaDe(escolhido) : null;
    let caminho = escolhido && !problema ? escolhido : acharNoPath(c.comando, env);
    // Pelo outro nome (ex.: "agent" do Cursor): só o arquivo de verdade da instalação
    // conhecida, com a impressão digital tirada antes de ele rodar.
    const outro = caminho ? null : peloOutroNome(c.id, env);
    const sha256 = outro ? await impressaoDe(outro) : null;
    if (outro) caminho = outro;
    const versao = caminho ? await perguntarVersao(caminho, env) : null;
    const r = { id: c.id, nome: c.nome, comando: c.comando, encontrado: !!caminho, caminho, versao, suportado: c.suportado };
    if (escolhido) Object.assign(r, { escolhido, problema });
    if (outro) Object.assign(r, { via: OUTRO_NOME[c.id].comando, sha256 });
    return r;
  }));
}

let cache = null; // { em, chave, lista }
let andando = null; // detecção em curso: quem pedir junto espera a mesma
// forcar: o botão "Detectar de novo" (ignora o que está guardado).
// Trocar um caminho escolhido invalida o que está guardado.
async function listar({ env = process.env, forcar = false, caminhos = {} } = {}) {
  const chave = JSON.stringify(caminhos || {});
  if (!forcar && cache && cache.chave === chave && Date.now() - cache.em < VALIDADE) return cache.lista;
  if (!andando || andando.chave !== chave) {
    const p = detectar(env, caminhos).then((lista) => { cache = { em: Date.now(), chave, lista }; return lista; }).finally(() => { if (andando === p) andando = null; });
    p.chave = chave;
    andando = p;
  }
  return andando;
}

// A IA que vai de fato rodar: a escolhida, se o app souber conduzi-la e ela
// estiver instalada; senão o Claude.
function efetiva(escolhida, lista) {
  const c = (lista || []).find((x) => x.id === escolhida);
  return c && c.suportado && c.encontrado ? c.id : PADRAO;
}

module.exports = { CANDIDATOS, IDS, PADRAO, listar, efetiva, versaoDe, acharNoPath, comando, caminhoEscolhido, problemaDe, _limpar: () => { cache = null; } };
