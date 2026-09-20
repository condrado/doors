# Resumen de sesión: puertas, texturas, estilos y alturas

Registro de todo lo implementado en esta sesión de trabajo sobre el motor (`src/engine/raycaster.js`), el editor (`src/editor/editor.js` + `index.html` + `editor.css`) y la demo (`src/demo/game.js`). Pensado como referencia rápida para retomar el trabajo o para dar contexto a una sesión nueva.

---

## 1. Puertas no permitidas en paredes centradas (CH/CV)

Las puertas colocadas sobre un eje central (`DCH`/`DCV`) se abrían mal en el motor 3D. En vez de arreglar el render, se bloqueó la colocación:

- `editor.js` → `applyToolAt()`: si se intenta poner una puerta sobre `CH`/`CV`, se cancela y se muestra un aviso (`🚫 No se pueden colocar puertas en paredes centradas`).
- El motor sigue soportando `DCH`/`DCV` por compatibilidad con mapas antiguos, pero el editor ya no los genera.

## 2. Cantos (jambas) siempre generados, sin lógica de conexión

Antes había una lógica topológica compleja que solo generaba el canto/jamba en extremos "abiertos al aire", para ahorrar geometría. Se simplificó por decisión explícita del usuario: el coste extra es insignificante y la lógica de conexión era frágil.

- `generateCellFaces()` genera **siempre** los cantos en ambos extremos de cada tramo (pared, puerta, esquina, cruce, rincón), estén o no conectados a otra pared.
- Se eliminaron los 8 métodos de detección de conexión (`isPerimeterXConnected`, `isCenterXConnected`) y `isSolidCell`.
- **Cantos de pared → `textures[10]`. Cantos de puerta → `textures[11]`** (tipos separados), para que cada uno pueda tener su propio estilo/textura sin mezclarse.
- Regla documentada en `.agents/rules/paredes-cantos-3d.md`.

## 3. Sistema de texturas por imagen (upload + carpeta de proyecto)

Dos vías para sustituir el diseño procedural por una imagen, pensadas como *override* que tiene prioridad sobre el estilo procedural:

- **Por mapa (Editor)**: sección "Texturas Personalizadas" — subir una imagen por tipo (pared, puerta N/E/S/O, ventana, canto), se reescala a 64×64 y se guarda como Data URL en `customTextures` dentro del JSON del nivel/`localStorage`.
- **Por proyecto (archivos)**: `src/engine/textures/` — colocar `wall.png`, `door_n.png`, `door_e.png`, `door_s.png`, `door_w.png`, `window.png`, `cap.png`, `door_cap.png`. El motor los intenta cargar al arrancar (`loadDefaultTextureOverrides()`); si no existen, sigue con la textura procedural. Documentado en el `README.md` de esa carpeta.
- Precedencia: procedural (base) → archivo de proyecto → imagen subida en el editor (la más específica gana). Implementado con `Promise` (`textureOverridesReady`) para evitar condiciones de carrera.
- En el motor, una textura "override" por imagen es un `Uint32Array` plano; una textura procedural normal es un diccionario `{ estilo: pixeles }`. El render distingue ambos casos con `instanceof Uint32Array`.

## 4. Estilos procedurales de pared y puerta (sin PNGs)

Módulo nuevo **`src/engine/textures.js`** (compartido por motor y editor) con funciones de dibujo procedural puras y dos catálogos:

```js
WALL_STYLES = { castillo, blanca, cristal }       // pared + su canto
DOOR_STYLES = { castillo, blanca, negra, cristal } // puerta + su canto
```

- **Castillo**: diseño original (ladrillo/piedra en pared, madera con herrajes en puerta).
- **Blanca / Cristal (pared)**: superficies **lisas**, sin ladrillos ni bloques (a petición expresa: "no estirar el patrón, que sea liso").
- **Blanca / Negra / Cristal (puerta)**: superficies **lisas**, sin tablones ni paneles — solo el picaporte y la runa de color que identifica la dirección (N/E/S/O), que se conserva porque es funcional para el juego.
- Ventana (`textures[6]`) no tiene variantes de estilo.

### Editor: selector de estilo (modal)
- Botones **"Pincel de Pared"** (sección Colocación de Paredes) y **"Pincel de Puerta"** (sección Colocación de Accesorios) abren un modal compartido (`#styleModalOverlay`) con miniaturas 64×64 generadas en vivo con la misma función que usará el motor 3D.
- Importante: estos "pinceles" **no repintan el mapa existente** — solo determinan con qué estilo se etiquetará lo próximo que se coloque (ver punto 5).

## 5. Estilo por segmento (no global) — `wallStyleMap`

Requisito clave del usuario: cambiar el pincel de estilo **no debe afectar a lo ya colocado**; cada pared/puerta puede tener una textura distinta, incluso dentro de la misma celda (hasta 4 paredes con 4 texturas distintas).

- `editor.js`: `this.wallStyleMap = { "x,y": { N: 'blanca', DW: 'negra', ... } }`, guardado dentro del JSON del nivel (`level.wallStyleMap`) solo si no está vacío.
- `setSegmentStyle(x, y, edgeCode)` / `clearSegmentStyle(...)` / `clearCellStyles(...)`: etiquetan o limpian el estilo de un código de segmento concreto en el momento de colocarlo/borrarlo, usando el pincel activo (`this.wallStyle` o `this.doorStyle`) en ese instante.
- Se llama desde: colocación normal (`applyToolAt`), esquinas rápidas (`corner_...`), la herramienta "Habitación" (`createRoom`). Los generadores de mapa completo (`initDefaultMap`, `createNewRoomOfSize`, `applyPreset`, `clearMap`) resetean `wallStyleMap` a `{}` (sus paredes por defecto son "castillo" implícito).
- Motor: `getSegmentStyle(mapX, mapY, edgeCode)` lee ese mapa; por defecto `'castillo'` si no hay dato (compatibilidad con mapas antiguos).

### Bug importante ya corregido: pared Oeste nunca cambiaba de estilo
`setSegmentStyle` tenía `if (edgeCode.startsWith('W')) return;` para ignorar ventanas (`WN`, `WCH`...) — pero el código de la **pared Oeste es exactamente `'W'`** (1 carácter) y también empezaba por `'W'`, así que nunca se etiquetaba. Arreglado comprobando longitud: `edgeCode.length > 1 && edgeCode.startsWith('W')`.

### Estilo independiente por cara en figuras compuestas
En `generateCellFaces()`, cuando dos paredes comparten celda y forman una esquina, rincón o cruce (p. ej. `N`+`W`), **cada cara de la geometría usa el estilo de la pared a la que pertenece geométricamente** (no un estilo combinado único). Se sustituyó el antiguo `pickStyle(...)` (elegía el primero disponible) por `styleOf(code)` aplicado cara a cara, usando el patrón: caras `axis:'y'` pertenecen al código N/S (o CH/CV central-horizontal), caras `axis:'x'` pertenecen al código W/E (o CV/CH central-vertical).

## 6. Alturas independientes de pared y puerta ("5x15" / "5x10")

- `this.wallHeightScale = 3.0` (paredes 3× más altas que anchas/gruesas).
- `this.doorHeightScale = 2.0` (puertas 2× más altas).
- Proyección: ambas se calculan desde una altura de ojos común `eyeHeight = wallHeightScale / 2`, ancladas al mismo suelo, para que no floten ni se desalineen aunque midan distinto.

## 7. Dintel (hueco de pared sobre la puerta)

Como la puerta es más baja que la pared, queda un hueco por encima que se rellena con textura de **pared**, con su propio pincel dedicado:

- **Pincel de Dintel** (`this.lintelStyle`, catálogo `WALL_STYLES`): tercer botón en la sección de Accesorios, junto a "Pincel de Puerta". Al colocar una puerta, se etiqueta automáticamente `DN_lintel` (o `DS_lintel`, `DW_lintel`, `DE_lintel`, `DCH_lintel`, `DCV_lintel`) con este pincel.
- Persistencia: `activeLintelStyle` en el JSON (pincel actual) + la entrada `_lintel` dentro de `wallStyleMap` (estilo real ya colocado).

### Bug importante ya corregido: el dintel se abría con la puerta
Primera implementación: el dintel se dibujaba como una segunda banda de textura sobre el mismo impacto de rayo que la puerta (`hit` 2-5). Al abrir la puerta (`ODN`, etc.), su geometría se mueve al lateral (hoja abatida) y ya no hay ningún segmento en la posición original del hueco → el dintel desaparecía también, como si "se abriera" con la puerta.

**Arreglo (arquitectura final):**
- Nuevo tipo de segmento `isLintelOnly: true` en `generateCellFaces()`: una cara de pared (tipo 1, o tipo 10 para su canto) colocada en la posición **original** del hueco de la puerta (p. ej. `nyA`/`nyB` para una puerta Norte), añadida **tanto si la puerta está cerrada (`DN`) como abierta (`ODN`)**.
- `_intersectSegments()` (nuevo método auxiliar del motor): los segmentos `isLintelOnly` **no bloquean el rayo** — se registran aparte como "impacto de dintel más cercano" mientras el rayo sigue su camino normal (pudiendo atravesar el hueco de la puerta abierta y golpear algo más lejano).
- En `render()`, tras resolver el impacto principal de cada columna, si se encontró un dintel se dibuja **como una capa superpuesta**, con su propia distancia/sombreado/textura — independientemente de si la puerta de abajo está abierta o cerrada.
- Verificado con test de píxeles: el color del dintel es **idéntico** antes y después de `engine.openDoor(...)`.

## 8. Texturas de pared: repetir (tile) en vez de estirar

Al poner `wallHeightScale = 3`, la textura de 64×64 se estiraba para llenar toda la altura (un ladrillo "5x5" pasaba a ocupar "5x15", deformado). Cambio pedido: mantener la proporción natural y **repetir** la textura en vez de estirarla.

- `blitTexBand(..., tile, tileDist)` en `render()`: si `tile === true`, el paso de muestreo se calcula como `texSize / (h / distancia)` (texels por 1 unidad de mundo) y `texY` se calcula con módulo (`% texSize`) para repetir, en vez de estirar sobre toda la banda.
- **Se aplica a**: paredes (tipo 1), cantos de pared (tipo 10), ventanas (tipo 6) y el dintel — todos son patrones repetitivos.
- **NO se aplica a**: puertas (tipos 2-5) ni cantos de puerta (tipo 11) — son una imagen única con detalles propios (runa, picaporte, pomo) que se deformarían/duplicarían si se repitieran. Estas siguen estirándose una sola vez para llenar su altura (`doorHeightScale`), tal y como pidió el usuario ("la puerta debe ocupar 5x10 así no se estira" = sin repetición, una sola imagen ajustada a su tamaño).
- Verificado con muestreo de píxeles: patrón de ladrillo repetido ~3 veces en una pared cercana (periodicidad ≈ proj px, coincide con `wallHeightScale=3`); textura de puerta con forma simétrica única (sin repetición) confirmando el picaporte/runa aparece una sola vez.

---

## Estado actual / pendiente

- Todo lo anterior está implementado y verificado mediante pruebas directas en el motor (Node/consola del navegador) y visualmente en el editor. **No se ha hecho commit** de ningún cambio (regla del proyecto: gestión manual de git por el usuario).
- Posible siguiente paso pendiente de confirmar con el usuario: pulir visualmente el modal "Pincel de Dintel" (recién añadido) con una pasada de uso real en el editor, y considerar si conviene un pincel de dintel por defecto distinto de "castillo".
