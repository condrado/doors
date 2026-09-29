const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

// ==========================================
// LIVE RELOAD (SSE - Server-Sent Events)
// ==========================================
const sseClients = new Set();

function notifyClients() {
  for (const client of sseClients) {
    try {
      client.write('data: reload\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}

// Mantener conexiones SSE vivas con un ping regular
const heartbeatInterval = setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': ping\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 20000);
heartbeatInterval.unref();

// Observador de archivos para recarga en vivo con debounce
let debounceTimer = null;
try {
  fs.watch(__dirname, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const normalized = filename.replace(/\\/g, '/');
    if (
      normalized.includes('.git') ||
      normalized.includes('node_modules') ||
      normalized.includes('scratch') ||
      normalized.includes('src/assets/textures') ||
      normalized.includes('src/assets/texturas') ||
      normalized.includes('src/engine/textures') ||
      normalized.endsWith('.tmp')
    ) {
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(`🔄 [LiveReload] Cambio detectado en "${filename}". Recargando navegador...`);
      notifyClients();
    }, 120);
  });
} catch (err) {
  console.warn('⚠️ No se pudo inicializar fs.watch:', err.message);
}

const LIVE_RELOAD_SCRIPT = `
<!-- Live Reload Automático -->
<script>
(() => {
  let retryCount = 0;
  function connect() {
    const es = new EventSource('/__live_reload');
    es.onmessage = (e) => {
      if (e.data === 'reload') {
        console.log('⚡ [LiveReload] Actualización de desarrollo detectada. Recargando...');
        location.reload();
      }
    };
    es.onerror = () => {
      es.close();
      setTimeout(connect, Math.min(2500, 500 * (++retryCount)));
    };
    es.onopen = () => {
      retryCount = 0;
    };
  }
  connect();
})();
</script>
`;

const server = http.createServer((req, res) => {
  let reqUrl = req.url.split('?')[0];

  // Endpoint SSE para Live Reload
  if (reqUrl === '/__live_reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('data: connected\n\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // Endpoint API para guardar texturas PNG en disco
  if (req.method === 'POST' && reqUrl === '/api/save-texture') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { relativePath, base64Data } = JSON.parse(body);
        if (!relativePath || !base64Data) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify({ error: 'Faltan parámetros relativePath o base64Data' }));
          return;
        }

        // Prevenir directory traversal
        let normalized = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
        // Migración transparente de rutas antiguas a src/assets/textures
        normalized = normalized.replace('src' + path.sep + 'engine' + path.sep + 'textures', 'src' + path.sep + 'assets' + path.sep + 'textures')
                               .replace('src' + path.sep + 'assets' + path.sep + 'texturas', 'src' + path.sep + 'assets' + path.sep + 'textures');

        const targetPath = path.join(__dirname, normalized);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });

        const base64Pure = base64Data.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(targetPath, Buffer.from(base64Pure, 'base64'));

        console.log(`🖼️ [Textura guardada]: ${normalized}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ success: true, path: normalized }));
      } catch (err) {
        console.error('Error guardando textura:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Endpoint API para listar texturas físicas presentes en carpetas
  if (req.method === 'GET' && reqUrl === '/api/list-textures') {
    try {
      const baseDir = path.join(__dirname, 'src', 'assets', 'textures');
      const categories = ['walls', 'doors', 'windows', 'caps'];
      const result = { walls: [], doors: [], windows: [], caps: [] };

      categories.forEach(cat => {
        const catDir = path.join(baseDir, cat);
        if (fs.existsSync(catDir)) {
          const files = fs.readdirSync(catDir);
          files.forEach(file => {
            if (/\.(png|jpg|jpeg|webp)$/i.test(file)) {
              const name = path.parse(file).name;
              const catFilePath = path.join(catDir, file);
              const capFilePath = path.join(baseDir, 'caps', file);
              const hasCap = fs.existsSync(capFilePath);

              let catMtime = Date.now();
              try {
                const statCat = fs.statSync(catFilePath);
                catMtime = Math.floor(statCat.mtimeMs);
              } catch {}

              let capMtime = catMtime;
              if (hasCap) {
                try {
                  const statCap = fs.statSync(capFilePath);
                  capMtime = Math.floor(statCap.mtimeMs);
                } catch {}
              }

              result[cat].push({
                name,
                file: `${cat}/${file}`,
                url: `/src/assets/textures/${cat}/${file}?t=${catMtime}`,
                capFile: hasCap ? `caps/${file}` : null,
                capUrl: hasCap ? `/src/assets/textures/caps/${file}?t=${capMtime}` : null,
                hasCap,
                mtime: catMtime,
                capMtime: hasCap ? capMtime : null
              });
            }
          });
        }
      });

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Endpoint API para listar TODOS los assets del juego para exportación autónoma
  if (req.method === 'GET' && reqUrl === '/api/list-all-assets') {
    try {
      const rootAssetsDir = path.join(__dirname, 'src', 'assets');
      const allFiles = [];

      function scanDir(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile()) {
            if (/\.(png|jpg|jpeg|webp|json|txt)$/i.test(entry.name) && !entry.name.endsWith('.bak')) {
              const relFromAssets = path.relative(rootAssetsDir, fullPath).replace(/\\/g, '/');
              allFiles.push({
                exportPath: `assets/${relFromAssets}`,
                url: `/src/assets/${relFromAssets}`
              });
            }
          }
        }
      }

      scanDir(rootAssetsDir);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      res.end(JSON.stringify(allFiles));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Mapear peticiones relativas a /assets/ hacia /src/assets/
  if (reqUrl.startsWith('/assets/')) {
    reqUrl = '/src' + reqUrl;
  }

  // Compatibilidad hacia atrás y reescritura de rutas para assets organizados bajo /src/assets/textures/
  reqUrl = reqUrl.replace('/src/engine/textures/', '/src/assets/textures/')
                 .replace('/src/assets/texturas/', '/src/assets/textures/')
                 .replace('/src/assets/personajes/', '/src/assets/textures/characters/')
                 .replace('/src/assets/accesorios/', '/src/assets/textures/accessories/');

  if (/^\/src\/assets\/(char_|personaje-)/.test(reqUrl)) {
    reqUrl = reqUrl.replace('/src/assets/', '/src/assets/textures/characters/');
  } else if (/^\/src\/assets\/monitor/.test(reqUrl)) {
    reqUrl = reqUrl.replace('/src/assets/', '/src/assets/textures/accessories/');
  }

  // Reescritura de nombres de archivo españoles a ingleses
  reqUrl = reqUrl.replace('personaje-andar.png', 'character-walk.png')
                 .replace('personaje-correr.png', 'character-run.png')
                 .replace(/personaje-/g, 'character-')
                 .replace('castillo.png', 'castle.png')
                 .replace('blanca.png', 'white.png')
                 .replace('negra.png', 'black.png')
                 .replace('cristal-c.png', 'crystal-c.png')
                 .replace('cristal.png', 'crystal.png')
                 .replace('ventana.png', 'window.png')
                 .replace('cesped-1.png', 'grass-1.png')
                 .replace('cesped-2.png', 'grass-2.png')
                 .replace('rosa-1.png', 'pink-1.png')
                 .replace('rosa-2.png', 'pink-2.png')
                 .replace('rosa.png', 'pink.png');

  // Enrutamiento limpio y amigable
  if (reqUrl === '/' || reqUrl === '') {
    reqUrl = '/index.html';
  } else if (reqUrl === '/demo' || reqUrl === '/demo/') {
    reqUrl = '/src/demo/index.html';
  } else if (reqUrl === '/editor' || reqUrl === '/editor/') {
    reqUrl = '/src/editor/index.html';
  }

  // Normalizar ruta de archivo
  let filePath = path.join(__dirname, reqUrl);

  // Si la ruta solicitada es un directorio, buscar index.html dentro
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('404 Archivo no encontrado: ' + reqUrl);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end(`500 Error del servidor: ${err.code}`);
      }
    } else {
      if (ext === '.html') {
        let htmlStr = content.toString('utf-8');
        if (htmlStr.includes('</body>')) {
          htmlStr = htmlStr.replace('</body>', `${LIVE_RELOAD_SCRIPT}\n</body>`);
        } else {
          htmlStr += LIVE_RELOAD_SCRIPT;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(htmlStr);
      } else {
        const headers = { 'Content-Type': contentType };
        if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(ext)) {
          headers['Cache-Control'] = 'no-cache, must-revalidate';
        }
        res.writeHead(200, headers);
        res.end(content);
      }
    }
  });
});

function startServer(port) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`\n==============================================`);
    console.log(`🎮 Servidor activo del proyecto (con Live Reload):`);
    console.log(`👉 Hub Principal:   http://localhost:${port}/`);
    console.log(`👉 Demo 3D:         http://localhost:${port}/demo`);
    console.log(`👉 Editor:          http://localhost:${port}/editor`);
    console.log(`⚡ Live Reload activo: el navegador se actualizará automáticamente`);
    console.log(`==============================================\n`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const nextPort = PORT + 1;
    console.log(`⚠️ Puerto ${PORT} en uso, intentando con ${nextPort}...`);
    startServer(nextPort);
  } else {
    console.error('Error en el servidor:', err);
  }
});

startServer(PORT);
