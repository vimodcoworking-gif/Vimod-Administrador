const mongoose = require('mongoose');

// Sistema propio de una empresa cliente (copia de VIMOD CONTROL en el servidor).
// Lo crea el agente del servidor (vimod-empresas\herramientas\agente.php) a pedido del Panel.
const EmpresaSchema = new mongoose.Schema(
  {
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', index: true, default: null }, // cliente dueño
    licencia: { type: mongoose.Schema.Types.ObjectId, ref: 'Licencia', default: null }, // licencia vinculada
    nombre: { type: String, required: true, trim: true, maxlength: 150 },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true, match: /^[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$/ },
    plan: { type: String, trim: true, maxlength: 40, default: 'mensual' },
    adminUsuario: { type: String, trim: true, lowercase: true, default: 'admin' },
    adminNombre: { type: String, trim: true, maxlength: 120 },
    adminEmail: { type: String, trim: true, lowercase: true, maxlength: 160 },
    // pendiente = esperando al servidor; lista = creada; error = el servidor no pudo crearla
    estado: { type: String, enum: ['pendiente', 'lista', 'error'], default: 'pendiente' },
    error: { type: String, maxlength: 500 },
    url: { type: String, trim: true, maxlength: 400 },
    baseDatos: { type: String, trim: true, maxlength: 80 },
    adminClave: { type: String, select: false }, // contraseña inicial, cifrada (lib/cifrado.js)
    claveVista: { type: Date, default: null }, // cuándo la vio el cliente
    vence: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }, // pedido / último conocido (AAAA-MM-DD)
    // Estado real informado por el servidor (inventario del agente)
    licenciaServidor: {
      estado: String,
      vence: String,
      plan: String,
      dias: Number,
      vigente: Boolean
    },
    sincronizada: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Empresa', EmpresaSchema);
