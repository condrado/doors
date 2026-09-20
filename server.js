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
        res.writeHead(200, { 'Content-Type': contentType });
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
