/* =====================================================================
   Conversor LAS -> octree Potree 2.0 (sin servidor, dentro del navegador)

   Lee el .las por partes (nunca entero en memoria), arma un octree con
   niveles de detalle y escribe en el disco privado del navegador (OPFS):
     metadata.json, hierarchy.bin, octree.bin
   que Potree transmite por partes igual que COPC.

   Pasos:  1) conteo en una grilla  2) reparto en bloques ("chunks")
           con muestreo de los niveles altos  3) octree de cada bloque
           4) jerarquía + metadatos
   ===================================================================== */

const G = 128;                        // grilla de conteo y de muestreo por nodo
const NIV = 7;                        // log2(G)
const TROZO_LECTURA = 64 * 1024 * 1024;

let MAX_BLOQUE = 4_000_000;           // puntos máx. por bloque en memoria
let MAX_HOJA = 20_000;                // puntos máx. en un nodo hoja

const avisar = (fase, avance, texto) => postMessage({ tipo: "progreso", fase, avance, texto });

onmessage = async (e) => {
  try {
    if (e.data.maxBloque) MAX_BLOQUE = e.data.maxBloque;
    if (e.data.maxHoja) MAX_HOJA = e.data.maxHoja;
    const r = await convertir(e.data.file, e.data.carpeta);
    postMessage({ tipo: "listo", ...r });
  } catch (err) {
    postMessage({ tipo: "error", mensaje: err && err.message ? err.message : String(err) });
  }
};

/* ---------------- cabecera LAS ---------------- */
function leerCabecera(buf, tamArchivo) {
  const v = new DataView(buf);
  const firma = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (firma !== "LASF") throw new Error("El archivo no es un LAS/LAZ válido.");
  const verMin = v.getUint8(25);
  const tamCab = v.getUint16(94, true);
  const offPts = v.getUint32(96, true);
  const fmtByte = v.getUint8(104);
  if (fmtByte & 0xc0) throw new Error("Es un .laz comprimido. Por ahora la página convierte .las sin comprimir (o .laz que ya sean COPC).");
  const fmt = fmtByte & 0x3f;
  if (fmt > 10) throw new Error("Formato de punto LAS no reconocido (" + fmt + ").");
  const lenReg = v.getUint16(105, true);
  let n = v.getUint32(107, true);
  if (verMin >= 4 && tamCab >= 375) {
    const n64 = Number(v.getBigUint64(247, true));
    if (n64 > 0) n = n64;
  }
  const maxPorTam = Math.floor((tamArchivo - offPts) / lenReg);
  if (!n || n > maxPorTam) n = maxPorTam;
  const esc = [v.getFloat64(131, true), v.getFloat64(139, true), v.getFloat64(147, true)];
  const off = [v.getFloat64(155, true), v.getFloat64(163, true), v.getFloat64(171, true)];
  const max = [v.getFloat64(179, true), v.getFloat64(195, true), v.getFloat64(211, true)];
  const min = [v.getFloat64(187, true), v.getFloat64(203, true), v.getFloat64(219, true)];
  const offRGB = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }[fmt] ?? -1;
  const offCls = fmt >= 6 ? 16 : 15;
  const mascCls = fmt >= 6 ? 0xff : 0x1f;
  return { verMin, offPts, fmt, lenReg, n, esc, off, min, max, offRGB, offCls, mascCls };
}

async function* recorrer(file, h) {
  const porTrozo = Math.max(1, Math.floor(TROZO_LECTURA / h.lenReg));
  for (let i = 0; i < h.n; i += porTrozo) {
    const cant = Math.min(porTrozo, h.n - i);
    const ini = h.offPts + i * h.lenReg;
    const buf = await file.slice(ini, ini + cant * h.lenReg).arrayBuffer();
    yield { dv: new DataView(buf), u8: new Uint8Array(buf), cant, hechos: i + cant };
  }
}

/* ---------------- utilidades de escritura OPFS ---------------- */
class Escritor { // archivo de solo-añadir con búfer
  constructor(acceso, tamBufer) { this.a = acceso; this.buf = new Uint8Array(tamBufer); this.pos = 0; this.total = 0; }
  agregar(bytes) {
    if (this.pos + bytes.length > this.buf.length) this.vaciar();
    if (bytes.length > this.buf.length) { this.a.write(bytes, { at: this.total }); this.total += bytes.length; return; }
    this.buf.set(bytes, this.pos); this.pos += bytes.length;
  }
  vaciar() {
    if (!this.pos) return;
    this.a.write(this.buf.subarray(0, this.pos), { at: this.total });
    this.total += this.pos; this.pos = 0;
  }
  cerrar() { this.vaciar(); this.a.flush(); this.a.close(); }
}

class Lista { // arreglo de bytes que crece (para nodos superiores)
  constructor(bpp) { this.bpp = bpp; this.buf = new Uint8Array(bpp * 4096); this.n = 0; }
  agregar(reg) {
    const fin = (this.n + 1) * this.bpp;
    if (fin > this.buf.length) { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
    this.buf.set(reg, this.n * this.bpp); this.n++;
  }
  bytes() { return this.buf.subarray(0, this.n * this.bpp); }
}

/* ---------------- conversión ---------------- */
async function convertir(file, carpeta) {
  const raiz = await navigator.storage.getDirectory();
  const dir = await raiz.getDirectoryHandle(carpeta, { create: true });
  const cab = await file.slice(0, 400).arrayBuffer();
  const h = leerCabecera(cab, file.size);
  if (h.n <= 0) throw new Error("El archivo no tiene puntos.");
  const conRGB = h.offRGB >= 0;
  const bpp = 12 + (conRGB ? 6 : 0) + 2 + 1; // posición int32×3, rgb uint16×3, intensidad uint16, clase uint8

  /* --- cubo envolvente (desde la cabecera; se recorta si algún punto se sale) --- */
  const ext = [h.max[0] - h.min[0], h.max[1] - h.min[1], h.max[2] - h.min[2]];
  if (!ext.every((d) => isFinite(d) && d >= 0)) throw new Error("La cabecera del LAS tiene límites inválidos.");
  const lado = Math.max(...ext, 1e-6) * 1.0001;
  const cMin = [0, 1, 2].map((k) => (h.min[k] + h.max[k]) / 2 - lado / 2);
  let escSal = Math.min(...h.esc.filter((s) => s > 0), 0.01);
  if (lado / escSal > 2e9) escSal = lado / 2e9;
  const ladoInt = lado / escSal;

  const celda = (x, k) => { let c = Math.floor(((x - cMin[k]) / lado) * G); return c < 0 ? 0 : c >= G ? G - 1 : c; };

  /* --- paso 1: conteo --- */
  const conteo = new Uint32Array(G * G * G);
  const rMin = [Infinity, Infinity, Infinity], rMax = [-Infinity, -Infinity, -Infinity];
  for await (const t of recorrer(file, h)) {
    for (let i = 0, p = 0; i < t.cant; i++, p += h.lenReg) {
      const x = t.dv.getInt32(p, true) * h.esc[0] + h.off[0];
      const y = t.dv.getInt32(p + 4, true) * h.esc[1] + h.off[1];
      const z = t.dv.getInt32(p + 8, true) * h.esc[2] + h.off[2];
      if (x < rMin[0]) rMin[0] = x; if (x > rMax[0]) rMax[0] = x;
      if (y < rMin[1]) rMin[1] = y; if (y > rMax[1]) rMax[1] = y;
      if (z < rMin[2]) rMin[2] = z; if (z > rMax[2]) rMax[2] = z;
      conteo[celda(x, 0) + celda(y, 1) * G + celda(z, 2) * G * G]++;
    }
    avisar("conteo", t.hechos / h.n, "Analizando la nube");
  }

  /* --- pirámide de conteos y división en bloques --- */
  const piramide = new Array(NIV + 1);
  piramide[NIV] = conteo;
  for (let l = NIV - 1; l >= 0; l--) {
    const n = 1 << l, n2 = n * 2, sup = piramide[l + 1], cur = new Float64Array(n * n * n);
    for (let iz = 0; iz < n2; iz++) for (let iy = 0; iy < n2; iy++) for (let ix = 0; ix < n2; ix++) {
      const c = sup[ix + iy * n2 + iz * n2 * n2];
      if (c) cur[(ix >> 1) + (iy >> 1) * n + (iz >> 1) * n * n] += c;
    }
    piramide[l] = cur;
  }
  const clave = (l, ix, iy, iz) => ((l * 256 + ix) * 256 + iy) * 256 + iz;
  const superiores = new Map(); // clave -> nodo superior (se muestrea al vuelo)
  const bloques = new Map();    // clave -> bloque
  const listaBloques = [];
  (function dividir(l, ix, iy, iz, nombre) {
    const n = 1 << l, c = piramide[l][ix + iy * n + iz * n * n];
    if (!c) return;
    if (c <= MAX_BLOQUE || l === NIV) {
      const b = { nombre, l, ix, iy, iz, conteo: c };
      bloques.set(clave(l, ix, iy, iz), b); listaBloques.push(b); return;
    }
    superiores.set(clave(l, ix, iy, iz), { nombre, l, ix, iy, iz, mascara: new Uint8Array((G * G * G) >> 3), puntos: new Lista(bpp) });
    for (let k = 0; k < 8; k++) dividir(l + 1, ix * 2 + ((k >> 2) & 1), iy * 2 + ((k >> 1) & 1), iz * 2 + (k & 1), nombre + k);
  })(0, 0, 0, 0, "r");

  /* --- paso 2: reparto --- */
  const tamBufBloque = Math.max(64 * 1024, Math.min(1 << 20, Math.floor((256 << 20) / Math.max(1, listaBloques.length))));
  for (let i = 0; i < listaBloques.length; i++) {
    const fh = await dir.getFileHandle("b" + i + ".bin", { create: true });
    listaBloques[i].arch = "b" + i + ".bin";
    listaBloques[i].esc = new Escritor(await fh.createSyncAccessHandle(), tamBufBloque);
  }
  const reg = new Uint8Array(bpp), rv = new DataView(reg.buffer);
  for await (const t of recorrer(file, h)) {
    for (let i = 0, p = 0; i < t.cant; i++, p += h.lenReg) {
      const x = t.dv.getInt32(p, true) * h.esc[0] + h.off[0];
      const y = t.dv.getInt32(p + 4, true) * h.esc[1] + h.off[1];
      const z = t.dv.getInt32(p + 8, true) * h.esc[2] + h.off[2];
      // registro de salida
      rv.setInt32(0, Math.round((x - cMin[0]) / escSal), true);
      rv.setInt32(4, Math.round((y - cMin[1]) / escSal), true);
      rv.setInt32(8, Math.round((z - cMin[2]) / escSal), true);
      let o = 12;
      if (conRGB) { reg.set(t.u8.subarray(p + h.offRGB, p + h.offRGB + 6), 12); o = 18; }
      rv.setUint16(o, t.dv.getUint16(p + 12, true), true);
      reg[o + 2] = t.u8[p + h.offCls] & h.mascCls;
      // descenso por los nodos superiores
      const ux = (x - cMin[0]) / lado, uy = (y - cMin[1]) / lado, uz = (z - cMin[2]) / lado;
      for (let l = 0; l <= NIV; l++) {
        const n = 1 << l;
        let ix = Math.floor(ux * n), iy = Math.floor(uy * n), iz = Math.floor(uz * n);
        ix = ix < 0 ? 0 : ix >= n ? n - 1 : ix; iy = iy < 0 ? 0 : iy >= n ? n - 1 : iy; iz = iz < 0 ? 0 : iz >= n ? n - 1 : iz;
        const k = clave(l, ix, iy, iz);
        const sup = superiores.get(k);
        if (sup) {
          let sx = Math.floor((ux * n - ix) * G), sy = Math.floor((uy * n - iy) * G), sz = Math.floor((uz * n - iz) * G);
          sx = sx < 0 ? 0 : sx >= G ? G - 1 : sx; sy = sy < 0 ? 0 : sy >= G ? G - 1 : sy; sz = sz < 0 ? 0 : sz >= G ? G - 1 : sz;
          const c = sx + sy * G + sz * G * G, byte = c >> 3, bit = 1 << (c & 7);
          if (!(sup.mascara[byte] & bit)) { sup.mascara[byte] |= bit; sup.puntos.agregar(reg); break; }
          continue;
        }
        const b = bloques.get(k);
        if (b) { b.esc.agregar(reg); break; }
      }
    }
    avisar("reparto", t.hechos / h.n, "Organizando los puntos");
  }
  for (const b of listaBloques) b.esc.cerrar();

  /* --- paso 3: octree de cada bloque + escritura --- */
  const fhOct = await dir.getFileHandle("octree.bin", { create: true });
  const oct = await fhOct.createSyncAccessHandle();
  oct.truncate(0);
  let posOct = 0;
  const nodos = new Map(); // nombre -> {np, off, tam}
  const escribirNodo = (nombre, bytes, np) => {
    oct.write(bytes, { at: posOct });
    nodos.set(nombre, { np, off: posOct, tam: bytes.length });
    posOct += bytes.length;
  };
  for (const s of superiores.values()) { escribirNodo(s.nombre, s.puntos.bytes(), s.puntos.n); s.mascara = null; s.puntos = null; }

  const sello = new Uint32Array(G * G * G); // celdas ocupadas por nodo (sin borrar la grilla)
  let idNodo = 0;
  let hechos = 0, totalBloques = listaBloques.reduce((a, b) => a + b.conteo, 0);
  for (const b of listaBloques) {
    const fh = await dir.getFileHandle(b.arch);
    const acc = await fh.createSyncAccessHandle();
    const tam = acc.getSize();
    const datos = new Uint8Array(tam);
    acc.read(datos, { at: 0 }); acc.close();
    await dir.removeEntry(b.arch);
    const np = tam / bpp, dv = new DataView(datos.buffer);
    const ux = new Float64Array(np), uy = new Float64Array(np), uz = new Float64Array(np);
    for (let i = 0; i < np; i++) {
      ux[i] = dv.getInt32(i * bpp, true) / ladoInt;
      uy[i] = dv.getInt32(i * bpp + 4, true) / ladoInt;
      uz[i] = dv.getInt32(i * bpp + 8, true) / ladoInt;
    }
    const destino = new Uint8Array(np);
    const construir = (nombre, l, ix, iy, iz, idx) => {
      const juntar = (lista) => {
        const out = new Uint8Array(lista.length * bpp);
        for (let j = 0; j < lista.length; j++) out.set(datos.subarray(lista[j] * bpp, lista[j] * bpp + bpp), j * bpp);
        return out;
      };
      if (idx.length <= MAX_HOJA || l >= 30) { escribirNodo(nombre, juntar(idx), idx.length); return; }
      const n = 2 ** l, id = ++idNodo;
      const cuentas = new Uint32Array(9);
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j];
        const fx = ux[i] * n - ix, fy = uy[i] * n - iy, fz = uz[i] * n - iz;
        let sx = Math.floor(fx * G), sy = Math.floor(fy * G), sz = Math.floor(fz * G);
        sx = sx < 0 ? 0 : sx >= G ? G - 1 : sx; sy = sy < 0 ? 0 : sy >= G ? G - 1 : sy; sz = sz < 0 ? 0 : sz >= G ? G - 1 : sz;
        const c = sx + sy * G + sz * G * G;
        let d;
        if (sello[c] !== id) { sello[c] = id; d = 8; }
        else d = (fx >= 0.5 ? 4 : 0) | (fy >= 0.5 ? 2 : 0) | (fz >= 0.5 ? 1 : 0);
        destino[i] = d; cuentas[d]++;
      }
      const grupos = Array.from({ length: 9 }, (_, d) => new Uint32Array(cuentas[d]));
      const pos = new Uint32Array(9);
      for (let j = 0; j < idx.length; j++) { const i = idx[j], d = destino[i]; grupos[d][pos[d]++] = i; }
      escribirNodo(nombre, juntar(grupos[8]), grupos[8].length);
      for (let k = 0; k < 8; k++) if (grupos[k].length)
        construir(nombre + k, l + 1, ix * 2 + ((k >> 2) & 1), iy * 2 + ((k >> 1) & 1), iz * 2 + (k & 1), grupos[k]);
    };
    const todos = new Uint32Array(np); for (let i = 0; i < np; i++) todos[i] = i;
    construir(b.nombre, b.l, b.ix, b.iy, b.iz, todos);
    hechos += b.conteo;
    avisar("octree", hechos / totalBloques, "Creando niveles de detalle");
  }
  oct.flush(); oct.close();

  /* --- paso 4: jerarquía (un solo bloque, en orden por anchura) --- */
  const mascaras = new Map();
  for (const nombre of nodos.keys()) {
    if (nombre === "r") continue;
    const padre = nombre.slice(0, -1), k = +nombre[nombre.length - 1];
    mascaras.set(padre, (mascaras.get(padre) || 0) | (1 << k));
  }
  const orden = [], cola = ["r"];
  let profundidad = 0;
  while (cola.length) {
    const nombre = cola.shift();
    orden.push(nombre);
    profundidad = Math.max(profundidad, nombre.length - 1);
    const m = mascaras.get(nombre) || 0;
    for (let k = 0; k < 8; k++) if (m & (1 << k)) cola.push(nombre + k);
  }
  const jer = new Uint8Array(orden.length * 22), jv = new DataView(jer.buffer);
  orden.forEach((nombre, i) => {
    const nd = nodos.get(nombre) || { np: 0, off: 0, tam: 0 };
    const m = mascaras.get(nombre) || 0;
    jv.setUint8(i * 22, m ? 0 : 1);
    jv.setUint8(i * 22 + 1, m);
    jv.setUint32(i * 22 + 2, nd.np, true);
    jv.setBigInt64(i * 22 + 6, BigInt(nd.off), true);
    jv.setBigInt64(i * 22 + 14, BigInt(nd.tam), true);
  });
  await escribirArchivo(dir, "hierarchy.bin", jer);

  const atributos = [
    { name: "position", description: "", size: 12, numElements: 3, elementSize: 4, type: "int32", min: rMin, max: rMax },
  ];
  if (conRGB) atributos.push({ name: "rgb", description: "", size: 6, numElements: 3, elementSize: 2, type: "uint16", min: [0, 0, 0], max: [65535, 65535, 65535] });
  atributos.push({ name: "intensity", description: "", size: 2, numElements: 1, elementSize: 2, type: "uint16", min: [0], max: [65535] });
  atributos.push({ name: "classification", description: "", size: 1, numElements: 1, elementSize: 1, type: "uint8", min: [0], max: [255] });
  const meta = {
    version: "2.0", name: carpeta, description: "", points: h.n, projection: "",
    hierarchy: { firstChunkSize: jer.length, stepSize: 4, depth: profundidad },
    offset: cMin, scale: [escSal, escSal, escSal], spacing: lado / G,
    boundingBox: { min: cMin, max: cMin.map((v) => v + lado) },
    encoding: "DEFAULT", attributes: atributos,
  };
  await escribirArchivo(dir, "metadata.json", new TextEncoder().encode(JSON.stringify(meta, null, 1)));
  return { puntos: h.n, nodos: orden.length, bytesOctree: posOct, conRGB };
}

async function escribirArchivo(dir, nombre, bytes) {
  const fh = await dir.getFileHandle(nombre, { create: true });
  const a = await fh.createSyncAccessHandle();
  a.truncate(0); a.write(bytes, { at: 0 }); a.flush(); a.close();
}
