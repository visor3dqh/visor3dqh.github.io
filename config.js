/* =========================================================
   CONFIGURACIÓN DEL VISOR 3D
   ========================================================= */
window.VISOR_CONFIG = {

  // Título que aparece en el panel
  titulo: "Visor 3D",

  // BIBLIOTECA: repositorio de datos (dataset) público en Hugging Face,
  // en formato "usuario/nombre". Todo archivo .copc.laz que tenga aparece en el visor.
  hfRepo: "Loadingfav1/nubes-visor",

  // Token de escritura de Hugging Face, CIFRADO con la contraseña del visor.
  // Se genera desde el propio visor: Administrar → Configuración inicial.
  hfTokenCifrado: "",

  // Nubes fijas adicionales (opcional), alojadas en otro servidor con lectura por partes:
  // { id: "bloque-a", nombre: "Bloque A", url: "https://..." },
  nubes: [
  ],

  // Corte de sección: valores por defecto
  corte: { color: "#ff0000", grosor: 0.10 },
};
