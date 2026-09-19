# Regla de Generación de Paredes, Cantos 3D y Rendimiento

## Principio Fundamental
En la representación 3D de paredes del motor (`raycaster.js`), **todo tramo de pared, tabique, puerta o ventana genera SIEMPRE la textura de canto/jamba metálica (`textures[10]`, `isCap: true`) en sus dos extremos**, sin excepción y sin comprobar si ese extremo conecta con otra pared o casilla contigua.

Se descartó deliberadamente la detección topológica de conexiones (comprobar si un tramo se une a otro para suprimir el canto en la unión): el coste extra de generar esas caras adicionales es insignificante para este motor (canvas interno de 640x400, mapas pequeños, `_cellSegmentsCache` por celda) y la lógica de conexión añadía muchos casos especiales frágiles y difíciles de mantener. Cuando dos tramos de pared se tocan, el canto queda sencillamente oculto/inalcanzable dentro de la propia geometría sólida (nunca lo intersecta ningún rayo válido desde el suelo transitable), así que no hay coste visual ni de jugabilidad por generarlo siempre.

---

## Requisitos Obligatorios de Implementación

### 1. Cantos incondicionales
Cada bloque de `generateCellFaces()` que genera un tramo de pared, puerta o ventana (perimetral N/S/E/W, central CH/CV, esquinas, rincones, cruces, uniones en T y puertas abiertas ODx) debe incluir sus caras de canto (`type: 10, isCap: true`) directamente en el mismo `faces.push(...)`, sin condicional de conexión previa.

### 2. Caché de Geometría por Celda (`_cellSegmentsCache`)
- Dado que el algoritmo DDA evalúa las celdas miles de veces por segundo en cada frame de raycasting, las caras y cantos calculados deben **cachearse por casilla** en memoria.
- Cada vez que el mapa se actualice, se cargue un nivel del editor o se modifiquen paredes, se debe invocar obligatoriamente `engine.clearSegmentsCache()` para recalcular de forma limpia.

### 3. Nuevas Geometrías y Modificaciones Futuras
- Si en el futuro se añaden nuevos tipos de tabiques, columnas, bloques diagonales, ventanas o accesorios, **es obligatorio aplicar esta misma regla**: generar siempre ambos cantos del tramo, sin lógica de detección de conexión con celdas o tramos vecinos.
