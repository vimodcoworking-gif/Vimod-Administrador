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
const Empresa = require('../models/Empresa');
const Tarea = require('../models/Tarea');
const cifrado = require('../lib/cifrado');
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
  const empresas = await Empresa.find({ usuario: usuario._id }).select('+adminClave').sort('-createdAt').lean();
  res.json({ usuario, licencias: licencias.map(conNombres), solicitudes: solicitudes.map(conNombres), empresas: empresas.map(empresaPublica) });
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
  // Su sistema de empresa sigue en el servidor: queda sin cliente para volver a vincularlo.
  await Empresa.updateMany({ usuario: usuario._id }, { usuario: null, licencia: null });
  res.json({ ok: true });
}));

// ---- Licencias ----
function datosLicencia(body) {
  const d = tomar(body, ['usuario', 'sistema', 'plan', 'estado', 'fechaInicio', 'fechaVencimiento', 'maxUsuarios', 'precio', 'periodo', 'notas']);
  if ('precio' in d) d.precio = numONull(d.precio);
  if ('periodo' in d) d.periodo = txt(d.periodo, 30) || null;
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
  const antes = { vence: aDia(actual.fechaVencimiento), estado: actual.estado };
  actual.set(d);
  const guardada = await actual.save();
  // Si la licencia está vinculada al sistema de una empresa, el servidor recibe el cambio.
  const despues = { vence: aDia(guardada.fechaVencimiento), estado: guardada.estado };
  if (antes.vence !== despues.vence || antes.estado !== despues.estado) {
    for (const e of await Empresa.find({ licencia: guardada._id, estado: 'lista' })) {
      await pedirLicencia(e, { estado: despues.estado === 'activa' ? 'activa' : 'suspendida', vence: despues.vence || undefined });
    }
  }
  res.json(guardada);
}));

router.delete('/licencias/:id', idValido, a(async (req, res) => {
  const r = await Licencia.findByIdAndDelete(req.params.id);
  if (!r) return res.status(404).json({ error: 'Licencia no encontrada' });
  res.json({ ok: true });
}));

// ---- Sistemas de empresa (servidor de VIMOD CONTROL) ----
const SLUG_EMPRESA = /^[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$/;
const aDia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const planServidor = (periodo) => ({ 'año': 'anual', mes: 'mensual' }[periodo] || txt(periodo, 40) || 'mensual');

function empresaPublica(e) {
  const o = e.toObject ? e.toObject() : { ...e };
  const tieneClave = !!o.adminClave;
  delete o.adminClave;
  return { ...o, tieneClave };
}

// GB de almacenamiento recibidos (0 = ilimitado); undefined si no vino o no es válido.
function gbValidos(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1000000 ? Math.round(n * 100) / 100 : undefined;
}

async function pedirLicencia(empresa, datos) {
  const d = { slug: empresa.slug };
  if (datos.estado) d.estado = datos.estado === 'activa' ? 'activa' : 'suspendida';
  if (datos.vence) d.vence = datos.vence;
  if (datos.plan) d.plan = datos.plan;
  if (datos.almacenamientoGb !== undefined) d.almacenamiento_gb = datos.almacenamientoGb;
  const local = {};
  if (d.vence) local.vence = d.vence;
  if (d.almacenamiento_gb !== undefined) local.almacenamientoGb = d.almacenamiento_gb;
  if (Object.keys(local).length) await Empresa.updateOne({ _id: empresa._id }, local);
  return Tarea.create({ tipo: 'licencia', datos: d, empresa: empresa._id });
}

// Enlace firmado de un solo uso para entrar al sistema de la empresa como
// superadministrador VIMOD (lo verifica api/vimod_super.php de la empresa).
// La clave sale de AGENTE_TOKEN, igual que ve_clave_sso() en el servidor.
function enlaceSuper(empresa) {
  const token = process.env.AGENTE_TOKEN || '';
  const clave = crypto.createHmac('sha256', token).update('sso:' + empresa.slug).digest('hex');
  const datos = Buffer.from(JSON.stringify({
    e: empresa.slug,
    u: empresa.adminUsuario || 'admin',
    exp: Math.floor(Date.now() / 1000) + 90,
    n: crypto.randomBytes(18).toString('base64url')
  })).toString('base64url');
  const firma = crypto.createHmac('sha256', clave).update(datos).digest('hex');
  const base = empresa.url.endsWith('/') ? empresa.url : empresa.url + '/';
  return `${base}api/vimod_super.php?t=${datos}.${firma}`;
}

// (No usar /servidor: ese prefijo es del agente, routes/servidor.js)
router.get('/estado-servidor', a(async (req, res) => {
  const [agente, empresas, tareas] = await Promise.all([
    Contenido.findById('agente').lean(),
    Empresa.find().select('+adminClave').populate('usuario', 'nombre email').sort('-createdAt').lean(),
    Tarea.find().populate('empresa', 'nombre slug').sort('-createdAt').limit(30).lean()
  ]);
  res.json({
    agente: agente ? agente.datos : null,
    agenteConfigurado: (process.env.AGENTE_TOKEN || '').length >= 48,
    cifradoConfigurado: cifrado.disponible(),
    empresas: empresas.map(empresaPublica),
    tareas
  });
}));

router.post('/empresas', a(async (req, res) => {
  const b = req.body || {};
  const slug = txt(b.slug, 24).toLowerCase();
  if (!SLUG_EMPRESA.test(slug)) return res.status(400).json({ error: 'El código solo puede tener minúsculas, números y guiones (máx. 24), por ejemplo "coworking".' });
  if (await Empresa.exists({ slug })) return res.status(409).json({ error: `Ya existe una empresa con el código "${slug}".` });
  const nombre = txt(b.nombre, 150);
  if (!nombre) return res.status(400).json({ error: 'Escribe el nombre de la empresa' });
  const vence = /^\d{4}-\d{2}-\d{2}$/.test(b.vence || '') ? b.vence : null;
  if (!vence) return res.status(400).json({ error: 'Elige la fecha de vencimiento' });
  const adminUsuario = txt(b.adminUsuario, 40).toLowerCase() || 'admin';
  if (!/^[a-z0-9._-]{3,40}$/.test(adminUsuario)) return res.status(400).json({ error: 'El usuario administrador solo puede tener letras, números, punto, guion y guion bajo (3 a 40).' });
  const adminEmail = txt(b.adminEmail, 160).toLowerCase();
  if (adminEmail && !/.+@.+\..+/.test(adminEmail)) return res.status(400).json({ error: 'El correo del administrador no es válido' });

  const usuario = mongoose.isValidObjectId(b.usuario) ? await Usuario.findById(b.usuario) : null;
  if (b.usuario && !usuario) return res.status(400).json({ error: 'Cliente no válido' });
  const licencia = mongoose.isValidObjectId(b.licencia) ? await Licencia.findById(b.licencia) : null;
  if (licencia && usuario && String(licencia.usuario) !== String(usuario._id)) return res.status(400).json({ error: 'La licencia es de otro cliente' });

  const almacenamientoGb = gbValidos(b.almacenamientoGb) ?? 0;
  const empresa = await Empresa.create({
    usuario: usuario ? usuario._id : null,
    licencia: licencia ? licencia._id : null,
    nombre, slug, vence,
    plan: txt(b.plan, 40) || 'mensual',
    adminUsuario,
    adminNombre: txt(b.adminNombre, 120) || 'Administrador',
    adminEmail,
    almacenamientoGb
  });
  await Tarea.create({
    tipo: 'crear',
    empresa: empresa._id,
    datos: {
      nombre, slug, vence, plan: empresa.plan,
      admin_usuario: adminUsuario, admin_nombre: empresa.adminNombre, admin_email: adminEmail,
      almacenamiento_gb: almacenamientoGb
    }
  });
  res.status(201).json(empresaPublica(empresa));
}));

// Vincular a un cliente y/o a una licencia
router.put('/empresas/:id', idValido, a(async (req, res) => {
  const e = await Empresa.findById(req.params.id);
  if (!e) return res.status(404).json({ error: 'Empresa no encontrada' });
  if ('usuario' in req.body) {
    const u = req.body.usuario ? await Usuario.findById(req.body.usuario) : null;
    if (req.body.usuario && !u) return res.status(400).json({ error: 'Cliente no válido' });
    e.usuario = u ? u._id : null;
    if (!u) e.licencia = null;
  }
  if ('licencia' in req.body) {
    const l = req.body.licencia ? await Licencia.findById(req.body.licencia) : null;
    if (req.body.licencia && (!l || String(l.usuario) !== String(e.usuario))) return res.status(400).json({ error: 'La licencia no es de este cliente' });
    e.licencia = l ? l._id : null;
  }
  if (req.body.nombre !== undefined) e.nombre = txt(req.body.nombre, 150) || e.nombre;
  res.json(empresaPublica(await e.save()));
}));

// Renovar / suspender / reactivar
router.post('/empresas/:id/licencia', idValido, a(async (req, res) => {
  const e = await Empresa.findById(req.params.id);
  if (!e) return res.status(404).json({ error: 'Empresa no encontrada' });
  if (e.estado !== 'lista') return res.status(409).json({ error: 'El sistema de esta empresa todavía no está creado en el servidor' });
  const vence = /^\d{4}-\d{2}-\d{2}$/.test(req.body.vence || '') ? req.body.vence : undefined;
  const estado = ['activa', 'suspendida'].includes(req.body.estado) ? req.body.estado : undefined;
  const almacenamientoGb = gbValidos(req.body.almacenamientoGb);
  if (req.body.almacenamientoGb !== undefined && almacenamientoGb === undefined) {
    return res.status(400).json({ error: 'Almacenamiento inválido: indica los GB (0 = ilimitado)' });
  }
  if (!vence && !estado && almacenamientoGb === undefined) return res.status(400).json({ error: 'Indica la nueva fecha, el estado o el almacenamiento' });
  const tarea = await pedirLicencia(e, { vence, estado, almacenamientoGb, plan: txt(req.body.plan, 40) || undefined });
  // La licencia vinculada del cliente queda igual que el sistema.
  if (e.licencia) {
    const cambios = {};
    if (vence) cambios.fechaVencimiento = new Date(`${vence}T23:59:59.999Z`);
    if (estado) cambios.estado = estado === 'activa' ? 'activa' : 'suspendida';
    if (Object.keys(cambios).length) await Licencia.updateOne({ _id: e.licencia }, cambios);
  }
  res.status(201).json(tarea);
}));

// Entrar al sistema de la empresa como superadministrador VIMOD
router.post('/empresas/:id/acceso-super', idValido, a(async (req, res) => {
  const e = await Empresa.findById(req.params.id);
  if (!e || e.estado !== 'lista' || !/^https?:\/\//i.test(e.url || '')) {
    return res.status(409).json({ error: 'El sistema de esta empresa todavía no está creado' });
  }
  if ((process.env.AGENTE_TOKEN || '').length < 48) return res.status(503).json({ error: 'Falta AGENTE_TOKEN en el Panel' });
  if (!e.accesoSuper) {
    // Diagnóstico: ¿el agente del servidor se conecta? ¿ya respondió sin habilitar el acceso?
    const agente = await Contenido.findById('agente').lean();
    const contacto = agente && agente.datos && agente.datos.ultimoContacto ? new Date(agente.datos.ultimoContacto) : null;
    if (!contacto || Date.now() - contacto > 10 * 60e3) {
      const cuando = contacto ? `desde el ${contacto.toLocaleString('es-PE', { timeZone: 'America/Lima' })}` : 'nunca';
      return res.status(409).json({
        error: `El agente del servidor no se conecta con el Panel (${cuando}). En el servidor de las empresas, revisa servidor.php → panel.url y panel.token (igual a AGENTE_TOKEN) y que la tarea programada del agente esté activa.`
      });
    }
    const ultima = await Tarea.findOne({ empresa: e._id, tipo: 'licencia' }).sort('-createdAt').lean();
    if (ultima && ultima.estado === 'hecha') {
      // Se pide de nuevo, por si ya se corrigió el servidor: el próximo intento usa la respuesta nueva.
      await Tarea.create({ tipo: 'licencia', datos: { slug: e.slug }, empresa: e._id });
      const lic = (ultima.resultado && ultima.resultado.licencia) || {};
      if (!('acceso_super' in lic)) {
        return res.status(409).json({
          error: 'Las herramientas del servidor están desactualizadas y no habilitan este acceso. Copia la versión nueva de vimod-empresas\\herramientas (lib.php y agente.php) al servidor, pulsa "Actualizar" en esta empresa y vuelve a intentarlo.'
        });
      }
      if (lic.acceso_super === false) {
        return res.status(409).json({
          error: 'El servidor no tiene un token válido para el acceso: en servidor.php, panel.token debe ser igual a AGENTE_TOKEN del Panel (48 caracteres o más).'
        });
      }
    }
    if (ultima && ultima.estado === 'error') {
      // El último intento falló: se muestra el motivo y se reintenta.
      await Tarea.create({ tipo: 'licencia', datos: { slug: e.slug }, empresa: e._id });
      return res.status(409).json({ error: `El servidor no pudo habilitar el acceso: ${ultima.error || 'error desconocido'}. Se volvió a intentar; prueba en 1 o 2 minutos.` });
    }
    // Sistemas creados antes de esta función: el servidor reescribe su licencia con la clave de acceso.
    const pendiente = await Tarea.exists({ empresa: e._id, tipo: 'licencia', estado: { $in: ['pendiente', 'enviada'] } });
    if (!pendiente) await Tarea.create({ tipo: 'licencia', datos: { slug: e.slug }, empresa: e._id });
    return res.status(409).json({ error: 'Estamos habilitando el acceso de superadministrador en el servidor. Vuelve a intentarlo en 1 o 2 minutos.' });
  }
  res.json({ url: enlaceSuper(e) });
}));

router.post('/empresas/:id/actualizar', idValido, a(async (req, res) => {
  const e = await Empresa.findById(req.params.id);
  if (!e || e.estado !== 'lista') return res.status(409).json({ error: 'El sistema de esta empresa todavía no está creado' });
  res.status(201).json(await Tarea.create({ tipo: 'actualizar', datos: { slug: e.slug }, empresa: e._id }));
}));

// Volver a intentar la creación (si el servidor dio error)
router.post('/empresas/:id/reintentar', idValido, a(async (req, res) => {
  const e = await Empresa.findById(req.params.id);
  if (!e || e.estado !== 'error') return res.status(409).json({ error: 'Solo se puede reintentar una empresa con error' });
  e.set({ estado: 'pendiente', error: undefined });
  await e.save();
  await Tarea.create({
    tipo: 'crear', empresa: e._id,
    datos: { nombre: e.nombre, slug: e.slug, vence: e.vence, plan: e.plan, admin_usuario: e.adminUsuario, admin_nombre: e.adminNombre, admin_email: e.adminEmail || '' }
  });
  res.json(empresaPublica(e));
}));

router.get('/empresas/:id/clave', idValido, a(async (req, res) => {
  const e = await Empresa.findById(req.params.id).select('+adminClave');
  if (!e || !e.adminClave) return res.status(404).json({ error: 'No hay contraseña guardada para esta empresa' });
  const clave = cifrado.descifrar(e.adminClave);
  if (!clave) return res.status(500).json({ error: 'No se pudo descifrar (revisa CIFRADO_SECRETO)' });
  res.json({ usuario: e.adminUsuario, clave, url: e.url });
}));

// Borra la contraseña guardada (cuando el cliente ya la cambió)
router.delete('/empresas/:id/clave', idValido, a(async (req, res) => {
  await Empresa.updateOne({ _id: req.params.id }, { $unset: { adminClave: 1 } });
  res.json({ ok: true });
}));

// Eliminar del servidor el sistema de una empresa (carpeta, base de datos y usuario de MySQL).
// El agente guarda sus archivos en vimod-empresas\eliminadas\ y, al terminar, se borra del Panel.
router.post('/empresas/:id/eliminar', idValido, a(async (req, res) => {
  const e = await Empresa.findById(req.params.id);
  if (!e) return res.status(404).json({ error: 'Empresa no encontrada' });
  if (e.estado === 'eliminando') return res.status(409).json({ error: 'Esta empresa ya se está eliminando.' });
  if (e.estado !== 'lista') return res.status(409).json({ error: 'Esta empresa no está creada en el servidor: usa "Quitar".' });
  if (txt(req.body.confirmar, 30).toLowerCase() !== e.slug) {
    return res.status(400).json({ error: `Para confirmar, escribe el código "${e.slug}".` });
  }
  // Lo que estaba por hacerse en esta empresa ya no sirve.
  await Tarea.deleteMany({ empresa: e._id, estado: 'pendiente' });
  if (req.body.borrarLicencia && e.licencia) {
    await Licencia.deleteOne({ _id: e.licencia });
    e.licencia = null;
  }
  e.set({ estado: 'eliminando', error: undefined });
  await e.save();
  res.status(201).json(await Tarea.create({ tipo: 'eliminar', datos: { slug: e.slug }, empresa: e._id }));
}));

// Quitar del Panel una empresa que no llegó a crearse (no toca el servidor)
router.delete('/empresas/:id', idValido, a(async (req, res) => {
  const e = await Empresa.findById(req.params.id);
  if (!e) return res.status(404).json({ error: 'Empresa no encontrada' });
  if (e.estado === 'lista' || e.estado === 'eliminando') return res.status(409).json({ error: 'Esta empresa existe en el servidor: usa "Eliminar".' });
  if (await Tarea.exists({ empresa: e._id, tipo: 'crear', estado: 'enviada' })) {
    return res.status(409).json({ error: 'El servidor está creando esta empresa ahora. Espera a que termine.' });
  }
  await Tarea.deleteMany({ empresa: e._id, estado: 'pendiente' });
  await e.deleteOne();
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
  if (body.enServidor !== undefined) d.enServidor = !!body.enServidor;
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
        .map((i) => ({
          titulo: txt(i.titulo, 120),
          categoria: txt(i.categoria, 60),
          imagen: urlImagen(i.imagen),
          descripcion: txt(i.descripcion, 3000),
          enlace: /^https?:\/\/\S+$/i.test(txt(i.enlace, 300)) ? txt(i.enlace, 300) : '',
          imagenes: arr(i.imagenes).map(urlImagen).filter(Boolean).slice(0, 12)
        }))
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
