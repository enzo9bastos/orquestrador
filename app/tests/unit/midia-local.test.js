// Área: conversa (imagem, GIF e vídeo do computador mostrados na conversa)
// Pedido de 26/11: "seria bom ele mesmo poder mandar em tela cheia ou prévia imagens, vídeos, gifs,
// aí eu vejo pelo próprio app, ao invés de ele ficar abrindo na minha tela". Aqui a regra do que o
// app aceita servir à tela (midia-local.js), o --mostrar do script do agente e o aviso ao
// orquestrador quando o recado traz mídia.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pastaTemporaria } = require('../temporarias');

const casa = pastaTemporaria('orq-midia-');
process.env.HOME = casa;
const M = require('../../midia-local');
const recados = require('../../recados');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(16)]);
const grava = (rel, dados) => { const a = path.join(casa, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, dados); return a; };
const fora = pastaTemporaria('orq-midia-fora-'); // fica na pasta temporária: também vale

test('o que pode ser mostrado: imagem e vídeo de verdade, da pasta pessoal ou da temporária', () => {
  const png = grava('projeto/tela.png', PNG);
  const gif = grava('projeto/anim.gif', GIF);
  const mp4 = grava('projeto/demo.mp4', MP4);
  assert.deepStrictEqual([M.validar(png).ok, M.validar(png).tipo, M.validar(png).mime], [true, 'imagem', 'image/png']);
  assert.strictEqual(M.validar(gif).mime, 'image/gif');
  assert.deepStrictEqual([M.validar(mp4).tipo, M.validar(mp4).mime], ['video', 'video/mp4']);
  assert.strictEqual(M.validar('~/projeto/tela.png').real, fs.realpathSync(png), '"~/" é a pasta pessoal');
  const tmp = path.join(fora, 'x.gif');
  fs.writeFileSync(tmp, GIF);
  assert.strictEqual(M.validar(tmp).ok, true);
});

test('o que não pode: caminho incompleto, outro tipo, conteúdo falso, fora da pasta, pastas de chaves, pasta, link para fora', () => {
  const motivo = (p, o) => M.validar(p, o).motivo;
  assert.match(motivo('projeto/tela.png'), /caminho precisa ser completo/);
  assert.match(motivo(grava('projeto/nota.txt', 'oi')), /só imagem/);
  assert.match(motivo(grava('projeto/falso.png', 'não sou imagem')), /não bate com a extensão/);
  assert.match(motivo(grava('projeto/falso.mp4', 'nem vídeo')), /não bate com a extensão/);
  assert.match(motivo(grava('.ssh/chave.png', PNG)), /pasta protegida/);
  assert.match(motivo(grava('.config/BraveSoftware/x.png', PNG)), /pasta protegida/);
  assert.match(motivo(path.join(casa, 'nao-existe.png')), /não encontrado/);
  fs.mkdirSync(path.join(casa, 'pasta.png'), { recursive: true });
  assert.match(motivo(path.join(casa, 'pasta.png')), /não é um arquivo/);
  // Fora da pasta pessoal e da temporária (aqui as duas são trocadas por pastas de teste).
  const outra = pastaTemporaria('orq-midia-outra-');
  const casaTeste = pastaTemporaria('orq-midia-casa-');
  const img = path.join(outra, 'x.png');
  fs.writeFileSync(img, PNG);
  assert.match(motivo(img, { casa: casaTeste, tmp: casaTeste }), /só arquivos da sua pasta pessoal/);
  // Um link dentro da casa apontando para fora vale pelo destino.
  fs.symlinkSync(img, path.join(casaTeste, 'link.png'));
  assert.match(motivo(path.join(casaTeste, 'link.png'), { casa: casaTeste, tmp: casaTeste }), /só arquivos da sua pasta pessoal/);
});

test('o endereço da tela leva o caminho e volta igual, com acento e espaço', () => {
  const p = '/home/pessoa/Vídeos/minha animação (1).gif';
  assert.strictEqual(M.caminhoDaUrl(M.url(p)), p);
  assert.throws(() => M.caminhoDaUrl('orqmidia://outro/x'), /endereço inválido/);
});

const SCRIPT = path.join(__dirname, '../../../hooks/orq-recado.sh');
const agente = (dir, args) => spawnSync('bash', [SCRIPT, ...args], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: '' }, encoding: 'utf8' });

test('script do agente: --mostrar põe a linha ![nome](/caminho completo) no recado; arquivo que não existe ou não é mídia, o recado não sai', () => {
  const dir = path.join(casa, 'proj-mostrar');
  fs.mkdirSync(dir, { recursive: true });
  grava('proj-mostrar/saida/anim.gif', GIF);
  grava('proj-mostrar/demo.mp4', MP4);
  const r = agente(dir, ['enviar', 'a primeira animação está pronta', '--mostrar', 'saida/anim.gif', '--mostrar', path.join(dir, 'demo.mp4')]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const [arq] = fs.readdirSync(path.join(dir, '.orq/recados/saida'));
  const m = JSON.parse(fs.readFileSync(path.join(dir, '.orq/recados/saida', arq), 'utf8'));
  assert.strictEqual(m.texto, `a primeira animação está pronta\n![anim.gif](${path.join(dir, 'saida/anim.gif')})\n![demo.mp4](${path.join(dir, 'demo.mp4')})`);
  const sem = agente(dir, ['enviar', 'veja', '--mostrar', 'nao-existe.gif']);
  assert.notStrictEqual(sem.status, 0);
  assert.match(sem.stdout, /recado NÃO enviado: --mostrar: arquivo não encontrado/);
  grava('proj-mostrar/notas.txt', 'x');
  assert.match(agente(dir, ['enviar', 'veja', '--mostrar', 'notas.txt']).stdout, /só aceita imagem .* ou vídeo/);
  assert.strictEqual(fs.readdirSync(path.join(dir, '.orq/recados/saida')).length, 1, 'os recusados não deixaram nada');
});

test('o recado com mídia avisa o orquestrador que o usuário já vê e como mostrar outra; sem mídia, nada muda', () => {
  const base = { id: 'r1', de: { tipo: 'agente', nome: 'Agente 3', alvo: 'site' }, para: { tipo: 'orquestrador' }, tipo: 'aviso' };
  const com = recados.embrulho({ ...base, texto: 'pronta\n![anim.gif](/home/pessoa/site/anim.gif)' });
  assert.match(com, /As linhas !\[nome\]\(\/caminho\) acima o usuário já vê no app/);
  assert.match(com, /!\[anim\.gif\]\(\/home\/pessoa\/site\/anim\.gif\)/, 'a linha chega inteira ao orquestrador');
  assert.doesNotMatch(recados.embrulho({ ...base, texto: 'sem nada para ver' }), /já vê no app/);
});
