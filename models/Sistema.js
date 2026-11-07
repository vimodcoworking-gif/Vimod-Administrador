const mongoose = require('mongoose');

// Catálogo de sistemas/softwares que VIMOD licencia (ej. VIMOD Gestión).
const SistemaSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 120 },
    descripcion: { type: String, trim: true, maxlength: 600 },
    url: { type: String, trim: true, maxlength: 300 },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Sistema', SistemaSchema);
