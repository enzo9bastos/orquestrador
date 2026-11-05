// Área: voltar (conversa: voltar para antes de uma mensagem)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirApp } = require('./app');

// Claude falso: anota os argumentos de cada vez que sobe e responde ao init.
function claudeFalso() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-claude-falso-'));
  const log = path.join(d, 'args.log');
  const bin = path.join(d, 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
echo "$*" >> "${log}"
# Como o Claude de verdade: --resume mantém a sessão; com --fork-session nasce outra.
sessao="S-nova-$$"; ant=""
for a in "$@"; do [ "$ant" = "--resume" ] && sessao="$a"; ant="$a"; done
case " $* " in *" --fork-session "*) sessao="S-nova-$$" ;; esac
echo '{"type":"system","subtype":"init","session_id":"'"$sessao"'","model":"falso","cwd":"/"}'
cat > /dev/null
`, { mode: 0o755 });
  return { bin, chamadas: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}

test('voltar a conversa para antes de uma mensagem', async (t) => {
  const falso = claudeFalso();
  const app = await abrirApp({
    config: { iasCaminhos: { claude: falso.bin } },
    arquivos: { '.cache/orq-app/conversas-teste.json': JSON.stringify([{ id: 'orquestrador', titulo: 'Orquestrador', sessao: 'S1', orquestrador: true }]) },
  });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  // Histórico do Claude: três mensagens do usuário, cada uma com resposta.
  const l = (o) => JSON.stringify(o);
  const projeto = app.casa.replace(/[^A-Za-z0-9]/g, '-');
  fs.mkdirSync(path.join(app.casa, '.claude/projects', projeto), { recursive: true });
  app.escrever(`.claude/projects/${projeto}/S1.jsonl`, [
    l({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'primeira pergunta' } }),
    l({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta um' }] } }),
    l({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'me diz onde t' } }),
    l({ type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'chegou cortada' }] } }),
    l({ type: 'user', uuid: 'u3', message: { role: 'user', content: 'outra coisa' } }),
    l({ type: 'assistant', uuid: 'a3', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta três' }] } }),
  ].join('\n') + '\n');
  // Reabre a conversa para a tela ler o histórico.
  await app.avaliar("window.orq.conversa.reiniciar('orquestrador')");
  const baloes = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].map((b) => b.dataset.texto)");
  await app.esperar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length === 3", 8000);
  const clicarEditar = (texto) => app.avaliar(`[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].find((b) => b.dataset.texto === ${JSON.stringify(texto)}).querySelector('.editar-msg').click()`);

  await t.test('✎ na mensagem do meio pede confirmação dizendo quantas saem', async () => {
    await clicarEditar('me diz onde t');
    await app.esperar("!document.getElementById('corrigindo').hidden");
    assert.match(await app.avaliar("document.getElementById('corrigindo-texto').textContent"), /a 1 mensagem sua depois dela/);
    await app.avaliar("document.getElementById('corrigindo-cancelar').click()");
    await app.esperar("document.getElementById('corrigindo').hidden");
    assert.deepStrictEqual(await baloes(), ['primeira pergunta', 'me diz onde t', 'outra coisa'], 'cancelar não muda nada');
  });

  await t.test('confirmar volta: o Claude reabre cortado, numa sessão nova, e o texto vai para a caixa', async () => {
    const antes = falso.chamadas().length;
    await clicarEditar('me diz onde t');
    await app.esperar("!document.getElementById('corrigindo').hidden");
    await app.avaliar("document.getElementById('corrigindo-voltar').click()");
    await app.esperar("document.getElementById('entrada').value === 'me diz onde t'", 8000);
    for (let i = 0; i < 50 && falso.chamadas().length <= antes; i++) await app.espera(100);
    const ultima = falso.chamadas().at(-1);
    assert.match(ultima, /--resume S1 --resume-session-at a1 --fork-session/);
    await app.esperar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length === 1", 8000);
    assert.deepStrictEqual(await baloes(), ['primeira pergunta'], 'a mensagem errada e o que veio depois saem da tela');
    const lista = JSON.parse(app.ler('.cache/orq-app/conversas-teste.json'));
    assert.deepStrictEqual(lista.find((c) => c.orquestrador).volta, { de: 'S1', ate: 'a1' }, 'a volta fica gravada até a 1ª resposta');
    assert.ok(fs.existsSync(path.join(app.casa, `.claude/projects/${projeto}/S1.jsonl`)), 'o histórico original não é apagado');
  });

  await t.test('✎ na última mensagem volta direto; sendo a primeira da conversa, o Claude recomeça do zero', async () => {
    // A volta anterior ainda não teve resposta: a sessão de partida continua a S1.
    const antes = falso.chamadas().length;
    await clicarEditar('primeira pergunta');
    for (let i = 0; i < 50 && falso.chamadas().length <= antes; i++) await app.espera(100);
    assert.ok(await app.avaliar("document.getElementById('corrigindo').hidden"), 'sem confirmação na última');
    await app.esperar("document.getElementById('entrada').value === 'primeira pergunta'", 8000);
    assert.doesNotMatch(falso.chamadas().at(-1), /--resume/);
    await app.esperar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length === 0", 8000);
    const o = JSON.parse(app.ler('.cache/orq-app/conversas-teste.json')).find((c) => c.orquestrador);
    assert.ok(o.anteriores.includes('S1'), 'a conversa original fica guardada');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
