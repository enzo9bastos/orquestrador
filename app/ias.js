// IAs conectadas: acha as ferramentas de IA de linha de comando (CLIs) que
// estão no PATH do app, com a versão de cada uma. Primeiro passo para o app
// conduzir agentes de outras IAs além do Claude Code: por enquanto só o
// Claude sabe ser o orquestrador (conversa.js); as outras aparecem na lista.
//
// Cada candidato roda só com --version, sem shell, com tempo curto e o
// ambiente das conversas. Da saída fica só o número da versão: nada do que a
// ferramenta imprimir (que pode ter conta, chave ou caminho) vai para a tela.
const fs = require('fs');
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

async function detectar(env) {
  return Promise.all(CANDIDATOS.map(async (c) => {
    const caminho = acharNoPath(c.comando, env);
    const versao = caminho ? await perguntarVersao(caminho, env) : null;
    return { id: c.id, nome: c.nome, comando: c.comando, encontrado: !!caminho, caminho, versao, suportado: c.suportado };
  }));
}

let cache = null; // { em, lista }
let andando = null; // detecção em curso: quem pedir junto espera a mesma
// forcar: o botão "Detectar de novo" (ignora o que está guardado).
async function listar({ env = process.env, forcar = false } = {}) {
  if (!forcar && cache && Date.now() - cache.em < VALIDADE) return cache.lista;
  if (!andando) {
    andando = detectar(env).then((lista) => { cache = { em: Date.now(), lista }; return lista; }).finally(() => { andando = null; });
  }
  return andando;
}

// A IA que vai de fato rodar: a escolhida, se o app souber conduzi-la e ela
// estiver instalada; senão o Claude (o único ligado hoje).
function efetiva(escolhida, lista) {
  const c = (lista || []).find((x) => x.id === escolhida);
  return c && c.suportado && c.encontrado ? c.id : PADRAO;
}

module.exports = { CANDIDATOS, IDS, PADRAO, listar, efetiva, versaoDe, acharNoPath, _limpar: () => { cache = null; } };
