require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const Sistema = require('./models/Sistema');

const app = express();
const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI;

app.set('trust proxy', 1); // Render está detrás de un proxy HTTPS
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Robots-Tag', 'noindex');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---- Conexión a MongoDB (la misma base que VIMOD PRESENTACION) ----
if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI)
    .then(async () => {
      console.log('✔ Conectado a MongoDB');
      // Catálogo inicial de sistemas
      if ((await Sistema.countDocuments()) === 0) {
        await Sistema.create({
          nombre: 'VIMOD Gestión',
          descripcion: 'Software de gestión empresarial: facturación, inventario, CRM, contabilidad y proyectos.'
        });
        console.log('✔ Sistema "VIMOD Gestión" creado');
      }
    })
    .catch((err) => console.error('✖ Error conectando a MongoDB:', err.message));
} else {
  console.warn('⚠ MONGODB_URI no definido.');
}
if (!process.env.ADMIN_USUARIO || !process.env.ADMIN_PASSWORD) {
  console.warn('⚠ Define ADMIN_USUARIO y ADMIN_PASSWORD para poder iniciar sesión en el panel.');
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'conectada' : 'desconectada' });
});

app.use('/api', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Panel VIMOD en http://localhost:${PORT}`));
