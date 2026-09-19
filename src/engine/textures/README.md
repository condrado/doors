# Texturas del Proyecto

Coloca aquí imágenes (PNG recomendado, cualquier formato que soporte `<img>`) con estos nombres exactos para sustituir el diseño por defecto (procedural) de cada elemento en toda la Demo 3D:

| Archivo        | Sustituye a                  |
|-----------------|-------------------------------|
| `wall.png`      | Pared de piedra                |
| `door_n.png`    | Puerta Norte                   |
| `door_e.png`    | Puerta Este                    |
| `door_s.png`    | Puerta Sur                     |
| `door_w.png`    | Puerta Oeste                   |
| `window.png`    | Ventana                        |
| `cap.png`       | Canto / Jamba de pared          |
| `door_cap.png`  | Canto / Jamba de puerta         |

## Cómo funciona

- El motor (`RaycasterEngine`) genera primero sus texturas procedurales (siempre disponibles, sin depender de archivos externos) y luego intenta cargar estos archivos de forma asíncrona.
- Si un archivo existe, la imagen se reescala automáticamente a 64x64 px y sustituye a la textura procedural correspondiente.
- Si un archivo no existe, no pasa nada: simplemente se conserva el diseño procedural por defecto.
- No hace falta tocar ningún código: basta con añadir, reemplazar o borrar el archivo con el nombre correcto.

## Prioridad frente a las texturas por mapa

Si además subes texturas específicas para un mapa concreto desde el **Editor de Niveles** (sección "Texturas Personalizadas"), esas texturas de mapa tienen prioridad y sustituyen a las de esta carpeta solo mientras ese mapa esté cargado.
