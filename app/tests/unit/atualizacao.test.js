// Área: atualizacao (atualizar pelo app: procurar a última versão lançada, o que mudou e aplicar)
// Pedido de 24/11: o app avisa quando sai versão nova e atualiza a pedido. Sem rede: o remoto dos
// testes é uma pasta (repo-falso.js).
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { criar, git, AMB } = require('./repo-falso');

Object.assign(process.env, { GIT_CONFIG_GLOBAL: AMB.GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM: AMB.GIT_CONFIG_SYSTEM });
const A = require('../../atualizacao');
const versaoNoDisco = (r) => JSON.parse(fs.readFileSync(path.join(r.app, 'package.json'), 'utf8')).version;

test('atualização: na última versão, nada a oferecer; sem buscar, não vê o que saiu depois', async () => {
  const r = criar(pastaTemporaria('orq-atualiza-'));
  let p = await A.procurar(r.app);
  assert.deepStrictEqual({ instalada: p.instalada, ultima: p.ultima, pode: p.pode, motivo: p.motivo, erro: p.erro }, { instalada: '0.1.0', ultima: null, pode: false, motivo: 'em-dia', erro: null });
  r.publicar('0.2.0');
  p = await A.procurar(r.app, { buscar: false });
  assert.strictEqual(p.ultima, null, 'sem buscar no remoto, a pasta ainda não sabe da 0.2.0');
  p = await A.procurar(r.app);
  assert.deepStrictEqual(p.ultima, { versao: '0.2.0', tag: 'v0.2.0' });
});

test('atualização: acha a última versão lançada, traz o que mudou de cada versão no caminho e aplica', async () => {
  const r = criar(pastaTemporaria('orq-atualiza-'));
  r.publicar('0.2.0', ['Second version, first item', 'Second item']);
  r.publicar('0.10.0', ['Tenth: a long item that\n  continues on the next line', 'Another']);
  const p = await A.procurar(r.app);
  assert.deepStrictEqual(p.ultima, { versao: '0.10.0', tag: 'v0.10.0' }, 'a 0.10.0 é maior que a 0.2.0 (número, não texto)');
  assert.deepStrictEqual(p.notas.map((n) => [n.versao, n.itens]), [
    ['0.10.0', ['Tenth: a long item that continues on the next line', 'Another']],
    ['0.2.0', ['Second version, first item', 'Second item']],
  ], 'só as versões acima da instalada, a mais nova primeiro');
  assert.strictEqual(p.notas[0].data, '2026-01-09');
  assert.deepStrictEqual({ pode: p.pode, motivo: p.motivo, comando: p.comando }, { pode: true, motivo: null, comando: null });
  assert.strictEqual(versaoNoDisco(r), '0.1.0', 'procurar não muda a pasta');
  assert.deepStrictEqual(await A.aplicar(r.app, '0.10.0'), { ok: true, versao: '0.10.0' });
  assert.strictEqual(versaoNoDisco(r), '0.10.0');
  assert.strictEqual(git(r.instalada, 'rev-parse', 'HEAD'), git(r.instalada, 'rev-parse', 'v0.10.0^{commit}'));
  assert.strictEqual(git(r.instalada, 'symbolic-ref', '--short', 'HEAD'), 'main', 'continua no ramo');
  const d = await A.procurar(r.app);
  assert.deepStrictEqual({ instalada: d.instalada, ultima: d.ultima, motivo: d.motivo }, { instalada: '0.10.0', ultima: null, motivo: 'em-dia' });
});

test('atualização: só vale versão lançada no ramo publicado (tag solta, fora do ramo, não conta)', async () => {
  const r = criar(pastaTemporaria('orq-atualiza-'));
  r.publicar('9.9.9', ['Not on the published branch'], { semRamo: true });
  const p = await A.procurar(r.app);
  assert.strictEqual(git(r.instalada, 'tag', '--list', 'v9.9.9'), 'v9.9.9', 'a tag chegou');
  assert.deepStrictEqual({ ultima: p.ultima, motivo: p.motivo }, { ultima: null, motivo: 'em-dia' });
});

test('atualização: arquivo do app mexido à mão: avisa, não aplica e não toca no arquivo; arquivo novo solto não atrapalha', async () => {
  const r = criar(pastaTemporaria('orq-atualiza-'));
  r.publicar('0.2.0');
  fs.writeFileSync(path.join(r.app, 'anotacao-minha.txt'), 'solto');
  assert.strictEqual((await A.procurar(r.app)).pode, true, 'arquivo novo, fora do git, não impede');
  fs.writeFileSync(path.join(r.app, 'main.js'), '// mexido por mim\n');
  const p = await A.procurar(r.app);
  assert.deepStrictEqual({ ultima: p.ultima.versao, pode: p.pode, motivo: p.motivo }, { ultima: '0.2.0', pode: false, motivo: 'mexido' });
  assert.match(p.comando, /git status$/);
  assert.deepStrictEqual(await A.aplicar(r.app, '0.2.0'), { erro: 'mexido' });
  assert.strictEqual(fs.readFileSync(path.join(r.app, 'main.js'), 'utf8'), '// mexido por mim\n');
  assert.strictEqual(versaoNoDisco(r), '0.1.0');
});

test('atualização: pasta com commits próprios (não é avanço simples) e versão que muda as dependências: não aplica, mostra o comando', async () => {
  const a = criar(pastaTemporaria('orq-atualiza-'));
  a.publicar('0.2.0');
  fs.writeFileSync(path.join(a.app, 'meu.js'), '// meu\n');
  git(a.instalada, 'add', '-A'); git(a.instalada, 'commit', '-qm', 'meu commit');
  const p = await A.procurar(a.app);
  assert.deepStrictEqual({ pode: p.pode, motivo: p.motivo }, { pode: false, motivo: 'nao-avanco' });
  assert.deepStrictEqual(await A.aplicar(a.app, '0.2.0'), { erro: 'nao-avanco' });

  const b = criar(pastaTemporaria('orq-atualiza-'));
  b.publicar('0.2.0', ['New dependency'], { trava: true });
  const q = await A.procurar(b.app);
  assert.deepStrictEqual({ pode: q.pode, motivo: q.motivo }, { pode: false, motivo: 'dependencias' });
  assert.match(q.comando, /git merge --ff-only v0\.2\.0 && cd .*app\/? && npm install$/);
  assert.deepStrictEqual(await A.aplicar(b.app, '0.2.0'), { erro: 'dependencias' });
  assert.strictEqual(versaoNoDisco(b), '0.1.0');
});

test('atualização: pedir uma versão que não é mais a última não aplica nada', async () => {
  const r = criar(pastaTemporaria('orq-atualiza-'));
  r.publicar('0.2.0');
  await A.procurar(r.app);
  assert.deepStrictEqual(await A.aplicar(r.app, '0.3.0'), { erro: 'mudou' });
  assert.deepStrictEqual(await A.aplicar(r.app, '0.2.0; echo x'), { erro: 'mudou' });
  assert.strictEqual(versaoNoDisco(r), '0.1.0');
});

test('atualização: sem git, sem ramo publicado e sem resposta do remoto: diz o motivo, sem inventar versão', async () => {
  const solta = pastaTemporaria('orq-atualiza-');
  fs.writeFileSync(path.join(solta, 'package.json'), '{ "version": "0.1.0" }');
  let p = await A.procurar(solta);
  assert.deepStrictEqual({ ultima: p.ultima, pode: p.pode, motivo: p.motivo }, { ultima: null, pode: false, motivo: 'sem-git' });

  const local = pastaTemporaria('orq-atualiza-');
  git(local, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(local, 'package.json'), '{ "version": "0.1.0" }');
  git(local, 'add', '-A'); git(local, 'commit', '-qm', 'um');
  p = await A.procurar(local);
  assert.strictEqual(p.motivo, 'sem-origem');

  const r = criar(pastaTemporaria('orq-atualiza-'));
  git(r.instalada, 'remote', 'set-url', 'origin', path.join(r.remoto, 'nao-existe'));
  p = await A.procurar(r.app);
  assert.deepStrictEqual({ ultima: p.ultima, motivo: p.motivo, temErro: !!p.erro }, { ultima: null, motivo: 'sem-rede', temErro: true });
});

test('atualização: o que o git disse aparece em uma linha e sem usuário e senha do endereço', () => {
  assert.strictEqual(A._semSegredo("aviso\nfatal: unable to access 'https://fulano:ghp_segredo123@exemplo.test/x.git/': não deu\n"), "fatal: unable to access 'https://exemplo.test/x.git/': não deu");
  assert.strictEqual(A._semSegredo(''), '');
});

test('atualização: comparação de versões e leitura do CHANGELOG', () => {
  assert.ok(A.compara('0.10.0', '0.9.9') > 0 && A.compara('v1.0.0', '0.99.99') > 0 && A.compara('0.2.0', '0.2.0') === 0);
  assert.strictEqual(A.compara('lixo', '0.1.0'), 0);
  const notas = A._lerNotas('# Changelog\n\n## 0.3.0 (2026-02-02)\n\n- A\n- B\n  more\n\n## 0.2.0 (2026-01-01)\n\n- C\n\n## 0.1.0\n\n- D\n', '0.1.0', '0.3.0');
  assert.deepStrictEqual(notas, [{ versao: '0.3.0', data: '2026-02-02', itens: ['A', 'B more'] }, { versao: '0.2.0', data: '2026-01-01', itens: ['C'] }]);
  assert.deepStrictEqual(A._lerNotas('## 0.4.0\n\n- X\n\n## 0.3.0\n\n- Y\n', '0.1.0', '0.3.0').map((n) => n.versao), ['0.3.0'], 'nada acima da versão pedida');
});
