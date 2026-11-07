// Contenido editable de la página: valores por defecto, carga inicial y lectura.
// Este archivo es idéntico en VIMOD PRESENTACION y en el Panel administrador.
const mongoose = require('mongoose');
const Sistema = require('../models/Sistema');
const Contenido = require('../models/Contenido');
const Imagen = require('../models/Imagen');

const unsplash = (id, w) => `https://images.unsplash.com/photo-${id}?w=${w}&q=75`;

// Textos originales de la página. Se usan mientras no se editen desde el panel.
const CONTENIDO_DEFECTO = {
  nosotros: {
    etiqueta: 'Nosotros',
    titulo: 'Diseñamos espacios *y soluciones* que transforman',
    parrafos: [
      'En VIMOD unimos la arquitectura, el diseño y la tecnología. Creamos espacios funcionales y estéticos, y desarrollamos software que ayuda a las empresas a gestionar sus procesos con claridad y control.',
      'Nuestro equipo combina experiencia en obra, diseño de interiores y desarrollo de sistemas para ofrecer resultados medibles en cada proyecto.'
    ],
    imagen: unsplash('1497366216548-37526070297c', 1000),
    cifras: [
      { valor: 120, texto: 'Proyectos' },
      { valor: 10, texto: 'Años' },
      { valor: 85, texto: 'Clientes' }
    ]
  },
  proyectos: {
    etiqueta: 'Portafolio',
    titulo: 'Nuestros *proyectos*',
    texto: 'Una selección de obras residenciales, corporativas y comerciales.',
    items: [
      { titulo: 'Casa Horizonte', categoria: 'Residencial', imagen: unsplash('1600585154340-be6161a56a0c', 1400) },
      { titulo: 'Torre Norte', categoria: 'Corporativo', imagen: unsplash('1487958449943-2429e8be8625', 800) },
      { titulo: 'Loft Central', categoria: 'Interiorismo', imagen: unsplash('1600607687939-ce8a6c25118c', 800) },
      { titulo: 'Plan Maestro Sur', categoria: 'Diseño', imagen: unsplash('1503387762-592deb58ef4e', 800) },
      { titulo: 'Oficinas Prisma', categoria: 'Comercial', imagen: unsplash('1497366811353-6870744d04b2', 800) }
    ]
  },
  softwares: {
    etiqueta: 'Nuestros softwares'
  },
  contacto: {
    etiqueta: 'Contacto',
    titulo: 'Hablemos de tu *próximo proyecto*',
    texto: 'Cuéntanos qué necesitas y te responderemos a la brevedad.',
    correo: 'vimodcoworking@gmail.com',
    telefono: '',
    direccion: '',
    horario: 'Lunes a viernes · 9:00 – 18:00'
  }
};

// Software original con sus 3 planes.
const SOFTWARE_DEFECTO = {
  nombre: 'VIMOD Gestión',
  etiqueta: 'Ideal para gestión empresarial',
  titulo: 'Tecnología para *gestionar tu empresa*',
  descripcion: 'VIMOD Gestión es un software ideal para la gestión empresarial: centraliza ventas, inventario, finanzas, clientes y proyectos en una sola plataforma en la nube.',
  resumen: 'Organiza tu negocio, toma decisiones con datos y crece sin perder el control. Haz clic para conocer nuestros planes.',
  caracteristicas: [
    'Facturación, inventario y compras',
    'Control financiero y contable',
    'Seguimiento de proyectos y obras',
    'Reportes y dashboards en tiempo real'
  ],
  imagen: unsplash('1551288049-bebda4e38f71', 1200),
  textoPlanes: 'Elige el plan que mejor se adapta a tu empresa. Todos incluyen acceso en la nube, actualizaciones y respaldo de tu información.',
  planes: [
    {
      codigo: 'estandar', nombre: 'Estándar', precio: 29, periodo: 'mes', maxUsuarios: 3, destacado: false,
      descripcion: 'Para pequeños negocios que empiezan a ordenar su gestión.',
      caracteristicas: ['Hasta 3 usuarios', 'Facturación e inventario', 'Gestión de clientes (CRM básico)', 'Reportes mensuales', 'Soporte por correo']
    },
    {
      codigo: 'premium', nombre: 'Premium', precio: 79, periodo: 'mes', maxUsuarios: 15, destacado: true,
      descripcion: 'Para empresas en crecimiento que necesitan control total.',
      caracteristicas: ['Hasta 15 usuarios', 'Todo lo del plan Estándar', 'Contabilidad y finanzas', 'Gestión de proyectos y obras', 'Dashboards en tiempo real', 'Soporte prioritario por chat']
    },
    {
      codigo: 'enterprise', nombre: 'Enterprise', precio: null, periodo: null, maxUsuarios: null, destacado: false,
      descripcion: 'Para corporaciones con procesos y volúmenes a medida.',
      caracteristicas: ['Usuarios ilimitados', 'Todo lo del plan Premium', 'Multi-sucursal y multi-empresa', 'Integraciones y API dedicada', 'Servidor y respaldo dedicados', 'Gerente de cuenta 24/7']
    }
  ]
};

// Crea o completa "VIMOD Gestión" la primera vez (no pisa lo que ya se haya editado).
async function sembrar() {
  if ((await Sistema.countDocuments()) === 0) {
    await Sistema.updateOne({ nombre: SOFTWARE_DEFECTO.nombre }, { $setOnInsert: SOFTWARE_DEFECTO }, { upsert: true });
    return;
  }
  const s = await Sistema.findOne({ nombre: SOFTWARE_DEFECTO.nombre });
  if (s && !s.planes.length && !s.titulo) {
    const { nombre, descripcion, ...resto } = SOFTWARE_DEFECTO;
    s.set(resto);
    if (!s.descripcion) s.descripcion = descripcion;
    await s.save();
  }
}

// Une lo guardado con los valores por defecto, sección por sección.
async function obtenerContenido() {
  const doc = await Contenido.findById('sitio').lean();
  const guardado = (doc && doc.datos) || {};
  const res = {};
  for (const [seccion, valores] of Object.entries(CONTENIDO_DEFECTO)) {
    res[seccion] = { ...valores, ...(guardado[seccion] || {}) };
  }
  return res;
}

const CAMPOS_PUBLICOS = 'nombre etiqueta titulo descripcion resumen caracteristicas imagen textoPlanes planes orden';
async function softwaresPublicados() {
  return Sistema.find({ publicado: { $ne: false } }, CAMPOS_PUBLICOS).sort({ orden: 1, createdAt: 1 }).lean();
}

// GET /imagenes/:id
async function servirImagen(req, res) {
  if (!mongoose.isValidObjectId(req.params.id) || mongoose.connection.readyState !== 1) return res.status(404).end();
  const img = await Imagen.findById(req.params.id).lean();
  if (!img) return res.status(404).end();
  res.set('Content-Type', img.tipo);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(img.datos.buffer ? Buffer.from(img.datos.buffer) : img.datos);
}

module.exports = { CONTENIDO_DEFECTO, SOFTWARE_DEFECTO, sembrar, obtenerContenido, softwaresPublicados, servirImagen };
