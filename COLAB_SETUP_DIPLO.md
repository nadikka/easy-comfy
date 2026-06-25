# Setup Colab para el DIPLO completo (fp8) — receta paso 1

Objetivo: dejar el pipeline **DIPLO completo** (`workflow_diplo.json`) corriendo en
ComfyUI sobre Colab (GPU T4, fp8 nativo), que es el backend elegido para la UI propia.

Hoy en Colab **faltan custom nodes** → sin ellos el DIPLO revienta al encolar.
Esta guía instala SOLO lo necesario para el flujo de la UI (escribís el prompt vos),
salteando el branch QwenVL de auto-prompt.

---

## 1) Celda de instalación de custom nodes (pegar en el notebook de Colab)

Correr DESPUÉS de que ComfyUI esté clonado en `/content/ComfyUI` y ANTES de lanzar
`main.py`. Si ya lanzaste ComfyUI, corré esto y reiniciá el server.

```python
import os, subprocess

CUSTOM = "/content/ComfyUI/custom_nodes"   # ajustar si tu ComfyUI vive en otra ruta
os.makedirs(CUSTOM, exist_ok=True)
os.chdir(CUSTOM)

# 5 repos necesarios para el DIPLO via UI (sin branch QwenVL):
repos = [
    "https://github.com/Fannovel16/comfyui_controlnet_aux",   # AIO_Preprocessor (Canny)  -> node 80
    "https://github.com/TTPlanetPig/Comfyui_TTP_Toolset",     # TTP_Tile_*/Image_Assy      -> nodes 49/50/52
    "https://github.com/yolain/ComfyUI-Easy-Use",             # easy imageList<->Batch     -> nodes 42/57
    "https://github.com/rgthree/rgthree-comfy",               # Image Resize/Comparer      -> node 87
    "https://github.com/LAOGOU-666/Comfyui-Memory_Cleanup",   # RAMCleanup                 -> nodes 64/65
]

for url in repos:
    name = url.rstrip("/").split("/")[-1]
    if os.path.isdir(name):
        print(f"[skip] {name} ya existe")
        continue
    print(f"[clone] {name}")
    subprocess.run(["git", "clone", "--depth", "1", url], check=True)

# Instalar requirements de los repos que los tengan
for name in os.listdir(CUSTOM):
    req = os.path.join(CUSTOM, name, "requirements.txt")
    if os.path.isfile(req):
        print(f"[pip] {name}/requirements.txt")
        subprocess.run(["pip", "install", "-q", "-r", req])

print("\n✅ Custom nodes instalados. Reiniciá ComfyUI (volvé a correr main.py).")
```

---

## 2) Modelos que tienen que estar en Colab

Custom nodes != pesos. Verificá que estos archivos existan en Colab (los demás ya se
confirmaron el 2026-06-19):

- `Z-Image-Turbo-Fun-Controlnet-Union.safetensors`  → `models/model_patches/`  (node 76, ModelPatchLoader)
- `2x-AnimeSharpV4_RCAN.safetensors`                 → `models/upscale_models/` (node 85, UpscaleModelLoader)

Ya confirmados presentes: UNet `z_image_turbo_fp8_e4m3fn.safetensors.safetensors`,
CLIP `qwen_3_4b.safetensors.safetensors`, VAE `ultrafluxVAEImproved_v10.safetensors`,
LoRA `Bradhamel_art_style.safetensors`.

---

## 3) Fix ya aplicado en el workflow (local, no tocar en Colab)

`workflow_diplo.json` node 28: `CLIPLoaderGGUF` → **`CLIPLoader`** (core, tipo `lumina2`).
El CLIP es `.safetensors`, no `.gguf` → con esto NO hace falta instalar `ComfyUI-GGUF` en Colab.

---

## 4) Branch QwenVL: salteado a propósito

Los nodos `AILab_QwenVL` (82), `ShowText|pysssss` (83) y su `LoadImage` (91) generan el
prompt automáticamente analizando una imagen. La UI inyecta el prompt que escribís
(nodos 6/7/47), así que **no se instalan** (`ComfyUI-QwenVL-Mod` + `ComfyUI-Custom-Scripts`)
ni se baja el modelo Qwen3-VL-4B (pesado). Si algún día querés el auto-prompt, se agregan
esos 2 repos y se decide el fork de QwenVL.

---

## 5) Próximo paso (con Colab prendido)

1. Prender Colab + celda cloudflared → copiar la URL `*.trycloudflare.com`.
2. Correr la celda de instalación (sección 1) y reiniciar ComfyUI.
3. Verificar via `GET {url}/object_info` que aparezcan: `AIO_Preprocessor`,
   `TTP_Tile_image_size`, `TTP_Image_Assy`, `easy imageListToImageBatch`,
   `Image Resize (rgthree)`, `RAMCleanup`.
4. Validar el DIPLO completo por API directa (POST `/prompt` con `workflow_diplo.json`)
   ANTES de tocar la UI.
5. Recién ahí: derivar el manifest manifest-driven del workflow que efectivamente corre.
