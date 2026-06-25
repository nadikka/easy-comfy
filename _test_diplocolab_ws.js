// Test end-to-end: simula el navegador contra la UI (puerto 8085).
// Dispara el workflow 'diplocolab' (Z-Image + upscale 2x en Colab) y espera image_generated.
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8085');
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

ws.on('open', () => {
    console.log(`[${el()}] WS abierto -> enviando prompt diplocolab`);
    ws.send(JSON.stringify({
        type: 'generarImagen',
        prompt: 'a cozy mushroom house in a forest clearing, lowpoly 3d render, eran hilleli style, soft light',
        workflow: 'diplocolab',
        params: { steps: 8, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', width: 1024, height: 640, seed: 909090 }
    }));
});

ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.type === 'connection_status') { console.log(`[${el()}] conexion: ${m.status}`); return; }
    if (m.type === 'generation_progress') { console.log(`[${el()}] progreso ${m.percent}% (step ${m.value}/${m.max})`); return; }
    if (m.type === 'generation_status') { console.log(`[${el()}] status: ${m.status} - ${m.message}`); return; }
    if (m.type === 'image_generated') {
        console.log(`[${el()}] IMAGEN GENERADA: ${m.url}`);
        ws.close();
        process.exit(0);
    }
});

ws.on('error', (e) => { console.log(`[${el()}] WS error: ${e.message}`); process.exit(1); });
setTimeout(() => { console.log(`[${el()}] TIMEOUT sin imagen`); process.exit(2); }, 180000);
