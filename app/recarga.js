// Recarregar a tela ao vivo: quando um arquivo de renderer/ muda, a janela só
// recarrega sozinha se a pasta estiver igual ao último commit — é o caso do
// publicar.sh, que grava o código já commitado. Arquivo mudado ou plantado
// por fora (sem commit) não roda sozinho na janela; também não recarrega no
// meio de uma publicação ainda pela metade. Sem git: não recarrega sozinho.
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

module.exports = { publicado, versaoDoPrincipal };
