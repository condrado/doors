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

const server = http.createServer((req, res) => {
  let reqUrl = req.url.split('?')[0];

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
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`\n==============================================`);
    console.log(`🎮 Servidor activo del proyecto:`);
    console.log(`👉 Hub Principal:   http://localhost:${port}/`);
    console.log(`👉 Demo 3D:         http://localhost:${port}/demo`);
    console.log(`👉 Editor:          http://localhost:${port}/editor`);
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
