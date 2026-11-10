# Visor 3D de nubes de puntos

Visor web para nubes de 4–6 GB que abre en cualquier laptop: solo descarga los puntos
que se ven en pantalla. El código vive en **GitHub Pages** (da el link) y las nubes en
**Hugging Face**.

Incluye: corte de sección (planta / vertical, con giro, grosor y color de línea editable,
rojo por defecto), medición (distancia, altura, área, ángulo), vista ortográfica,
varias nubes a la vez y tres niveles de calidad.

## 1. Convertir cada nube a COPC (una sola vez, en Windows)

El visor transmite el formato **COPC** (`.copc.laz`). Para convertir `.las`, `.laz`, `.e57`, `.ply`…:

1. Instala **QGIS** (gratis): <https://qgis.org/download/>.
2. Arrastra tus archivos sobre **`herramientas/Convertir-a-COPC.bat`** (también se descarga desde
   Administrar en el visor). Crea `nombre.copc.laz` junto a cada archivo.

Alternativa sin el .bat: abre la nube en QGIS; al cargarla crea `nombre.copc.laz` en la misma carpeta.

## 2. Biblioteca en Hugging Face (gratis)

1. Crea una cuenta en <https://huggingface.co/join>.
2. Crea un repositorio de datos **público**: <https://huggingface.co/new-dataset>, por ejemplo `nubes-visor`.
3. Crea un token de acceso *fine-grained* en <https://huggingface.co/settings/tokens/new?tokenType=fineGrained>
   con permiso de **escritura solo en ese repositorio**.
4. En el visor (en tu laptop): **Administrar**, pega el token y elige la contraseña → *Configurar este equipo*.
   El token queda guardado solo en ese equipo, cifrado con la contraseña; no se publica en ningún lado.

## 3. Subir nubes

Administrar → contraseña → elige el `.copc.laz` → *Subir a la biblioteca*. Aparece para todos en la
biblioteca. Los visitantes solo pueden abrir y medir; subir o borrar requiere la contraseña.

## 4. Publicar en GitHub Pages

1. Crea un repositorio público y sube **todo el contenido** de esta carpeta.
2. *Settings → Pages → Deploy from a branch → main / (root)*.
3. Tu link: `https://TU-USUARIO.github.io/NOMBRE-REPO/`
   - Una nube concreta: `...?nube=bloque-a`
   - Varias: `...?nube=bloque-a,bloque-b`

## Límites

Hugging Face da almacenamiento público gratuito "best-effort" (sin tope fijo publicado, con
controles contra abuso) y hasta 50 GB por archivo. Si alguna vez bloquea, cualquier servidor con
lectura por partes sirve: agrega la nube en `nubes` con su `url`.

## Probar en tu PC

Abre una terminal en la carpeta y ejecuta `python -m http.server`, luego entra a
`http://localhost:8000`. (Abrir `index.html` con doble clic no funciona.)

---
Basado en [Potree 1.8.2](https://github.com/potree/potree) (licencia BSD, ver `LICENSE-potree.txt`).
