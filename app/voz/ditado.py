"""Ditado: transcreve o microfone enquanto a pessoa fala (o app conversa com este script: ditado.js).

Uso: python ditado.py --modelo small [--idioma pt] [--threads 4] [--baixar] [--ensaio]

Fica rodando com o modelo carregado e atende um ditado por vez. O áudio chega pela entrada e só
existe na memória deste processo: nada é gravado em disco e nada sai do computador.

Entrada (stdin), em quadros: 1 byte de tipo + 4 bytes de tamanho (little-endian) + corpo
  'A'  áudio: PCM de 16 bits, 16 kHz, mono
  'C'  comando, em JSON:
         {"t": "comecar", "id": n, "contexto": "o texto que já está antes do cursor"}
         {"t": "cortar", "epoca": n, "contexto": "..."}  larga o trecho aberto (a pessoa mexeu no texto)
         {"t": "parar"}    fecha o trecho aberto e termina o ditado
         {"t": "largar"}   termina sem fechar o trecho (o que estava na caixa já foi enviado)
         {"t": "sair"}

Saída (stdout), uma linha de JSON por evento:
  {"t": "pronto", "modelo", "aparelho", "ms"}   modelo carregado
  {"t": "parcial", "id", "epoca", "texto"}   o trecho aberto até agora (ainda pode mudar)
  {"t": "final", "id", "epoca", "texto"}     um trecho fechado (não muda mais)
  {"t": "parou", "id"}                        o ditado terminou; tudo o que foi falado já saiu
  {"t": "erro", "erro"}

Como o texto aparece "enquanto fala" com um modelo que não é de tempo real: a cada pedaço novo de
áudio o trecho aberto inteiro é transcrito de novo, rápido (feixe 1), e sai como "parcial".
Quando a pessoa faz uma pausa, o trecho é transcrito com cuidado (feixe 5, com o que veio antes
como contexto) e sai como "final". Fala comprida sem pausa é fechada aos poucos, no fim de uma frase.

--ensaio troca o modelo por um faz de conta (para os testes do recorte, sem modelo nenhum):
"fala" é onde o som passa de um limiar, e o "texto" é uma letra pela altura do som seguida do
tamanho da fala em décimos de segundo.
"""
import glob
import json
import math
import os
import queue
import re
import struct
import sys
import threading
import time
from array import array

SR = 16000  # amostras por segundo
PADRAO = {
    "passo": 0.4,    # segundos de áudio novo entre uma prévia e a próxima (no mínimo)
    "pausa": 0.7,    # silêncio que fecha o trecho
    "margem": 0.3,   # som guardado antes da fala começar
    "aberto": 8.0,   # fala sem pausa: a partir daqui fecha no fim de uma frase
    "duro": 20.0,    # fala sem pausa nem frase: fecha tudo
}
# Frases que o whisper inventa em cima de ruído (teclado, respiração), em português. Só valem
# quando são o trecho inteiro.
FANTASMAS = {
    "obrigado por assistir", "legendas pela comunidade amara.org", "legendas pela comunidade do amara.org",
    "inscreva-se no canal", "e aí", "tchau, tchau", "tchau tchau", "transcrição e legendas pela comunidade amara.org",
}


def dizer(o):
    sys.stdout.write(json.dumps(o, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def limpar(texto):
    t = " ".join((texto or "").split())
    if t.strip(" .!?…").lower() in FANTASMAS:
        return ""
    # Reticências repetidas ("... ... ...") são o modelo enchendo o silêncio do fim do trecho.
    t = re.sub(r"(\s*(\.{3}|…)){2,}", "...", t)
    # A mesma frase várias vezes em seguida é o modelo em laço: fica uma só.
    return re.sub(r"(\b[^.!?]{12,}[.!?])(\s*\1)+", r"\1", sem_laco(t))


def sem_laco(texto):
    """O mesmo pedaço (de 1 a 8 palavras) três vezes ou mais em seguida é o modelo em laço, o que
    acontece quando o som do trecho acaba e ele continua escrevendo: fica uma vez só."""
    p = texto.split(" ")
    chave = [x.lower().strip(".,;:!?…") for x in p]
    saida = []
    i = 0
    while i < len(p):
        pulou = False
        for k in range(1, 9):
            if i + 3 * k > len(p):
                break
            unidade = chave[i: i + k]
            if not any(unidade):
                continue
            vezes = 1
            while chave[i + vezes * k: i + (vezes + 1) * k] == unidade:
                vezes += 1
            if vezes >= 3:
                saida.extend(p[i: i + k])
                i += vezes * k
                # O laço cortado no meio (o começo de mais uma volta) sai junto.
                resto = 0
                while resto < k and i + resto < len(p) and chave[i + resto] == unidade[resto]:
                    resto += 1
                if i + resto == len(p):
                    i += resto
                pulou = True
                break
        if not pulou:
            saida.append(p[i])
            i += 1
    return " ".join(saida)


def aparar(texto):
    # Na prévia, o ponto e as reticências do fim só piscam (a frase ainda não acabou).
    return re.sub(r"[\s.…]+$", "", texto or "")


class Ditado:
    """O recorte: junta o áudio que chega, decide quando sai prévia e quando o trecho fecha."""

    def __init__(self, motor, p, dizer_evento=dizer):
        self.motor = motor
        self.p = p
        self.dizer = dizer_evento
        self.ativo = False
        self.id = None
        self.epoca = 0
        self.pcm = bytearray()
        self.novo = 0
        self.contexto = ""
        self.parcial = ""

    def comecar(self, id_, contexto):
        self.ativo = True
        self.id = id_
        self.epoca = 0
        self.pcm = bytearray()
        self.novo = 0
        self.contexto = (contexto or "")[-300:]
        self.parcial = ""

    def audio(self, corpo):
        if not self.ativo:
            return
        self.pcm += corpo
        self.novo += len(corpo)

    def cortar(self, epoca, contexto):
        self.epoca = epoca
        self.pcm = bytearray()
        self.novo = 0
        self.parcial = ""
        if contexto is not None:
            self.contexto = contexto[-300:]

    def terminar(self, fechar):
        if not self.ativo:
            return
        if fechar:
            self.passo(fechar=True)
        self.ativo = False
        self.pcm = bytearray()
        self.novo = 0
        self.dizer({"t": "parou", "id": self.id})

    def hora_do_passo(self):
        return self.ativo and self.novo >= int(self.p["passo"] * SR) * 2

    def previa(self, texto):
        if texto == self.parcial:
            return
        self.parcial = texto
        self.dizer({"t": "parcial", "id": self.id, "epoca": self.epoca, "texto": texto})

    def fechar(self, ini, fim, manter_de=None):
        trechos = self.motor.transcrever(bytes(self.pcm[ini * 2: fim * 2]), True, self.contexto)
        texto = " ".join(t[2] for t in trechos if t[2])
        total = len(self.pcm) // 2
        de = manter_de if manter_de is not None else max(fim, total - int(self.p["margem"] * SR))
        del self.pcm[: de * 2]
        if texto:
            self.parcial = ""
            self.contexto = (self.contexto + " " + texto)[-300:]
            self.dizer({"t": "final", "id": self.id, "epoca": self.epoca, "texto": texto})
        else:
            self.previa("")

    def passo(self, fechar=False):
        self.novo = 0
        total = len(self.pcm) // 2
        if not total:
            return
        falas = self.motor.fala(bytes(self.pcm))
        margem = int(self.p["margem"] * SR)
        if not falas:
            # Só silêncio: guarda o fim, para a fala que começar não perder o começo.
            if total > margem:
                del self.pcm[: (total - margem) * 2]
            self.previa("")
            return
        ini = max(0, falas[0][0] - margem)
        fim = min(total, falas[-1][1] + margem // 2)
        silencio = (total - falas[-1][1]) / SR
        aberto = (total - ini) / SR
        if fechar or silencio >= self.p["pausa"]:
            self.fechar(ini, fim)
            return
        if aberto >= self.p["duro"]:
            self.fechar(ini, total)
            return
        trechos = self.motor.transcrever(bytes(self.pcm[ini * 2:]), False, self.contexto)
        if aberto >= self.p["aberto"] and len(trechos) > 1:
            # Fala comprida sem pausa: fecha tudo menos a última frase, cortando no começo dela.
            corte = ini + int(trechos[-1][0] * SR)
            if corte - ini >= SR and corte < total:
                self.fechar(ini, corte, manter_de=corte)
                self.previa(aparar(trechos[-1][2]))
                return
        self.previa(aparar(" ".join(t[2] for t in trechos if t[2])))


class MotorEnsaio:
    """Sem modelo: para os testes do recorte."""

    aparelho = "ensaio"

    def __init__(self, ms=0):
        self.ms = ms

    @staticmethod
    def _amostras(pcm):
        a = array("h")
        a.frombytes(pcm[: len(pcm) // 2 * 2])
        return a

    def fala(self, pcm):
        a = self._amostras(pcm)
        janela = SR // 50  # 20 ms
        trechos = []
        ini = None
        for i in range(0, len(a) - janela + 1, janela):
            alto = max(a[i: i + janela]) > 1000
            if alto and ini is None:
                ini = i
            elif not alto and ini is not None:
                trechos.append([ini, i])
                ini = None
        if ini is not None:
            trechos.append([ini, len(a)])
        # Um vão de menos de 0,2 s não separa duas falas.
        juntos = []
        for t in trechos:
            if juntos and t[0] - juntos[-1][1] < SR // 5:
                juntos[-1][1] = t[1]
            else:
                juntos.append(t)
        return [(i, f) for i, f in juntos]

    def transcrever(self, pcm, final, _contexto):
        if self.ms:
            time.sleep(self.ms / 1000)
        a = self._amostras(pcm)
        # Cada "frase" é um pedaço de som na mesma altura: a letra vem da altura.
        saida = []
        for i, f in self.fala(pcm):
            pedacos = []
            for k in range(i, f, SR // 50):
                letra = chr(ord("a") + min(25, max(0, max(a[k: k + SR // 50]) // 1000 - 1)))
                if pedacos and pedacos[-1][0] == letra:
                    pedacos[-1][2] = min(f, k + SR // 50)
                else:
                    pedacos.append([letra, k, min(f, k + SR // 50)])
            for letra, k0, k1 in pedacos:
                saida.append((k0 / SR, k1 / SR, f"{letra}{round((k1 - k0) * 10 / SR)}{'!' if final else ''}"))
        return saida


class MotorWhisper:
    """O faster-whisper e o filtro de fala que vem com ele (Silero)."""

    def __init__(self, modelo, idioma, baixar, threads):
        import numpy as np
        import faster_whisper.transcribe as T
        from faster_whisper import WhisperModel
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        self.np = np
        self.idioma = idioma or None
        self._falas = get_speech_timestamps
        campos = getattr(VadOptions, "__dataclass_fields__", {}) or getattr(VadOptions, "_fields", ())
        quer = {"min_silence_duration_ms": 250, "speech_pad_ms": 80, "min_speech_duration_ms": 120}
        self._vad = VadOptions(**{k: v for k, v in quer.items() if k in campos})
        so_local = not baixar

        try:
            self.m = WhisperModel(modelo, device="cuda", compute_type="float16", local_files_only=so_local)
            self.aparelho = "cuda"
        except Exception:  # noqa: BLE001
            self.m = WhisperModel(modelo, device="cpu", compute_type="int8", cpu_threads=threads, local_files_only=so_local)
            self.aparelho = "cpu"
        # O faster-whisper completa cada trecho até 30 s antes de transcrever, e o custo é o da
        # janela inteira, por menor que seja a fala. Na CPU com o modelo leve, a janela acompanha o
        # tamanho do trecho: 3 s de fala saem em 0,3 s em vez de 1,7 s (medido). Os modelos maiores
        # repetem frases com a janela curta, e na placa de vídeo os 30 s já são rápidos: ficam como são.
        # Se esta versão do faster-whisper não aceitar a janela curta, fica nos 30 s também.
        self.quadros = None
        self.curta = self.aparelho == "cpu" and modelo in ("tiny", "base", "small") and hasattr(T, "pad_or_trim")
        if self.curta:
            original = T.pad_or_trim
            T.pad_or_trim = lambda a, length=None, **k: original(a, length if length is not None else (self.quadros or 3000), **k)
        self.folga = {False: float(os.environ.get("ORQ_DITADO_FOLGA_PREVIA", "1.5")), True: float(os.environ.get("ORQ_DITADO_FOLGA_FINAL", "3"))}
        self.feixe = {False: 1, True: int(os.environ.get("ORQ_DITADO_FEIXE_FINAL", "5"))}

    def _float(self, pcm):
        return self.np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=self.np.int16).astype(self.np.float32) / 32768.0

    def fala(self, pcm):
        return [(int(f["start"]), int(f["end"])) for f in self._falas(self._float(pcm), self._vad)]

    def _rodar(self, a, final, contexto, janela):
        self.quadros = janela * 100
        try:
            # O contexto (o que veio antes) só entra ao fechar: na prévia, com pouco som, o modelo
            # às vezes devolve o próprio contexto no lugar da fala.
            # O limite de palavras acompanha o tamanho do som (a fala corrida dá umas 4 por segundo):
            # sem ele, quando o som acaba o modelo às vezes entra em laço e escreve até cansar.
            segundos = len(a) / SR
            trechos, _ = self.m.transcribe(
                a, language=self.idioma, beam_size=self.feixe[final], temperature=(0.0, 0.4) if final else 0.0,
                condition_on_previous_text=False, initial_prompt=(contexto or None) if final else None, chunk_length=janela, vad_filter=False,
                max_new_tokens=int(segundos * (12 if final else 9)) + 24,
            )
            saida = [(t.start, t.end, limpar(t.text)) for t in trechos]
        finally:
            self.quadros = None
        # O mesmo eco, ao fechar: um trecho igual ao fim do contexto não é fala nova.
        fim = " ".join((contexto or "").split()).lower()
        return [t for t in saida if not (t[2] and len(t[2]) > 8 and fim.endswith(t[2].lower()))]

    def transcrever(self, pcm, final, contexto):
        a = self._float(pcm)
        janela = 30
        if self.curta:
            janela = min(30, max(4, int(math.ceil(len(a) / SR + self.folga[final]))))
        try:
            return self._rodar(a, final, contexto, janela)
        except Exception:  # noqa: BLE001
            if janela == 30:
                raise
            self.curta = False
            return self._rodar(a, final, contexto, 30)


def sair(codigo):
    # A linha de leitura fica presa lendo a entrada: sai sem esperar por ela.
    sys.stdout.flush()
    os._exit(codigo)


def ler(fila):
    f = sys.stdin.buffer
    while True:
        cab = f.read(5)
        if len(cab) < 5:
            break
        tamanho = struct.unpack("<I", cab[1:])[0]
        if tamanho > 4 * 1024 * 1024:
            break
        corpo = f.read(tamanho) if tamanho else b""
        if len(corpo) < tamanho:
            break
        if cab[:1] == b"A":
            fila.put(("audio", corpo))
        elif cab[:1] == b"C":
            try:
                fila.put(("cmd", json.loads(corpo.decode("utf-8"))))
            except ValueError:
                pass
    fila.put(("cmd", {"t": "sair"}))


def opcoes(args):
    o = {"modelo": "small", "idioma": "pt", "baixar": False, "ensaio": False, "threads": None, "p": dict(PADRAO)}
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("--baixar", "--ensaio"):
            o[a[2:]] = True
        elif a in ("--modelo", "--idioma", "--threads") and i + 1 < len(args):
            o[a[2:]] = args[i + 1]
            i += 1
        elif a[2:] in PADRAO and a.startswith("--") and i + 1 < len(args):
            o["p"][a[2:]] = float(args[i + 1])
            i += 1
        i += 1
    return o


def main():
    o = opcoes(sys.argv[1:])
    if not o["ensaio"]:
        # As bibliotecas da NVIDIA instaladas pelo pip precisam estar no caminho antes de o processo carregar.
        libs = glob.glob(os.path.join(os.path.dirname(os.path.dirname(sys.executable)), "lib", "python3.*", "site-packages", "nvidia", "*", "lib"))
        atual = os.environ.get("LD_LIBRARY_PATH", "")
        if libs and libs[0] not in atual and not os.environ.get("ORQ_VOZ_REEXEC"):
            os.environ["LD_LIBRARY_PATH"] = ":".join(libs + ([atual] if atual else []))
            os.environ["ORQ_VOZ_REEXEC"] = "1"
            os.execve(sys.executable, [sys.executable] + sys.argv, os.environ)
    fila = queue.Queue()
    threading.Thread(target=ler, args=(fila,), daemon=True).start()
    t0 = time.time()
    if o["ensaio"]:
        motor = MotorEnsaio(ms=int(os.environ.get("ORQ_DITADO_ENSAIO_MS", "0")))
    else:
        try:
            nucleos = os.cpu_count() or 4
            # 4 linhas de processamento: medido igual a 6 neste tipo de processador, e pesa menos no resto.
            threads = int(o["threads"] or os.environ.get("ORQ_DITADO_THREADS") or max(2, min(4, nucleos - 2)))
            motor = MotorWhisper(o["modelo"], o["idioma"], o["baixar"], threads)
        except Exception as e:  # noqa: BLE001
            texto = str(e)
            if isinstance(e, ImportError):
                texto = f"faster-whisper não está instalado neste Python: {e}"
            elif not o["baixar"] and any(x in texto.lower() for x in ("local", "snapshot", "cache")):
                texto = f"o modelo {o['modelo']} ainda não está neste computador"
            dizer({"t": "erro", "erro": texto})
            sair(4)
    dizer({"t": "pronto", "modelo": o["modelo"], "aparelho": motor.aparelho, "ms": int((time.time() - t0) * 1000)})
    d = Ditado(motor, o["p"])
    while True:
        try:
            item = fila.get(timeout=0.05)
        except queue.Empty:
            item = None
        while item:
            tipo, corpo = item
            if tipo == "audio":
                d.audio(corpo)
            else:
                t = corpo.get("t")
                try:
                    if t == "comecar":
                        d.comecar(corpo.get("id"), corpo.get("contexto") or "")
                    elif t == "cortar":
                        d.cortar(int(corpo.get("epoca") or 0), corpo.get("contexto"))
                    elif t == "parar":
                        d.terminar(True)
                    elif t == "largar":
                        d.terminar(False)
                    elif t == "sair":
                        sair(0)
                except Exception as e:  # noqa: BLE001
                    dizer({"t": "erro", "erro": str(e)})
                    d.terminar(False)
            try:
                item = fila.get_nowait()
            except queue.Empty:
                item = None
        if d.hora_do_passo():
            try:
                d.passo()
            except Exception as e:  # noqa: BLE001
                dizer({"t": "erro", "erro": str(e)})
                d.terminar(False)


if __name__ == "__main__":
    sys.exit(main())
