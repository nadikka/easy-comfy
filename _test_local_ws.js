// Test end-to-end: simula el cliente del navegador contra la UI (puerto 8085).
// Dispara una generacion con el workflow 'local' (Z-Image GGUF) y espera image_generated.
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8085');
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

ws.on('open', () => {
    console.log(`[${el()}] WS abierto -> enviando prompt local 512x512`);
    ws.send(JSON.stringify({
        type: 'generarImagen',
        prompt: 'a low poly geometric mountain landscape, flat colors, eran hilleli style',
        workflow: 'local',
        params: { steps: 8, width: 512, height: 512, seed: 12345, negative_prompt: 'blurry ugly bad' }
    }));
});

ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.type === 'connection_status') return;
    if (m.type === 'generation_progress') { console.log(`[${el()}] progreso ${m.percent}% (step ${m.value}/${m.max})`); return; }
    if (m.type === 'generation_status') { console.log(`[${el()}] status: ${m.status} - ${m.message}`); return; }
    if (m.type === 'image_generated') {
        console.log(`[${el()}] ✅ IMAGEN GENERADA: ${m.url}`);
        ws.close();
        process.exit(0);
    }
});

ws.on('error', (e) => { console.log(`[${el()}] WS error: ${e.message}`); process.exit(1); });
setTimeout(() => { console.log(`[${el()}] TIMEOUT sin imagen (puede estar compilando kernels la 1ra vez)`); process.exit(2); }, 600000);
