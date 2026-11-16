// Recarregar a tela ao vivo: quando um arquivo de renderer/ muda, a janela só
// recarrega sozinha se a pasta estiver igual ao último commit — é o caso do
// publicar.sh, que grava o código já commitado. Arquivo mudado ou plantado
// por fora (sem commit) não roda sozinho na janela; também não recarrega no
// meio de uma publicação ainda pela metade. Sem git: não recarrega sozinho.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function publicado(pasta) {
  return new Promise((ok) => {
    execFile('git', ['status', '--porcelain', '--untracked-files=all', '--', '.'], { cwd: pasta, timeout: 5000 }, (erro, saida) => {
      ok(!erro && String(saida).trim() === '');
    });
  });
}

// O código que NÃO é da tela (processo principal, ponte, módulos): a lista do
// último commit da pasta do app, sem a pasta renderer/. A tela só pode
// recarregar sozinha se isto estiver igual ao que estava quando o app abriu:
// tela nova com processo principal antigo deixa os dois falando formatos
// diferentes (16/11: a tela esperava os envios em lote e o processo antigo
// mandava um a um; as mensagens sumiram da tela até reiniciar).
function versaoDoPrincipal(pastaApp) {
  return new Promise((ok) => {
    execFile('git', ['ls-tree', 'HEAD', '.'], { cwd: pastaApp, timeout: 5000 }, (erro, saida) => {
      if (erro) return ok(null);
      ok(String(saida).split('\n').filter((l) => l && !/\trenderer$/.test(l)).join('\n'));
    });
  });
}

// Publicação que muda SÓ o código de fora da tela (main.js, conversa.js,
// bin/…) não mexe em renderer/, e a vigia da tela não dispara: o app ficava
// velho sem avisar. Esta parte vigia o HEAD do git e pede o reinício quando o
// código de fora da tela ficou diferente do que estava ao abrir.

// A pasta do git (absoluta) do repositório do app; null sem git. Num worktree
// é a pasta própria dele (.git/worktrees/<nome>), onde mora o logs/HEAD dele.
function pastaGit(pasta) {
  return new Promise((ok) => {
    execFile('git', ['rev-parse', '--absolute-git-dir'], { cwd: pasta, timeout: 5000 }, (erro, saida) => {
      ok(erro ? null : (String(saida).trim() || null));
    });
  });
}

// Marcas de uma operação do git pela metade (índice travado, merge, rebase,
// cherry-pick, revert): enquanto alguma existir, não decide nada.
const MARCAS_DE_OPERACAO = ['index.lock', 'MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
async function gitOcupado(dirGit) {
  for (const marca of MARCAS_DE_OPERACAO) {
    try { await fs.promises.access(path.join(dirGit, marca)); return true; } catch { /* não está */ }
  }
  return false;
}

// A decisão, sem efeito colateral:
//   'nada'       igual ao que estava ao abrir, ou sem git para saber;
//   'esperar'    o git está trabalhando, ou a pasta do app ainda não bate com
//                o commit (gravação pela metade, mudança à mão);
//   'reiniciar'  o código de fora da tela mudou e já está inteiro no disco.
function decidirPrincipal({ inicio, agora, publicado: igualAoCommit, ocupado }) {
  if (ocupado) return 'esperar';
  if (inicio == null || agora == null) return 'nada';
  if (agora === inicio) return 'nada';
  return igualAoCommit ? 'reiniciar' : 'esperar';
}

// Junta os fatos (tudo por execFile/fs.promises: nada trava o processo
// principal) e devolve a decisão acima.
async function conferirPrincipal({ pastaApp, dirGit, inicio }) {
  if (dirGit && await gitOcupado(dirGit)) return 'esperar';
  const [agora, igual] = await Promise.all([versaoDoPrincipal(pastaApp), publicado(pastaApp)]);
  return decidirPrincipal({ inicio: await inicio, agora, publicado: igual, ocupado: false });
}

// Vigia o logs/HEAD do git: ele ganha uma linha a cada commit, merge, pull ou
// checkout, e só nessa hora o app confere (nada de conferir de tempos em
// tempos). Parado, não custa nada. Depois do evento espera esperaMs e tenta
// até `tentativas` vezes, de intervaloMs em intervaloMs, enquanto a decisão
// for 'esperar'. inicio: a versaoDoPrincipal de quando o app abriu (valor ou
// promessa). Devolve a função que para a vigia.
function vigiarPrincipal({ pastaApp, inicio, aoMudar, esperaMs = 400, tentativas = 30, intervaloMs = 1000 }) {
  let parado = false;
  let observador = null;
  let dirGit = null;
  let rodada = null;
  const conferir = () => {
    const minha = Symbol('principal');
    rodada = minha;
    setTimeout(async () => {
      for (let i = 0; i < tentativas && rodada === minha && !parado; i++) {
        const decisao = await conferirPrincipal({ pastaApp, dirGit, inicio });
        if (rodada !== minha || parado) return;
        if (decisao === 'reiniciar') { aoMudar(); return; }
        if (decisao === 'nada') return;
        await new Promise((r) => setTimeout(r, intervaloMs));
      }
    }, esperaMs);
  };
  pastaGit(pastaApp).then((dir) => {
    if (!dir || parado) return;
    dirGit = dir;
    try {
      observador = fs.watch(path.join(dir, 'logs'), (_tipo, nome) => { if (!nome || String(nome) === 'HEAD') conferir(); });
      observador.on('error', () => { /* pasta sumiu: fica sem vigia */ });
    } catch { /* sem logs/ (reflog desligado): fica sem vigia */ }
  });
  return () => { parado = true; rodada = null; if (observador) observador.close(); };
}

module.exports = { publicado, versaoDoPrincipal, decidirPrincipal, conferirPrincipal, vigiarPrincipal };
