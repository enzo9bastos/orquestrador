// IAs conectadas: acha as ferramentas de IA de linha de comando (CLIs) que
// estão no PATH do app (ou no caminho escolhido na engrenagem), com a versão
// de cada uma. Primeiro passo para o app
// conduzir agentes de outras IAs além do Claude Code: por enquanto só o
// Claude sabe ser o orquestrador (conversa.js); as outras aparecem na lista.
//
// Cada candidato roda só com --version, sem shell, com tempo curto e o
// ambiente das conversas. Da saída fica só o número da versão: nada do que a
// ferramenta imprimir (que pode ter conta, chave ou caminho) vai para a tela.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// suportado: o app já sabe conduzir esta IA como orquestrador.
const CANDIDATOS = [
  { id: 'claude', nome: 'Claude Code', comando: 'claude', suportado: true },
  { id: 'codex', nome: 'Codex CLI', comando: 'codex', suportado: false },
  { id: 'gemini', nome: 'Gemini CLI', comando: 'gemini', suportado: false },
  { id: 'opencode', nome: 'OpenCode', comando: 'opencode', suportado: false },
  { id: 'cursor', nome: 'Cursor CLI', comando: 'cursor-agent', suportado: false },
  { id: 'aider', nome: 'Aider', comando: 'aider', suportado: false },
  { id: 'qwen', nome: 'Qwen Code', comando: 'qwen', suportado: false },
];
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
    const caminho = escolhido && !problema ? escolhido : acharNoPath(c.comando, env);
    const versao = caminho ? await perguntarVersao(caminho, env) : null;
    const r = { id: c.id, nome: c.nome, comando: c.comando, encontrado: !!caminho, caminho, versao, suportado: c.suportado };
    if (escolhido) Object.assign(r, { escolhido, problema });
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
// estiver instalada; senão o Claude (o único ligado hoje).
function efetiva(escolhida, lista) {
  const c = (lista || []).find((x) => x.id === escolhida);
  return c && c.suportado && c.encontrado ? c.id : PADRAO;
}

module.exports = { CANDIDATOS, IDS, PADRAO, listar, efetiva, versaoDe, acharNoPath, comando, caminhoEscolhido, problemaDe, _limpar: () => { cache = null; } };
