// Área: repertorio
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria, escrever } = require('../ajuda');

const casa = casaTemporaria({ fontesRepertorio: [{ nome: 'Claude', ferramenta: 'claude', caminho: '~/c' }, { nome: 'Outra', ferramenta: 'agentes', caminho: '~/o' }] });
escrever(casa, 'c/revisar/SKILL.md', '---\nname: revisar\ndescription: Revisa o texto\n---\n# Revisar\n');
escrever(casa, 'o/publicar/SKILL.md', '---\nname: publicar\ndescription: "Publica"\n---\ncorpo\n');
escrever(casa, 'o/sem-skill/LEIA.md', 'não é skill');
const repertorio = require('../../repertorio');

test('repertorio: junta as skills das duas ferramentas, com fonte e descrição', () => {
  const l = repertorio.lista();
  assert.deepStrictEqual(l.skills.map((s) => [s.id, s.fonte, s.descricao]), [['agentes:publicar', 'Outra', 'Publica'], ['claude:revisar', 'Claude', 'Revisa o texto']]);
  assert.match(repertorio.conteudo('agentes:publicar'), /corpo/);
});

test('repertorio: atalhos gravam normalizados e guardam a versão anterior', () => {
  repertorio.gravarAtalhos([{ nome: 'Antes e Depois', texto: 'faça o antes x depois', tecla: '3', enviar: true }]);
  const l = repertorio.gravarAtalhos([...repertorio.atalhos(), { nome: 'x', texto: '' }]);
  assert.deepStrictEqual(l.map((a) => [a.nome, a.tecla, a.enviar]), [['antes-e-depois', '3', true]], 'sem texto não entra');
  assert.ok(fs.readdirSync(path.join(casa, '.local/share/orq-app/versoes/repertorio')).length >= 1);
});
