// Área: hook (canal de permissão do hooks/orq-evento.sh)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HOOK = path.join(__dirname, '../../../hooks/orq-evento.sh');
const pular = !fs.existsSync(HOOK) && 'fora do repositório';

// Monta um projeto com o hook copiado em .orq/bin e o app "vivo".
function projeto({ hookSoLeitura, respostasSoLeitura }) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-hook-'));
  const bin = path.join(raiz, '.orq', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(raiz, '.orq', 'respostas-perm'));
  fs.copyFileSync(HOOK, path.join(bin, 'orq-evento.sh'));
  fs.chmodSync(path.join(bin, 'orq-evento.sh'), hookSoLeitura ? 0o555 : 0o755);
  fs.writeFileSync(path.join(raiz, '.orq', 'app-vivo'), '');
  return { raiz, hook: path.join(bin, 'orq-evento.sh'), resp: path.join(raiz, '.orq', 'respostas-perm'), respostasSoLeitura };
}

// Roda o pedido de permissão e, quando ele aparece, grava "permitir" como o
// app grava (o app roda no host, fora do container: a pasta só-leitura do
// container é gravável para ele — aqui, liberando a escrita só na hora).
function pedir(p) {
  return new Promise((ok) => {
    const proc = spawn('bash', [p.hook], { env: { ...process.env, CLAUDE_PROJECT_DIR: p.raiz, ORQ_ESPERA_SEGUNDOS: '4' } });
    let saida = '';
    proc.stdout.on('data', (d) => { saida += d; });
    proc.on('close', () => {
      clearInterval(vigia);
      // Devolve a escrita: a sobra no /tmp tem de sair com um rm comum.
      for (const f of [p.resp, p.hook]) try { fs.chmodSync(f, 0o755); } catch { /* já foi */ }
      ok(saida);
    });
    proc.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }));
    var vigia = setInterval(() => {
      let pedido;
      try { pedido = fs.readdirSync(path.join(p.raiz, '.orq', 'permissoes')).find((f) => f.endsWith('.json')); } catch { return; }
      if (!pedido) return;
      clearInterval(vigia);
      fs.chmodSync(p.resp, 0o755);
      fs.writeFileSync(path.join(p.resp, pedido.replace(/\.json$/, '.resposta')), 'permitir\n');
      if (p.respostasSoLeitura) fs.chmodSync(p.resp, 0o555);
    }, 50);
    setTimeout(() => clearInterval(vigia), 6000);
  });
}

test('hook: com hook e respostas só-leitura para o agente, o "permitir" do app vale (S3)', { skip: pular || (process.getuid() === 0 && 'root grava em tudo') }, async () => {
  const p = projeto({ hookSoLeitura: true, respostasSoLeitura: true });
  fs.chmodSync(p.resp, 0o555);
  assert.match(await pedir(p), /"behavior":\s*"allow"/);
});

test('hook: se o agente consegue gravar nas respostas, um "permitir" é ignorado e a pergunta volta ao terminal (S3)', { skip: pular }, async () => {
  const p = projeto({ hookSoLeitura: true, respostasSoLeitura: false });
  assert.doesNotMatch(await pedir(p), /allow/);
});

test('hook: se o agente consegue reescrever o próprio hook, nada é aprovado pelo app (S3)', { skip: pular || (process.getuid() === 0 && 'root grava em tudo') }, async () => {
  const p = projeto({ hookSoLeitura: false, respostasSoLeitura: true });
  fs.chmodSync(p.resp, 0o555);
  assert.doesNotMatch(await pedir(p), /allow/);
});
