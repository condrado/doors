# Regla de Persistencia Total del Estado y del Editor

## Principio Fundamental
Cualquier cambio, acción del usuario o evento que modifique el estado de la aplicación (tanto visual como de datos) **DEBE persistirse automáticamente en `localStorage`** para que nunca se pierda nada al refrescar la página (F5), al navegar entre el Editor y la Demo 3D, o al volver desde el Hub.

## Requisitos Obligatorios

1. **Persistencia de Datos del Mapa (`customRaycasterMap`)**:
   - Cada inserción, borrado, trazo, edición de pared, colocación de accesorio (puertas, ventanas), ajuste de dimensiones, cambio de nombre de mapa o movimiento del punto de inicio del jugador debe guardarse inmediatamente en `localStorage`.
   - Al cargar el editor o la demo 3D, se debe comprobar y cargar prioritariamente el mapa guardado si existe.
   - Al probar en 3D ("Probar en 3D") y pulsar "Volver al Editor", o viceversa, el mapa debe mantenerse idéntico con todos los cambios realizados.

2. **Persistencia del Estado de la Interfaz (UI State - `levelEditor_uiState`)**:
   - **Acordeones / Secciones plegables**: Si el usuario pliega o despliega una sección del menú de herramientas (`.tool-section`), su estado (`.collapsed`) debe guardarse y restaurarse fielmente al refrescar.
   - **Panel lateral de JSON**: Si el usuario colapsa o expande la barra lateral derecha del JSON (`.json-collapsed`), este estado debe guardarse y restaurarse.
   - **Herramienta activa**: El modo de dibujo seleccionado (`brush`, `room`, `eraser`).
   - **Elemento seleccionado**: La opción elegida en la paleta de elementos (`1` pared, `accessories`, `0` suelo, `player`).
   - **Pestaña de colocación de paredes**: Si está en `laterales`, `centro` o `uniones-t`.
   - **Modo específico de pared o esquina**: El botón activo de la cuadrícula de colocación.
   - **Accesorio activo**: Puerta (`door`) o ventana (`window`).
   - **Nivel de Zoom**: Tanto el modo (`auto`/`manual`) como el tamaño de celda (`cellSize`).

3. **Aplicación a Nuevas Funcionalidades**:
   - Para **CUALQUIER** nueva opción, panel, botón, filtro, selector o herramienta que se agregue al editor o al juego en el futuro, es **OBLIGATORIO** conectar su evento de cambio con la lógica de persistencia (`saveUIState()` o guardado de datos correspondiente) y restaurarlo en el arranque (`restoreUIState()`).
   - Nunca debe introducirse un estado volátil que vuelva a su valor por defecto al refrescar si el usuario lo ha modificado.
