import * as THREE from "./libs/three.js/build/three.module.js";

const CFG = window.VISOR_CONFIG || { nubes: [] };

/* ---------- protección de la página ---------- */
// No permitir que otra web muestre este visor dentro de un marco.
if (window.top !== window.self) { try { window.top.location = window.self.location; } catch (e) { document.documentElement.innerHTML = ""; } }
// Disuasión: sin menú contextual, sin "Guardar como", sin atajos de herramientas de desarrollo.
document.addEventListener("contextmenu", (e) => { if (!e.target.closest("input, textarea")) e.preventDefault(); });
document.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (e.key === "F12" || (ctrl && (k === "s" || k === "u" || k === "p")) || (ctrl && e.shiftKey && ["i", "j", "c", "k"].includes(k))) e.preventDefault();
}, true);
document.addEventListener("dragstart", (e) => e.preventDefault());
const $id = (x) => document.getElementById(x);
const guardar = (k, v) => { try { localStorage.setItem("visor3d." + k, v); } catch (e) {} };
const leer = (k) => { try { return localStorage.getItem("visor3d." + k); } catch (e) { return null; } };

/* ---------- avisos ---------- */
let tAviso = null;
function aviso(texto, error = false, fijo = false) {
  const el = $id("aviso");
  el.textContent = texto; el.className = error ? "error" : ""; el.style.display = texto ? "block" : "none";
  clearTimeout(tAviso);
  if (texto && !fijo) tAviso = setTimeout(() => (el.style.display = "none"), error ? 15000 : 4000);
}

/* ---------- visor ---------- */
const viewer = new Potree.Viewer($id("potree_render_area"));
window.viewer = viewer;
viewer.setFOV(60);
viewer.setBackground("gradient");
viewer.setMinNodeSize(30);
document.title = CFG.titulo || "Visor 3D";
$id("vpTitulo").textContent = CFG.titulo || "Visor 3D";
$id("vpCab").onclick = () => {
  const c = $id("vp").classList.toggle("cerrado");
  $id("vpFlecha").textContent = c ? "▸" : "▾";
};
if (window.innerWidth < 700) $id("vpCab").onclick();
// que los clics en el panel no lleguen al visor 3D
for (const ev of ["mousedown", "mouseup", "wheel", "dblclick", "touchstart", "pointerdown", "contextmenu", "keydown"])
  $id("vp").addEventListener(ev, (e) => e.stopPropagation());

/* ---------- calidad ---------- */
// Suavidad: puntos redondos siempre; en alta, "splats" de alta calidad (bordes mezclados, sin pixelado).
const CALIDAD = {
  baja:  { puntos:   700_000, edl: false, nodo: 50, hq: false },
  media: { puntos: 2_000_000, edl: true,  nodo: 25, hq: false },
  alta:  { puntos: 4_500_000, edl: false, nodo: 12, hq: true  },
};
function aplicarMaterial(pc) {
  const m = pc.material;
  m.shape = Potree.PointShape.CIRCLE;
  m.pointSizeType = Potree.PointSizeType.ADAPTIVE;
  m.size = parseFloat($id("tamPunto").value) || 1.2;
  m.minSize = 2;
}
function aplicarCalidad(c) {
  const q = CALIDAD[c] || CALIDAD.media;
  viewer.setPointBudget(q.puntos);
  viewer.setEDLEnabled(q.edl);
  viewer.setMinNodeSize(q.nodo);
  viewer.useHQ = q.hq;
  $id("calidad").value = c; guardar("calidad", c);
}
const equipoBasico = (navigator.deviceMemory && navigator.deviceMemory <= 4) || window.innerWidth < 700;
aplicarCalidad(leer("calidad") || (equipoBasico ? "baja" : "media"));
$id("calidad").onchange = (e) => aplicarCalidad(e.target.value);
$id("tamPunto").value = leer("tamPunto") || "1.2"; $id("tamVal").textContent = $id("tamPunto").value;
$id("tamPunto").oninput = (e) => {
  $id("tamVal").textContent = e.target.value; guardar("tamPunto", e.target.value);
  for (const pc of viewer.scene.pointclouds) pc.material.size = parseFloat(e.target.value);
};

/* ---------- biblioteca de nubes (Hugging Face) ---------- */
const cargadas = new Map();   // id -> { pc, conColor, rangoZ }
const cargando = new Set();
let ultimoPedido = null; // en "uno a la vez", solo se queda el último bloque pedido
let nubesBiblio = [];
const HF = "https://huggingface.co";
// hfRepo puede ser un texto o una lista: se leen todas; se sube a la primera (o a hfRepoSubida).
const repos = () => (Array.isArray(CFG.hfRepo) ? CFG.hfRepo : [CFG.hfRepo]).filter(Boolean);
const repo = () => CFG.hfRepoSubida || repos()[0] || "";
const urlHF = (ruta, r = repo()) => `${HF}/datasets/${r}/resolve/main/${ruta.split("/").map(encodeURIComponent).join("/")}`;

// Lector por partes: resuelve una vez la dirección firmada del CDN (válida ~1 h) y la renueva si caduca.
// ---- Lectura de la biblioteca: dirección firmada del CDN + descifrado por rangos ----
// Los archivos en Hugging Face están cifrados (AES-CTR); aquí se descifra solo el trozo pedido.
const _fetch = window.fetch.bind(window);
const firmadas = new Map();   // url -> dirección firmada del CDN (vale ~1 h; se renueva sola)
const infoArch = new Map();   // url -> Promise<{ cifrado, nonce, total }>
const esDeBiblio = (abs) => repos().some((r) => abs.startsWith(`${HF}/datasets/${r}/resolve/`));
const espera = (ms) => new Promise((t) => setTimeout(t, ms));

async function bajarCrudo(abs, rango) { // bytes tal cual están guardados
  for (let intento = 0; intento < 5; intento++) {
    try {
      let f = firmadas.get(abs);
      if (!f) {
        const r0 = await _fetch(abs, { headers: { Range: "bytes=0-0" } });
        if (r0.status === 404) throw Object.assign(new Error("Archivo no encontrado en la biblioteca."), { fatal: true });
        f = r0.url; firmadas.set(abs, f);
      }
      const r = await _fetch(f, { headers: { Range: rango } });
      if (r.status === 206) return r;
    } catch (e) { if (e.fatal) throw e; }
    firmadas.delete(abs);
    await espera(700 * (intento + 1));
  }
  throw new Error("No se pudo leer la nube (conexión).");
}
function infoDe(abs) {
  if (!infoArch.has(abs)) infoArch.set(abs, (async () => {
    const r = await bajarCrudo(abs, "bytes=0-31");
    const u8 = new Uint8Array(await r.arrayBuffer());
    const total = parseInt((r.headers.get("content-range") || "").split("/")[1]);
    if (VQ.esCifrado(u8)) return { cifrado: true, nonce: VQ.nonceDe(u8), total: total - VQ.ENC };
    return { cifrado: false, total };
  })().catch((e) => { infoArch.delete(abs); throw e; }));
  return infoArch.get(abs);
}
async function leerBiblio(abs, a, b) { // bytes descifrados [a, b] (incluidos)
  const info = await infoDe(abs);
  if (b == null || b >= info.total) b = info.total - 1;
  if (!info.cifrado) return new Uint8Array(await (await bajarCrudo(abs, `bytes=${a}-${b}`)).arrayBuffer());
  const s = a - (a % 16);
  const ct = new Uint8Array(await (await bajarCrudo(abs, `bytes=${s + VQ.ENC}-${b + VQ.ENC}`)).arrayBuffer());
  return (await VQ.descifrar(info.nonce, s, ct)).subarray(a - s);
}
window.fetch = async (entrada, opciones = {}) => {
  const url = typeof entrada === "string" ? entrada : entrada && entrada.url;
  let abs = null;
  try { abs = new URL(url, location.href).href; } catch (e) {}
  if (!abs || !esDeBiblio(abs)) return _fetch(entrada, opciones);
  const rango = opciones.headers && (opciones.headers.Range || opciones.headers.range);
  let a = 0, b = null;
  if (rango) { const m = /bytes=(\d+)-(\d*)/.exec(rango); a = +m[1]; b = m[2] ? +m[2] : null; }
  const datos = await leerBiblio(abs, a, b);
  const info = await infoDe(abs);
  return new Response(datos, { status: rango ? 206 : 200, headers: { "Content-Range": `bytes ${a}-${a + datos.length - 1}/${info.total}` } });
};
function lectorRemoto(url) {
  const abs = new URL(url, location.href).href;
  if (!esDeBiblio(abs)) // otro servidor (sin cifrar)
    return { resolver: async () => {}, leer: async (i, f) => new Uint8Array(await (await _fetch(abs, { headers: { Range: `bytes=${i}-${f - 1}` } })).arrayBuffer()) };
  return { resolver: () => infoDe(abs), leer: async (i, f) => (await leerBiblio(abs, i, f - 1)).slice() };
}

function marcarPestanas() {
  document.querySelectorAll("#tiras .pest").forEach((p) => {
    p.classList.toggle("cargada", cargadas.has(p.dataset.id));
    p.classList.toggle("cargando", cargando.has(p.dataset.id));
  });  if (typeof actualizarUI === "function") try { actualizarUI(); } catch (e) {}
}

// misma escala de colores por altura en todos los bloques cargados
function unificarAlturas() {
  let lo = Infinity, hi = -Infinity;
  for (const c of cargadas.values()) if (!c.conColor && c.rangoZ) { lo = Math.min(lo, c.rangoZ[0]); hi = Math.max(hi, c.rangoZ[1]); }
  if (lo < hi) for (const c of cargadas.values()) if (!c.conColor) c.pc.material.elevationRange = [lo, hi];
}

async function cargarNube(n, { encuadrar = false } = {}) {
  if (cargadas.has(n.id) || cargando.has(n.id)) return;
  cargando.add(n.id); marcarPestanas();
  aviso("Cargando «" + n.nombre + "»…", false, true);
  try {
    let pc, conColor, rangoZ = null, caja = null; // caja: límites reales de los puntos [min, max]
    const url = n.url || urlHF(n.ruta, n.repo);
    if (/metadata\.json$/i.test(url)) { // octree Potree (convertido en la página)
      const r = await Potree.OctreeLoader.load(url);
      pc = new Potree.PointCloudOctree(r.geometry);
      conColor = !!r.geometry.pointAttributes.attributes.find((a) => a.name === "rgba");
      const pos = r.geometry.pointAttributes.attributes.find((a) => a.name === "position");
      if (pos && pos.range && pos.range[0]) { rangoZ = [pos.range[0][2], pos.range[1][2]]; caja = [pos.range[0], pos.range[1]]; }
    } else { // COPC
      const lector = lectorRemoto(url);
      await lector.resolver();
      const { Copc } = window.Copc;
      const copc = await Copc.create(lector.leer);
      const geometry = new Potree.PointCloudCopcGeometry(lector.leer, copc);
      geometry.root = new Potree.PointCloudCopcGeometryNode(geometry);
      geometry.root.load();
      pc = new Potree.PointCloudOctree(geometry);
      // formatos LAS 7, 8 y 10 traen color; el resto se pinta por altura
      conColor = [7, 8, 10].includes(copc.header ? copc.header.pointDataRecordFormat : 7);
      if (copc.header && copc.header.min) { rangoZ = [copc.header.min[2], copc.header.max[2]]; caja = [copc.header.min, copc.header.max]; }
    }
    pc.name = n.nombre;
    aplicarMaterial(pc);
    pc.material.activeAttributeName = conColor ? "rgba" : "elevation";
    if (!conColor) {
      if (!rangoZ) { const bb = viewer.getBoundingBox([pc]); rangoZ = [bb.min.z, bb.max.z]; }
      if (Potree.Gradients && Potree.Gradients.TURBO) pc.material.gradient = Potree.Gradients.TURBO;
    }
    if ($id("unoAlaVez").checked && ultimoPedido && ultimoPedido !== n.id) { cargando.delete(n.id); marcarPestanas(); if (!cargando.size) aviso(""); return; }
    const primera = cargadas.size === 0;
    viewer.scene.addPointCloud(pc);
    cargadas.set(n.id, { pc, conColor, rangoZ, caja });
    unificarAlturas();
    if (primera || encuadrar) viewer.zoomTo(pc, 1.1, 600);
    actualizarCorte();
    aviso("");
  } catch (e) {
    console.error(e);
    aviso("«" + n.nombre + "»: " + (e.message || e), true);
  }
  cargando.delete(n.id); marcarPestanas();
}

function quitarNube(id) {
  const c = cargadas.get(id);
  if (!c) return;
  viewer.scene.scenePointCloud.remove(c.pc);
  const i = viewer.scene.pointclouds.indexOf(c.pc);
  if (i >= 0) viewer.scene.pointclouds.splice(i, 1);
  cargadas.delete(id);
  unificarAlturas(); actualizarCorte(); marcarPestanas();
}

const pesoTexto = (b) => !b ? "" : b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : Math.max(1, Math.round(b / 1048576)) + " MB";

async function listarRepo(rp) {
  const r = await fetch(`${HF}/api/datasets/${rp}/tree/main?recursive=true&expand=false`, { cache: "no-store" });
  if (r.status === 404) throw new Error("No se encontró la biblioteca en Hugging Face (" + rp + ").");
  if (!r.ok) throw new Error("No se pudo leer la biblioteca " + rp + " (error " + r.status + ").");
  const lista = await r.json();
  const tam = new Map(lista.map((f) => [f.path, (f.lfs && f.lfs.size) || f.size || 0]));
  const salida = [];
  for (const f of lista) {
    if (f.type !== "file") continue;
    if (/\.copc\.laz$/i.test(f.path)) {
      const base = f.path.split("/").pop().replace(/\.copc\.laz$/i, "");
      salida.push({ id: base, repo: rp, ruta: f.path, nombre: base.replace(/[_-]+/g, " "), bytes: tam.get(f.path) });
    } else if (/(^|\/)metadata\.json$/.test(f.path) && f.path.includes("/")) {
      const carpeta = f.path.slice(0, -"/metadata.json".length);
      const base = carpeta.split("/").pop();
      salida.push({ id: base, repo: rp, ruta: f.path, nombre: base.replace(/[_-]+/g, " "), bytes: tam.get(carpeta + "/octree.bin") });
    }
  }
  return salida;
}
async function listarHF() {
  const todas = [], ids = new Set();
  for (const rp of repos()) {
    try {
      for (const n of await listarRepo(rp)) {
        let id = n.id, k = 2;
        while (ids.has(id)) id = n.id + "-" + k++;
        ids.add(id); n.id = id; n.peso = pesoTexto(n.bytes); todas.push(n);
      }
    } catch (e) { console.error(e); aviso(e.message, true); }
  }
  return todas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
}

let primeraVez = true;
const pedidasLink = (new URLSearchParams(location.search).get("nube") || "").split(",").filter(Boolean);
if (location.search || location.hash) history.replaceState(null, "", location.pathname); // la dirección queda limpia
async function cargarBiblioteca() {
  let nubes = [...(CFG.nubes || [])];
  try { nubes = nubes.concat(await listarHF()); }
  catch (e) { console.error(e); aviso(e.message, true); }
  nubesBiblio = nubes;
  const tiras = $id("tiras");
  tiras.textContent = "";
  if (!nubes.length) { tiras.innerHTML = '<span class="titulo">Todavía no hay nubes en la biblioteca</span>'; pintarBloquesAdmin(); return; }
  for (const n of nubes) {
    const p = document.createElement("div");
    p.className = "pest"; p.dataset.id = n.id; p.title = "Clic: cargar / quitar · Doble clic: ir al bloque";
    const punto = document.createElement("span"); punto.className = "punto";
    const nom = document.createElement("span"); nom.textContent = n.nombre;
    p.append(punto, nom);
    if (n.peso) { const sm = document.createElement("small"); sm.textContent = n.peso; p.append(sm); }
    const enf = document.createElement("span"); enf.className = "enfocar"; enf.textContent = "⌖"; enf.title = "Ir a este bloque";
    enf.onclick = (e) => { e.stopPropagation(); const c = cargadas.get(n.id); if (c) viewer.zoomTo(c.pc, 1.1, 600); };
    p.append(enf);
    p.onclick = () => {
      if (cargadas.has(n.id)) { quitarNube(n.id); return; }
      if ($id("unoAlaVez").checked) { ultimoPedido = n.id; for (const id of [...cargadas.keys()]) quitarNube(id); }
      cargarNube(n, { encuadrar: $id("unoAlaVez").checked });
    };
    p.ondblclick = () => { const c = cargadas.get(n.id); if (c) viewer.zoomTo(c.pc, 1.1, 600); };
    tiras.append(p);
  }
  marcarPestanas(); pintarBloquesAdmin();
  if (!primeraVez) return;
  primeraVez = false;
  const pedidas = pedidasLink;
  // al entrar todo está apagado, salvo los bloques que indique el link (?nube=...)
  const iniciales = nubes.filter((n) => pedidas.includes(n.id));
  if (iniciales.length > 1) { $id("unoAlaVez").checked = false; $id("unoAlaVez").onchange(); }
  for (const n of iniciales) cargarNube(n);
}
$id("verTodos").onclick = () => { for (const n of nubesBiblio) cargarNube(n); };
$id("unoAlaVez").checked = leer("unoAlaVez") !== "0";
$id("unoAlaVez").onchange = () => {
  const uno = $id("unoAlaVez").checked;
  guardar("unoAlaVez", uno ? "1" : "0");
  $id("verTodos").style.display = uno ? "none" : "";
  if (uno && cargadas.size > 1) { const [primero] = cargadas.keys(); for (const id of [...cargadas.keys()]) if (id !== primero) quitarNube(id); }
};
$id("verTodos").style.display = $id("unoAlaVez").checked ? "none" : "";
$id("quitarTodos").onclick = () => { for (const id of [...cargadas.keys()]) quitarNube(id); };
for (const ev of ["mousedown", "mouseup", "wheel", "dblclick", "touchstart", "pointerdown", "contextmenu", "keydown"])
  $id("pestanas").addEventListener(ev, (e) => e.stopPropagation());
cargarBiblioteca();

/* ---------- administración: contraseña + subida a Hugging Face ---------- */
// El token de escritura de Hugging Face se guarda CIFRADO en config.js (AES-GCM, clave derivada
// de la contraseña con PBKDF2). Sin la contraseña no se puede leer ni usar.
const ITER = 2000000;
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const deB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
async function claveDe(pass, sal) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: sal, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function cifrar(texto, pass) {
  const sal = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await claveDe(pass, sal), new TextEncoder().encode(texto));
  return [b64(sal), b64(iv), b64(new Uint8Array(c))].join(".");
}
async function descifrar(blob, pass) {
  const [sal, iv, c] = blob.split(".").map(deB64);
  const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await claveDe(pass, sal), c);
  return new TextDecoder().decode(p);
}

const cifradoTok = () => CFG.hfTokenCifrado || leer("hfTokenCifrado") || "";
let token = null;
const estado = (t) => ($id("adminEstado").textContent = t);
function mostrar(vista) {
  $id("adminLogin").style.display = vista === "login" ? "block" : "none";
  $id("adminConfig").style.display = vista === "config" ? "block" : "none";
  $id("adminSubir").style.display = vista === "subir" ? "block" : "none";
}
(() => { // sesión guardada en este equipo
  const t = leer("hfToken");
  if (t && cifradoTok()) token = t;
})();

$id("adminLink").onclick = (e) => {
  e.preventDefault();
  const a = $id("admin"); a.style.display = a.style.display === "none" ? "block" : "none";
  estado("");
  if (token) { mostrar("subir"); pintarBloquesAdmin(); }
  else if (!cifradoTok()) mostrar("config");
  else mostrar("login");
};

$id("adminEntrar").onclick = async () => {
  const pass = $id("adminClave").value;
  if (!pass) return;
  $id("adminEntrar").disabled = true; estado("Comprobando…");
  try {
    token = await descifrar(cifradoTok(), pass);
    if ($id("adminRecordar").checked) guardar("hfToken", token);
    $id("adminClave").value = ""; mostrar("subir"); pintarBloquesAdmin(); estado("Sesión iniciada. Elige un archivo .copc.laz.");
  } catch (e) { token = null; estado("Contraseña incorrecta."); }
  $id("adminEntrar").disabled = false;
};
$id("adminClave").addEventListener("keydown", (e) => { if (e.key === "Enter") $id("adminEntrar").click(); });

$id("adminSalir").onclick = () => {
  token = null; try { localStorage.removeItem("visor3d.hfToken"); } catch (e) {}
  mostrar(cifradoTok() ? "login" : "config"); estado("Sesión cerrada.");
};

$id("cfgCifrar").onclick = async () => {
  const t = $id("cfgToken").value.trim(), p = $id("cfgClave").value;
  if (!/^hf_/.test(t) || !p) { estado("Pega el token (empieza con hf_) y escribe la contraseña."); return; }
  estado("Comprobando el token…");
  try {
    const r = await fetch(`${HF}/api/whoami-v2`, { headers: { Authorization: "Bearer " + t } });
    if (!r.ok) throw new Error();
  } catch (e) { estado("Hugging Face no aceptó ese token."); return; }
  estado("Guardando…");
  guardar("hfTokenCifrado", await cifrar(t, p)); // solo en este equipo, cifrado con la contraseña
  token = t;
  if ($id("adminRecordar").checked) guardar("hfToken", t);
  $id("cfgToken").value = ""; $id("cfgClave").value = "";
  mostrar("subir"); pintarBloquesAdmin(); estado("Equipo configurado. Ya puedes subir nubes.");
};

function convertirEnNavegador(file, carpeta, progreso, extra = {}) {
  return new Promise((ok, mal) => {
    const w = new Worker("libs/conversor/conversor-worker.js");
    w.onmessage = (e) => {
      const m = e.data;
      if (m.tipo === "progreso") progreso(m.fase, m.avance, m.texto);
      else if (m.tipo === "listo") { w.terminate(); ok(m); }
      else if (m.tipo === "error") { w.terminate(); mal(new Error(m.mensaje)); }
    };
    w.onerror = (e) => { w.terminate(); mal(new Error(e.message || "Error en el conversor")); };
    w.postMessage({ file, carpeta, ...extra });
  });
}
function cifrarEnNavegador(carpeta, entradas, progreso) {
  return new Promise((ok, mal) => {
    const w = new Worker("libs/conversor/conversor-worker.js");
    w.onmessage = (e) => {
      const m = e.data;
      if (m.tipo === "progreso") progreso(m.avance);
      else if (m.tipo === "listo") { w.terminate(); ok(m); }
      else if (m.tipo === "error") { w.terminate(); mal(new Error(m.mensaje)); }
    };
    w.onerror = (e) => { w.terminate(); mal(new Error(e.message || "Error al cifrar")); };
    w.postMessage({ tarea: "cifrar", carpeta, entradas });
  });
}

// Conversión pendiente de subir (si la subida falló): se guarda en el disco del navegador.
const pendiente = () => { try { return JSON.parse(leer("pendiente") || "null"); } catch (e) { return null; } };
function mostrarPendiente() {
  const p = pendiente(), bt = $id("adminReintentar");
  bt.style.display = p ? "block" : "none";
  if (p) bt.textContent = "Reintentar subida de «" + p.base.replace(/_/g, " ") + "» (ya convertida)";
}
mostrarPendiente();

async function subirArchivos(archivos, base) {
  const { uploadFilesWithProgress } = await import("./libs/hf/hfhub.mjs");
  const barra = $id("adminProg");
  const total = archivos.reduce((a, x) => a + x.content.size, 0);
  const hecho = new Map();
  for await (const ev of uploadFilesWithProgress({
    repo: { type: "dataset", name: repo() }, accessToken: token, files: archivos,
    commitTitle: "Subir " + base, useXet: true,
  })) {
    if (ev.event === "fileProgress") {
      const x = archivos.find((a) => a.path === ev.path);
      if (x) hecho.set(ev.path, ev.progress * x.content.size);
      const p = [...hecho.values()].reduce((a, v) => a + v, 0) / total;
      barra.value = p;
      estado((ev.state === "hashing" ? "Preparando la subida… " : "Subiendo… ") + (100 * p).toFixed(1) + " % de " + pesoTexto(total) + "  (no cierres esta pestaña)");
    }
  }
}

// Archivos ya cifrados en la carpeta temporal, con la ruta que tendrán en la biblioteca.
async function archivosDeCarpeta(carpeta, base, tipo = "potree") {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(carpeta);
  const f = async (n) => (await dir.getFileHandle(n)).getFile();
  if (tipo === "copc") return [{ path: base + ".copc.laz", content: await f("nube.enc") }];
  const out = [];
  for (const nom of ["octree.bin", "hierarchy.bin", "metadata.json"]) out.push({ path: base + "/" + nom, content: await f(nom + ".enc") });
  return out;
}

async function cifrarCarpeta(carpeta, entradas) {
  const barra = $id("adminProg");
  await cifrarEnNavegador(carpeta, entradas, (av) => {
    barra.value = av; estado("Cifrando… " + (100 * av).toFixed(0) + " %  (no cierres esta pestaña)");
  });
}

async function trabajar(tarea) { // bloquea los botones y avisa si se intenta cerrar la pestaña
  const evitarCierre = (e) => { e.preventDefault(); e.returnValue = ""; };
  window.addEventListener("beforeunload", evitarCierre);
  $id("adminEnviar").disabled = $id("adminArchivo").disabled = $id("adminReintentar").disabled = true;
  const barra = $id("adminProg"); barra.style.display = "block"; barra.value = 0;
  try { await tarea(); }
  catch (e) {
    console.error(e);
    const m = String(e.message || e);
    if (/401|403|unauthor/i.test(m)) estado("Hugging Face rechazó el permiso. Revisa que el token tenga escritura en " + repo() + ".");
    else if (/quota|storage limit|exceed/i.test(m)) estado("La biblioteca " + repo() + " no admite más espacio. Crea otra biblioteca y agrégala en config.js (hfRepo).");
    else estado("Error: " + m);
  }
  window.removeEventListener("beforeunload", evitarCierre);
  $id("adminEnviar").disabled = $id("adminArchivo").disabled = $id("adminReintentar").disabled = false;
  barra.style.display = "none"; mostrarPendiente();
}

// Lista de bloques de la biblioteca de subida, con botón para eliminarlos (solo con sesión).
function pintarBloquesAdmin() {
  const caja = $id("adminBloques"); if (!caja) return;
  revisarSinCifrar();
  const mios = nubesBiblio.filter((n) => n.repo === repo());
  caja.textContent = mios.length ? "" : "Todavía no hay bloques.";
  for (const n of mios) {
    const fila = document.createElement("div"); fila.className = "fb";
    const nom = document.createElement("span"); nom.textContent = n.nombre; nom.title = n.ruta;
    const peso = document.createElement("small"); peso.textContent = n.peso || "";
    const bt = document.createElement("button"); bt.textContent = "Eliminar";
    bt.onclick = () => eliminarBloque(n);
    fila.append(nom, peso, bt); caja.append(fila);
  }
}

async function compactarHistorial() { // borra versiones antiguas (libera espacio y elimina copias legibles)
  try {
    const r = await fetch(`${HF}/api/datasets/${repo()}/super-squash/main`, {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Compactar historial" }),
    });
    return r.ok;
  } catch (e) { return false; }
}

async function eliminarBloque(n) {
  if (!token) { estado("Inicia sesión primero."); return; }
  if (!confirm("¿Eliminar «" + n.nombre + "» de la biblioteca?\n\nDesaparece para todos y no se puede deshacer.")) return;
  await trabajar(async () => {
    estado("Eliminando «" + n.nombre + "»…");
    quitarNube(n.id);
    const carpeta = n.ruta.endsWith("/metadata.json") ? n.ruta.slice(0, -"/metadata.json".length) : null;
    const rutas = carpeta ? ["octree.bin", "hierarchy.bin", "metadata.json"].map((x) => carpeta + "/" + x) : [n.ruta];
    const { deleteFiles } = await import("./libs/hf/hfhub.mjs");
    await deleteFiles({ repo: { type: "dataset", name: repo() }, accessToken: token, paths: rutas, commitTitle: "Eliminar " + n.nombre });
    // Borrar archivos no libera espacio por sí solo (quedan en el historial): se compacta el historial.
    const liberado = await compactarHistorial();
    estado("Eliminado: «" + n.nombre + "»." + (liberado ? " Espacio liberado." : " (El espacio se libera en Hugging Face → biblioteca → Settings → Storage.)"));
    await cargarBiblioteca();
  });
}

$id("adminReintentar").onclick = () => trabajar(async () => {
  const p = pendiente(); if (!p) return;
  let archivos;
  try { archivos = await archivosDeCarpeta(p.carpeta, p.base, p.tipo); }
  catch (e) { guardar("pendiente", ""); throw new Error("La conversión guardada ya no está en este navegador. Vuelve a subir el .las."); }
  await subirArchivos(archivos, p.base);
  try { await (await navigator.storage.getDirectory()).removeEntry(p.carpeta, { recursive: true }); } catch (e) {}
  guardar("pendiente", "");
  estado("Listo: «" + p.base.replace(/_/g, " ") + "» ya está en la biblioteca.");
  await cargarBiblioteca();
});

$id("adminEnviar").onclick = async () => {
  const f = $id("adminArchivo").files[0];
  if (!f) { estado("Elige primero un archivo."); return; }
  // Se revisa la cabecera: COPC se sube tal cual; un .las se convierte aquí mismo.
  let tipo = "otro";
  try {
    const h = new Uint8Array(await f.slice(0, 400).arrayBuffer());
    const txt = (i, n) => String.fromCharCode(...h.subarray(i, i + n)).replace(/\0+$/, "");
    if (txt(0, 4) === "LASF") tipo = txt(377, 4) === "copc" ? "copc" : (h[104] & 0xc0) ? "laz" : "las";
  } catch (e) {}
  if (tipo === "laz") { estado("Este .laz está comprimido y no es COPC. Guárdalo como .las (sin comprimir) o conviértelo con Convertir-a-COPC.bat, y súbelo."); return; }
  if (tipo === "otro") { estado("Por ahora la página convierte archivos .las (y sube .copc.laz). Para .e57/.ply usa Convertir-a-COPC.bat."); return; }
  if (!repo()) { estado("Falta el nombre de la biblioteca (hfRepo en config.js)."); return; }
  if (f.size > 49 * 1073741824 && tipo === "copc") { estado("Hugging Face admite hasta 50 GB por archivo. Divide la nube en bloques más pequeños."); return; }
  const base = f.name.replace(/(\.copc)?\.la[sz]$/i, "").replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "nube";
  if (pendiente() && !confirm("Hay una conversión sin subir («" + pendiente().base + "»). Si continúas se descarta. ¿Continuar?")) return;
  await trabajar(async () => {
    const raiz = await navigator.storage.getDirectory();
    for await (const [nom] of raiz.entries()) if (nom.startsWith("conv-")) await raiz.removeEntry(nom, { recursive: true }).catch(() => {});
    guardar("pendiente", "");
    try {
      const est = await navigator.storage.estimate();
      const libre = est.quota - est.usage, necesita = f.size * (tipo === "copc" ? 1.05 : 1.3);
      if (libre < necesita) throw new Error("No hay espacio suficiente en el disco (" + pesoTexto(necesita) + " necesarios; libres " + pesoTexto(libre) + "). Libera espacio e inténtalo de nuevo.");
    } catch (e) { if (/espacio/.test(e.message)) throw e; }
    const carpeta = "conv-" + Date.now();
    const barra = $id("adminProg");
    const dir = await raiz.getDirectoryHandle(carpeta, { create: true });
    if (tipo === "copc") {
      await cifrarCarpeta(carpeta, [{ blob: f, salida: "nube.enc" }]);
    } else {
      const r = await convertirEnNavegador(f, carpeta, (fase, avance, texto) => {
        const pesos = { conteo: [0, 0.25], reparto: [0.25, 0.4], octree: [0.65, 0.35] }[fase] || [0, 1];
        barra.value = pesos[0] + pesos[1] * avance;
        estado(texto + "… " + (100 * avance).toFixed(0) + " %  (paso " + (["conteo", "reparto", "octree"].indexOf(fase) + 1) + " de 5; no cierres esta pestaña)");
      });
      const ent = [];
      for (const nom of ["octree.bin", "hierarchy.bin", "metadata.json"]) ent.push({ blob: await (await dir.getFileHandle(nom)).getFile(), salida: nom + ".enc" });
      await cifrarCarpeta(carpeta, ent);
      for (const nom of ["octree.bin", "hierarchy.bin", "metadata.json"]) await dir.removeEntry(nom).catch(() => {}); // solo queda lo cifrado
      estado("Conversión lista (" + r.puntos.toLocaleString("es") + " puntos).");
    }
    guardar("pendiente", JSON.stringify({ carpeta, base, tipo: tipo === "copc" ? "copc" : "potree" })); // si la subida falla, no se repite nada
    await subirArchivos(await archivosDeCarpeta(carpeta, base, tipo === "copc" ? "copc" : "potree"), base);
    try { await raiz.removeEntry(carpeta, { recursive: true }); } catch (e) {}
    guardar("pendiente", "");
    estado("Listo: «" + base.replace(/_/g, " ") + "» ya está en la biblioteca (cifrado).");
    await cargarBiblioteca();
  });
};

/* ---------- proteger bloques subidos antes del cifrado ---------- */
async function bloquesSinCifrar() {
  const out = [];
  for (const n of nubesBiblio.filter((x) => x.repo === repo())) {
    try { if (!(await infoDe(urlHF(n.ruta, n.repo))).cifrado) out.push(n); } catch (e) {}
  }
  return out;
}
async function revisarSinCifrar() {
  const bt = $id("adminProteger"); if (!bt || !token) return;
  const lista = await bloquesSinCifrar();
  bt.style.display = lista.length ? "block" : "none";
  bt.textContent = "Proteger " + lista.length + " bloque" + (lista.length > 1 ? "s" : "") + " sin cifrar";
}
async function descargarA(dir, nombre, abs, barra, hechoAntes, total) { // copia cruda (sin descifrar) al disco del navegador
  const fh = await dir.getFileHandle(nombre, { create: true });
  const w = await fh.createWritable();
  const info = await infoDe(abs);
  const T = 32 * 1024 * 1024;
  for (let a = 0; a < info.total; a += T) {
    const b = Math.min(a + T, info.total) - 1;
    await w.write(new Uint8Array(await (await bajarCrudo(abs, `bytes=${a}-${b}`)).arrayBuffer()));
    barra.value = (hechoAntes + b + 1) / total;
    estado("Descargando para cifrar… " + (100 * (hechoAntes + b + 1) / total).toFixed(0) + " %");
  }
  await w.close();
  return info.total;
}
$id("adminProteger").onclick = async () => {
  const lista = await bloquesSinCifrar();
  if (!lista.length) { estado("Todos los bloques ya están cifrados."); return; }
  if (!confirm("Se cifrarán " + lista.length + " bloque(s): se descargan, se cifran y se vuelven a subir, y se borra la versión legible del historial. Mantén esta pestaña abierta. ¿Continuar?")) return;
  await trabajar(async () => {
    const raiz = await navigator.storage.getDirectory();
    for (const n of lista) {
      quitarNube(n.id);
      const carpeta = "conv-prot-" + Date.now();
      const dir = await raiz.getDirectoryHandle(carpeta, { create: true });
      const esCopc = !n.ruta.endsWith("/metadata.json");
      const base = esCopc ? n.ruta.replace(/\.copc\.laz$/i, "") : n.ruta.slice(0, -"/metadata.json".length);
      const fuentes = esCopc ? [[n.ruta, "nube"]] : ["octree.bin", "hierarchy.bin", "metadata.json"].map((x) => [base + "/" + x, x]);
      let total = 0; for (const [ruta] of fuentes) total += (await infoDe(urlHF(ruta, n.repo))).total;
      let hecho = 0; const ent = [];
      for (const [ruta, nom] of fuentes) {
        hecho += await descargarA(dir, nom, urlHF(ruta, n.repo), $id("adminProg"), hecho, total);
        ent.push({ blob: await (await dir.getFileHandle(nom)).getFile(), salida: nom + ".enc" });
      }
      await cifrarCarpeta(carpeta, ent);
      for (const [, nom] of fuentes) await dir.removeEntry(nom).catch(() => {}); // solo queda lo cifrado
      guardar("pendiente", JSON.stringify({ carpeta, base, tipo: esCopc ? "copc" : "potree" }));
      await subirArchivos(await archivosDeCarpeta(carpeta, base, esCopc ? "copc" : "potree"), base);
      guardar("pendiente", "");
      try { await raiz.removeEntry(carpeta, { recursive: true }); } catch (e) {}
      for (const [ruta] of fuentes) { infoArch.delete(urlHF(ruta, n.repo)); firmadas.delete(urlHF(ruta, n.repo)); }
    }
    const ok = await compactarHistorial();
    estado(ok ? "Listo: todos los bloques están cifrados y la versión legible se borró del historial."
              : "Bloques cifrados. Falta borrar la versión antigua del historial: Hugging Face → biblioteca → Settings → Storage.");
    await cargarBiblioteca();
  });
};

/* ---------- corte de sección ---------- */
const sec = window.VisorSeccion = { mode: 0, normal: [0, 0, 1], point: [0, 0, 0], thickness: 0.1, color: [1, 0, 0] };
let tipo = "0", lado = 1;

const marco = new THREE.LineLoop(
  new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([-.5,-.5,0, .5,-.5,0, .5,.5,0, -.5,.5,0], 3)),
  new THREE.LineBasicMaterial({ color: 0xff0000, depthTest: false })
);
marco.visible = false; marco.renderOrder = 10;
viewer.scene.scene.add(marco);
// relleno del plano de corte: se ve como una superficie y sobre ella se mide
const relleno = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false })
);
relleno.visible = false; relleno.renderOrder = 9;
viewer.scene.scene.add(relleno);

function hexARgb(h) { return [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255); }

function cajaTotal() { // límites reales de los puntos (no el cubo del octree)
  const b = new THREE.Box3();
  for (const c of cargadas.values()) {
    if (c.caja) b.union(new THREE.Box3(new THREE.Vector3(...c.caja[0]), new THREE.Vector3(...c.caja[1])));
    else { const bb = viewer.getBoundingBox([c.pc]); b.union(new THREE.Box3(new THREE.Vector3().copy(bb.min), new THREE.Vector3().copy(bb.max))); }
  }
  if (b.isEmpty()) { const bb = viewer.getBoundingBox(viewer.scene.pointclouds); return new THREE.Box3(new THREE.Vector3().copy(bb.min), new THREE.Vector3().copy(bb.max)); }
  return b;
}

function actualizarCorte() {
  $id("opcCorte").style.display = tipo === "0" ? "none" : "block";
  $id("filaAng").style.display = tipo === "vertical" ? "flex" : "none";
  if (tipo === "0" || !viewer.scene.pointclouds.length) { sec.mode = 0; marco.visible = false; relleno.visible = false; return; }

  const b = cajaTotal(), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  const ang = ((parseFloat($id("angNum").value) || 0) * Math.PI) / 180;
  const n = tipo === "planta" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0);
  // recorrido del plano: proyección de la caja sobre la normal
  const medio = (Math.abs(n.x) * s.x + Math.abs(n.y) * s.y + Math.abs(n.z) * s.z) / 2;
  // posición escrita o con la barra: metros desde el inicio del recorrido (desde abajo en planta)
  if (posM == null || !isFinite(posM)) posM = medio;
  posM = Math.min(Math.max(posM, 0), 2 * medio);
  const t = posM - medio;
  const p = c.clone().addScaledVector(n, t);

  sec.mode = parseInt($id("modoCorte").value);
  sec.normal = [n.x * lado, n.y * lado, n.z * lado];
  sec.point = [p.x, p.y, p.z];
  sec.thickness = Math.max(0.001, parseFloat($id("grosorCorte").value) || 0.1);
  sec.color = hexARgb($id("colorCorte").value);

  $id("posEtq").textContent = tipo === "planta" ? "Altura (m)" : "Distancia (m)";
  $id("posEtq").title = tipo === "planta" ? "Altura del corte medida desde el punto más bajo de la nube" : "Distancia desde el borde de la nube";
  if (document.activeElement !== $id("posNum")) $id("posNum").value = posM.toFixed(2);
  $id("posNum").max = (2 * medio).toFixed(2); $id("posNum").min = 0;
  $id("posMax").textContent = "/ " + (2 * medio).toFixed(1);
  if (document.activeElement !== $id("posCorte")) $id("posCorte").value = Math.round((posM / (2 * medio || 1)) * 10000);

  // marco del plano de corte
  marco.material.color.setRGB(...sec.color);
  marco.position.copy(p);
  if (tipo === "planta") { marco.rotation.set(0, 0, 0); marco.scale.set(s.x, s.y, 1); }
  else {
    const ancho = Math.abs(n.y) * s.x + Math.abs(n.x) * s.y;
    marco.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-n.y, n.x, 0), new THREE.Vector3(0, 0, 1), n));
    marco.scale.set(ancho, s.z, 1);
  }
  marco.visible = true;
  relleno.position.copy(marco.position); relleno.quaternion.copy(marco.quaternion); relleno.scale.copy(marco.scale);
  relleno.material.color.setRGB(...sec.color);
  relleno.visible = true;
}

for (const bt of document.querySelectorAll("#tipoCorte button")) bt.onclick = () => {
  if (tipo !== bt.dataset.t) posM = null; // cada tipo de corte empieza al centro
  tipo = bt.dataset.t;
  document.querySelectorAll("#tipoCorte button").forEach((x) => x.classList.toggle("activo", x === bt));
  actualizarCorte();
  actualizarUI();
};
let posM = null; // posición del corte en metros
function recorrido() { // largo del recorrido del plano según el tipo de corte
  const s = cajaTotal().getSize(new THREE.Vector3());
  if (tipo === "planta") return s.z;
  const a = ((parseFloat($id("angNum").value) || 0) * Math.PI) / 180;
  return Math.abs(Math.cos(a)) * s.x + Math.abs(Math.sin(a)) * s.y;
}
for (const idc of ["modoCorte", "grosorCorte", "colorCorte"]) $id(idc).oninput = actualizarCorte;
$id("posCorte").oninput = () => { posM = (parseFloat($id("posCorte").value) / 10000) * recorrido(); actualizarCorte(); };
const aplicarPosEscrita = () => { const v = parseFloat(String($id("posNum").value).replace(",", ".")); if (isFinite(v)) { posM = v; actualizarCorte(); } };
$id("posNum").oninput = aplicarPosEscrita;
$id("posNum").onchange = () => { aplicarPosEscrita(); $id("posNum").value = posM.toFixed(2); };
$id("posNum").addEventListener("keydown", (e) => { if (e.key === "Enter") { aplicarPosEscrita(); $id("posNum").blur(); } });
$id("angCorte").oninput = () => { $id("angNum").value = $id("angCorte").value; actualizarCorte(); };
$id("angNum").oninput = () => { const v = parseFloat($id("angNum").value) || 0; $id("angCorte").value = ((v % 180) + 180) % 180; actualizarCorte(); };
$id("invertir").onclick = () => { lado = -lado; actualizarCorte(); };
$id("verFrente").onclick = () => {
  if (!sec.mode) return;
  const b = cajaTotal(), r = b.getSize(new THREE.Vector3()).length();
  const p = new THREE.Vector3(...sec.point), n = new THREE.Vector3(...sec.normal);
  const pos = p.clone().addScaledVector(n, r);
  if (tipo === "planta") pos.y -= r * 0.001; // evita la vista exactamente vertical
  viewer.scene.view.setView(pos, p, 400);
};
const c0 = CFG.corte || {};
if (c0.color) $id("colorCorte").value = c0.color;
if (c0.grosor) $id("grosorCorte").value = c0.grosor;

/* ---------- medir ---------- */
const MED = {
  distancia: { showDistances: true, closed: false, name: "Distancia" },
  altura:    { showDistances: false, showHeight: true, showArea: false, closed: false, maxMarkers: 2, name: "Altura" },
  area:      { showDistances: true, showArea: true, closed: true, name: "Área" },
};
let insertando = false, shiftPulsado = false, medActual = null, herramienta = null;
function terminarInsercion() { insertando = false; medActual = null; herramienta = null; actualizarUI(); }
for (const bt of document.querySelectorAll("button[data-m]"))
  bt.onclick = () => {
    if (!cargadas.size) { aviso("Primero enciende un bloque en la barra de abajo."); return; }
    if (insertando && herramienta === bt.dataset.m) { cancelarMedida(); return; } // segundo clic = cancelar
    if (insertando) cancelarMedida();
    insertando = true; herramienta = bt.dataset.m;
    medActual = viewer.measuringTool.startInsertion(MED[bt.dataset.m]);
    actualizarUI();
  };
function cancelarMedida() {
  if (!insertando) return;
  const m = medActual;
  viewer.dispatchEvent({ type: "cancel_insertions" });
  if (m && m.points.length < 2) viewer.scene.removeMeasurement(m); // sin tramo completo: se quita
  terminarInsercion();
}
$id("cancelarMed").onclick = cancelarMedida;
viewer.renderer.domElement.addEventListener("mouseup", (e) => {
  if (!insertando) return;
  setTimeout(() => {
    if (e.button === 2) terminarInsercion();
    else if (e.button === 0 && medActual && medActual.points.length >= (medActual.maxMarkers || Infinity)) terminarInsercion();
  }, 0);
});
window.addEventListener("keydown", (e) => { if (e.key === "Shift") shiftPulsado = true; if (e.key === "Escape") cancelarMedida(); }, true);
// Atajos de una tecla (no actúan mientras se escribe en un campo)
const ATAJOS = {
  d: () => document.querySelector('button[data-m="distancia"]').click(),
  h: () => document.querySelector('button[data-m="altura"]').click(),
  a: () => document.querySelector('button[data-m="area"]').click(),
  p: () => document.querySelector('#tipoCorte button[data-t="planta"]').click(),
  v: () => document.querySelector('#tipoCorte button[data-t="vertical"]').click(),
  x: () => document.querySelector('#tipoCorte button[data-t="0"]').click(),
  f: () => $id("verFrente").click(),
  i: () => $id("invertir").click(),
  e: () => $id("encuadrar").click(),
  delete: () => { if (!insertando) $id("borrarMed").click(); },
};
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea, select")) return;
  const f = ATAJOS[e.key.toLowerCase()];
  if (f) { e.preventDefault(); f(); }
}, true);
for (const [sel, tecla] of [['button[data-m="distancia"]', "D"], ['button[data-m="altura"]', "H"], ['button[data-m="area"]', "A"],
  ['#tipoCorte button[data-t="planta"]', "P"], ['#tipoCorte button[data-t="vertical"]', "V"], ['#tipoCorte button[data-t="0"]', "X"],
  ["#verFrente", "F"], ["#invertir", "I"], ["#encuadrar", "E"], ["#borrarMed", "Supr"]]) {
  const el = document.querySelector(sel); if (el) el.title = (el.title ? el.title + " · " : "") + "Atajo: " + tecla;
}
window.addEventListener("keyup", (e) => { if (e.key === "Shift") shiftPulsado = false; }, true);

// Muestra solo lo que sirve en cada momento.
function actualizarUI() {
  const hay = cargadas.size > 0, conCorte = tipo !== "0", nMed = viewer.scene.measurements.length;
  const ver = (id, si) => $id(id).classList.toggle("oculto", !si);
  // Vista, Corte y Medir siempre disponibles (sin iniciar sesión); solo los detalles aparecen cuando sirven.
  ver("secVacio", !hay); ver("secVista", true); ver("secCorte", true); ver("secMedir", true);
  ver("opcMedir", conCorte);
  ver("ayudaMedir", insertando);
  ver("borrarMed", nMed > 0 && !insertando);
  ver("medidas", nMed > 0);
  $id("quitarTodos").style.display = hay ? "" : "none";
  document.querySelectorAll("#botonesMedir button").forEach((b) => {
    b.classList.toggle("activo", insertando && b.dataset.m === herramienta);
    b.title = insertando && b.dataset.m === herramienta ? "Clic otra vez para cancelar" : "";
  });
}
$id("borrarMed").onclick = () => { viewer.scene.removeAllMeasurements(); actualizarUI(); };

/* Medición precisa en nubes de puntos.
   - Con corte activo y "Medir sobre el corte": el punto queda EXACTAMENTE sobre el plano rojo
     (intersección del rayo del mouse con el plano), así no salta a un punto lejano por un hueco.
     Si hay un punto de la franja roja cerca del cursor, se pega a él (proyectado sobre el plano).
   - Sin corte: se usa el punto de la nube más cercano al cursor (comportamiento normal). */
// Puntos de la franja de corte (la línea roja), en coordenadas del mundo. Se recalcula como mucho
// cada 400 ms o cuando cambia el corte, recorriendo solo los nodos visibles.
let cacheLinea = { firma: "", t: 0, pts: new Float32Array(0) };
function puntosLineaRoja() {
  const firma = JSON.stringify([sec.normal, sec.point, sec.thickness, viewer.scene.pointclouds.map((pc) => pc.visibleNodes.length)]);
  if (firma === cacheLinea.firma && performance.now() - cacheLinea.t < 400) return cacheLinea.pts;
  const n = sec.normal, p = sec.point, d0 = -(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]), media = Math.max(sec.thickness / 2, 0.005);
  const out = []; let total = 0;
  for (const pc of viewer.scene.pointclouds) for (const nodo of pc.visibleNodes) {
    const sn = nodo.sceneNode; if (!sn || !sn.geometry || !sn.geometry.attributes.position) continue;
    const a = sn.geometry.attributes.position.array, e = sn.matrixWorld.elements;
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i], y = a[i + 1], z = a[i + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (Math.abs(n[0] * wx + n[1] * wy + n[2] * wz + d0) <= media) { out.push(wx, wy, wz); if (++total > 400000) break; }
    }
  }
  cacheLinea = { firma, t: performance.now(), pts: new Float32Array(out) };
  return cacheLinea.pts;
}
function puntoDeLineaRoja(mouse, camera, el, radioPx) {
  const pts = puntosLineaRoja(); if (!pts.length) return null;
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  const w = el.clientWidth, h = el.clientHeight, r2 = radioPx * radioPx;
  let mejor = -1, mejorD = r2;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15]; if (cw <= 0) continue;
    const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw + 1) / 2 * w;
    const sy = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw) / 2 * h;
    const dd = (sx - mouse.x) ** 2 + (sy - mouse.y) ** 2;
    if (dd < mejorD) { mejorD = dd; mejor = i; }
  }
  return mejor < 0 ? null : { x: pts[mejor], y: pts[mejor + 1], z: pts[mejor + 2] };
}

// Área real en 3D (fórmula de Newell): sirve en planta, en muros y en planos inclinados.
// La de Potree solo mide la proyección sobre el suelo, por eso daba 0 en fachadas.
Potree.Measure.prototype.getArea = function () {
  const P = this.points.map((q) => q.position);
  if (P.length < 3) return 0;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], c = P[(i + 1) % P.length];
    nx += (a.y - c.y) * (a.z + c.z);
    ny += (a.z - c.z) * (a.x + c.x);
    nz += (a.x - c.x) * (a.y + c.y);
  }
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
};

const pickOriginal = Potree.Utils.getMousePointCloudIntersection.bind(Potree.Utils);
Potree.Utils.getMousePointCloudIntersection = function (mouse, camera, visor, nubes, params = {}) {
  const r = pickOriginal(mouse, camera, visor, nubes, params);
  if (!(sec.mode > 0 && $id("medirCorte").checked)) return r;
  const iman = $id("imanMedir").checked;
  const el = visor.renderer.domElement;
  const ray = new THREE.Raycaster();
  ray.setFromCamera({ x: (mouse.x / el.clientWidth) * 2 - 1, y: -(mouse.y / el.clientHeight) * 2 + 1 }, camera);
  const n = new THREE.Vector3(...sec.normal).normalize(), p0 = new THREE.Vector3(...sec.point);
  const plano = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p0);
  const proyectar = (v) => plano.projectPoint(new THREE.Vector3(v.x, v.y, v.z), new THREE.Vector3());
  let loc = null;
  // imán: el punto de la línea roja más cercano al cursor (en pantalla), proyectado sobre el plano
  if (iman) { const q = puntoDeLineaRoja(mouse, camera, el, 14); if (q) loc = proyectar(q); }
  if (!loc) {
    const corte = ray.ray.intersectPlane(plano, new THREE.Vector3());
    if (!corte || Math.abs(ray.ray.direction.dot(n)) < 0.05) return r; // mirando el plano de canto: sin intersección útil
    loc = corte;
  }
  // medida recta: el tramo nuevo sigue el eje del plano más parecido (horizontal o vertical)
  if (insertando && $id("medidaRecta").checked !== shiftPulsado) {
    const med = viewer.scene.measurements[viewer.scene.measurements.length - 1];
    const prev = med && med.points.length >= 2 ? med.points[med.points.length - 2].position : null;
    if (prev) {
      const P = proyectar(prev), d = loc.clone().sub(P);
      let u = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 0, 1));
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0); else u.normalize();
      const v = new THREE.Vector3().crossVectors(n, u).normalize();
      const du = d.dot(u), dv = d.dot(v);
      loc = Math.abs(du) >= Math.abs(dv) ? P.clone().addScaledVector(u, du) : P.clone().addScaledVector(v, dv);
    }
  }
  return { location: loc, distance: camera.position.distanceTo(loc), pointcloud: r ? r.pointcloud : nubes[0], point: { position: loc } };
};
const fmtM = (v) => v.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let firmaMed = "";
setInterval(() => { // lista de resultados (se actualiza al mover puntos)
  const filas = [];
  const cuenta = {};
  for (const m of viewer.scene.measurements) {
    const pts = m.points.map((p) => p.position);
    let tipo, valor;
    if (m.showArea) { tipo = "Área"; valor = pts.length >= 3 ? fmtM(m.getArea()) + " m²" : "…"; }
    else if (m.showHeight) { tipo = "Altura"; valor = pts.length >= 2 ? fmtM(Math.abs(pts[1].z - pts[0].z)) + " m" : "…"; }
    else { tipo = "Distancia"; valor = pts.length >= 2 ? fmtM(m.getTotalDistance()) + " m" : "…"; }
    cuenta[tipo] = (cuenta[tipo] || 0) + 1;
    filas.push([tipo + " " + cuenta[tipo], valor]);
  }
  actualizarUI();
  const firma = JSON.stringify(filas);
  if (firma === firmaMed) return;
  firmaMed = firma;
  const ul = $id("medidas"); ul.textContent = "";
  for (const [a, b] of filas) {
    const li = document.createElement("li");
    const x = document.createElement("span"); x.textContent = a;
    const y = document.createElement("span"); y.textContent = b;
    li.append(x, y); ul.append(li);
  }
}, 400);

/* ---------- vista ---------- */
// Siempre en perspectiva (la vista ortográfica ocultaba el modelo y confundía).
viewer.setCameraMode(Potree.CameraMode.PERSPECTIVE);
$id("encuadrar").onclick = () => { if (!cargadas.size) { aviso("Primero enciende un bloque en la barra de abajo."); return; } viewer.fitToScreen(0.6); };
