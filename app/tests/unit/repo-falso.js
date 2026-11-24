// Repositórios falsos para os testes da atualização pelo app (atualizacao.test.js e
// e2e/atualizacao.e2e.js): um "remoto" numa pasta, quem publica e a pasta instalada. Sem rede: o
// remoto é um caminho no disco. Cada versão publicada ganha o package.json, a entrada no CHANGELOG
// e a tag vX.Y.Z, como o publicar de verdade faz.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AMB = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (d, ...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe', env: AMB }).toString().trim();

// criar(dir, '0.1.0') → { remoto, publica, instalada, app, publicar(versao, itens, { trava }), git }
function criar(dir, versao = '0.1.0') {
  const remoto = path.join(dir, 'remoto.git'), publica = path.join(dir, 'publica'), instalada = path.join(dir, 'instalada');
  git(dir, 'init', '-q', '--bare', '-b', 'main', remoto);
  git(dir, 'clone', '-q', remoto, publica);
  fs.mkdirSync(path.join(publica, 'app'));
  fs.writeFileSync(path.join(publica, 'app', 'package-lock.json'), '{ "lockfileVersion": 3, "dependencias": 1 }\n');
  fs.writeFileSync(path.join(publica, 'app', 'main.js'), '// app\n');
  fs.writeFileSync(path.join(publica, 'CHANGELOG.md'), '# Changelog\n\nWhat changed in each version.\n');
  const publicar = (v, itens = [`Change of ${v}`], { trava = false, ramo = 'main', semRamo = false } = {}) => {
    fs.writeFileSync(path.join(publica, 'app', 'package.json'), JSON.stringify({ name: 'app', version: v }, null, 2) + '\n');
    if (trava) fs.writeFileSync(path.join(publica, 'app', 'package-lock.json'), `{ "lockfileVersion": 3, "dependencias": "${v}" }\n`);
    const log = fs.readFileSync(path.join(publica, 'CHANGELOG.md'), 'utf8');
    const corte = log.indexOf('\n## ');
    const entrada = `\n## ${v} (2026-01-0${Math.min(9, Number(v.split('.')[1]) + 1)})\n\n${itens.map((i) => `- ${i}`).join('\n')}\n`;
    fs.writeFileSync(path.join(publica, 'CHANGELOG.md'), corte < 0 ? log + entrada : log.slice(0, corte) + entrada + log.slice(corte));
    git(publica, 'add', '-A');
    git(publica, 'commit', '-qm', `Release v${v}`);
    git(publica, 'tag', '-a', `v${v}`, '-m', `v${v}`);
    if (!semRamo) git(publica, 'push', '-q', 'origin', `HEAD:${ramo}`);
    git(publica, 'push', '-q', 'origin', `v${v}`);
  };
  publicar(versao, ['First version']);
  git(dir, 'clone', '-q', remoto, instalada);
  return { remoto, publica, instalada, app: path.join(instalada, 'app'), publicar, git };
}

module.exports = { criar, git, AMB };
