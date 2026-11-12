// Área: workflows
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({});
const wf = require('../../workflows');

const mandados = [];
const avisos = [];
let orq = { id: 'orquestrador', orquestrador: true, vivo: false, ocupado: false };
wf.ligar({
  conversa: { lista: () => [orq], mandar: (id, t) => mandados.push([id, t]), ambienteLimpo: () => ({ ...process.env }) },
  avisar: (t, c) => avisos.push([t, c]),
  enviarTela: () => {},
});
wf.desligar(); // o relógio de verdade não roda no teste; o teste roda tique() à mão

test('workflows: primeira vez traz a passada de 3 em 3 min, desligada', () => {
  const l = wf.lista();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].id, 'passada-frentes');
  assert.strictEqual(l[0].ativo, false, 'o lembrete do Claude continua; este nasce desligado');
  assert.deepStrictEqual(l[0].nos.map((n) => n.tipo), ['agenda', 'orquestrador']);
  assert.strictEqual(l[0].nos[0].config.minutos, 3);
});

test('workflows: limpeza tira tipo desconhecido e ligação que entra num gatilho', () => {
  const g = wf.gravar({ id: 'w-limpo', nome: '  ', nos: [{ id: 'a', tipo: 'manual' }, { id: 'b', tipo: 'xyz' }, { id: 'c', tipo: 'notificar', config: { titulo: 'oi' } }],
    ligacoes: [{ de: 'c', para: 'a' }, { de: 'a', para: 'c' }, { de: 'a', para: 'c' }, { de: 'a', para: 'b' }] });
  assert.strictEqual(g.nome, 'Workflow sem nome');
  assert.deepStrictEqual(g.nos.map((n) => n.id), ['a', 'c']);
  assert.deepStrictEqual(g.ligacoes, [{ de: 'a', para: 'c' }]);
  assert.strictEqual(g.nos[1].config.texto, '{{entrada}}', 'campo que faltou ganha o padrão');
});

test('workflows: gravar guarda a versão anterior; apagar tira só aquele', () => {
  const versoes = path.join(casa, '.local/share/orq-app/versoes/workflows');
  const antes = fs.existsSync(versoes) ? fs.readdirSync(versoes).length : 0;
  wf.gravar({ id: 'w-tmp', nome: 'tmp', nos: [], ligacoes: [] });
  assert.ok(fs.readdirSync(versoes).length > antes);
  assert.ok(wf.apagar('w-tmp'));
  assert.ok(!wf.lista().some((w) => w.id === 'w-tmp'));
  assert.ok(wf.lista().some((w) => w.id === 'passada-frentes'));
});

test('workflows: comando → condição → comando, com a saída passando adiante', async () => {
  wf.gravar({ id: 'w-cadeia', nome: 'cadeia', nos: [
    { id: 'n1', tipo: 'manual' },
    { id: 'n2', tipo: 'comando', config: { comando: 'echo olá mundo' } },
    { id: 'n3', tipo: 'condicao', config: { modo: 'contem', valor: 'OLÁ' } },
    { id: 'n4', tipo: 'comando', config: { comando: 'echo "recebi $ORQ_ENTRADA"' } },
    { id: 'n5', tipo: 'condicao', config: { modo: 'contem', valor: 'xyz' } },
    { id: 'n6', tipo: 'notificar', config: { titulo: 'não devia' } },
    { id: 'n7', tipo: 'notificar', config: { titulo: 'Aviso', texto: 'veio: {{entrada}}' } },
  ], ligacoes: [{ de: 'n1', para: 'n2' }, { de: 'n2', para: 'n3' }, { de: 'n3', para: 'n4' }, { de: 'n2', para: 'n5' }, { de: 'n5', para: 'n6' }, { de: 'n4', para: 'n7' }] });
  const r = await wf.rodar('w-cadeia');
  assert.ok(r.ok, JSON.stringify(r.execucao.passos));
  const p = Object.fromEntries(r.execucao.passos.map((x) => [x.no, x]));
  assert.strictEqual(p.n4.saida, 'recebi olá mundo');
  assert.strictEqual(p.n5.estado, 'parou');
  assert.ok(!p.n6, 'ramo da condição falsa não roda');
  assert.deepStrictEqual(avisos.pop(), ['Aviso', 'veio: recebi olá mundo']);
  assert.strictEqual(wf.execucoes('w-cadeia')[0].id, r.execucao.id, 'a execução fica guardada');
});

test('workflows: comando que falha marca erro e não segue', async () => {
  wf.gravar({ id: 'w-erro', nome: 'erro', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'comando', config: { comando: 'echo ruim >&2; exit 3' } }, { id: 'n3', tipo: 'notificar' }],
    ligacoes: [{ de: 'n1', para: 'n2' }, { de: 'n2', para: 'n3' }] });
  const r = await wf.rodar('w-erro');
  assert.strictEqual(r.ok, false);
  assert.match(r.execucao.passos[1].saida, /código 3: ruim/);
  assert.strictEqual(r.execucao.passos.length, 2);
});

test('workflows: mandar ao orquestrador respeita rodada iniciada e ocupado', async () => {
  wf.gravar({ id: 'w-orq', nome: 'orq', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'orquestrador', config: { texto: 'passada {{entrada}}fim' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
  let r = await wf.rodar('w-orq');
  assert.strictEqual(r.execucao.passos[1].estado, 'parou');
  assert.match(r.execucao.passos[1].saida, /rodada não está iniciada/);
  orq = { ...orq, vivo: true, ocupado: true };
  r = await wf.rodar('w-orq');
  assert.match(r.execucao.passos[1].saida, /respondendo/);
  assert.strictEqual(mandados.length, 0);
  orq = { ...orq, ocupado: false };
  r = await wf.rodar('w-orq');
  assert.strictEqual(r.execucao.passos[1].estado, 'ok');
  assert.deepStrictEqual(mandados, [['orquestrador', '<orq-workflow nome="orq">\npassada fim\n</orq-workflow>']], 'vai por trás, marcado como workflow');
});

test('workflows: Perguntar ao Claude manda o pedido pela entrada e devolve a resposta', async () => {
  const falso = path.join(casa, 'claude-falso');
  fs.writeFileSync(falso, '#!/bin/sh\necho "modelo $3"; cat\n', { mode: 0o755 });
  process.env.ORQ_WF_CLAUDE = falso;
  wf.gravar({ id: 'w-claude', nome: 'claude', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'claude', config: { prompt: 'resuma isto', modelo: 'haiku' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
  const r = await wf.rodar('w-claude');
  assert.strictEqual(r.execucao.passos[1].saida, 'modelo haiku\nresuma isto');
  delete process.env.ORQ_WF_CLAUDE;
});

test('workflows: relógio — intervalo não dispara na abertura; dispara depois do prazo', async () => {
  wf.gravar({ id: 'w-relogio', nome: 'relógio', ativo: true, nos: [{ id: 'n1', tipo: 'agenda', config: { modo: 'intervalo', minutos: 2 } }, { id: 'n2', tipo: 'notificar', config: { titulo: 'tique' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
  const t0 = Date.now();
  wf.tique(t0);
  wf.tique(t0 + 60000);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!avisos.some((a) => a[0] === 'tique'));
  wf.tique(t0 + 121000);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(avisos.filter((a) => a[0] === 'tique').length, 1);
  assert.strictEqual(wf.execucoes('w-relogio')[0].motivo, 'relógio');
});

// Reiniciar o app = carregar o módulo de novo (a memória do relógio zera).
function reiniciar() {
  delete require.cache[require.resolve('../../workflows')];
  const w2 = require('../../workflows');
  w2.ligar({ conversa: { lista: () => [orq], mandar: (id, t) => mandados.push([id, t]), ambienteLimpo: () => ({ ...process.env }) }, avisar: (t, c) => avisos.push([t, c]), enviarTela: () => {} });
  w2.desligar();
  return w2;
}

test('workflows: relógio lembra o último disparo depois de reiniciar o app (M2)', async () => {
  // Diário 08:30: disparou às 08:31; o app reinicia e às 08:33 não dispara de novo.
  const d = reiniciar();
  d.gravar({ id: 'w-diario', nome: 'diário', ativo: true, nos: [{ id: 'n1', tipo: 'agenda', config: { modo: 'diario', horario: '08:30', diasUteis: false } }, { id: 'n2', tipo: 'notificar', config: { titulo: 'bom dia' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
  const hoje = new Date(); hoje.setHours(8, 31, 0, 0);
  d.tique(hoje.getTime());
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(avisos.filter((a) => a[0] === 'bom dia').length, 1);
  reiniciar().tique(hoje.getTime() + 2 * 60000);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(avisos.filter((a) => a[0] === 'bom dia').length, 1, 'disparou de novo depois de reiniciar');

  // Intervalo de 2 min: disparou em t0; reinicia em t0+1 min; em t0+2 min já vence
  // (antes o intervalo zerava e só voltava em t0+3 min).
  const i = reiniciar();
  i.gravar({ id: 'w-interv', nome: 'intervalo', ativo: true, nos: [{ id: 'n1', tipo: 'agenda', config: { modo: 'intervalo', minutos: 2 } }, { id: 'n2', tipo: 'notificar', config: { titulo: 'passada' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
  const t0 = Date.now();
  i.tique(t0 - 130000); // começa a contar
  i.tique(t0);          // vence
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(avisos.filter((a) => a[0] === 'passada').length, 1);
  const depois = reiniciar();
  depois.tique(t0 + 60000);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(avisos.filter((a) => a[0] === 'passada').length, 1, 'não pode disparar antes do prazo');
  depois.tique(t0 + 121000);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(avisos.filter((a) => a[0] === 'passada').length, 2, 'o prazo conta do último disparo, não do reinício');
});

test('workflows: relógio diário — uma vez no horário, nunca fora dele, sem fim de semana', () => {
  const c = { modo: 'diario', horario: '08:30', diasUteis: true };
  const seg = new Date(2026, 9, 26, 8, 31).getTime(); // segunda
  assert.ok(wf.vence(c, seg, 0));
  assert.ok(!wf.vence(c, seg, seg - 30000), 'já disparou hoje');
  assert.ok(!wf.vence(c, new Date(2026, 9, 26, 8, 29).getTime(), 0), 'antes da hora');
  assert.ok(!wf.vence(c, new Date(2026, 9, 26, 9, 0).getTime(), 0), 'passou muito da hora');
  assert.ok(!wf.vence(c, new Date(2026, 9, 25, 8, 31).getTime(), 0), 'domingo');
  assert.ok(wf.vence({ ...c, diasUteis: false }, new Date(2026, 9, 25, 8, 31).getTime(), 0));
});

test('workflows: arquivo novo na pasta → ler → escrever e mover, sem nunca sobrescrever', async () => {
  const entrada = path.join(casa, 'entrada'), saida = path.join(casa, 'saida');
  fs.mkdirSync(entrada); fs.mkdirSync(saida);
  fs.writeFileSync(path.join(entrada, 'velho.txt'), 'já estava');
  fs.writeFileSync(path.join(saida, 'nota.txt'), 'NÃO PODE SUMIR');
  wf.gravar({ id: 'w-pasta', nome: 'pasta', ativo: true, nos: [
    { id: 'n1', tipo: 'pasta', config: { pasta: '~/entrada', padrao: '*.txt' } },
    { id: 'n2', tipo: 'ler', config: { caminho: '{{arquivo}}' } },
    { id: 'n3', tipo: 'escrever', config: { modo: 'novo', pasta: '~/saida', nome: 'resumo-{{nome_arquivo}}', conteudo: 'li: {{entrada}}' } },
    { id: 'n4', tipo: 'mover', config: { modo: 'mover', caminho: '{{arquivo}}', destino: '~/saida' } },
  ], ligacoes: [{ de: 'n1', para: 'n2' }, { de: 'n2', para: 'n3' }, { de: 'n3', para: 'n4' }] });
  wf.olharPastas(); // primeira olhada: o que já existe não dispara
  fs.writeFileSync(path.join(entrada, 'nota.txt'), 'conteúdo novo');
  fs.writeFileSync(path.join(entrada, 'foto.png'), 'x');
  wf.olharPastas(); // viu o arquivo; espera o tamanho parar de mudar
  assert.strictEqual(wf.execucoes('w-pasta').length, 0);
  wf.olharPastas(); // tamanho igual: dispara
  for (let i = 0; i < 30 && !(wf.execucoes('w-pasta')[0]?.fim); i++) await new Promise((r) => setTimeout(r, 50));
  const e = wf.execucoes('w-pasta');
  assert.strictEqual(e.length, 1, 'só o .txt novo dispara (nem o velho nem o .png)');
  assert.ok(e[0].ok, JSON.stringify(e[0].passos));
  assert.match(e[0].motivo, /arquivo novo: nota\.txt/);
  assert.strictEqual(fs.readFileSync(path.join(saida, 'resumo-nota.txt'), 'utf8'), 'li: conteúdo novo');
  assert.strictEqual(fs.readFileSync(path.join(saida, 'nota.txt'), 'utf8'), 'NÃO PODE SUMIR', 'o que já existia no destino continua');
  assert.strictEqual(fs.readFileSync(path.join(saida, 'nota-2.txt'), 'utf8'), 'conteúdo novo', 'o movido ganhou número');
  assert.ok(!fs.existsSync(path.join(entrada, 'nota.txt')), 'saiu da origem');
  wf.olharPastas();
  assert.strictEqual(wf.execucoes('w-pasta').length, 1, 'não dispara de novo');
  wf.gravar({ ...wf.lista().find((w) => w.id === 'w-pasta'), ativo: false });
});

test('workflows: escrever acrescentando vai para o fim do arquivo', async () => {
  fs.writeFileSync(path.join(casa, 'log.md'), 'linha 1\n');
  wf.gravar({ id: 'w-log', nome: 'log', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'escrever', config: { modo: 'acrescentar', pasta: '~', nome: 'log.md', conteudo: 'linha 2' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
  await wf.rodar('w-log');
  assert.strictEqual(fs.readFileSync(path.join(casa, 'log.md'), 'utf8'), 'linha 1\nlinha 2\n');
});

test('workflows: credencial não vaza codificada nem cortada na saída guardada (S6)', async () => {
  const V = 'Sup3r/Segr+edo=9xQ!kz';
  const arq = path.join(casa, 'segredo-s6.txt');
  fs.writeFileSync(arq, V, { mode: 0o600 });
  const cr = wf.gravarCredencial({ id: 'c-s6', nome: 'S6', tipo: 'arquivo', ref: arq, variavel: 'S6' });
  const rodarCmd = async (id, cmd) => {
    wf.gravar({ id, nome: id, nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'comando', config: { comando: cmd, credenciais: [cr.id] } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
    const r = await wf.rodar(id);
    assert.ok(r.ok, JSON.stringify(r.execucao.passos));
    return JSON.stringify(r) + fs.readFileSync(path.join(casa, '.cache/orq-app/workflows-execucoes.json'), 'utf8');
  };
  // Codificado: base64, hex e URL.
  const cod = await rodarCmd('w-s6a', 'printf %s "$S6" | base64; printf %s "$S6" | od -An -tx1 | tr -d " \\n"; echo; '
    + 'python3 -c "import os,urllib.parse;print(urllib.parse.quote(os.environ[\'S6\'],safe=\'\'))"');
  for (const [nome, f] of Object.entries({ base64: Buffer.from(V).toString('base64'), hex: Buffer.from(V).toString('hex'), url: encodeURIComponent(V) })) {
    assert.ok(!cod.includes(f), `vazou em ${nome}`);
  }
  // Cortado: a saída passa de 20 000 caracteres e o que fica guardado começa
  // no meio do segredo (sobram os últimos 12 caracteres dele).
  const cort = await rodarCmd('w-s6b', 'printf %s "$S6"; head -c 19988 /dev/zero | tr "\\0" a');
  assert.ok(!cort.includes(V.slice(-12)), 'vazou o fim do segredo cortado');
});

// --- pedido de 2026-11-12: automações do expediente, HTTP e IA por assinatura ou API ---

test('workflows: relógio de intervalo respeita a janela do expediente e os dias úteis', () => {
  const c = { modo: 'intervalo', minutos: 30, de: '08:00', ate: '18:00', diasUteis: true };
  const qui = (h, m) => new Date(2026, 10, 12, h, m).getTime(); // quinta
  assert.ok(!wf.vence(c, qui(7, 59), 0), 'antes da janela');
  assert.ok(wf.vence(c, qui(8, 0), 0), 'a janela abre e o intervalo já passou');
  assert.ok(!wf.vence(c, qui(8, 10), qui(8, 0)), 'dentro da janela, antes do intervalo');
  assert.ok(wf.vence(c, qui(18, 0), qui(17, 30)), 'até 18:00 inclusive');
  assert.ok(!wf.vence(c, qui(18, 1), 0), 'depois da janela');
  assert.ok(!wf.vence(c, new Date(2026, 10, 14, 10, 0).getTime(), 0), 'sábado');
  assert.ok(wf.vence({ ...c, de: '', ate: '' }, qui(3, 0), 0), 'sem janela: qualquer hora');
  const noite = { modo: 'intervalo', minutos: 30, de: '22:00', ate: '06:00' };
  assert.ok(wf.vence(noite, qui(23, 0), 0) && wf.vence(noite, qui(5, 0), 0), 'janela que atravessa a meia-noite');
  assert.ok(!wf.vence(noite, qui(12, 0), 0));
});

test('workflows: diário que passou com o PC desligado roda ao abrir, só se pedido e no mesmo dia', () => {
  const c = { modo: 'diario', horario: '08:30', atrasado: true };
  const hoje = (h, m) => new Date(2026, 10, 12, h, m).getTime();
  const gravadoOntem = new Date(2026, 10, 11, 17, 0).getTime();
  assert.ok(wf.vence(c, hoje(10, 0), 0, gravadoOntem), 'abriu às 10:00: roda o das 08:30');
  assert.ok(!wf.vence({ ...c, atrasado: false }, hoje(10, 0), 0, gravadoOntem), 'sem a opção, continua como antes');
  assert.ok(!wf.vence(c, hoje(10, 0), hoje(8, 31), gravadoOntem), 'já rodou hoje');
  assert.ok(!wf.vence(c, hoje(10, 0), 0, hoje(9, 0)), 'ligado depois do horário: não roda o que já tinha passado');
  assert.ok(!wf.vence(c, hoje(8, 0), 0, gravadoOntem), 'antes do horário');
});

const http = require('http');
function servidor(trata) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (d) => { corpo += d; });
      req.on('end', () => trata(req, corpo, res));
    });
    s.listen(0, '127.0.0.1', () => ok({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}
const SEGREDO_HTTP = 'tok-HTTP-9f8e7d6c5b';
process.env.ORQ_TESTE_TOKEN_WF = SEGREDO_HTTP;
const credHttp = wf.gravarCredencial({ id: 'c-http', nome: 'token http', tipo: 'ambiente', ref: 'ORQ_TESTE_TOKEN_WF', variavel: 'TOKEN' });

test('workflows: Requisição HTTP manda método, cabeçalho e corpo, troca a credencial e não deixa ela na saída', async () => {
  const vistos = [];
  const { s, url } = await servidor((req, corpo, res) => {
    vistos.push({ metodo: req.method, caminho: req.url, auth: req.headers.authorization, tipo: req.headers['content-type'], corpo });
    if (req.url === '/falha') { res.writeHead(500); res.end('quebrou'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ recebi: corpo, eco: req.headers.authorization }));
  });
  try {
    wf.gravar({ id: 'w-http', nome: 'http', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'http', config: {
      metodo: 'POST', url: `${url}/itens?q={{entrada}}`, cabecalhos: 'Authorization: Bearer $TOKEN\nContent-Type: application/json', corpo: '{"nome":"teste"}', credenciais: [credHttp.id] } }],
    ligacoes: [{ de: 'n1', para: 'n2' }] });
    const r = await wf.rodar('w-http');
    assert.ok(r.ok, JSON.stringify(r.execucao.passos));
    assert.deepStrictEqual(vistos[0], { metodo: 'POST', caminho: '/itens?q=', auth: `Bearer ${SEGREDO_HTTP}`, tipo: 'application/json', corpo: '{"nome":"teste"}' });
    const saida = r.execucao.passos[1].saida;
    assert.match(saida, /"recebi":"\{\\"nome\\":\\"teste\\"\}"/);
    assert.ok(!saida.includes(SEGREDO_HTTP) && saida.includes('Bearer ••••'), 'o eco do token sai mascarado');
    assert.ok(!fs.readFileSync(path.join(casa, '.cache/orq-app/workflows-execucoes.json'), 'utf8').includes(SEGREDO_HTTP));

    wf.gravar({ id: 'w-http2', nome: 'http2', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'http', config: { metodo: 'GET', url: `${url}/falha` } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
    const f = await wf.rodar('w-http2');
    assert.strictEqual(f.ok, false);
    assert.match(f.execucao.passos[1].saida, /^HTTP 500: quebrou/);
    assert.strictEqual(vistos[1].corpo, '', 'GET vai sem corpo');

    wf.gravar({ id: 'w-http3', nome: 'http3', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'http', config: { url: 'ftp://x' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
    assert.match((await wf.rodar('w-http3')).execucao.passos[1].saida, /precisa começar com http/);
  } finally { s.close(); }
});

test('workflows: Perguntar a uma IA — passo antigo sem "via" continua no Claude da assinatura', () => {
  const g = wf.gravar({ id: 'w-ia-velho', nome: 'velho', nos: [{ id: 'n1', tipo: 'claude', config: { prompt: 'oi', modelo: 'opus' } }] });
  assert.strictEqual(g.nos[0].config.via, 'claude');
  assert.strictEqual(g.nos[0].config.modelo, 'opus');
});

test('workflows: Perguntar a uma IA pelo Codex da assinatura: só leitura, pedido pela entrada, resposta do arquivo', async () => {
  const falso = path.join(casa, 'codex-falso');
  // Grava os argumentos e o pedido; escreve a resposta no arquivo do -o.
  fs.writeFileSync(falso, `#!/bin/sh
printf '%s\\n' "$@" > "${casa}/codex-args.txt"
pedido=$(cat)
while [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then shift; printf 'resposta: %s' "$pedido" > "$1"; fi; shift; done
echo "log do codex"
`, { mode: 0o755 });
  process.env.ORQ_WF_CODEX = falso;
  try {
    wf.gravar({ id: 'w-codex', nome: 'codex', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'claude', config: { via: 'codex', prompt: 'resuma {{entrada}}fim', modeloLivre: 'gpt-x' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
    const r = await wf.rodar('w-codex');
    assert.ok(r.ok, JSON.stringify(r.execucao.passos));
    assert.strictEqual(r.execucao.passos[1].saida, 'resposta: resuma fim');
    const args = fs.readFileSync(path.join(casa, 'codex-args.txt'), 'utf8').split('\n');
    assert.deepStrictEqual(args.slice(0, 6), ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never']);
    assert.ok(args.includes('-m') && args.includes('gpt-x') && args.includes('-'));
    assert.ok(!args.some((a) => /dangerously|danger-full/.test(a)), 'nunca sem sandbox');
    const pasta = path.dirname(args[args.indexOf('-o') + 1]);
    assert.ok(!fs.existsSync(pasta), 'a pasta temporária some no fim');
  } finally { delete process.env.ORQ_WF_CODEX; }
});

test('workflows: Perguntar a uma IA pela API da Anthropic: chave do cofre, modelo padrão com reserva, recusa vira erro', async () => {
  const CHAVE = 'sk-ant-teste-0123456789abcdef';
  process.env.ORQ_TESTE_CHAVE_ANT = CHAVE;
  const cred = wf.gravarCredencial({ id: 'c-ant', nome: 'anthropic', tipo: 'ambiente', ref: 'ORQ_TESTE_CHAVE_ANT', variavel: 'ANTHROPIC' });
  const pedidos = [];
  let recusar = false;
  const { s, url } = await servidor((req, corpo, res) => {
    const b = JSON.parse(corpo || '{}');
    pedidos.push({ caminho: req.url, chave: req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer /, ''), beta: req.headers['anthropic-beta'] || '', corpo: b });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: b.model,
      content: recusar ? [] : [{ type: 'text', text: `ok ${CHAVE.slice(0, 0)}resposta da API` }],
      stop_reason: recusar ? 'refusal' : 'end_turn', stop_details: recusar ? { type: 'refusal', category: 'cyber' } : null,
      usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  process.env.ORQ_WF_ANTHROPIC_URL = url;
  try {
    wf.gravar({ id: 'w-ant', nome: 'ant', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'claude', config: { via: 'anthropic', prompt: 'classifique', credenciais: [cred.id] } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
    const r = await wf.rodar('w-ant');
    assert.ok(r.ok, JSON.stringify(r.execucao.passos));
    assert.strictEqual(r.execucao.passos[1].saida, 'ok resposta da API');
    const p = pedidos[0];
    assert.strictEqual(p.chave, CHAVE);
    assert.match(p.caminho, /^\/v1\/messages/);
    assert.strictEqual(p.corpo.model, 'claude-opus-5-5');
    assert.strictEqual(p.corpo.fallbacks, 'default');
    assert.match(p.beta, /server-side-fallback-2026-07-01/);
    assert.deepStrictEqual(p.corpo.messages, [{ role: 'user', content: 'classifique' }]);

    wf.gravar({ id: 'w-ant2', nome: 'ant2', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'claude', config: { via: 'anthropic', modeloLivre: 'claude-haiku-5-5', prompt: 'x', credenciais: [cred.id] } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
    await wf.rodar('w-ant2');
    assert.strictEqual(pedidos[1].corpo.model, 'claude-haiku-5-5');
    assert.strictEqual(pedidos[1].corpo.fallbacks, undefined, 'Haiku não tem reserva no servidor');

    recusar = true;
    const rec = await wf.rodar('w-ant');
    assert.strictEqual(rec.ok, false);
    assert.match(rec.execucao.passos[1].saida, /recusou o pedido \(cyber\)/);

    wf.gravar({ id: 'w-ant3', nome: 'ant3', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'claude', config: { via: 'anthropic', prompt: 'x' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
    assert.match((await wf.rodar('w-ant3')).execucao.passos[1].saida, /marque a credencial/);
  } finally { s.close(); delete process.env.ORQ_WF_ANTHROPIC_URL; }
});

test('workflows: Perguntar a uma IA pela API da OpenAI: pede o modelo, manda a chave e lê a resposta', async () => {
  process.env.ORQ_TESTE_CHAVE_OAI = 'sk-oai-teste-abcdef012345';
  const cred = wf.gravarCredencial({ id: 'c-oai', nome: 'openai', tipo: 'ambiente', ref: 'ORQ_TESTE_CHAVE_OAI', variavel: 'OPENAI' });
  const pedidos = [];
  const { s, url } = await servidor((req, corpo, res) => {
    pedidos.push({ caminho: req.url, auth: req.headers.authorization, corpo: JSON.parse(corpo) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'resposta openai' }] }] }));
  });
  process.env.ORQ_WF_OPENAI_URL = url;
  try {
    wf.gravar({ id: 'w-oai', nome: 'oai', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'claude', config: { via: 'openai', prompt: 'p', credenciais: [cred.id] } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
    assert.match((await wf.rodar('w-oai')).execucao.passos[1].saida, /diga o modelo/);
    assert.strictEqual(pedidos.length, 0);
    wf.gravar({ id: 'w-oai', nome: 'oai', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'claude', config: { via: 'openai', modeloLivre: 'gpt-teste', prompt: 'p', credenciais: [cred.id] } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
    const r = await wf.rodar('w-oai');
    assert.ok(r.ok, JSON.stringify(r.execucao.passos));
    assert.strictEqual(r.execucao.passos[1].saida, 'resposta openai');
    assert.deepStrictEqual(pedidos[0], { caminho: '/responses', auth: 'Bearer sk-oai-teste-abcdef012345', corpo: { model: 'gpt-teste', input: 'p' } });
  } finally { s.close(); delete process.env.ORQ_WF_OPENAI_URL; }
});
