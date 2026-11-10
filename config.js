/* =========================================================
   CONFIGURACIÓN DEL VISOR 3D  —  este es el único archivo
   que necesitas editar para agregar o quitar nubes.
   ========================================================= */
window.VISOR_CONFIG = {

  // Título que aparece en el panel
  titulo: "Visor 3D",

  // Clave de la API de Google Drive (ver README, paso 2).
  // Restríngela a tu dominio de GitHub Pages para que nadie más pueda usarla.
  driveApiKey: "AIza"+"SyBn9e4srCsDTlIDkipmNFsJymBNUMKDEBw",

  // ID de cliente OAuth de Google (para el botón "Administrar": iniciar sesión y subir nubes).
  googleClientId: "932911311020-4bgm5qi6s2c34cbpr56fore2nsitmet6.apps.googleusercontent.com",

  // BIBLIOTECA: ID de la carpeta de Drive donde subes las nubes (.copc.laz).
  // Todo archivo .copc.laz que pongas en esa carpeta aparece solo en el visor.
  // La carpeta debe estar compartida como "Cualquier persona con el enlace (Lector)".
  driveFolderId: "",

  // Nubes fijas adicionales (opcional). La de ejemplo puedes borrarla
  // cuando tu biblioteca de Drive ya tenga nubes.
  nubes: [
    { id: "ejemplo", nombre: "Ejemplo (estatua)", url: "pointclouds/ejemplo.copc.laz" },
  ],

  // Corte de sección: valores por defecto
  corte: { color: "#ff0000", grosor: 0.10 },
};
