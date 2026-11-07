const mongoose = require('mongoose');

const SolicitudSchema = new mongoose.Schema(
  {
    plan: { type: String, required: true, enum: ['estandar', 'premium', 'enterprise'] },
    nombre: { type: String, required: true, trim: true, maxlength: 120 },
    empresa: { type: String, trim: true, maxlength: 160 },
    email: { type: String, required: true, trim: true, lowercase: true, match: /.+@.+\..+/ },
    telefono: { type: String, trim: true, maxlength: 40 },
    estado: { type: String, enum: ['pendiente', 'contactado', 'atendida', 'descartada'], default: 'pendiente' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Solicitud', SolicitudSchema);
