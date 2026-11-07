// API del Panel administrador.
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');
const Licencia = require('../models/Licencia');
const Sistema = require('../models/Sistema');
const Solicitud = require('../models/Solicitud');
const Contacto = require('../models/Contacto');
const planes = require('../lib/planes');
const auth = require('../lib/auth');

const router = express.Router();
const COOKIE = 'vimod_admin';
const HORAS = 12;
const DIA = 86400e3;

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const tomar = (obj, campos) => Object.fromEntries(campos.filter((c) => obj[c] !== undefined).map((c) => [c, obj[c]]));
const vacioANull = (v) => (v === '' || v === undefined ? null : v);
const idValido = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(404).json({ error: 'No encontrado' });

// Compara en tiempo constante (evita deducir la contraseña por tiempos de respuesta).
const igual = (x, y) => {
  const h = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(h(x), h(y));
};

// ---- Sesión del administrador ----
router.post('/auth/login', auth.limitador(8, 15 * 60e3), (req, res) => {
  const { ADMIN_USUARIO, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USUARIO || !ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Faltan ADMIN_USUARIO y ADMIN_PASSWORD en la configuración del servidor' });
  }
  const usuarioOk = igual(String(req.body.usuario || '').trim(), ADMIN_USUARIO);
  const claveOk = igual(String(req.body.password || ''), ADMIN_PASSWORD);
  if (!usuarioOk || !claveOk) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  auth.iniciarSesion(req, res, COOKIE, { sub: 'admin', u: ADMIN_USUARIO }, HORAS);
  res.json({ ok: true, usuario: ADMIN_USUARIO });
});

router.post('/auth/logout', (req, res) => {
  auth.cerrarSesion(req, res, COOKIE);
  res.json({ ok: true });
});

router.use((req, res, next) => {
  const sesion = auth.leerSesion(req, COOKIE);
  if (!sesion || sesion.sub !== 'admin' || sesion.u !== process.env.ADMIN_USUARIO) {
    return res.status(401).json({ error: 'Inicia sesión para continuar' });
  }
  req.admin = sesion.u;
  next();
});

router.get('/auth/yo', (req, res) => res.json({ usuario: req.admin }));

router.use((req, res, next) =>
  mongoose.connection.readyState === 1 ? next() : res.status(503).json({ error: 'Base de datos no disponible' })
);

router.get('/config', (req, res) => {
  res.json({
    sitioUrl: (process.env.SITIO_URL || '').replace(/\/$/, ''),
    planes: planes.map((p) => ({ id: p.id, nombre: p.nombre, precio: p.precio }))
  });
});

// ---- Resumen ----
const filtroActivas = () => ({
  estado: 'activa',
  $or: [{ fechaVencimiento: null }, { fechaVencimiento: { $gte: new Date() } }]
});
const pendientes = { estado: { $in: [null, 'pendiente'] } };

router.get('/resumen', a(async (req, res) => {
  const ahora = new Date();
  const [usuarios, usuariosActivos, licenciasActivas, solicitudesPendientes, mensajesSinLeer, porVencer, ultimasSolicitudes] =
    await Promise.all([
      Usuario.countDocuments(),
      Usuario.countDocuments({ activo: true }),
      Licencia.countDocuments(filtroActivas()),
      Solicitud.countDocuments(pendientes),
      Contacto.countDocuments({ leido: { $ne: true } }),
      Licencia.find({ estado: 'activa', fechaVencimiento: { $gte: ahora, $lte: new Date(Date.now() + 30 * DIA) } })
        .populate('usuario', 'nombre email').populate('sistema', 'nombre').sort('fechaVencimiento').limit(10),
      Solicitud.find().sort('-createdAt').limit(6)
    ]);
  res.json({ usuarios, usuariosActivos, licenciasActivas, solicitudesPendientes, mensajesSinLeer, porVencer, ultimasSolicitudes });
}));

router.get('/contadores', a(async (req, res) => {
  const [solicitudes, mensajes] = await Promise.all([
    Solicitud.countDocuments(pendientes),
    Contacto.countDocuments({ leido: { $ne: true } })
  ]);
  res.json({ solicitudes, mensajes });
}));

// ---- Usuarios (clientes) ----
const CAMPOS_USUARIO = ['nombre', 'email', 'empresa', 'telefono', 'activo'];

router.get('/usuarios', a(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filtro = {};
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filtro.$or = [{ nombre: re }, { email: re }, { empresa: re }];
  }
  const usuarios = await Usuario.find(filtro).sort('-createdAt').limit(500).lean();
  const conteos = await Licencia.aggregate([
    { $match: { usuario: { $in: usuarios.map((u) => u._id) } } },
    { $group: { _id: '$usuario', total: { $sum: 1 } } }
  ]);
  const mapa = new Map(conteos.map((c) => [String(c._id), c.total]));
  res.json(usuarios.map((u) => ({ ...u, licencias: mapa.get(String(u._id)) || 0 })));
}));

router.get('/usuarios/:id', idValido, a(async (req, res) => {
  const usuario = await Usuario.findById(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  const licencias = await Licencia.find({ usuario: usuario._id }).populate('sistema', 'nombre url').sort('-createdAt');
  const solicitudes = await Solicitud.find({ email: usuario.email }).sort('-createdAt').limit(20);
  res.json({ usuario, licencias: licencias.map((l) => l.toObject({ virtuals: true })), solicitudes });
}));

router.post('/usuarios', a(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  const usuario = await Usuario.create({ ...tomar(req.body, CAMPOS_USUARIO), passwordHash: auth.hashPassword(password) });
  res.status(201).json(usuario);
}));

router.put('/usuarios/:id', idValido, a(async (req, res) => {
  const usuario = await Usuario.findByIdAndUpdate(req.params.id, tomar(req.body, CAMPOS_USUARIO), { new: true, runValidators: true });
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(usuario);
}));

router.put('/usuarios/:id/password', idValido, a(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  const r = await Usuario.updateOne({ _id: req.params.id }, { passwordHash: auth.hashPassword(password) });
  if (!r.matchedCount) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true });
}));

router.delete('/usuarios/:id', idValido, a(async (req, res) => {
  const usuario = await Usuario.findByIdAndDelete(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  await Licencia.deleteMany({ usuario: usuario._id });
  res.json({ ok: true });
}));

// ---- Licencias ----
function datosLicencia(body) {
  const d = tomar(body, ['usuario', 'sistema', 'plan', 'estado', 'fechaInicio', 'fechaVencimiento', 'maxUsuarios', 'notas']);
  // Fechas "AAAA-MM-DD": el inicio cuenta desde el comienzo del día y el vencimiento hasta su final.
  const dia = (v, hora) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${hora}Z` : v);
  if ('fechaInicio' in d) d.fechaInicio = dia(vacioANull(d.fechaInicio), '00:00:00.000') || new Date();
  if ('fechaVencimiento' in d) d.fechaVencimiento = dia(vacioANull(d.fechaVencimiento), '23:59:59.999');
  if ('maxUsuarios' in d) d.maxUsuarios = vacioANull(d.maxUsuarios);
  return d;
}

router.post('/licencias', a(async (req, res) => {
  const d = datosLicencia(req.body);
  if (!mongoose.isValidObjectId(d.usuario) || !(await Usuario.exists({ _id: d.usuario }))) {
    return res.status(400).json({ error: 'Usuario no válido' });
  }
  if (!mongoose.isValidObjectId(d.sistema) || !(await Sistema.exists({ _id: d.sistema }))) {
    return res.status(400).json({ error: 'Elige un sistema' });
  }
  const licencia = await Licencia.create(d);
  res.status(201).json(licencia);
}));

router.put('/licencias/:id', idValido, a(async (req, res) => {
  const d = datosLicencia(req.body);
  delete d.usuario; // una licencia no cambia de dueño
  if ('sistema' in d && !(mongoose.isValidObjectId(d.sistema) && (await Sistema.exists({ _id: d.sistema })))) {
    return res.status(400).json({ error: 'Elige un sistema' });
  }
  const licencia = await Licencia.findByIdAndUpdate(req.params.id, d, { new: true, runValidators: true });
  if (!licencia) return res.status(404).json({ error: 'Licencia no encontrada' });
  res.json(licencia);
}));

router.delete('/licencias/:id', idValido, a(async (req, res) => {
  const r = await Licencia.findByIdAndDelete(req.params.id);
  if (!r) return res.status(404).json({ error: 'Licencia no encontrada' });
  res.json({ ok: true });
}));

// ---- Sistemas ----
const CAMPOS_SISTEMA = ['nombre', 'descripcion', 'url', 'activo'];

router.get('/sistemas', a(async (req, res) => {
  const sistemas = await Sistema.find().sort('nombre').lean();
  const conteos = await Licencia.aggregate([{ $group: { _id: '$sistema', total: { $sum: 1 } } }]);
  const mapa = new Map(conteos.map((c) => [String(c._id), c.total]));
  res.json(sistemas.map((s) => ({ ...s, licencias: mapa.get(String(s._id)) || 0 })));
}));

router.post('/sistemas', a(async (req, res) => {
  res.status(201).json(await Sistema.create(tomar(req.body, CAMPOS_SISTEMA)));
}));

router.put('/sistemas/:id', idValido, a(async (req, res) => {
  const s = await Sistema.findByIdAndUpdate(req.params.id, tomar(req.body, CAMPOS_SISTEMA), { new: true, runValidators: true });
  if (!s) return res.status(404).json({ error: 'Sistema no encontrado' });
  res.json(s);
}));

router.delete('/sistemas/:id', idValido, a(async (req, res) => {
  const enUso = await Licencia.countDocuments({ sistema: req.params.id });
  if (enUso) return res.status(409).json({ error: `No se puede eliminar: tiene ${enUso} licencia(s). Desactívalo en su lugar.` });
  const r = await Sistema.findByIdAndDelete(req.params.id);
  if (!r) return res.status(404).json({ error: 'Sistema no encontrado' });
  res.json({ ok: true });
}));

// ---- Solicitudes de planes ----
router.get('/solicitudes', a(async (req, res) => {
  const filtro = req.query.estado === 'pendiente' ? pendientes : req.query.estado ? { estado: req.query.estado } : {};
  const lista = await Solicitud.find(filtro).sort('-createdAt').limit(500).lean();
  const correos = await Usuario.find({ email: { $in: lista.map((s) => s.email) } }, 'email').lean();
  const conCuenta = new Map(correos.map((u) => [u.email, String(u._id)]));
  res.json(lista.map((s) => ({ ...s, estado: s.estado || 'pendiente', usuarioId: conCuenta.get(s.email) || null })));
}));

router.put('/solicitudes/:id', idValido, a(async (req, res) => {
  const s = await Solicitud.findByIdAndUpdate(req.params.id, tomar(req.body, ['estado']), { new: true, runValidators: true });
  if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
  res.json(s);
}));

router.delete('/solicitudes/:id', idValido, a(async (req, res) => {
  const r = await Solicitud.findByIdAndDelete(req.params.id);
  if (!r) return res.status(404).json({ error: 'Solicitud no encontrada' });
  res.json({ ok: true });
}));

// ---- Mensajes de contacto ----
router.get('/mensajes', a(async (req, res) => {
  res.json(await Contacto.find().sort('-createdAt').limit(500));
}));

router.put('/mensajes/:id', idValido, a(async (req, res) => {
  const m = await Contacto.findByIdAndUpdate(req.params.id, { leido: !!req.body.leido }, { new: true });
  if (!m) return res.status(404).json({ error: 'Mensaje no encontrado' });
  res.json(m);
}));

router.delete('/mensajes/:id', idValido, a(async (req, res) => {
  const r = await Contacto.findByIdAndDelete(req.params.id);
  if (!r) return res.status(404).json({ error: 'Mensaje no encontrado' });
  res.json({ ok: true });
}));

// ---- Errores ----
router.use((err, req, res, next) => {
  if (err.code === 11000) {
    const campo = Object.keys(err.keyPattern || {})[0];
    return res.status(409).json({ error: campo === 'email' ? 'Ya existe un usuario con ese correo' : 'Registro duplicado' });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message).join('. ') });
  }
  if (err.name === 'CastError') return res.status(400).json({ error: `Valor no válido en "${err.path}"` });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = router;
