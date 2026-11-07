// API del Panel administrador.
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');
const Licencia = require('../models/Licencia');
const Sistema = require('../models/Sistema');
const Solicitud = require('../models/Solicitud');
const Contacto = require('../models/Contacto');
const Contenido = require('../models/Contenido');
const Imagen = require('../models/Imagen');
const sitio = require('../lib/sitio');
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

// Textos y listas recibidos desde los formularios
const txt = (v, max = 600) => String(v ?? '').trim().slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
const lineas = (v, max = 160, cant = 30) => arr(v).map((x) => txt(x, max)).filter(Boolean).slice(0, cant);
const urlImagen = (v) => {
  const u = txt(v, 500);
  return /^(https?:\/\/|\/imagenes\/[a-f0-9]{24}$)/i.test(u) ? u : '';
};
const numONull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const slug = (t) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'plan';

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
  res.json({ sitioUrl: (process.env.SITIO_URL || '').replace(/\/$/, '') });
});

// Añade el nombre del software y del plan a solicitudes/licencias con "sistema" poblado.
const conNombres = (doc) => {
  const o = doc.toObject ? doc.toObject({ virtuals: true }) : doc;
  const s = o.sistema && typeof o.sistema === 'object' ? o.sistema : null;
  return {
    ...o,
    sistema: s ? { _id: s._id, nombre: s.nombre, url: s.url } : o.sistema || null,
    sistemaNombre: s ? s.nombre : '',
    planNombre: Sistema.nombrePlan(s, o.plan)
  };
};

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
        .populate('usuario', 'nombre email').populate('sistema', 'nombre planes').sort('fechaVencimiento').limit(50),
      Solicitud.find().populate('sistema', 'nombre planes').sort('-createdAt').limit(6)
    ]);
  res.json({
    usuarios, usuariosActivos, licenciasActivas, solicitudesPendientes, mensajesSinLeer,
    porVencer: porVencer.map(conNombres),
    ultimasSolicitudes: ultimasSolicitudes.map(conNombres)
  });
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
  const [licencias, solicitudes] = await Promise.all([
    Licencia.find({ usuario: usuario._id }).populate('sistema', 'nombre url planes').sort('-createdAt'),
    Solicitud.find({ email: usuario.email }).populate('sistema', 'nombre planes').sort('-createdAt').limit(20)
  ]);
  res.json({ usuario, licencias: licencias.map(conNombres), solicitudes: solicitudes.map(conNombres) });
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

// El plan debe existir en el software elegido.
async function validarSistemaYPlan(sistemaId, plan) {
  if (!mongoose.isValidObjectId(sistemaId)) return 'Elige un software';
  const s = await Sistema.findById(sistemaId, 'planes').lean();
  if (!s) return 'Elige un software';
  if (s.planes.length && !s.planes.some((p) => p.codigo === plan)) return 'Elige un plan de este software';
  if (!plan) return 'Elige un plan';
  return null;
}

router.post('/licencias', a(async (req, res) => {
  const d = datosLicencia(req.body);
  if (!mongoose.isValidObjectId(d.usuario) || !(await Usuario.exists({ _id: d.usuario }))) {
    return res.status(400).json({ error: 'Usuario no válido' });
  }
  const error = await validarSistemaYPlan(d.sistema, d.plan);
  if (error) return res.status(400).json({ error });
  res.status(201).json(await Licencia.create(d));
}));

router.put('/licencias/:id', idValido, a(async (req, res) => {
  const d = datosLicencia(req.body);
  delete d.usuario; // una licencia no cambia de dueño
  const actual = await Licencia.findById(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Licencia no encontrada' });
  if ('sistema' in d || 'plan' in d) {
    const error = await validarSistemaYPlan(d.sistema ?? actual.sistema, d.plan ?? actual.plan);
    if (error) return res.status(400).json({ error });
  }
  actual.set(d);
  res.json(await actual.save());
}));

router.delete('/licencias/:id', idValido, a(async (req, res) => {
  const r = await Licencia.findByIdAndDelete(req.params.id);
  if (!r) return res.status(404).json({ error: 'Licencia no encontrada' });
  res.json({ ok: true });
}));

// ---- Softwares y planes ----
function limpiarPlanes(planes) {
  const usados = new Set();
  return arr(planes).slice(0, 12).map((p) => {
    const base = slug(p.codigo || p.nombre);
    let codigo = base;
    for (let n = 2; usados.has(codigo); n++) codigo = `${base}-${n}`;
    usados.add(codigo);
    return {
      codigo,
      nombre: txt(p.nombre, 60),
      precio: numONull(p.precio),
      periodo: txt(p.periodo, 30) || null,
      descripcion: txt(p.descripcion, 300),
      destacado: !!p.destacado,
      caracteristicas: lineas(p.caracteristicas),
      maxUsuarios: numONull(p.maxUsuarios)
    };
  });
}

function datosSistema(body) {
  const d = {};
  for (const [campo, max] of [['nombre', 120], ['etiqueta', 80], ['titulo', 160], ['descripcion', 1000], ['resumen', 400], ['textoPlanes', 400]]) {
    if (body[campo] !== undefined) d[campo] = txt(body[campo], max);
  }
  if (body.url !== undefined) d.url = /^https?:\/\//i.test(txt(body.url)) ? txt(body.url, 300) : '';
  if (body.imagen !== undefined) d.imagen = urlImagen(body.imagen);
  if (body.caracteristicas !== undefined) d.caracteristicas = lineas(body.caracteristicas);
  if (body.planes !== undefined) d.planes = limpiarPlanes(body.planes);
  if (body.activo !== undefined) d.activo = !!body.activo;
  if (body.publicado !== undefined) d.publicado = !!body.publicado;
  if (body.orden !== undefined) d.orden = Number(body.orden) || 0;
  return d;
}

router.get('/sistemas', a(async (req, res) => {
  const sistemas = await Sistema.find().sort({ orden: 1, createdAt: 1 }).lean();
  const conteos = await Licencia.aggregate([{ $group: { _id: '$sistema', total: { $sum: 1 } } }]);
  const mapa = new Map(conteos.map((c) => [String(c._id), c.total]));
  res.json(sistemas.map((s) => ({ ...s, licencias: mapa.get(String(s._id)) || 0 })));
}));

router.get('/sistemas/:id', idValido, a(async (req, res) => {
  const s = await Sistema.findById(req.params.id).lean();
  if (!s) return res.status(404).json({ error: 'Software no encontrado' });
  const usados = await Licencia.aggregate([
    { $match: { sistema: s._id } },
    { $group: { _id: '$plan', total: { $sum: 1 } } }
  ]);
  res.json({ ...s, licenciasPorPlan: Object.fromEntries(usados.map((u) => [u._id, u.total])) });
}));

router.post('/sistemas', a(async (req, res) => {
  res.status(201).json(await Sistema.create(datosSistema(req.body)));
}));

router.put('/sistemas/:id', idValido, a(async (req, res) => {
  const s = await Sistema.findById(req.params.id);
  if (!s) return res.status(404).json({ error: 'Software no encontrado' });
  const d = datosSistema(req.body);
  if (d.planes) {
    // No permitir quitar un plan que tiene licencias asignadas.
    const nuevos = new Set(d.planes.map((p) => p.codigo));
    for (const p of s.planes.filter((x) => !nuevos.has(x.codigo))) {
      const n = await Licencia.countDocuments({ sistema: s._id, plan: p.codigo });
      if (n) return res.status(409).json({ error: `No puedes eliminar el plan "${p.nombre}": tiene ${n} licencia(s). Puedes cambiarle el nombre o el precio.` });
    }
  }
  s.set(d);
  res.json(await s.save());
}));

router.delete('/sistemas/:id', idValido, a(async (req, res) => {
  const enUso = await Licencia.countDocuments({ sistema: req.params.id });
  if (enUso) return res.status(409).json({ error: `No se puede eliminar: tiene ${enUso} licencia(s). Despublícalo en su lugar.` });
  const r = await Sistema.findByIdAndDelete(req.params.id);
  if (!r) return res.status(404).json({ error: 'Software no encontrado' });
  res.json({ ok: true });
}));

// ---- Contenido de la página ----
function limpiarContenido(d) {
  const r = {};
  if (d.nosotros) {
    const n = d.nosotros;
    r.nosotros = {
      etiqueta: txt(n.etiqueta, 80),
      titulo: txt(n.titulo, 200),
      parrafos: lineas(n.parrafos, 1500, 6),
      imagen: urlImagen(n.imagen),
      cifras: arr(n.cifras).slice(0, 6)
        .map((c) => ({ valor: Math.max(0, Math.round(Number(c.valor) || 0)), texto: txt(c.texto, 40) }))
        .filter((c) => c.texto)
    };
  }
  if (d.proyectos) {
    const p = d.proyectos;
    r.proyectos = {
      etiqueta: txt(p.etiqueta, 80),
      titulo: txt(p.titulo, 200),
      texto: txt(p.texto, 400),
      items: arr(p.items).slice(0, 40)
        .map((i) => ({ titulo: txt(i.titulo, 120), categoria: txt(i.categoria, 60), imagen: urlImagen(i.imagen) }))
        .filter((i) => i.titulo || i.imagen)
    };
  }
  if (d.softwares) r.softwares = { etiqueta: txt(d.softwares.etiqueta, 80) };
  if (d.contacto) {
    const c = d.contacto;
    r.contacto = {
      etiqueta: txt(c.etiqueta, 80),
      titulo: txt(c.titulo, 200),
      texto: txt(c.texto, 400),
      correo: txt(c.correo, 120),
      telefono: txt(c.telefono, 60),
      direccion: txt(c.direccion, 200),
      horario: txt(c.horario, 120)
    };
  }
  return r;
}

router.get('/contenido', a(async (req, res) => res.json(await sitio.obtenerContenido())));

router.put('/contenido', a(async (req, res) => {
  const limpio = limpiarContenido(req.body || {});
  const set = Object.fromEntries(Object.entries(limpio).map(([k, v]) => [`datos.${k}`, v]));
  if (Object.keys(set).length) await Contenido.updateOne({ _id: 'sitio' }, { $set: set }, { upsert: true });
  res.json(await sitio.obtenerContenido());
}));

// ---- Imágenes ----
router.post('/imagenes', a(async (req, res) => {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.datos || ''));
  if (!m) return res.status(400).json({ error: 'Formato de imagen no válido (usa JPG, PNG o WEBP)' });
  const datos = Buffer.from(m[2], 'base64');
  if (datos.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'La imagen es demasiado grande (máx. 4 MB)' });
  const img = await Imagen.create({ datos, tipo: m[1], nombre: txt(req.body.nombre, 200) });
  res.status(201).json({ url: `/imagenes/${img.id}` });
}));

// ---- Solicitudes de planes ----
router.get('/solicitudes', a(async (req, res) => {
  const filtro = req.query.estado === 'pendiente' ? pendientes : req.query.estado ? { estado: req.query.estado } : {};
  const lista = await Solicitud.find(filtro).populate('sistema', 'nombre planes').sort('-createdAt').limit(500);
  const correos = await Usuario.find({ email: { $in: lista.map((s) => s.email) } }, 'email').lean();
  const conCuenta = new Map(correos.map((u) => [u.email, String(u._id)]));
  res.json(lista.map((s) => ({ ...conNombres(s), estado: s.estado || 'pendiente', usuarioId: conCuenta.get(s.email) || null })));
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
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El contenido es demasiado grande' });
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
