#!/usr/bin/env node
// cc_hero.js — img2img del HERO de Leo sobre el Colab (Z-Image Turbo, sin navegador).
// Sube una foto base, la escala, VAEEncode -> KSampler(denoise) -> decode -> upscale.
// Genera N variantes con seed random y baja todas a brief_design/lora-leo/hero/.
//
// Uso:
//   node cc_hero.js --src <ruta_foto> --n 4 --denoise 0.45
//   node cc_hero.js --src ../../../laboral/Automata/brief_design/lora-leo/dataset/DSC00958.jpg --n 4
//   flags: --w 1152 --h 768 --steps 8 --cfg 1 --denoise 0.45 --lora <nombre.safetensors> --lora-str 0.75

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

function arg(flag, def) { const i = process.argv.indexOf(flag); return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : def; }

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const baseUrl = (arg('--url', cfg.comfyUrl) || '').replace(/\/$/, '');
const src = arg('--src', null);
if (!src) { console.error('Falta --src <foto>'); process.exit(1); }
const srcPath = path.isAbsolute(src) ? src : path.join(__dirname, src);
if (!fs.existsSync(srcPath)) { console.error('No existe la foto: ' + srcPath); process.exit(1); }

const N = Number(arg('--n', 4));
const width = Number(arg('--w', 1152));
const height = Number(arg('--h', 768));
const steps = Number(arg('--steps', 8));
const cfgScale = Number(arg('--cfg', 1.0));
const denoise = Number(arg('--denoise', 0.45));
const loraName = arg('--lora', null);
const loraStr = Number(arg('--lora-str', 0.75));

const POS = arg('--pos', 'cinematic black and white photograph of a young man working at a desk in a dark room, lit only by the glow of a computer monitor, 3/4 view, focused expression, moody low-key lighting, shallow depth of field, dark blurred background, subtle film grain, photorealistic, sharp skin texture');
const NEG = arg('--neg', 'plastic, waxy, oversmoothed, cgi, 3d render, illustration, cartoon, cluttered background, water bottles, daylight, overexposed, bright, text, watermark, deformed');
const prefix = arg('--prefix', 'hero');
const noUpscale = process.argv.includes('--no-upscale');

const outDir = arg('--outdir', null)
    ? path.resolve(arg('--outdir'))
    : path.join(__dirname, '..', '..', '..', '..', '..', 'laboral', 'Automata', 'brief_design', 'lora-leo', 'hero');
fs.mkdirSync(outDir, { recursive: true });

const mod = baseUrl.startsWith('https') ? https : http;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function req(method, urlPath, body, headers) {
    return new Promise((resolve, reject) => {
        const u = new URL(baseUrl + urlPath);
        const opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method, headers: headers || {} };
        const r = mod.request(opts, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
        r.on('error', reject);
        if (body) r.write(body);
        r.end();
    });
}

function uploadImage(filePath) {
    return new Promise((resolve, reject) => {
        const fileName = path.basename(filePath);
        const boundary = '----ccHero' + Math.random().toString(16).slice(2);
        const fileData = fs.readFileSync(filePath);
        const pre = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\nContent-Type: image/jpeg\r\n\r\n`);
        const post = Buffer.from(`\r\n--${boundary}--\r\n`);
        const payload = Buffer.concat([pre, fileData, post]);
        const u = new URL(baseUrl + '/upload/image');
        const opts = { hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length } };
        const r = mod.request(opts, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
        r.on('error', reject); r.write(payload); r.end();
    });
}

function download(urlPath, dest) {
    return new Promise((resolve, reject) => {
        const u = new URL(baseUrl + urlPath);
        mod.get(u, (res) => { if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
            const f = fs.createWriteStream(dest); res.pipe(f); f.on('finish', () => f.close(() => resolve(dest))); }).on('error', reject);
    });
}

function buildWorkflow(imageName, seed) {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow_diplo_colab.json'), 'utf8'));
    wf['6'].inputs.text = POS;
    wf['7'].inputs.text = NEG;
    wf['3'].inputs.seed = seed;
    wf['3'].inputs.steps = steps;
    wf['3'].inputs.cfg = cfgScale;
    wf['3'].inputs.denoise = denoise;
    // img2img: LoadImage -> ImageScale -> VAEEncode
    wf['20'] = { inputs: { image: imageName, upload: 'image' }, class_type: 'LoadImage', _meta: { title: 'Load base photo' } };
    wf['22'] = { inputs: { image: ['20', 0], width, height, upscale_method: 'lanczos', crop: 'center' }, class_type: 'ImageScale', _meta: { title: 'Scale base' } };
    wf['21'] = { inputs: { pixels: ['22', 0], vae: ['17', 0] }, class_type: 'VAEEncode', _meta: { title: 'VAE Encode base' } };
    wf['3'].inputs.latent_image = ['21', 0];
    delete wf['13'];
    // LoRA opcional
    if (loraName) {
        wf['90'] = { inputs: { lora_name: loraName, strength_model: loraStr, model: ['16', 0] }, class_type: 'LoraLoaderModelOnly', _meta: { title: 'Style LoRA' } };
        wf['3'].inputs.model = ['90', 0];
    }
    // sin upscale: borrar la cadena 2x (mas rapido en T4); queda node 9 (base) como salida
    if (noUpscale) { delete wf['84']; delete wf['85']; delete wf['86']; }
    return wf;
}

async function generateOne(imageName, idx) {
    const seed = Math.floor(Math.random() * 1e15);
    const wf = buildWorkflow(imageName, seed);
    const body = JSON.stringify({ client_id: 'cc_hero', prompt: wf });
    const q = await req('POST', '/prompt', body, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    let pid; try { pid = JSON.parse(q.body).prompt_id; } catch (e) {}
    if (!pid) { console.error(`[${idx}] no encolo:`, q.body.slice(0, 300)); return null; }
    console.log(`[${idx}] encolado ${pid} seed=${seed}`);
    for (let i = 0; i < 120; i++) {
        await sleep(4000);
        const h = await req('GET', '/history/' + pid);
        let hist; try { hist = JSON.parse(h.body); } catch (e) { continue; }
        const entry = hist[pid]; if (!entry) { process.stdout.write('.'); continue; }
        const status = entry.status || {}; const outputs = entry.outputs || {};
        let imgs = (outputs['86'] && outputs['86'].images) || null;
        if (!imgs) for (const k of Object.keys(outputs)) { if (outputs[k].images && outputs[k].images.length) { imgs = outputs[k].images; break; } }
        if ((status.completed || status.status_str === 'success') && imgs && imgs.length) {
            const img = imgs[imgs.length - 1];
            const dest = path.join(outDir, `${prefix}_d${String(denoise).replace('.', '')}_${String(idx).padStart(2, '0')}_${seed}.png`);
            const sub = img.subfolder || '';
            await download(`/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(sub)}&type=${encodeURIComponent(img.type)}`, dest);
            console.log(`\n[${idx}] OK -> ${dest}`);
            return dest;
        }
        if (status.status_str === 'error') { console.error(`\n[${idx}] ComfyUI error:`, JSON.stringify(status).slice(0, 400)); return null; }
    }
    console.error(`\n[${idx}] timeout`); return null;
}

(async () => {
    console.log(`-> Colab: ${baseUrl}`);
    console.log(`-> subiendo ${path.basename(srcPath)} ...`);
    const up = await uploadImage(srcPath);
    let imageName; try { imageName = JSON.parse(up.body).name; } catch (e) {}
    if (!imageName) { console.error('Falló upload:', up.status, up.body.slice(0, 300)); process.exit(1); }
    console.log(`-> subida como: ${imageName}`);
    console.log(`-> ${width}x${height} steps=${steps} cfg=${cfgScale} denoise=${denoise}${loraName ? ` lora=${loraName}@${loraStr}` : ''}`);
    console.log(`-> generando ${N} variantes...\n`);
    const results = [];
    for (let i = 1; i <= N; i++) { results.push(await generateOne(imageName, i)); }
    const ok = results.filter(Boolean);
    console.log(`\n=== ${ok.length}/${N} listas en ${outDir} ===`);
    ok.forEach(p => console.log('  ' + path.basename(p)));
})();
