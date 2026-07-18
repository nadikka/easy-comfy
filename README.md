

**English**

![easy comfy — home](docs/screenshots/shot-en-1.png)
![easy comfy — controls and gallery](docs/screenshots/shot-en-3.png)

> *The fox image is a sample generated with this same pipeline (Z-Image Turbo).*


A simple web UI to generate images with **ComfyUI**, without wiring the node graph by hand. You
write what you want, pick a mode, and comfyweb talks to a ComfyUI instance (local or in the cloud)
behind the scenes and returns the image.

The trick: **the computing (the GPU) doesn't run on your PC** — it runs on a free **Google Colab**.
comfyweb is just the lightweight interface that runs on your machine and sends the requests to Colab.

```
   Your browser  ─►  comfyweb (Node, your PC)  ─►  ComfyUI + GPU (Google Colab)
   localhost:8085                                   (Cloudflare public tunnel)
```

## Two parts (and both are yours)

1. **comfyweb** (this repo) — the UI, runs on your PC.
2. **The Colab** — the GPU. It lives in a separate repo:
   **https://github.com/nadikka/comfy-colab-leo** (notebook `ComfyUI_Web.ipynb`).

You open and run the Colab **in your own Google account** — you use *your* free GPU, nobody else's.
The notebook downloads the models to *your* Google Drive and gives you a public URL to connect your
comfyweb. All under your account, without depending on anyone else being online.

> Open the notebook directly in Colab here:
> https://colab.research.google.com/github/nadikka/comfy-colab-leo/blob/master/ComfyUI_Web.ipynb

## What you need (once)

1. **Node.js** installed (v18 or newer) → https://nodejs.org ("LTS" button).
2. A **Google account** (for Colab). No payment required.

You don't need to install ComfyUI, models, or Python on your PC. All of that lives on Colab.

## How to use it (each time, ~3 minutes)

### Step 1 — Start the GPU on Colab

1. Open the notebook: **https://colab.research.google.com/github/nadikka/comfy-colab-leo/blob/master/ComfyUI_Web.ipynb**
2. Top right, pick the GPU: **Runtime → Change runtime type**.
   **T4** (free) is enough for Create, ControlNet, LoRA, Describe and Restore. Only the
   **Edit** mode (Qwen-Image-Edit) needs **L4** (on T4 it runs out of memory / OOM).
3. **Runtime → Run all.** The first time it downloads the models to *your* Google Drive
   (~14 GB, takes a while); after that it starts in 2-3 min.
4. When it finishes, at the very bottom it prints a **public URL**, like:
   ```
   URL PÚBLICA (random, pegala en comfyweb):
   https://something-something.trycloudflare.com
   ```
   **Copy that URL.** (It changes every time you restart Colab — that's normal.)

### Step 2 — Start comfyweb on your PC

In a terminal, inside this folder:

```bash
npm install     # first time only
npm start
```

- **Windows:** you can also double-click `run-colab.bat`.
- **Mac / Linux:** you can also run `./start.sh`.

It opens at **http://localhost:8085**.

### Step 3 — Connect and generate

1. In comfyweb, click **"Colab (Cloudflare)"**.
2. Paste the `...trycloudflare.com` URL from Step 1 and click **"Save & Connect"**.
3. Write your prompt, pick a mode and generate. Done.

## Notes

- The Colab URL **changes** every time you restart the notebook. If you lose connection,
  re-run the last Colab cell, copy the new URL and paste it again into the "Colab" button.
- comfyweb saves your URL in `config.json` (stays only on your PC, not pushed to the repo).
- To generate against a **local** ComfyUI instead of Colab, paste `http://localhost:8188`.

## Credits

comfyweb is built on top of [**jpupper's comfyweb**](https://github.com/jpupper/comfyweb)
(the base ComfyUI↔web bridge). The *easy comfy* layer (intent-based UI, modes, integration with the
Z-Image Colab notebook, bilingual UI) is my own work on that base.
