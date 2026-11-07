// Edita aquí precios y características de los planes.
module.exports = [
  {
    id: 'estandar',
    nombre: 'Estándar',
    precio: 29,
    periodo: 'mes',
    descripcion: 'Para pequeños negocios que empiezan a ordenar su gestión.',
    destacado: false,
    caracteristicas: [
      'Hasta 3 usuarios',
      'Facturación e inventario',
      'Gestión de clientes (CRM básico)',
      'Reportes mensuales',
      'Soporte por correo'
    ]
  },
  {
    id: 'premium',
    nombre: 'Premium',
    precio: 79,
    periodo: 'mes',
    descripcion: 'Para empresas en crecimiento que necesitan control total.',
    destacado: true,
    caracteristicas: [
      'Hasta 15 usuarios',
      'Todo lo del plan Estándar',
      'Contabilidad y finanzas',
      'Gestión de proyectos y obras',
      'Dashboards en tiempo real',
      'Soporte prioritario por chat'
    ]
  },
  {
    id: 'enterprise',
    nombre: 'Enterprise',
    precio: null,
    periodo: null,
    descripcion: 'Para corporaciones con procesos y volúmenes a medida.',
    destacado: false,
    caracteristicas: [
      'Usuarios ilimitados',
      'Todo lo del plan Premium',
      'Multi-sucursal y multi-empresa',
      'Integraciones y API dedicada',
      'Servidor y respaldo dedicados',
      'Gerente de cuenta 24/7'
    ]
  }
];
