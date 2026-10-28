#!/usr/bin/env python3
"""Install the optional CPU subtitle translator in an isolated local cache."""

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import venv
import zipfile

ROOT = Path(os.environ.get("HPMOVIES_TRANSLATOR_HOME", Path.home() / ".cache/hpmovies/subtitle-translator"))
MODEL = "translate-en_pb-1_9"
MODEL_SHA256 = "1d1cd5e9540c6b38c258bed002a42d3b311b8a189acb74feaa311ef30d175c5b"
MODEL_URL = f"https://argos-net.com/v1/{MODEL}.argosmodel"


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    environment = ROOT / "venv"
    if not (environment / "bin/python").exists():
        venv.EnvBuilder(with_pip=True).create(environment)
    subprocess.run([
        str(environment / "bin/python"), "-m", "pip", "install",
        "ctranslate2==4.8.4", "sentencepiece==0.2.2",
    ], check=True)
    archive = ROOT / f"{MODEL}.argosmodel"
    if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != MODEL_SHA256:
        temporary = archive.with_suffix(".download")
        request = urllib.request.Request(MODEL_URL, headers={"User-Agent": "Mozilla/5.0 (HPmovies local subtitle translator)"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response, temporary.open("wb") as output:
                size = 0
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > 100_000_000:
                        raise RuntimeError("O modelo ultrapassou o limite de download.")
                    output.write(chunk)
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != MODEL_SHA256:
                raise RuntimeError("O arquivo do modelo não corresponde ao SHA-256 revisado.")
            temporary.replace(archive)
        finally:
            temporary.unlink(missing_ok=True)
    destination = ROOT / "models"
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if len(entries) > 64 or sum(entry.file_size for entry in entries) > 200_000_000:
            raise RuntimeError("Arquivo de modelo incompatível.")
        for entry in entries:
            path = Path(entry.filename)
            if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != MODEL:
                raise RuntimeError("O modelo contém um caminho inválido.")
            # Retain upstream attribution; the unused Stanza model is unnecessary.
            if "stanza" in path.parts:
                continue
            target = destination / path
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open(entry) as original, target.open("wb") as output:
                    shutil.copyfileobj(original, output)
    print(f"Modelo EN→PT-BR instalado em {destination / MODEL}.")
    print("O README.md do modelo preserva a atribuição e a licença CC BY 4.0.")
    print(f"Inicie com: {environment / 'bin/python'} scripts/subtitle-translator.py")


if __name__ == "__main__":
    main()
