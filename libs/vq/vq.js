/* Cifrado de las nubes (AES-256-CTR).  Encabezado de 32 bytes por archivo:
   "VQ3DENC1" (8) + nonce (16) + reservado (8); luego los datos cifrados.
   CTR permite descifrar cualquier rango sin bajar el archivo entero. */
(function (g) {
  "use strict";
  const MAGIA = [86, 81, 51, 68, 69, 78, 67, 49]; // "VQ3DENC1"
  const ENC = 32;
  const p = ["CHvdhVFDJmWCbSo2NetbskgPzlFbaajGAMoLuAZ2u/U=", "IqTM2AYj03TsYL6h88s+ste3+0JiTHUZMbXB4TXl3fM=", "bFc0pbjSreHMQ4CCu+ys+YmWQWmVrfyT3vBpHggGJsg="];
  let claveP = null;
  function partes() { return p.map((t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0))); }
  function clave() {
    if (!claveP) {
      const [a, b, c] = partes(), k = new Uint8Array(32);
      for (let i = 0; i < 32; i++) k[i] = a[i] ^ b[i] ^ c[i];
      claveP = crypto.subtle.importKey("raw", k, { name: "AES-CTR" }, false, ["encrypt", "decrypt"]);
    }
    return claveP;
  }
  function contador(nonce, bloque) { // nonce con los 64 bits bajos + número de bloque (mod 2^64)
    const c = new Uint8Array(nonce);
    const dv = new DataView(c.buffer);
    const bajo = (dv.getBigUint64(8, false) + BigInt(bloque)) & 0xffffffffffffffffn;
    dv.setBigUint64(8, bajo, false);
    return c;
  }
  async function aplicar(nonce, desde, datos, cifrar) { // desde: posición en bytes (múltiplo de 16)
    const k = await clave();
    const alg = { name: "AES-CTR", counter: contador(nonce, desde / 16), length: 64 };
    return new Uint8Array(await crypto.subtle[cifrar ? "encrypt" : "decrypt"](alg, k, datos));
  }
  function esCifrado(u8) { return u8.length >= ENC && MAGIA.every((v, i) => u8[i] === v); }
  function nuevoEncabezado() {
    const e = new Uint8Array(ENC); e.set(MAGIA, 0);
    crypto.getRandomValues(e.subarray(8, 24));
    return e;
  }
  g.VQ = {
    ENC, esCifrado, nuevoEncabezado,
    nonceDe: (enc) => enc.slice(8, 24),
    cifrar: (nonce, desde, datos) => aplicar(nonce, desde, datos, true),
    descifrar: (nonce, desde, datos) => aplicar(nonce, desde, datos, false),
  };
})(typeof self !== "undefined" ? self : window);
