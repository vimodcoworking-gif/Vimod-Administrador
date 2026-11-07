const crypto = require('crypto');
const mongoose = require('mongoose');

const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generarClave() {
  const b = crypto.randomBytes(12);
  const grupos = [0, 4, 8].map((i) => Array.from(b.subarray(i, i + 4), (x) => LETRAS[x % LETRAS.length]).join(''));
  return 'VMD-' + grupos.join('-');
}

// Licencia de un sistema asignada a un usuario.
const LicenciaSchema = new mongoose.Schema(
  {
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
    sistema: { type: mongoose.Schema.Types.ObjectId, ref: 'Sistema', required: true },
    plan: { type: String, required: true, trim: true, maxlength: 60 }, // código del plan dentro del software
    clave: { type: String, unique: true, default: generarClave },
    estado: { type: String, enum: ['activa', 'suspendida', 'vencida'], default: 'activa' },
    fechaInicio: { type: Date, default: Date.now },
    fechaVencimiento: { type: Date, default: null },
    maxUsuarios: { type: Number, min: 1, default: null },
    notas: { type: String, trim: true, maxlength: 1000 } // solo visible para el administrador
  },
  { timestamps: true }
);

// Estado considerando la fecha de vencimiento.
LicenciaSchema.virtual('estadoReal').get(function () {
  if (this.estado === 'activa' && this.fechaVencimiento && this.fechaVencimiento < new Date()) return 'vencida';
  return this.estado;
});

module.exports = mongoose.model('Licencia', LicenciaSchema);
