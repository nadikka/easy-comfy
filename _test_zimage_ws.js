// Test end-to-end: simula el navegador contra la UI (puerto 8085).
// Dispara una generacion con el workflow 'zimage' (Z-Image en Colab) y espera image_generated.
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8085');
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

ws.on('open', () => {
    console.log(`[${el()}] WS abierto -> enviando prompt zimage 1024x640`);
    ws.send(JSON.stringify({
        type: 'generarImagen',
        prompt: 'a low poly geometric fox in a magical forest, flat colors, eran hilleli style',
        workflow: 'zimage',
        params: { steps: 8, width: 1024, height: 640, seed: 777, negative_prompt: 'blurry ugly bad' }
    }));
});

ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.type === 'connection_status') { console.log(`[${el()}] conexion: ${m.status}`); return; }
    if (m.type === 'generation_progress') { console.log(`[${el()}] progreso ${m.percent}% (step ${m.value}/${m.max})`); return; }
    if (m.type === 'generation_status') { console.log(`[${el()}] status: ${m.status} - ${m.message}`); return; }
    if (m.type === 'image_generated') {
        console.log(`[${el()}] ✅ IMAGEN GENERADA: ${m.url}`);
        ws.close();
        process.exit(0);
    }
});

ws.on('error', (e) => { console.log(`[${el()}] WS error: ${e.message}`); process.exit(1); });
setTimeout(() => { console.log(`[${el()}] TIMEOUT sin imagen`); process.exit(2); }, 300000);
