// Área: repertorio
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria, escrever } = require('../ajuda');

const casa = casaTemporaria({ detectarFerramentas: false, fontesRepertorio: [{ nome: 'Claude', ferramenta: 'claude', caminho: '~/c' }, { nome: 'Outra', ferramenta: 'agentes', caminho: '~/o' }] });
escrever(casa, 'c/revisar/SKILL.md', '---\nname: revisar\ndescription: Revisa o texto\n---\n# Revisar\n');
escrever(casa, 'o/publicar/SKILL.md', '---\nname: publicar\ndescription: "Publica"\n---\ncorpo\n');
escrever(casa, 'o/sem-skill/LEIA.md', 'não é skill');
const repertorio = require('../../repertorio');

test('repertorio: junta as skills das duas ferramentas, com fonte e descrição', () => {
  const l = repertorio.lista();
  assert.deepStrictEqual(l.skills.map((s) => [s.id, s.fonte, s.descricao]), [['agentes:skill:publicar', 'Outra', 'Publica'], ['claude:skill:revisar', 'Claude', 'Revisa o texto']]);
  assert.match(repertorio.conteudo('agentes:skill:publicar'), /corpo/);
});

test('repertorio: atalhos gravam normalizados e guardam a versão anterior', () => {
  repertorio.gravarAtalhos([{ nome: 'Antes e Depois', texto: 'faça o antes x depois', tecla: '3', enviar: true }]);
  const l = repertorio.gravarAtalhos([...repertorio.atalhos(), { nome: 'x', texto: '' }]);
  assert.deepStrictEqual(l.map((a) => [a.nome, a.tecla, a.enviar]), [['antes-e-depois', '3', true]], 'sem texto não entra');
  assert.ok(fs.readdirSync(path.join(casa, '.local/share/orq-app/versoes/repertorio')).length >= 1);
});

test('repertorio: acha sozinho o que foi criado em cada ferramenta de IA', () => {
  const { casaTemporaria: nova, escrever: esc } = require('../ajuda');
  const c = nova({});
  esc(c, '.claude/skills/minha/SKILL.md', '---\nname: minha\ndescription: d\n---\n');
  esc(c, '.claude/commands/git/push.md', '---\ndescription: Envia\n---\nfaça o push');
  esc(c, '.claude/agents/revisor.md', '---\nname: revisor\ndescription: Revisa código\n---\nvocê revisa');
  esc(c, '.codex/prompts/resumo.md', 'Resuma o texto');
  esc(c, '.gemini/commands/teste.toml', 'description = "Roda os testes"\nprompt = """\nrode npm test\n"""\n');
  esc(c, '.codeium/windsurf/global_workflows/deploy.md', '# Deploy');
  delete require.cache[require.resolve('../../config')];
  delete require.cache[require.resolve('../../repertorio')];
  const r = require('../../repertorio');
  const l = r.lista();
  const por = Object.fromEntries(l.conectadas.map((x) => [x.ferramenta, x.tipos]));
  assert.deepStrictEqual(por, { claude: { skill: 1, comando: 1, subagente: 1 }, codex: { prompt: 1 }, gemini: { comando: 1 }, windsurf: { workflow: 1 } });
  assert.ok(l.skills.some((s) => s.nome === 'git:push' && s.descricao === 'Envia'), 'comando aninhado vira pasta:nome');
  assert.strictEqual(r.conteudo('gemini:comando:teste'), 'rode npm test', 'do TOML vem o prompt');
});
