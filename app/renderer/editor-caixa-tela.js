// Escrever a mensagem no editor de texto do computador (plano 4.4, H2: o Ctrl+G do terminal).
// O atalho é dos que a pessoa troca ou desliga em Configurações › Atalhos.
//
// O processo principal guarda o texto num arquivo temporário do app e abre o editor de texto do
// sistema (editor-de-texto.js). Enquanto isso a caixa fica só para leitura e espelha o arquivo:
// cada vez que a pessoa salva lá, o texto aparece aqui. O mesmo atalho, ou o botão "Terminar",
// encerra: a caixa volta a aceitar digitação com o último texto salvo.
//
// O texto que vem do editor entra na caixa como texto comum (nunca como "!comando"): quem
// envia é a pessoa. Abrir o programa de fora só acontece com uma tecla ou um clique dela.
(() => {
  const E = window.orq && window.orq.editor;
  if (!E || !window.orqConversa) return;
  const V = window.orqConversa;
  const A = window.orqAtalhos;
  const entrada = document.getElementById('entrada');
  const faixa = document.getElementById('editando-fora');
  let editando = false;

  function pintar() {
    faixa.hidden = !editando;
    entrada.readOnly = editando;
    document.getElementById('compositor').classList.toggle('editando-fora-ligado', editando);
    const c = V.atalhoDaCaixa('editor');
    const tecla = document.getElementById('editando-fora-tecla');
    tecla.textContent = c ? A.mostrar(c) : '';
    tecla.hidden = !c;
  }
  async function comecar() {
    if (editando) return;
    editando = true;
    pintar();
    const r = await E.comecar(entrada.value).catch((e) => ({ erro: String((e && e.message) || e) }));
    if (r && r.ok) return;
    editando = false;
    pintar();
    V.aviso(`Não consegui abrir o editor de texto: ${(r && r.erro) || 'erro desconhecido'}. O texto continua na caixa.`, 'erro');
  }
  // trazer: o último texto salvo vem para a caixa (falso depois de um envio: a caixa fica como está).
  async function terminar({ trazer = true } = {}) {
    if (!editando) return;
    editando = false;
    pintar();
    const r = await E.terminar().catch(() => null);
    if (trazer && r && r.ok && typeof r.texto === 'string' && r.texto !== entrada.value) V.porNaCaixa(r.texto);
    if (trazer) entrada.focus();
  }
  const alternar = () => (editando ? terminar() : comecar());

  // A pessoa salvou no editor: o texto novo aparece na caixa, sem tirar o teclado de onde está.
  E.aoMudar((texto) => { if (editando && typeof texto === 'string') V.porNaCaixa(texto, { foco: false }); });
  // De volta ao app: confere na hora o que está salvo (sem esperar a próxima espiada no arquivo),
  // para um Enter logo em seguida mandar o texto mais novo.
  window.addEventListener('focus', async () => {
    if (!editando) return;
    const r = await E.estado().catch(() => null);
    if (editando && r && r.editando && typeof r.texto === 'string' && r.texto !== entrada.value) V.porNaCaixa(r.texto, { foco: false });
  });

  document.getElementById('editando-fora-terminar').addEventListener('click', () => terminar());
  document.addEventListener('keydown', (ev) => {
    const c = V.atalhoDaCaixa('editor');
    if (!c || A.deEvento(ev) !== c || !V.caixaAtende()) return;
    ev.preventDefault();
    if (ev.isTrusted) alternar();
  });
  if (window.orqPaleta) window.orqPaleta.registrar(() => [{ grupo: 'Ações', titulo: 'Escrever a mensagem no editor de texto', faz: () => alternar() }]);

  window.orqEditorDeTexto = { editando: () => editando, comecar, terminar, alternar, depoisDeEnviar: () => terminar({ trazer: false }) };
  // A tela recarregou com uma edição aberta: continua de onde estava.
  E.estado().then((r) => {
    if (!r || !r.editando || editando) return;
    editando = true;
    pintar();
    if (typeof r.texto === 'string' && r.texto !== entrada.value) V.porNaCaixa(r.texto, { foco: false });
  }).catch(() => {});
})();
