const mongoose = require('mongoose');

// Plan de precios de un software.
const PlanSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, trim: true, maxlength: 60 }, // identificador estable (ej. "premium")
    nombre: { type: String, required: true, trim: true, maxlength: 60 },
    precio: { type: Number, min: 0, default: null }, // null = "A medida"
    periodo: { type: String, trim: true, maxlength: 30, default: 'mes' },
    descripcion: { type: String, trim: true, maxlength: 300 },
    destacado: { type: Boolean, default: false },
    caracteristicas: [{ type: String, trim: true, maxlength: 160 }],
    maxUsuarios: { type: Number, min: 1, default: null } // sugerido al asignar una licencia
  },
  { _id: false }
);

// Software que VIMOD vende: se muestra en la web ("Nuestros softwares" y planes)
// y se asigna a los clientes mediante licencias.
const SistemaSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 120 },
    etiqueta: { type: String, trim: true, maxlength: 80 }, // chip, ej. "Ideal para gestión empresarial"
    titulo: { type: String, trim: true, maxlength: 160 }, // titular en la web; *texto* = negrita
    descripcion: { type: String, trim: true, maxlength: 1000 },
    resumen: { type: String, trim: true, maxlength: 400 }, // texto de la tarjeta con imagen
    caracteristicas: [{ type: String, trim: true, maxlength: 160 }],
    imagen: { type: String, trim: true, maxlength: 500 },
    url: { type: String, trim: true, maxlength: 300 }, // enlace de acceso al sistema para clientes
    textoPlanes: { type: String, trim: true, maxlength: 400 },
    planes: [PlanSchema],
    activo: { type: Boolean, default: true }, // se pueden asignar licencias
    publicado: { type: Boolean, default: true }, // se muestra en la página
    orden: { type: Number, default: 0 }
  },
  { timestamps: true }
);

// Nombre visible de un plan (acepta solicitudes/licencias antiguas sin software).
SistemaSchema.statics.nombrePlan = function (sistema, codigo) {
  const plan = sistema && (sistema.planes || []).find((p) => p.codigo === codigo);
  if (plan) return plan.nombre;
  return codigo ? codigo.charAt(0).toUpperCase() + codigo.slice(1) : '—';
};

module.exports = mongoose.model('Sistema', SistemaSchema);
