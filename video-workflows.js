// video-workflows.js — builders PUROS de grafos de video (Clase 5, Módulo 4).
// No tocan red ni ComfyUI: reciben params, devuelven { workflow, saveNodeId, requiredNodes }.
// server.js los consume, hace el pre-chequeo de /object_info con requiredNodes, y llama
// queuePollDownload(workflow, saveNodeId, ...). Separados en este módulo para poder
// validarlos offline (dry-run / node --check) sin depender del Colab (inestable, error 1033).
//
// Esquemas verificados contra la fuente real donde se pudo (ComfyUI core: CreateVideo,
// SaveVideo, VAEEncode, VAEDecode, KSampler, UNETLoader, CLIPLoader, VAELoader,
// CLIPTextEncode, AIO_Preprocessor, QwenImageDiffsynthControlnet, ModelPatchLoader —
// todos ya usados en workflow_diplo_colab_cn.json / generate-video-wan). Los nodos de
// los packs nuevos (VHS_LoadVideo, "FILM VFI") están tomados del inventario de la Clase 5
// (KNOW_HOW/CLASE5-INVENTARIO-Y-PLAN-EASYCOMFY.md) — MARCADOS abajo con ⚠️ VERIFICAR
// contra el /object_info real la primera vez que el Colab viva con los repos nuevos.

// Z-Image (mismos defaults que workflow_diplo_colab_cn.json / generarImagenDiploColab)
const ZIMAGE_UNET = 'z-image-turbo-fp8-e4m3fn.safetensors';
const ZIMAGE_WEIGHT_DTYPE = 'fp8_e4m3fn';
const ZIMAGE_VAE = 'ae.safetensors';
const ZIMAGE_CLIP = 'qwen_3_4b_fp8_mixed.safetensors';
const ZIMAGE_CLIP_TYPE = 'lumina2';
const ZIMAGE_CN_MODEL_PATCH = 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors';
const DEFAULT_NEGATIVE = 'blurry, ugly, low quality, deformed hands, extra limbs, text, watermark';

// ⚠️ VERIFICAR: nombre real del checkpoint FILM tal como lo expone el nodo instalado
// (Fannovel16/ComfyUI-Frame-Interpolation). Se descarga solo la 1ª vez que corre.
const FILM_CKPT = 'film_net_fp32.pt';

// Number(x) simple no alcanza para params como denoise=0 (valor legítimo) — `||` lo
// pisaría por el default; `??` no atrapa NaN (Number("") ?? def sigue siendo NaN).
// Estos endpoints son HTTP directos (curl-eables), no solo desde la UI (que ya manda
// valores válidos) — sanitizar acá evita mandarle un grafo con NaN a ComfyUI.
// OJO con la trampa de JS: Number('') y Number(null) dan 0, no NaN — sin el chequeo
// explícito de undefined/null/'' de abajo, un campo vacío se colaría como "0" (valor
// falso-legítimo) en vez de caer al default.
function numOr(v, def) {
    if (v === undefined || v === null || v === '') return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}

// Nodos que TODO builder de este módulo puede llegar a necesitar (para el pre-chequeo
// de /object_info en server.js). Cada builder devuelve su propio subconjunto en requiredNodes.
const NODE_VHS_LOAD = 'VHS_LoadVideo';
const NODE_FILM = 'FILM VFI'; // ⚠️ VERIFICAR: el class_type real puede llevar el espacio literal o no.

// ── buildInterpolateWorkflow ─────────────────────────────────────────────────
// VHS_LoadVideo → FILM VFI → CreateVideo → SaveVideo.
// mode: 'fluid' (fps × multiplier, mismo largo real, movimiento más suave) |
//       'slowmo' (fps sin cambios, el video queda más largo = cámara lenta).
function buildInterpolateWorkflow({ filename, multiplier = 2, mode = 'fluid', sourceFps = 24, filenamePrefix = 'film_interp' }) {
    if (!filename) throw new Error('falta filename (video ya subido a ComfyUI)');
    const mult = Number(multiplier) || 2;
    const srcFps = Number(sourceFps) || 24;
    const outFps = mode === 'slowmo' ? srcFps : (srcFps * mult);

    const workflow = {
        "1": {
            inputs: { video: filename, force_rate: 0, force_size: "Disabled", custom_width: 0, custom_height: 0,
                      frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1 },
            class_type: NODE_VHS_LOAD,
            _meta: { title: "cargar video" }
        },
        "2": {
            inputs: { ckpt_name: FILM_CKPT, frames: ["1", 0], clear_cache_after_n_frames: 10, multiplier: mult },
            class_type: NODE_FILM,
            _meta: { title: "FILM VFI (interpolar frames)" }
        },
        "3": {
            inputs: { fps: outFps, images: ["2", 0] },
            class_type: "CreateVideo",
            _meta: { title: "crear video interpolado" }
        },
        "4": {
            inputs: { filename_prefix: filenamePrefix, format: "auto", codec: "auto", video: ["3", 0] },
            class_type: "SaveVideo",
            _meta: { title: "guardar video" }
        }
    };

    return {
        workflow,
        saveNodeId: "4",
        requiredNodes: [NODE_VHS_LOAD, NODE_FILM, "CreateVideo", "SaveVideo"]
    };
}

// ── buildWanPostSmooth ───────────────────────────────────────────────────────
// Inserta un fragmento FILM VFI entre el VAEDecode y el CreateVideo de un workflow
// Wan 2.2 YA armado (mutación in-place, no devuelve un workflow nuevo). Reusa el
// patrón "toggle suavizar" — el resultado sigue teniendo el mismo saveNodeId final.
// decodeNodeId = nodo VAEDecode (imágenes crudas), combineNodeId = nodo CreateVideo
// (el que hoy toma "images" del decode; se re-cablea para que tome el output de FILM).
function buildWanPostSmooth(workflow, { decodeNodeId, combineNodeId, multiplier = 2, filmNodeId = "smoothFilm" }) {
    if (!workflow[decodeNodeId]) throw new Error(`falta el nodo de decode ${decodeNodeId} en el workflow`);
    if (!workflow[combineNodeId]) throw new Error(`falta el nodo de combine ${combineNodeId} en el workflow`);
    workflow[filmNodeId] = {
        inputs: { ckpt_name: FILM_CKPT, frames: [decodeNodeId, 0], clear_cache_after_n_frames: 10, multiplier: Number(multiplier) || 2 },
        class_type: NODE_FILM,
        _meta: { title: "FILM VFI (suavizar salida Wan)" }
    };
    workflow[combineNodeId].inputs.images = [filmNodeId, 0];
    return workflow;
}

// ── buildVideo2VideoWorkflow ──────────────────────────────────────────────────
// vid2vid estilo Octavio: VHS Load Video → resize 720×512 → ControlNet Depth +
// VAE Encode (i2i) EN SIMULTÁNEO → KSampler (denoise bajo) → VAEDecode → [FILM
// opcional] → CreateVideo → SaveVideo. La consistencia entre frames sale de sumar
// depth + i2i sobre el MISMO batch de frames, no de fijar la seed.
// Cableado de Z-Image copiado 1:1 de workflow_diplo_colab_cn.json (UNETLoader/
// CLIPLoader/VAELoader/QwenImageDiffsynthControlnet/ModelPatchLoader).
//
// Truco "probar 1 frame": si frameLoadCap===1, no tiene sentido armar un video de
// un solo frame → se reemplaza CreateVideo+SaveVideo por un SaveImage y se marca
// isPreviewFrame:true, para que el front lo muestre como imagen suelta antes de
// quemar créditos en el video completo.
function buildVideo2VideoWorkflow({
    filename, prompt, negativePrompt, denoise = 0.3, frameLoadCap = 0, forceRate = 16,
    steps = 8, cfg = 1.0, seed, controlnetStrength = 0.8,
    preprocessor = 'DepthAnythingV2Preprocessor', filmMultiplier = 0,
    filenamePrefix = 'v2v_octavio'
}) {
    if (!filename) throw new Error('falta filename (video ya subido a ComfyUI)');
    if (!prompt || !String(prompt).trim()) throw new Error('falta el prompt');
    const isPreviewFrame = Number(frameLoadCap) === 1;
    // numOr, no el chequeo de undefined/null/'': un seed truthy pero no-numérico (ej.
    // "abc" desde un curl a mano) pasaba Number("abc")=NaN sin red de contención.
    const realSeed = numOr(seed, Math.floor(Math.random() * 1e15) + 1);

    const workflow = {
        // ── carga + resize del video de entrada ──
        "1": {
            inputs: { video: filename, force_rate: Number(forceRate) || 16, force_size: "Disabled",
                      custom_width: 0, custom_height: 0, frame_load_cap: Number(frameLoadCap) || 0,
                      skip_first_frames: 0, select_every_nth: 1 },
            class_type: NODE_VHS_LOAD,
            _meta: { title: "cargar video (Octavio)" }
        },
        "2": {
            inputs: { image: ["1", 0], upscale_method: "lanczos", width: 720, height: 512, crop: "center" },
            class_type: "ImageScale",
            _meta: { title: "resize 720x512" }
        },
        // ── rama depth (ControlNet) ──
        "3": {
            inputs: { image: ["2", 0], preprocessor, resolution: 512 },
            class_type: "AIO_Preprocessor",
            _meta: { title: "preprocesador depth" }
        },
        // ── modelos Z-Image (cableado calcado de workflow_diplo_colab_cn.json) ──
        "16": { inputs: { unet_name: ZIMAGE_UNET, weight_dtype: ZIMAGE_WEIGHT_DTYPE }, class_type: "UNETLoader", _meta: { title: "UNET Z-Image" } },
        "17": { inputs: { vae_name: ZIMAGE_VAE }, class_type: "VAELoader", _meta: { title: "VAE" } },
        "28": { inputs: { clip_name: ZIMAGE_CLIP, type: ZIMAGE_CLIP_TYPE }, class_type: "CLIPLoader", _meta: { title: "CLIP" } },
        "76": { inputs: { name: ZIMAGE_CN_MODEL_PATCH }, class_type: "ModelPatchLoader", _meta: { title: "ControlNet Union (parche)" } },
        "75": {
            inputs: { model: ["16", 0], model_patch: ["76", 0], vae: ["17", 0], image: ["3", 0], strength: numOr(controlnetStrength, 0.8) },
            class_type: "QwenImageDiffsynthControlnet",
            _meta: { title: "ControlNet depth (parcha el modelo)" }
        },
        "6": { inputs: { text: String(prompt), clip: ["28", 0] }, class_type: "CLIPTextEncode", _meta: { title: "positive" } },
        "7": { inputs: { text: String(negativePrompt || DEFAULT_NEGATIVE), clip: ["28", 0] }, class_type: "CLIPTextEncode", _meta: { title: "negative" } },
        // ── rama i2i (VAE Encode del MISMO batch resizeado, en simultáneo con el depth) ──
        "8": { inputs: { pixels: ["2", 0], vae: ["17", 0] }, class_type: "VAEEncode", _meta: { title: "i2i encode (todo el batch)" } },
        "9": {
            inputs: {
                seed: realSeed, steps: Number(steps) || 8, cfg: numOr(cfg, 1.0),
                sampler_name: "euler", scheduler: "simple", denoise: numOr(denoise, 0.3),
                model: ["75", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["8", 0]
            },
            class_type: "KSampler",
            _meta: { title: "KSampler (depth + i2i simultáneo)" }
        },
        "10": { inputs: { samples: ["9", 0], vae: ["17", 0] }, class_type: "VAEDecode", _meta: { title: "decode" } }
    };

    if (isPreviewFrame) {
        workflow["11"] = { inputs: { filename_prefix: filenamePrefix + '_preview', images: ["10", 0] },
            class_type: "SaveImage", _meta: { title: "preview 1 frame" } };
        return {
            workflow,
            saveNodeId: "11",
            isPreviewFrame: true,
            requiredNodes: [NODE_VHS_LOAD, "ImageScale", "AIO_Preprocessor", "UNETLoader", "VAELoader", "CLIPLoader",
                "ModelPatchLoader", "QwenImageDiffsynthControlnet", "CLIPTextEncode", "VAEEncode", "KSampler", "VAEDecode", "SaveImage"]
        };
    }

    let decodeSource = "10";
    if (Number(filmMultiplier) > 1) {
        workflow["12"] = {
            inputs: { ckpt_name: FILM_CKPT, frames: ["10", 0], clear_cache_after_n_frames: 10, multiplier: Number(filmMultiplier) },
            class_type: NODE_FILM,
            _meta: { title: "FILM VFI (interpolar la salida)" }
        };
        decodeSource = "12";
    }
    workflow["13"] = { inputs: { fps: Number(forceRate) || 16, images: [decodeSource, 0] }, class_type: "CreateVideo", _meta: { title: "crear video" } };
    workflow["14"] = { inputs: { filename_prefix: filenamePrefix, format: "auto", codec: "auto", video: ["13", 0] },
        class_type: "SaveVideo", _meta: { title: "guardar video" } };

    const requiredNodes = [NODE_VHS_LOAD, "ImageScale", "AIO_Preprocessor", "UNETLoader", "VAELoader", "CLIPLoader",
        "ModelPatchLoader", "QwenImageDiffsynthControlnet", "CLIPTextEncode", "VAEEncode", "KSampler", "VAEDecode",
        "CreateVideo", "SaveVideo"];
    if (Number(filmMultiplier) > 1) requiredNodes.push(NODE_FILM);

    return { workflow, saveNodeId: "14", isPreviewFrame: false, requiredNodes };
}

module.exports = { buildInterpolateWorkflow, buildWanPostSmooth, buildVideo2VideoWorkflow, NODE_VHS_LOAD, NODE_FILM, FILM_CKPT };
