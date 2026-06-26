// Test end-to-end FASE 2: upload imagen -> preprocess-preview (Canny) -> generar con ControlNet (diplocolabcn).
// Simula lo que hace el navegador. Corre desde la carpeta comfyweb: node _test_fase2_cn.js
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const BASE = 'http://localhost:8085';
const IMG = path.join(__dirname, 'public', 'imagenes', 'diplo_upscale_00008_.png');
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

// Nombres reales del Colab nuevo (lo que models.js auto-seleccionaria en el browser)
const MODELS = {
    unet_name: 'z-image-turbo-fp8-e4m3fn.safetensors',
    vae_name: 'ae.safetensors',
    clip_name: 'qwen_3_4b_fp8_mixed.safetensors',
    model_patch_name: 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors',
};

async function main() {
    // 1) UPLOAD
    const b64 = fs.readFileSync(IMG).toString('base64');
    console.log(`[${el()}] 1) Subiendo imagen de referencia (${(b64.length/1024).toFixed(0)} KB b64)...`);
    const up = await fetch(BASE + '/api/upload-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'test_ref.png', dataUrl: 'data:image/png;base64,' + b64 })
    }).then(r => r.json());
    console.log(`[${el()}]    ->`, JSON.stringify(up));
    if (!up.success) throw new Error('upload fallo: ' + up.error);
    const refName = up.name;

    // 2) PREPROCESS PREVIEW
    console.log(`[${el()}] 2) Preview CannyEdgePreprocessor...`);
    const pv = await fetch(BASE + '/api/preprocess-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: refName, preprocessor: 'CannyEdgePreprocessor', resolution: 512, scale_by: 1.0 })
    }).then(r => r.json());
    console.log(`[${el()}]    ->`, JSON.stringify(pv));
    if (!pv.success) throw new Error('preview fallo: ' + pv.error);

    // 3) GENERAR con ControlNet
    console.log(`[${el()}] 3) Generando con ControlNet (diplocolabcn)...`);
    const ws = new WebSocket('ws://localhost:8085');
    ws.on('open', () => {
        ws.send(JSON.stringify({
            type: 'generarImagen',
            prompt: 'lowpoly geometric landscape, mountains and a lake at dusk, eran hilleli style, cinematic soft light',
            workflow: 'diplocolabcn',
            params: {
                ...MODELS,
                ref_image: refName,
                preprocessor: 'CannyEdgePreprocessor',
                preprocessor_resolution: 512,
                controlnet_strength: 0.8,
                steps: 8, cfg: 1.0, denoise: 0.55, width: 1024, height: 640, seed: 123456789,
            }
        }));
    });
    ws.on('message', (data) => {
        let m; try { m = JSON.parse(data.toString()); } catch { return; }
        if (m.type === 'generation_progress') { process.stdout.write(`\r[${el()}]    progreso ${m.percent || ''}% (step ${m.value}/${m.max})   `); return; }
        if (m.type === 'generation_status') { console.log(`\n[${el()}]    status: ${m.status} - ${m.message || ''}`); if (m.status === 'error') process.exit(1); return; }
        if (m.type === 'image_generated') {
            console.log(`\n[${el()}] ✅ IMAGEN GENERADA: ${m.url}`);
            console.log(`[${el()}] OK FASE 2 END-TO-END COMPLETA (upload + preview Canny + ControlNet)`);
            ws.close(); process.exit(0);
        }
    });
    ws.on('error', (e) => { console.log(`\n[${el()}] WS error: ${e.message}`); process.exit(1); });
    setTimeout(() => { console.log(`\n[${el()}] TIMEOUT sin imagen`); process.exit(2); }, 240000);
}

main().catch(e => { console.error(`\n[${el()}] FALLO:`, e.message); process.exit(1); });
