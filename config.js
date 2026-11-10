/* =========================================================
   CONFIGURACIÓN DEL VISOR 3D  —  este es el único archivo
   que necesitas editar para agregar o quitar nubes.
   ========================================================= */
window.VISOR_CONFIG = {

  // Título que aparece en el panel
  titulo: "Visor 3D",

  // Clave de la API de Google Drive (ver README, paso 2).
  // Restríngela a tu dominio de GitHub Pages para que nadie más pueda usarla.
  driveApiKey: "",

  // Lista de nubes. Cada una necesita:
  //   id      -> texto corto sin espacios (se usa en el link: ?nube=id)
  //   nombre  -> lo que se ve en el panel
  //   driveId -> ID del archivo .copc.laz en Drive
  //              (o "url" si el archivo está en otro servidor)
  nubes: [
    { id: "ejemplo", nombre: "Ejemplo (estatua)", url: "pointclouds/ejemplo.copc.laz" },

    // { id: "bloque-a", nombre: "Bloque A", driveId: "PEGA_AQUI_EL_ID_DE_DRIVE" },
    // { id: "bloque-b", nombre: "Bloque B", driveId: "PEGA_AQUI_EL_ID_DE_DRIVE" },
  ],

  // Nubes que se abren al entrar si el link no indica ninguna
  inicial: ["ejemplo"],

  // Corte de sección: valores por defecto
  corte: { color: "#ff0000", grosor: 0.10 },
};
