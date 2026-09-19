# Regla de Generación de Paredes, Cantos 3D y Rendimiento

## Principio Fundamental
En la representación 3D de paredes del motor (`raycaster.js`), **la textura de canto/jamba metálica (`textures[10]`, `isCap: true`) SOLO se debe colocar en extremos de pared que queden VISTOS AL AIRE (extremos abiertos o libres)**.

Cuando dos o más tramos de pared se unan o toquen entre sí (dentro de la misma casilla o con casillas adyacentes), **está TERMINANTEMENTE PROHIBIDO generar caras de canto en la unión**, para evitar sobrecargar la demo con geometrías y texturas invisibles que ralenticen el movimiento y la carga del juego.

---

## Requisitos Obligatorios de Implementación

### 1. Detección Topológica de Conexiones
Antes de añadir una cara de tipo `isCap: true`, el motor debe comprobar si ese extremo está conectado a otra pared:

- **Ejes Centrales (`CH`, `CV`, `CN`, `CS`, `CW`, `CE`, Puertas y Ventanas Centrales):**
  - **Extremo Oeste:** Conecta si en la misma celda hay muro perimetral `W` (`DW`, `WW`) o si la celda vecina al Oeste (`mapX - 1`) tiene pared que toque en el centro (`CH`, `CE`, `E`, bloque sólido). Si conecta, **NO generar Canto Oeste**.
  - **Extremo Este:** Conecta si en la misma celda hay muro perimetral `E` (`DE`, `WE`) o si la celda vecina al Este (`mapX + 1`) tiene pared que toque en el centro (`CH`, `CW`, `W`, bloque sólido). Si conecta, **NO generar Canto Este**.
  - **Extremo Norte:** Conecta si en la misma celda hay muro perimetral `N` (`DN`, `WN`) o si la celda vecina al Norte (`mapY - 1`) tiene pared que toque en el centro (`CV`, `CS`, `S`, bloque sólido). Si conecta, **NO generar Canto Norte**.
  - **Extremo Sur:** Conecta si en la misma celda hay muro perimetral `S` (`DS`, `WS`) o si la celda vecina al Sur (`mapY + 1`) tiene pared que toque en el centro (`CV`, `CN`, `N`, bloque sólido). Si conecta, **NO generar Canto Sur**.

- **Paredes Perimetrales (`N`, `S`, `W`, `E`, Esquinas Exteriores, Puertas y Ventanas Perimetrales):**
  - Cada extremo (horizontal o vertical) comprueba si la pared continúa en la casilla contigua, si hace esquina con otra pared de la misma celda, o si una pared perpendicular adyacente hace contacto con su extremo.
  - Si hay contacto, **el canto se suprime**. Solo se genera si el extremo termina en espacio vacío.

### 2. Puntos de Encuentro en Esquinas, Cruces y Uniones T
- **Codos centrales (`CN+CW`, `CN+CE`, `CS+CW`, `CS+CE`) y Cruces (`CH+CV`):** El centro de intersección es geométricamente continuo; nunca debe incluir caras de canto internas.
- **Uniones T interiores (`CH+CN`, `CH+CS`, `CV+CW`, `CV+CE`):** El tallo de la T se empalma directamente contra el muro transversal. No lleva cara de canto en la zona de contacto.
- **Uniones T de borde (`CH+W`, `CH+E`, `CV+N`, `CV+S`):** El eje central se incrusta en el muro perimetral; no se debe colocar ningún canto entre ellos.

### 3. Caché de Geometría por Celda (`_cellSegmentsCache`)
- Dado que el algoritmo DDA evalúa las celdas miles de veces por segundo en cada frame de raycasting, las caras y cantos calculados deben **cachearse por casilla** en memoria.
- Cada vez que el mapa se actualice, se cargue un nivel del editor o se modifiquen paredes, se debe invocar obligatoriamente `engine.clearSegmentsCache()` para recalcular de forma limpia.

### 4. Nuevas Geometrías y Modificaciones Futuras
- Si en el futuro se añaden nuevos tipos de tabiques, columnas, bloques diagonales, ventanas o accesorios, **es obligatorio aplicar esta misma regla**: verificar continuidad y colocar cantos única y exclusivamente en las caras visibles expuestas al aire.
