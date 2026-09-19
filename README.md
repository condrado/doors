# 🎮 Laberinto 2.5D: La Sala de las 4 Puertas & Editor Visual

Proyecto modular basado en un motor **Raycaster 2.5D** puro (estilo Wolfenstein 3D / Doom clásico) implementado en **Canvas 2D nativo** de HTML5, sin bibliotecas 3D externas (cero dependencias).

---

## 🏛️ Estructura del Proyecto

El proyecto se encuentra organizado en módulos independientes y coherentes:

```text
doors/
├── package.json                   # Configuración del proyecto y scripts npm
├── README.md                      # Documentación completa del proyecto
├── server.js                      # Servidor HTTP local con rutas amigables
├── index.html                     # Portal / Hub principal con acceso a Demo y Editor
├── .agents/                       # Reglas y configuraciones del entorno de desarrollo
└── src/
    ├── engine/                    # Motor central 2.5D desacoplado
    │   └── raycaster.js           # RaycasterEngine (algoritmo DDA, texturas procedurales, minimapa)
    ├── demo/                      # Módulo de la Demo 3D en primera persona
    │   ├── index.html             # Interfaz del juego y HUD
    │   ├── style.css              # Estilos del viewport, brújula y controles
    │   └── game.js                # Game loop, entradas del jugador y colisiones
    └── editor/                    # Módulo del Editor Visual de Niveles
        ├── index.html             # Interfaz del editor de cuadrícula y paleta
        ├── editor.css             # Estilos de la mesa de trabajo y herramientas
        └── editor.js              # Lógica de dibujo 5x1, rotación [R] y exportación JSON
```

---

## 🚀 Cómo Iniciar el Proyecto

### Requisitos
- **Node.js** (versión 14 o superior)

### Ejecución Local
En la terminal, ejecuta:
```bash
npm run dev
# o bien
npm start
```

El servidor iniciará automáticamente en el puerto `3000` (o el siguiente disponible) y ofrecerá los siguientes accesos directos:

- **🏠 Portal Principal (Hub)**: `http://localhost:3000/`
- **🎮 Demo 3D**: `http://localhost:3000/demo` (o `http://localhost:3000/src/demo/`)
- **🛠️ Editor de Niveles**: `http://localhost:3000/editor` (o `http://localhost:3000/src/editor/`)

---

## 🕹️ Características de la Demo 3D (`src/demo/`)

- **Perspectiva en primera persona**: Campo de visión de ~66° generado por cálculo de rayos (DDA).
- **Tabiques finos con volumen sólido (5x1)**: Grosor de 0.20 unidades con cantos visibles biselados.
- **4 Puertas con Runas**:
  - 🔴 **Norte (N)** (Rojo)
  - 🟢 **Este (E)** (Verde)
  - 🔵 **Sur (S)** (Azul)
  - 🟠 **Oeste (O)** (Naranja)
- **Minimapa / Radar en vivo**: Orientación y cono de visión en tiempo real.
- **Brújula dinámica de rumbo**: Indicador superior cardinal (Norte, Este, Sur, Oeste).
- **Controles**:
  - `A` / `◀`: Girar hacia la izquierda.
  - `D` / `▶`: Girar hacia la derecha.
  - `W` / `▲`: Avanzar un paso.
  - `S` / `▼`: Retroceder un paso.

---

## 🛠️ Características del Editor Visual (`src/editor/`)

- **Tabiques finos en bordes y centros**: Selección rápida de posición (N, S, E, W, Centro Horizontal, Centro Vertical).
- **Rotación Rápida**: Tecla `[R]` para alternar entre Horizontal ━ y Vertical ┃.
- **Esquinas y Rincones Inteligentes**:
  - Esquinas perimetrales: NO, NE, SO, SE.
  - Rincones centrales en L y Cruces completos H+V.
- **Herramienta Habitación**: Arrastra sobre la cuadrícula para construir recintos completos con muros perimetrales.
- **Importación y Exportación JSON**: Carga o guarda mapas en formato `.json` al instante.
- **Probar en 3D**: Guarda el mapa actual en `localStorage` y lo abre automáticamente en la demo jugable (`?custom=1`).
