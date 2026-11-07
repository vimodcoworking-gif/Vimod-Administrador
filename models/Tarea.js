const mongoose = require('mongoose');

// Pedido para el agente del servidor (crear empresa, cambiar licencia, actualizar).
// Contrato: vimod-empresas\LEEME.md → "Conexión con el Panel administrador".
const TareaSchema = new mongoose.Schema(
  {
    tipo: { type: String, required: true, enum: ['crear', 'licencia', 'actualizar'] },
    datos: { type: mongoose.Schema.Types.Mixed, default: {} },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', index: true },
    // pendiente → enviada (el agente la recibió) → hecha | error
    estado: { type: String, enum: ['pendiente', 'enviada', 'hecha', 'error'], default: 'pendiente', index: true },
    entregas: { type: Number, default: 0 },
    resultado: { type: mongoose.Schema.Types.Mixed, default: null }, // sin contraseñas
    error: { type: String, maxlength: 1000 },
    terminada: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tarea', TareaSchema);
