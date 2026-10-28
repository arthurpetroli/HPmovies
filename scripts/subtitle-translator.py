#!/usr/bin/env python3
"""Loopback-only EN→PT-BR service for the optional subtitle fallback.

The endpoints implement the subset of LibreTranslate used by HPmovies. This
service uses the Argos-packaged OPUS-MT model directly through CTranslate2; it
does not run a LibreTranslate installation or expose a public translation API.
"""

import json
import os
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import ctranslate2
import sentencepiece

ROOT = Path(os.environ.get("HPMOVIES_TRANSLATOR_HOME", Path.home() / ".cache/hpmovies/subtitle-translator"))
MODEL = ROOT / "models/translate-en_pb-1_9"
PORT = int(os.environ.get("HPMOVIES_TRANSLATOR_PORT", "5000"))
PROCESSOR = sentencepiece.SentencePieceProcessor(model_file=str(MODEL / "sentencepiece.model"))
TRANSLATOR = ctranslate2.Translator(str(MODEL / "model"), device="cpu", compute_type="int8", inter_threads=1, intra_threads=4)
LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_args):
        # Do not persist subtitle dialogue, request URLs or query parameters.
        pass

    def respond(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path == "/languages":
            self.respond(200, [{"code": "en", "name": "English", "targets": ["pt"]}])
        elif self.path == "/health":
            self.respond(200, {"status": "OK", "model": "Argos EN→PT-BR 1.9", "license": "CC BY 4.0"})
        else:
            self.respond(404, {"error": "Rota não encontrada."})

    def do_POST(self):
        # Browser origins are unnecessary: only the local HPmovies API connects.
        if self.path != "/translate" or self.headers.get("Origin"):
            self.respond(403, {"error": "Use a API local do HPmovies."})
            return
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
            self.respond(400, {"error": "JSON obrigatório."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 24_000:
                raise ValueError()
            request = json.loads(self.rfile.read(size))
            if not isinstance(request, dict) or request.get("source") != "en" or request.get("target") != "pt" or request.get("format") != "text":
                raise ValueError()
            texts = request.get("q")
            if not isinstance(texts, list) or not 0 < len(texts) <= 32 or any(not isinstance(text, str) or not text.strip() or len(text) > 1500 for text in texts):
                raise ValueError()
            if sum(map(len, texts)) > 4000:
                raise ValueError()
        except (ValueError, TypeError, UnicodeDecodeError, TimeoutError):
            self.respond(400, {"error": "Lote de tradução inválido."})
            return
        if not LOCK.acquire(timeout=2):
            self.respond(429, {"error": "Tradutor ocupado."})
            return
        try:
            encoded = [PROCESSOR.encode(text, out_type=str) for text in texts]
            # Reject oversized sequences rather than silently truncate a cue.
            if any(len(tokens) > 512 for tokens in encoded):
                self.respond(400, {"error": "Uma fala excede o limite de tokens do modelo."})
                return
            results = TRANSLATOR.translate_batch(encoded, beam_size=2, replace_unknowns=True, max_decoding_length=768)
            if any(len(result.hypotheses[0]) >= 768 for result in results):
                self.respond(502, {"error": "Uma tradução atingiu o limite de saída do modelo."})
                return
            translated = [PROCESSOR.decode(result.hypotheses[0]).replace("▁", " ").strip() for result in results]
            if any(not text for text in translated):
                self.respond(502, {"error": "O modelo não produziu uma tradução completa."})
                return
            self.respond(200, {"translatedText": translated})
        except Exception:
            self.respond(502, {"error": "Não foi possível traduzir este lote."})
        finally:
            LOCK.release()


if __name__ == "__main__":
    print(f"[legendas] Tradutor local EN→PT-BR em http://127.0.0.1:{PORT}; modelo Argos/OPUS-MT CC BY 4.0.", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
