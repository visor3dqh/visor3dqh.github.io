# Visor 3D de nubes de puntos

Visor web para nubes de 4–6 GB que abre en cualquier laptop: solo descarga los puntos
que se ven en pantalla. El código vive en **GitHub Pages** (da el link) y las nubes en
**Hugging Face**.

Incluye: corte de sección (planta / vertical, con giro, grosor y color de línea editable,
rojo por defecto), medición (distancia, altura, área, ángulo), vista ortográfica,
varias nubes a la vez y tres niveles de calidad.

## 1. Formatos que acepta la página

- **`.las`**: Administrar → elegir el archivo → *Subir*. La página lo convierte ahí mismo
  (formato octree de Potree, por partes y sin cargarlo entero en memoria) y sube el resultado.
  Usa espacio temporal del navegador (≈ el tamaño del .las) y se borra al terminar.
- **`.copc.laz`**: se sube tal cual.
- **`.laz` comprimido, `.e57`, `.ply`**: convertir antes con `herramientas/Convertir-a-COPC.bat`
  (arrastrar encima; usa QGIS, gratis) y subir el `.copc.laz`.

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

## Medir con precisión

En una nube de puntos un clic puede "atravesar" un hueco y caer en un punto lejano. Con un corte
activo, el panel Medir ofrece:

- **Medir sobre el corte**: los puntos quedan exactamente sobre el plano rojo; nunca saltan atrás.
- **Imán a la línea roja**: se pegan al punto real de la franja de corte más cercano al cursor
  (p. ej. las dos caras de un muro → espesor).
- **Libre o diagonal** por defecto; **Forzar medida recta** (o mantener Shift) alinea el tramo al eje
  horizontal/vertical del corte.
- **Posición del corte escrita**: en planta, *Altura (m)* desde el punto más bajo de la nube (p. ej.
  1.20); en vertical, *Distancia (m)* y *Giro* en grados exactos. La barra sigue disponible.
- Consejo: *Ver de frente* coloca la cámara de frente al corte para medir cómodamente.

## Protección

- **Cifrado de extremo a extremo**: cada nube se cifra en el navegador (AES-256) antes de subirla.
  Lo que guarda Hugging Face es ilegible: descargar los archivos de la biblioteca no sirve en ningún
  programa. El visor descifra solo el trozo que muestra, en memoria.
- **Bloques subidos antes del cifrado**: Administrar → *Proteger N bloques sin cifrar* (los cifra,
  reemplaza y borra la versión legible del historial).
- **Página**: política de seguridad estricta (CSP: solo se ejecuta código propio y solo se conecta a
  Hugging Face), no se puede incrustar en otras webs, sin menú contextual ni atajos de guardado.
- **Límite honesto**: sin contraseña de visitante, la clave tiene que estar en la página; alguien con
  conocimientos técnicos y tiempo podría extraerla. El cifrado frena la descarga directa y casual.
- **Subir / borrar**: solo con el token, guardado cifrado únicamente en el equipo del administrador.

## Eliminar bloques

Administrar → *Bloques subidos* → **Eliminar**. Pide confirmación, lo quita para todos y compacta el
historial de la biblioteca para liberar el espacio en Hugging Face.

## Capacidad y nubes grandes

- **El visor no se vuelve más pesado al crecer la biblioteca**: al entrar todos los bloques están
  apagados y, aun con varios encendidos, solo descarga los puntos que se ven (límite fijo según la
  calidad elegida).
- **Por archivo**: Hugging Face admite hasta 50 GB por archivo. Un .las convertido pesa ~la mitad
  (p. ej. un .las de 20 GB queda en ~10 GB). Si un bloque supera eso, divídelo.
- **Conversión en el navegador**: necesita espacio libre en disco ≈ tamaño del .las y la pestaña
  abierta. Si la subida falla (corte de internet), la conversión queda guardada y aparece
  *Reintentar subida* en Administrar: no hay que convertir otra vez.
- **Total de la biblioteca**: el espacio público gratuito de Hugging Face es "best-effort". Si una
  biblioteca llega a su límite, crea otra (p. ej. `nubes-visor-2`), dale permiso de escritura al
  token y ponla en `config.js` como lista; el visor muestra todas juntas y sube a la primera:

  ```js
  hfRepo: ["Loadingfav1/nubes-visor-2", "Loadingfav1/nubes-visor"],
  ```

## Probar en tu PC

Abre una terminal en la carpeta y ejecuta `python -m http.server`, luego entra a
`http://localhost:8000`. (Abrir `index.html` con doble clic no funciona.)

---
Basado en [Potree 1.8.2](https://github.com/potree/potree) (licencia BSD, ver `LICENSE-potree.txt`).
