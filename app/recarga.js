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

module.exports = { publicado };
