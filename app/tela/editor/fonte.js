// Editor de notas no estilo Notion: blocos já formatados, "/" para inserir,
// e o arquivo continua sendo Markdown. Empacotado pelo esbuild em
// tela/editor.bundle.js (npm run editor), que expõe window.EditorNotas.
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';

// Itens do menu "/": nome, palavras para filtrar e o que fazem.
const BLOCOS = [
  { nome: 'Texto', dica: 'Parágrafo comum', chaves: 'texto paragrafo', faz: (c) => c.setParagraph() },
  { nome: 'Título 1', dica: 'Título grande', chaves: 'titulo h1 heading', faz: (c) => c.setHeading({ level: 1 }) },
  { nome: 'Título 2', dica: 'Título médio', chaves: 'titulo h2 heading', faz: (c) => c.setHeading({ level: 2 }) },
  { nome: 'Título 3', dica: 'Título pequeno', chaves: 'titulo h3 heading', faz: (c) => c.setHeading({ level: 3 }) },
  { nome: 'Lista', dica: 'Lista com marcadores', chaves: 'lista bullet marcadores', faz: (c) => c.toggleBulletList() },
  { nome: 'Lista numerada', dica: '1, 2, 3…', chaves: 'lista numerada ordered', faz: (c) => c.toggleOrderedList() },
  { nome: 'Tarefas', dica: 'Lista com caixinhas', chaves: 'tarefas todo checklist caixa', faz: (c) => c.toggleTaskList() },
  { nome: 'Citação', dica: 'Bloco de citação', chaves: 'citacao quote', faz: (c) => c.toggleBlockquote() },
  { nome: 'Código', dica: 'Bloco de código', chaves: 'codigo code', faz: (c) => c.toggleCodeBlock() },
  { nome: 'Tabela', dica: 'Tabela 3 × 3', chaves: 'tabela table', faz: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { nome: 'Divisor', dica: 'Linha horizontal', chaves: 'divisor linha hr', faz: (c) => c.setHorizontalRule() },
];

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Menu "/": aparece quando o parágrafo atual começa com "/" e só tem isso.
function menuBarra(raiz) {
  const menu = document.createElement('ul');
  menu.className = 'menu-barra';
  menu.hidden = true;
  raiz.append(menu);
  let itens = [], escolhido = 0, faixa = null, editorAtual = null;

  function fechar() { menu.hidden = true; faixa = null; }
  function aplicar(i) {
    const b = itens[i];
    if (!b || !faixa) return;
    const c = editorAtual.chain().focus().deleteRange(faixa);
    b.faz(c).run();
    fechar();
  }
  function atualizar(editor) {
    editorAtual = editor;
    const { $from, empty } = editor.state.selection;
    const texto = $from.parent.textContent;
    const m = empty && $from.parent.type.name === 'paragraph' && texto.match(/^\/([\p{L}\d ]{0,20})$/u);
    if (!m || $from.parentOffset !== texto.length) return fechar();
    const busca = semAcento(m[1]);
    itens = BLOCOS.filter((b) => !busca || semAcento(b.nome).includes(busca) || b.chaves.includes(busca));
    if (!itens.length) return fechar();
    escolhido = Math.min(escolhido, itens.length - 1);
    faixa = { from: $from.start(), to: $from.pos };
    menu.innerHTML = itens.map((b, i) => `<li data-i="${i}" aria-selected="${i === escolhido}"><strong>${b.nome}</strong><span>${b.dica}</span></li>`).join('');
    const pos = editor.view.coordsAtPos($from.pos);
    const base = raiz.getBoundingClientRect();
    menu.style.left = `${pos.left - base.left}px`;
    menu.style.top = `${pos.bottom - base.top + raiz.scrollTop + 6}px`;
    menu.hidden = false;
  }
  menu.addEventListener('mousedown', (ev) => {
    const li = ev.target.closest('li');
    if (li) { ev.preventDefault(); aplicar(Number(li.dataset.i)); }
  });
  return {
    atualizar,
    fechar,
    // Teclas enquanto o menu está aberto; true = o menu tratou.
    tecla(ev) {
      if (menu.hidden) return false;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        escolhido = (escolhido + (ev.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
        atualizar(editorAtual);
        return true;
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') { aplicar(escolhido); return true; }
      if (ev.key === 'Escape') { fechar(); return true; }
      return false;
    },
  };
}

function criar({ el, aoMudar, aoSalvarJa }) {
  const menu = menuBarra(el.parentElement);
  const Atalhos = Extension.create({
    name: 'atalhosNotas',
    addKeyboardShortcuts() {
      return { 'Mod-s': () => { if (aoSalvarJa) aoSalvarJa(); return true; } };
    },
  });
  let carregando = false;
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Título' : 'Escreva, ou digite / para inserir um bloco…') }),
      Markdown,
      Atalhos,
    ],
    editorProps: {
      handleKeyDown: (_v, ev) => {
        if (menu.tecla(ev)) { ev.preventDefault(); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => { menu.atualizar(e); if (!carregando && aoMudar) aoMudar(); },
    onSelectionUpdate: ({ editor: e }) => menu.atualizar(e),
    onBlur: () => setTimeout(() => menu.fechar(), 150),
  });
  return {
    definir(md) {
      carregando = true;
      editor.commands.setContent(md || '', { contentType: 'markdown', emitUpdate: false });
      carregando = false;
    },
    markdown: () => editor.getMarkdown(),
    focar: () => editor.commands.focus('end'),
    editavel: (sim) => editor.setEditable(sim),
    destruir: () => editor.destroy(),
  };
}

window.EditorNotas = { criar };
