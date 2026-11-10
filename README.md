# Visor 3D de nubes de puntos

Visor web para nubes de 4–6 GB que abre en cualquier laptop: solo descarga los puntos
que se ven en pantalla. El código vive en **GitHub Pages** (da el link) y las nubes en
**Google Drive**.

Incluye: corte de sección (planta / vertical, con giro, grosor y color de línea editable,
rojo por defecto), medición (distancia, altura, área, ángulo), vista ortográfica,
varias nubes a la vez y tres niveles de calidad.

## 1. Convertir cada nube a COPC (una sola vez, en Windows)

El visor lee el formato **COPC** (`.copc.laz`): un LAZ ordenado por niveles de detalle.

- **Opción fácil – QGIS** (gratis): arrastra tu `.las/.laz` a QGIS. Al indexarlo crea
  automáticamente `nombre.copc.laz` junto al archivo original.
- **Opción por comando – PDAL** (viene con QGIS, en "OSGeo4W Shell"):
  `pdal translate entrada.las salida.copc.laz`

El archivo debe terminar en `.copc.laz`. Suele pesar menos que el LAS original.

## 2. Subir a Drive y crear la clave

1. Sube el `.copc.laz` a Drive → Compartir → **Cualquier persona con el enlace (Lector)**.
2. Copia el **ID** del archivo: es la parte entre `/d/` y `/view` del enlace.
3. En <https://console.cloud.google.com>: crea un proyecto → *APIs y servicios* →
   habilita **Google Drive API** → *Credenciales* → **Crear clave de API**.
4. Restringe la clave: *Sitios web* → `https://TU-USUARIO.github.io/*`, y *API* → solo Drive API.
   (Así, aunque la clave sea visible en el repositorio, solo funciona desde tu visor.)

## 3. Biblioteca: una carpeta de Drive

Crea en Drive una carpeta (por ejemplo "Nubes visor"), compártela como
**Cualquier persona con el enlace (Lector)** y copia su ID (lo que va después de
`/folders/` en el enlace). En `config.js`:

```js
driveApiKey: "TU_CLAVE",
driveFolderId: "ID_DE_LA_CARPETA",
```

Desde ahí, **agregar una nube = subir su `.copc.laz` a esa carpeta**. Aparece sola en la
biblioteca del visor para todos. Solo tu cuenta de Google puede subir o borrar.

## 4. Publicar en GitHub Pages

1. Crea un repositorio público y sube **todo el contenido** de esta carpeta.
2. *Settings → Pages → Deploy from a branch → main / (root)*.
3. Tu link: `https://TU-USUARIO.github.io/NOMBRE-REPO/`
   - Una nube concreta: `...?nube=bloque-a`
   - Varias: `...?nube=bloque-a,bloque-b`

## Si Drive falla

El visor avisa con el motivo (permiso, clave o cuota). Drive limita las descargas de
archivos muy solicitados; si llegas a ese límite, cualquier almacenamiento que permita
lectura por partes sirve sin tocar el visor: pon `url: "https://..."` en lugar de
`driveId` (por ejemplo Cloudflare R2, que tiene capa gratuita).

## Probar en tu PC

Abre una terminal en la carpeta y ejecuta `python -m http.server`, luego entra a
`http://localhost:8000`. (Abrir `index.html` con doble clic no funciona.)

---
Basado en [Potree 1.8.2](https://github.com/potree/potree) (licencia BSD, ver `LICENSE-potree.txt`).
