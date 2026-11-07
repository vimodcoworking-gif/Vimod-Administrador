// API para el agente del servidor (vimod-empresas\herramientas\agente.php).
// Contrato en vimod-empresas\LEEME.md → "Conexión con el Panel administrador".
// Todas las rutas exigen "Authorization: Bearer <AGENTE_TOKEN>" y HTTPS.
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Empresa = require('../models/Empresa');
const Tarea = require('../models/Tarea');
const Contenido = require('../models/Contenido');
const cifrado = require('../lib/cifrado');

const router = express.Router();
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const igual = (x, y) => {
  const h = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(h(x), h(y));
};
const fechaValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : undefined);

function resumenLicencia(l) {
  if (!l || typeof l !== 'object') return undefined;
  return {
    estado: String(l.estado || '').slice(0, 20),
    vence: fechaValida(l.vence),
    plan: String(l.plan || '').slice(0, 40),
    dias: Number.isFinite(Number(l.dias)) ? Number(l.dias) : undefined,
    vigente: !!l.vigente
  };
}

// ---- Autenticación del agente ----
router.use((req, res, next) => {
  const token = process.env.AGENTE_TOKEN || '';
  if (token.length < 48) return res.status(503).json({ error: 'AGENTE_TOKEN no está configurado en el Panel (48+ caracteres).' });
  const local = ['localhost', '127.0.0.1'].includes(req.hostname);
  if (!req.secure && !local) return res.status(403).json({ error: 'Solo por HTTPS.' });
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m || !igual(m[1].trim(), token)) return res.status(401).json({ error: 'Token no válido.' });
  next();
});

router.use((req, res, next) =>
  mongoose.connection.readyState === 1 ? next() : res.status(503).json({ error: 'Base de datos no disponible' })
);

// Registra la última vez que el agente se comunicó.
async function latido(datos = {}) {
  await Contenido.updateOne(
    { _id: 'agente' },
    { $set: { 'datos.ultimoContacto': new Date(), ...Object.fromEntries(Object.entries(datos).map(([k, v]) => [`datos.${k}`, v])) } },
    { upsert: true }
  );
}

// 1. Tareas pendientes
router.get('/tareas', a(async (req, res) => {
  const tareas = await Tarea.find({ estado: { $in: ['pendiente', 'enviada'] } }).sort('createdAt').limit(20);
  await Tarea.updateMany(
    { _id: { $in: tareas.map((t) => t._id) } },
    { $set: { estado: 'enviada' }, $inc: { entregas: 1 } }
  );
  await latido();
  res.json({ tareas: tareas.map((t) => ({ id: t.id, tipo: t.tipo, datos: t.datos })) });
}));

// 2. Resultado de una tarea
router.post('/tareas/:id/resultado', a(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Tarea no encontrada' });
  const tarea = await Tarea.findById(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (tarea.estado === 'hecha' || tarea.estado === 'error') return res.json({ ok: true, repetido: true }); // reenvío

  const ok = req.body.ok === true;
  const r = req.body.resultado && typeof req.body.resultado === 'object' ? req.body.resultado : {};
  const empresa = tarea.empresa ? await Empresa.findById(tarea.empresa) : null;

  if (ok && tarea.tipo === 'crear') {
    // La contraseña llega una sola vez: si no se puede cifrar, se responde error y el agente la reenvía.
    const clave = r.admin && r.admin.clave ? String(r.admin.clave) : '';
    if (clave && !cifrado.disponible()) {
      return res.status(503).json({ error: 'Falta CIFRADO_SECRETO en el Panel; el agente reintentará.' });
    }
    if (empresa) {
      empresa.set({
        estado: 'lista',
        error: undefined,
        url: String(r.url || '').slice(0, 400),
        baseDatos: String(r.base_datos || '').slice(0, 80),
        adminUsuario: r.admin && r.admin.usuario ? String(r.admin.usuario) : empresa.adminUsuario,
        licenciaServidor: resumenLicencia(r.licencia),
        vence: fechaValida(r.licencia && r.licencia.vence) || empresa.vence,
        sincronizada: new Date()
      });
      if (clave) empresa.adminClave = cifrado.cifrar(clave);
      await empresa.save();
    }
  } else if (ok && tarea.tipo === 'licencia' && empresa) {
    empresa.set({ licenciaServidor: resumenLicencia(r.licencia), sincronizada: new Date() });
    if (r.licencia && fechaValida(r.licencia.vence)) empresa.vence = r.licencia.vence;
    await empresa.save();
  } else if (!ok && tarea.tipo === 'crear' && empresa) {
    empresa.set({ estado: 'error', error: String(req.body.error || 'Error desconocido').slice(0, 500) });
    await empresa.save();
  }

  // Se guarda el resultado sin la contraseña.
  const limpio = JSON.parse(JSON.stringify(r));
  if (limpio.admin) delete limpio.admin.clave;
  tarea.set({
    estado: ok ? 'hecha' : 'error',
    resultado: limpio,
    error: ok ? undefined : String(req.body.error || 'Error desconocido').slice(0, 1000),
    terminada: new Date()
  });
  await tarea.save();
  await latido();
  res.json({ ok: true });
}));

// 3. Inventario: estado de todas las empresas del servidor
router.post('/inventario', a(async (req, res) => {
  const lista = Array.isArray(req.body.empresas) ? req.body.empresas.slice(0, 1000) : [];
  for (const e of lista) {
    const slug = String(e.empresa || '').toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$/.test(slug)) continue;
    const cambios = {
      url: String(e.url || '').slice(0, 400),
      baseDatos: String(e.base_datos || '').slice(0, 80),
      licenciaServidor: resumenLicencia(e.licencia),
      sincronizada: new Date()
    };
    if (e.licencia && fechaValida(e.licencia.vence)) cambios.vence = e.licencia.vence;
    const existente = await Empresa.findOne({ slug });
    if (existente) {
      existente.set(cambios);
      if (existente.estado !== 'lista') existente.set({ estado: 'lista', error: undefined });
      await existente.save();
    } else {
      // Empresa creada a mano en el servidor (CREAR EMPRESA.bat): queda sin cliente para vincularla en el Panel.
      await Empresa.create({
        ...cambios,
        slug,
        nombre: String(e.nombre || slug).slice(0, 150),
        adminUsuario: String(e.admin || 'admin'),
        plan: (e.licencia && String(e.licencia.plan || '').slice(0, 40)) || 'mensual',
        estado: 'lista'
      });
    }
  }
  await latido({ servidor: String(req.body.servidor || '').slice(0, 100), fechaServidor: String(req.body.fecha || '').slice(0, 40), empresas: lista.length });
  res.json({ ok: true, recibidas: lista.length });
}));

router.use((err, req, res, next) => {
  console.error('[agente]', err);
  res.status(500).json({ error: 'Error interno del Panel' });
});

module.exports = router;
