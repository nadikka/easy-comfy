// Diagnostico: arma el workflow CN como server.js y lo postea directo al Colab para ver node_errors.
const fs = require('fs');
const path = require('path');
const U = 'https://from-andrew-lips-craft.trycloudflare.com';

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow_diplo_colab_cn.json'), 'utf8'));
const setIn = (w, id, k, v) => { if (w[id] && w[id].inputs) w[id].inputs[k] = v; };

setIn(wf, "6", "text", "lowpoly geometric landscape, mountains and a lake at dusk");
setIn(wf, "7", "text", "blurry, ugly, low quality");
setIn(wf, "3", "seed", 123456789);
setIn(wf, "3", "steps", 8);
setIn(wf, "3", "cfg", 1.0);
setIn(wf, "3", "sampler_name", "euler");
setIn(wf, "3", "scheduler", "simple");
setIn(wf, "3", "denoise", 0.55);
setIn(wf, "13", "width", 1024);
setIn(wf, "13", "height", 640);
setIn(wf, "13", "batch_size", 1);
setIn(wf, "16", "unet_name", "z-image-turbo-fp8-e4m3fn.safetensors");
setIn(wf, "16", "weight_dtype", "fp8_e4m3fn");
setIn(wf, "17", "vae_name", "ae.safetensors");
setIn(wf, "28", "clip_name", "qwen_3_4b_fp8_mixed.safetensors");
setIn(wf, "28", "type", "lumina2");
setIn(wf, "61", "image", "_upload_test_ref.png");
setIn(wf, "89", "scale_by", 1.0);
setIn(wf, "80", "preprocessor", "CannyEdgePreprocessor");
setIn(wf, "80", "resolution", 512);
setIn(wf, "75", "strength", 0.8);
setIn(wf, "76", "name", "Z-Image-Turbo-Fun-Controlnet-Union.safetensors");

(async () => {
  const r = await fetch(U + '/prompt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: wf, client_id: 'diag123' })
  });
  const text = await r.text();
  console.log('HTTP', r.status);
  try {
    const j = JSON.parse(text);
    console.log(JSON.stringify(j, null, 2));
  } catch { console.log(text.slice(0, 2000)); }
})();
