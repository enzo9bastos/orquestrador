"""Ditado: transcreve o microfone enquanto a pessoa fala (o app conversa com este script: ditado.js).

Uso: python ditado.py --modelo small [--revisor large-v3-turbo] [--idioma pt] [--threads 4] [--baixar] [--ensaio]

Fica rodando com o modelo carregado e atende um ditado por vez. O áudio chega pela entrada e só
existe na memória deste processo: nada é gravado em disco e nada sai do computador.

Entrada (stdin), em quadros: 1 byte de tipo + 4 bytes de tamanho (little-endian) + corpo
  'A'  áudio: PCM de 16 bits, 16 kHz, mono
  'C'  comando, em JSON:
         {"t": "comecar", "id": n}
         {"t": "cortar", "epoca": n}  larga o trecho aberto (a pessoa mexeu no texto)
         {"t": "parar"}    fecha o trecho aberto e termina o ditado
         {"t": "largar"}   termina sem fechar o trecho (o que estava na caixa já foi enviado)
         {"t": "sair"}

Saída (stdout), uma linha de JSON por evento:
  {"t": "pronto", "modelo", "previa", "revisor", "aparelho", "ms"}   modelo carregado; previa: o texto
                                              aparece enquanto a pessoa fala (senão, frase por frase)
  {"t": "escrevendo", "id", "epoca", "sim"}  só sem prévia: uma frase está sendo transcrita (ou acabou)
  {"t": "parcial", "id", "epoca", "texto"}   o trecho aberto até agora (ainda pode mudar)
  {"t": "final", "id", "epoca", "n", "texto"} um trecho fechado; n conta os trechos do ditado
  {"t": "revisao", "id", "epoca", "de", "ate", "texto"}  só com --revisor: o texto corrigido dos
                                              trechos de "de" até "ate" (no lugar do que saiu neles);
                                              com "igual": true no lugar do texto, ficam como estão
  {"t": "parou", "id"}                        o ditado terminou; tudo o que foi falado já saiu
  {"t": "erro", "erro"}

Como o texto aparece "enquanto fala" com um modelo que não é de tempo real: a cada pedaço novo de
áudio o trecho aberto inteiro é transcrito de novo, rápido (feixe 1), e sai como "parcial".
Quando a pessoa faz uma pausa, o trecho é transcrito com cuidado (feixe 5) e sai como "final".
Fala comprida sem pausa é fechada aos poucos, no fim de uma frase.

O texto que veio antes (o "contexto" que o app manda no começar e no cortar) NÃO é entregue ao
modelo. Entregue, ele era copiado para dentro das falas curtas: a prévia acertava "teste", o
fecho trocava por uma palavra errada e, com ela no contexto, todo "teste" seguinte saía igual
(medido com fala de verdade; sem o contexto não acontece).

Sem prévia: um modelo grande no processador (sem placa de vídeo) não acompanha a fala, então não
há "parcial": cada frase é transcrita uma vez só, quando a pessoa faz a pausa, e sai como "final"
alguns segundos depois. É o modo que menos usa o processador, e o que menos erra. Uma frase bem
curta (menos de 2 s) é transcrita junto com o som da anterior e sai como "revisao" das duas: sozinha,
o modelo grande erra (medido: "um ticket novo" solto saiu errado; junto com a frase anterior, certo).
Fala comprida sem pausa é fechada no maior vão entre as palavras.

--revisor: um modelo maior, lento demais para acompanhar a fala num processador comum, corrige
por trás o que o modelo de --modelo já fechou. Ele trabalha em blocos: os trechos fechados que
estiverem esperando vão juntos; um trecho curto (menos de 2 s) vai junto com o som do bloco
anterior, porque um pedacinho solto o modelo grande erra mais do que o pequeno (medido). O que
continua curto demais mesmo assim fica como está.

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
    "rev_min": 2.0,    # correção: bloco com menos fala que isto vai junto com o som do bloco anterior
    "rev_pouco": 1.2,  # correção: com menos fala que isto, mesmo junto, fica como está
    "rev_max": 8.0,    # correção: o maior bloco que é refeito para acompanhar um trecho curto
}
# Frases que o whisper inventa em cima de ruído (teclado, respiração), em português. Só valem
# quando são o trecho inteiro.
FANTASMAS = {
    "obrigado por assistir", "legendas pela comunidade amara.org", "legendas pela comunidade do amara.org",
    "inscreva-se no canal", "e aí", "tchau, tchau", "tchau tchau", "transcrição e legendas pela comunidade amara.org",
}


TRAVA_DA_SAIDA = threading.Lock()


def dizer(o):
    with TRAVA_DA_SAIDA:
        sys.stdout.write(json.dumps(o, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def limpar(texto):
    t = " ".join((texto or "").split())
    if t.strip(" .!?…").lower() in FANTASMAS:
        return ""
    # Reticências repetidas ("... ... ...") são o modelo enchendo o silêncio do fim do trecho.
    t = re.sub(r"(\s*(\.{3}|…)){2,}", "...", t)
    # A mesma frase várias vezes em seguida é o modelo em laço: fica uma só.
    return sem_repetida(re.sub(r"(\b[^.!?]{12,}[.!?])(\s*\1)+", r"\1", sem_laco(t)))


def sem_repetida(texto):
    """Uma frase que só repete o que o mesmo trecho já disse (inteira, ou o fim de uma anterior)
    é o modelo voltando atrás quando o som acaba: sai. "A. B. A." fica "A. B."."""
    frases = re.split(r"(?<=[.!?…])\s+", texto)
    if len(frases) < 2:
        return texto
    chave = lambda f: " ".join(re.sub(r"[^\w\s]", " ", f.lower()).split())  # noqa: E731
    ficam, dito = [], ""
    for f in frases:
        k = chave(f)
        if len(k) >= 8 and k in dito:
            continue
        ficam.append(f)
        dito = (dito + " " + k).strip()
    return " ".join(ficam)


def sem_laco(texto):
    """O mesmo pedaço três vezes ou mais em seguida é o modelo em laço, o que acontece quando o
    som do trecho acaba e ele continua escrevendo: fica uma vez só. Um pedaço comprido (5 palavras
    ou mais) já conta na segunda vez: ninguém repete uma frase inteira por querer."""
    p = texto.split(" ")
    chave = [x.lower().strip(".,;:!?…") for x in p]
    saida = []
    i = 0
    while i < len(p):
        pulou = False
        for k in range(1, 13):
            minimo = 2 if k >= 5 else 3
            if i + minimo * k > len(p):
                continue
            unidade = chave[i: i + k]
            if not any(unidade):
                continue
            vezes = 1
            while chave[i + vezes * k: i + (vezes + 1) * k] == unidade:
                vezes += 1
            if vezes >= minimo:
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


class Revisor:
    """Corrige por trás, com um modelo maior, o que o ditado já fechou (em outra linha de processamento)."""

    def __init__(self, carregar, p, dizer_evento=dizer):
        self.carregar = carregar  # () -> função que transcreve um som (o modelo carrega aqui dentro)
        self.p = p
        self.dizer = dizer_evento
        self.cv = threading.Condition()
        self.fila = []         # trechos esperando: (n, som)
        self.anterior = None   # (n do primeiro trecho, som) do último bloco, para acompanhar um trecho curto
        self.chave = None      # (ditado, época) de agora: o que for de outra é jogado fora
        self.ocupado = False
        self.morto = False
        threading.Thread(target=self.rodar, daemon=True).start()

    def zerar(self, chave=None):
        with self.cv:
            self.fila, self.anterior, self.chave = [], None, chave
            self.cv.notify_all()

    def entregar(self, chave, n, som):
        with self.cv:
            if chave != self.chave:
                self.fila, self.anterior, self.chave = [], None, chave
            self.fila.append((n, som))
            self.cv.notify_all()

    def esvaziar(self, limite):
        """Espera o que está na fila ser corrigido (o ditado está terminando)."""
        fim = time.time() + limite
        with self.cv:
            while (self.fila or self.ocupado) and not self.morto and time.time() < fim:
                self.cv.wait(0.1)

    def rodar(self):
        try:
            transcrever = self.carregar()
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"o modelo de correção não carregou: {e}\n")
            transcrever = None
            with self.cv:
                self.morto = True
        while True:
            with self.cv:
                while not self.fila:
                    self.cv.wait()
                chave, grupo, anterior = self.chave, self.fila, self.anterior
                self.fila = []
                self.ocupado = True
            try:
                self.revisar(transcrever, chave, grupo, anterior)
            except Exception as e:  # noqa: BLE001
                sys.stderr.write(f"a correção falhou: {e}\n")
                self.avisar(chave, {"de": grupo[0][0], "ate": grupo[-1][0], "igual": True})
            finally:
                with self.cv:
                    self.ocupado = False
                    self.cv.notify_all()

    def avisar(self, chave, evento):
        with self.cv:
            if chave != self.chave:
                return False
        self.dizer({"t": "revisao", "id": chave[0], "epoca": chave[1], **evento})
        return True

    def revisar(self, transcrever, chave, grupo, anterior):
        b = SR * 2
        de, ate = grupo[0][0], grupo[-1][0]
        partes = [som for _, som in grupo]
        segundos = sum(len(x) for x in partes) / b
        # Pouca fala: vai junto com o som do bloco anterior (um pedacinho solto sai pior).
        if segundos < self.p["rev_min"] and anterior and segundos + len(anterior[1]) / b <= self.p["rev_max"]:
            de = anterior[0]
            partes = [anterior[1]] + partes
            segundos += len(anterior[1]) / b
        som = (b"\0" * int(0.4 * b)).join(partes)  # 0,4 s de silêncio entre um trecho e outro
        if transcrever is None or segundos < self.p["rev_pouco"]:
            self.avisar(chave, {"de": grupo[0][0], "ate": ate, "igual": True})
        else:
            texto = transcrever(som)
            self.avisar(chave, {"de": de, "ate": ate, "texto": texto} if texto else {"de": de, "ate": ate, "igual": True})
        guardar = (de, som) if segundos <= self.p["rev_max"] else (ate, grupo[-1][1])
        with self.cv:
            if chave == self.chave:
                self.anterior = guardar


class Ditado:
    """O recorte: junta o áudio que chega, decide quando sai prévia e quando o trecho fecha."""

    def __init__(self, motor, p, dizer_evento=dizer, revisor=None):
        self.motor = motor
        self.p = p
        self.dizer = dizer_evento
        self.revisor = revisor
        self.ativo = False
        self.id = None
        self.n = 0  # quantos trechos este ditado já fechou
        self.anterior = None  # sem prévia: (n do primeiro trecho, som) da última frase, para acompanhar uma curta
        self.epoca = 0
        self.pcm = bytearray()
        self.novo = 0
        self.contexto = ""
        self.parcial = ""

    def comecar(self, id_, contexto):
        self.ativo = True
        self.id = id_
        self.n = 0
        self.anterior = None
        self.epoca = 0
        self.pcm = bytearray()
        self.novo = 0
        self.contexto = (contexto or "")[-300:]
        self.parcial = ""
        if self.revisor:
            self.revisor.zerar((self.id, self.epoca))

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
        self.anterior = None
        if contexto is not None:
            self.contexto = contexto[-300:]
        if self.revisor:
            self.revisor.zerar((self.id, self.epoca))

    def terminar(self, fechar):
        if not self.ativo:
            return
        if fechar:
            self.passo(fechar=True)
            if self.revisor:
                self.revisor.esvaziar(6)  # o que falta corrigir sai antes do "parou" (o que não der tempo fica como está)
        if self.revisor:
            self.revisor.zerar()
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

    def com_previa(self):
        return getattr(self.motor, "previa", True)

    def fechar_frase(self, som, fim, manter_de):
        """Sem prévia: a frase inteira, uma vez só. A frase curta vai junto com o som da anterior e
        o texto novo vale pelas duas."""
        total = len(self.pcm) // 2
        de = manter_de if manter_de is not None else max(fim, total - int(self.p["margem"] * SR))
        del self.pcm[: de * 2]
        b = SR * 2
        n = self.n
        self.n += 1
        segundos = len(som) / b
        ant = self.anterior
        self.dizer({"t": "escrevendo", "id": self.id, "epoca": self.epoca, "sim": True})
        try:
            if segundos < self.p["rev_min"] and ant and segundos + len(ant[1]) / b <= self.p["rev_max"]:
                junto = ant[1] + b"\0" * int(0.4 * b) + som
                texto = self.motor.frase(junto)
                if texto:
                    self.dizer({"t": "revisao", "id": self.id, "epoca": self.epoca, "de": ant[0], "ate": n, "texto": texto})
                    self.anterior = (ant[0], junto)
                return
            texto = self.motor.frase(som)
            if texto:
                self.dizer({"t": "final", "id": self.id, "epoca": self.epoca, "n": n, "texto": texto})
                self.anterior = (n, som) if segundos <= self.p["rev_max"] else None
        finally:
            self.dizer({"t": "escrevendo", "id": self.id, "epoca": self.epoca, "sim": False})

    def maior_vao(self, falas, ini):
        """Fala comprida sem pausa: o meio do maior vão entre as palavras (depois dos 2 primeiros segundos)."""
        melhor, corte = 0, None
        for (_, fim_a), (ini_b, _) in zip(falas, falas[1:]):
            if fim_a - ini >= 2 * SR and ini_b - fim_a > melhor:
                melhor, corte = ini_b - fim_a, (fim_a + ini_b) // 2
        return corte

    def fechar(self, ini, fim, manter_de=None):
        som = bytes(self.pcm[ini * 2: fim * 2])
        if not self.com_previa():
            self.fechar_frase(som, fim, manter_de)
            return
        trechos = self.motor.transcrever(som, True, self.contexto)
        texto = " ".join(t[2] for t in trechos if t[2])
        total = len(self.pcm) // 2
        de = manter_de if manter_de is not None else max(fim, total - int(self.p["margem"] * SR))
        del self.pcm[: de * 2]
        if texto:
            self.parcial = ""
            self.contexto = (self.contexto + " " + texto)[-300:]
            n = self.n
            self.n += 1
            self.dizer({"t": "final", "id": self.id, "epoca": self.epoca, "n": n, "texto": texto})
            if self.revisor:
                self.revisor.entregar((self.id, self.epoca), n, som)
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
        if not self.com_previa():
            # Sem prévia nada é transcrito no meio da fala: só se fecha, na pausa (acima) ou, em fala
            # comprida, no maior vão entre as palavras.
            if aberto >= self.p["aberto"]:
                corte = self.maior_vao(falas, ini)
                if corte:
                    self.fechar(ini, corte, manter_de=corte)
                    return
            if aberto >= self.p["duro"]:
                self.fechar(ini, total)
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

    def __init__(self, ms=0, previa=True):
        self.ms = ms
        self.previa = previa

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

    def frase(self, som):
        """Sem prévia: a frase inteira de uma vez (as "palavras" do som, em maiúscula)."""
        espera = int(os.environ.get("ORQ_DITADO_ENSAIO_FRASE_MS", "0")) / 1000
        if espera:
            time.sleep(espera)
        return " ".join(t[2].upper() for t in self.transcrever(som, False, ""))

    def revisor(self, _nome):
        """A correção de mentira: as mesmas "palavras" do som, em maiúscula."""
        espera = int(os.environ.get("ORQ_DITADO_ENSAIO_REV_MS", "0")) / 1000

        def revisar(som):
            if espera:
                time.sleep(espera)
            return " ".join(t[2].upper() for t in self.transcrever(som, False, ""))
        return revisar


class MotorWhisper:
    """O faster-whisper e o filtro de fala que vem com ele (Silero)."""

    def __init__(self, modelo, idioma, baixar, threads):
        import numpy as np
        import faster_whisper.transcribe as T
        from faster_whisper import WhisperModel
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        self.np = np
        self.Modelo = WhisperModel
        self.so_local = not baixar
        self.threads = threads
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
        # A janela de agora é de cada linha de processamento (o modelo de correção roda em outra).
        self.aqui = threading.local()
        self.encurta = hasattr(T, "pad_or_trim")
        leve = modelo in ("tiny", "base", "small")
        # Com prévia (o texto aparece enquanto a pessoa fala): só quando o modelo acompanha a fala,
        # que é o leve no processador ou qualquer um na placa de vídeo. Um modelo grande no
        # processador trabalha frase por frase (ver frase()).
        self.previa = leve or self.aparelho == "cuda"
        self.curta = self.aparelho == "cpu" and leve and self.encurta
        self.bloco_curto = {"sim": self.aparelho == "cpu" and self.encurta}
        self.folga_bloco = float(os.environ.get("ORQ_DITADO_FOLGA_BLOCO", "6"))
        if self.encurta:
            original = T.pad_or_trim
            T.pad_or_trim = lambda a, length=None, **k: original(a, length if length is not None else (getattr(self.aqui, "quadros", None) or 3000), **k)
        self.folga = {False: float(os.environ.get("ORQ_DITADO_FOLGA_PREVIA", "1.5")), True: float(os.environ.get("ORQ_DITADO_FOLGA_FINAL", "3"))}
        self.feixe = {False: 1, True: int(os.environ.get("ORQ_DITADO_FEIXE_FINAL", "5"))}

    def _float(self, pcm):
        return self.np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=self.np.int16).astype(self.np.float32) / 32768.0

    def fala(self, pcm):
        return [(int(f["start"]), int(f["end"])) for f in self._falas(self._float(pcm), self._vad)]

    def _rodar(self, a, final, janela):
        self.aqui.quadros = janela * 100
        try:
            # Sem contexto nenhum (initial_prompt): cada trecho é transcrito só pelo som dele.
            # O limite de palavras acompanha o tamanho do som (a fala corrida dá umas 4 por segundo):
            # sem ele, quando o som acaba o modelo às vezes entra em laço e escreve até cansar.
            segundos = len(a) / SR
            trechos, _ = self.m.transcribe(
                a, language=self.idioma, beam_size=self.feixe[final], temperature=(0.0, 0.4) if final else 0.0,
                condition_on_previous_text=False, initial_prompt=None, chunk_length=janela, vad_filter=False,
                max_new_tokens=int(segundos * (12 if final else 9)) + 24,
            )
            return [(t.start, t.end, limpar(t.text)) for t in trechos]
        finally:
            self.aqui.quadros = None

    def transcrever(self, pcm, final, _contexto):
        a = self._float(pcm)
        janela = 30
        if self.curta:
            janela = min(30, max(4, int(math.ceil(len(a) / SR + self.folga[final]))))
        try:
            return self._rodar(a, final, janela)
        except Exception:  # noqa: BLE001
            if janela == 30:
                raise
            self.curta = False
            return self._rodar(a, final, 30)

    def _bloco(self, m, som, curto):
        """Um bloco inteiro de uma vez, com um modelo grande: feixe 1, sem contexto e sem marcas de
        tempo (com a janela curta o modelo grande se perde nelas e repete ou inventa pedaços; medido).
        A janela acompanha o bloco, com 6 s de folga: medido com o robusto em 4 linhas, uma frase
        de 2,5 s sai em 1,5 s (com a janela de 30 s são 9 a 12 s), e com só 3 s de folga o fim da
        frase saía truncado."""
        a = self._float(som)

        def rodar(janela):
            self.aqui.quadros = janela * 100
            try:
                trechos, _ = m.transcribe(
                    a, language=self.idioma, beam_size=1, temperature=0.0, condition_on_previous_text=False, initial_prompt=None,
                    chunk_length=janela, vad_filter=False, max_new_tokens=int(len(a) / SR * 12) + 24, without_timestamps=True,
                )
                return limpar(" ".join(t.text.strip() for t in trechos))
            finally:
                self.aqui.quadros = None

        janela = min(30, max(4, int(math.ceil(len(a) / SR + self.folga_bloco)))) if curto["sim"] else 30
        try:
            return rodar(janela)
        except Exception:  # noqa: BLE001
            if janela == 30:
                raise
            curto["sim"] = False
            return rodar(30)

    def frase(self, som):
        """Sem prévia: a frase inteira de uma vez, com o modelo deste motor."""
        return self._bloco(self.m, som, self.bloco_curto)

    def revisor(self, nome):
        """Carrega o modelo de correção (roda na linha de processamento dele) e devolve a função
        que transcreve um bloco."""
        m = self.Modelo(nome, device="cpu", compute_type="int8", cpu_threads=self.threads, local_files_only=self.so_local)
        curto = {"sim": self.encurta}
        return lambda som: self._bloco(m, som, curto)


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
    o = {"modelo": "small", "revisor": None, "idioma": "pt", "baixar": False, "ensaio": False, "sem-previa": False, "threads": None, "p": dict(PADRAO)}
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("--baixar", "--ensaio", "--sem-previa"):
            o[a[2:]] = True
        elif a in ("--modelo", "--revisor", "--idioma", "--threads") and i + 1 < len(args):
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
        motor = MotorEnsaio(ms=int(os.environ.get("ORQ_DITADO_ENSAIO_MS", "0")), previa=not o["sem-previa"])
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
    # O modelo de correção só entra quando é outro e o ditado roda no processador (na placa de
    # vídeo o modelo grande já acompanha a fala). Ele carrega na linha de processamento dele,
    # sem segurar o "pronto".
    com_revisor = o["revisor"] and o["revisor"] != o["modelo"] and motor.aparelho != "cuda" and motor.previa
    revisor = Revisor(lambda: motor.revisor(o["revisor"]), o["p"]) if com_revisor else None
    dizer({"t": "pronto", "modelo": o["modelo"], "previa": bool(motor.previa), "revisor": o["revisor"] if com_revisor else None, "aparelho": motor.aparelho, "ms": int((time.time() - t0) * 1000)})
    d = Ditado(motor, o["p"], revisor=revisor)
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
