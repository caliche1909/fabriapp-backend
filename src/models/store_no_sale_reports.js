const Sequelize = require('sequelize');

module.exports = function(sequelize, DataTypes) {
  // 📌 MODELO PARA REPORTES DE NO-VENTA
  // Corresponde a la tabla: public.store_no_sale_reports
  // Almacena reportes detallados cuando no se pudo realizar una venta en una tienda
  // con información sobre la categoría, razón, comentarios y datos del cliente
  const StoreNoSaleReports = sequelize.define('store_no_sale_reports', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      allowNull: false,
      primaryKey: true,
      comment: 'Identificador único del reporte de no-venta'
    },
    visit_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'store_visits',
        key: 'id'
      },
      comment: 'Referencia opcional a la visita específica donde se generó el reporte (FK a store_visits)',
      validate: {
        // 🔍 VALIDACIÓN: Asegurar que no haya reportes duplicados por visita
        // Ejemplo de uso: Al crear un reporte desde una visita específica
        async isUniqueVisitReport(value) {
          if (value !== null && value !== undefined) {
            const existingReport = await StoreNoSaleReports.findOne({
              where: {
                visit_id: value,
                id: { [sequelize.Sequelize.Op.ne]: this.id || 0 }
              }
            });
            if (existingReport) {
              throw new Error('Ya existe un reporte de no-venta para esta visita');
            }
          }
        }
      }
    },
    store_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'stores',
        key: 'id'
      },
      comment: 'ID de la tienda donde ocurrió la no-venta (FK a stores) - REQUERIDO',
      validate: {
        notNull: {
          msg: 'El ID de la tienda es requerido'
        }
      }
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'ID del usuario que reporta la no-venta (FK a users) - REQUERIDO',
      validate: {
        notNull: {
          msg: 'El ID del usuario es requerido'
        }
      }
    },
    route_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'routes',
        key: 'id'
      },
      comment: 'Referencia opcional a la ruta en la que se encontraba el usuario (FK a routes)'
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'companies',
        key: 'id'
      },
      comment: 'ID de la compañía a la que pertenece el reporte (FK a companies) - REQUERIDO',
      validate: {
        notNull: {
          msg: 'El ID de la compañía es requerido'
        }
      }
    },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'no_sale_categories',
        key: 'id'
      },
      comment: 'ID de la categoría de no-venta (FK a no_sale_categories) - REQUERIDO',
      validate: {
        notNull: {
          msg: 'El ID de la categoría es requerido'
        }
      }
    },
    reason_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'no_sale_reasons',
        key: 'id'
      },
      comment: 'ID de la razón específica de no-venta (FK a no_sale_reasons) - REQUERIDO',
      validate: {
        notNull: {
          msg: 'El ID de la razón es requerido'
        }
      }
    },
    comments: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Comentarios detallados del usuario sobre la situación de no-venta - REQUERIDO',
      validate: {
        notNull: {
          msg: 'Los comentarios son requeridos'
        },
        notEmpty: {
          msg: 'Los comentarios no pueden estar vacíos'
        },
        len: {
          args: [1, 2000],
          msg: 'Los comentarios deben tener entre 1 y 2000 caracteres'
        }
      }
    },
    client_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Nombre del cliente contactado (opcional, máximo 255 caracteres)',
      validate: {
        len: {
          args: [0, 255],
          msg: 'El nombre del cliente no puede exceder 255 caracteres'
        }
      }
    },
    client_phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Teléfono del cliente contactado (opcional, máximo 20 caracteres)',
      validate: {
        len: {
          args: [0, 20],
          msg: 'El teléfono del cliente no puede exceder 20 caracteres'
        },
        // 🔍 VALIDACIÓN: Formato básico de teléfono
        // Ejemplo de uso: Validar formato antes de guardar
        isPhoneFormat(value) {
          if (value && value.trim() !== '') {
            const phoneRegex = /^[+]?[0-9\s\-\(\)]{7,20}$/;
            if (!phoneRegex.test(value)) {
              throw new Error('El formato del teléfono no es válido');
            }
          }
        }
      }
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      comment: 'Fecha y hora de creación del reporte (timestamp with time zone)'
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      comment: 'Fecha y hora de última actualización (actualizada automáticamente por trigger)'
    }
  }, {
    sequelize,
    tableName: 'store_no_sale_reports',
    schema: 'public',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    freezeTableName: true,
    hasTrigger: true, // ✅ Trigger set_timestamp_store_no_sale_reports actualiza updated_at
    indexes: [
      {
        name: "store_no_sale_reports_pkey",
        unique: true,
        fields: [{ name: "id" }]
      },
      {
        name: "idx_store_no_sale_reports_category",
        fields: [{ name: "category_id" }]
      },
      {
        name: "idx_store_no_sale_reports_category_company_date",
        fields: [
          { name: "category_id" },
          { name: "company_id" },
          { name: "created_at", order: "DESC" }
        ]
      },
      {
        name: "idx_store_no_sale_reports_company_date",
        fields: [
          { name: "company_id" },
          { name: "created_at", order: "DESC" }
        ]
      },
      {
        name: "idx_store_no_sale_reports_reason",
        fields: [{ name: "reason_id" }]
      },
      {
        name: "idx_store_no_sale_reports_reason_company_date",
        fields: [
          { name: "reason_id" },
          { name: "company_id" },
          { name: "created_at", order: "DESC" }
        ]
      },
      {
        name: "idx_store_no_sale_reports_route_date",
        fields: [
          { name: "route_id" },
          { name: "created_at", order: "DESC" }
        ],
        where: {
          route_id: { [sequelize.Sequelize.Op.ne]: null }
        }
      },
      {
        name: "idx_store_no_sale_reports_store_date",
        fields: [
          { name: "store_id" },
          { name: "created_at", order: "DESC" }
        ]
      },
      {
        name: "idx_store_no_sale_reports_user_date",
        fields: [
          { name: "user_id" },
          { name: "created_at", order: "DESC" }
        ]
      },
      {
        name: "idx_store_no_sale_reports_visit",
        fields: [{ name: "visit_id" }],
        where: {
          visit_id: { [sequelize.Sequelize.Op.ne]: null }
        }
      },
      {
        name: "idx_unique_visit_report",
        unique: true,
        fields: [{ name: "visit_id" }],
        where: {
          visit_id: { [sequelize.Sequelize.Op.ne]: null }
        }
      }
    ]
  });

  // � DEFINICIÓN DE RELACIONES/ASOCIACIONES
  StoreNoSaleReports.associate = function(models) {
    // 🏪 Relación con Stores - Un reporte pertenece a una tienda
    StoreNoSaleReports.belongsTo(models.stores, {
      as: 'store',
      foreignKey: 'store_id',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    });

    // 👤 Relación con Users - Un reporte pertenece a un usuario (quien lo creó)
    StoreNoSaleReports.belongsTo(models.users, {
      as: 'user',
      foreignKey: 'user_id',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    });

    // 🛣️ Relación con Routes - Un reporte puede pertenecer a una ruta (opcional)
    StoreNoSaleReports.belongsTo(models.routes, {
      as: 'route',
      foreignKey: 'route_id',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    // 🏢 Relación con Companies - Un reporte pertenece a una compañía
    StoreNoSaleReports.belongsTo(models.companies, {
      as: 'company',
      foreignKey: 'company_id',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    });

    // 📂 Relación con NoSaleCategories - Un reporte pertenece a una categoría
    StoreNoSaleReports.belongsTo(models.no_sale_categories, {
      as: 'category',
      foreignKey: 'category_id',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    });

    // 📋 Relación con NoSaleReasons - Un reporte pertenece a una razón específica
    StoreNoSaleReports.belongsTo(models.no_sale_reasons, {
      as: 'reason',
      foreignKey: 'reason_id',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    });

    // 🚶 Relación con StoreVisits - Un reporte puede estar asociado a una visita (opcional)
    StoreNoSaleReports.belongsTo(models.store_visits, {
      as: 'visit',
      foreignKey: 'visit_id',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  };

  // �🔧 MÉTODOS DE INSTANCIA
  
  /**
   * 📝 MÉTODO: toJSON - Personalizar serialización JSON
   * 🎯 Propósito: Formatear fechas y datos para respuestas API
   * 📋 Ejemplo de uso:
   *    const report = await StoreNoSaleReports.findByPk(1);
   *    const jsonData = report.toJSON(); // Fechas en formato ISO
   */
  StoreNoSaleReports.prototype.toJSON = function() {
    const values = { ...this.get() };
    
    // Formatear fechas si es necesario
    if (values.created_at) {
      values.created_at = values.created_at.toISOString();
    }
    if (values.updated_at) {
      values.updated_at = values.updated_at.toISOString();
    }
    
    return values;
  };

  /**
   * ✅ MÉTODO: validateCategoryReason - Validar compatibilidad categoría-razón
   * 🎯 Propósito: Asegurar que la razón seleccionada pertenece a la categoría
   * 📋 Ejemplo de uso:
   *    const report = new StoreNoSaleReports({category_id: 1, reason_id: 5});
   *    await report.validateCategoryReason(); // Valida antes de guardar
   */
  StoreNoSaleReports.prototype.validateCategoryReason = async function() {
    const reason = await sequelize.models.no_sale_reasons.findByPk(this.reason_id);
    if (!reason || reason.category_id !== this.category_id) {
      throw new Error('La razón seleccionada no pertenece a la categoría especificada');
    }
    return true;
  };

  /**
   * 🏢 MÉTODO: validateCategoryForCompany - Validar categoría para compañía
   * 🎯 Propósito: Verificar que la categoría esté disponible para la compañía (global o propia)
   * 📋 Ejemplo de uso:
   *    const report = new StoreNoSaleReports({category_id: 1, company_id: 'uuid-123'});
   *    await report.validateCategoryForCompany(); // Valida acceso a la categoría
   */
  StoreNoSaleReports.prototype.validateCategoryForCompany = async function() {
    const category = await sequelize.models.no_sale_categories.findByPk(this.category_id);
    if (!category) {
      throw new Error('La categoría especificada no existe');
    }
    
    // Si la categoría no es global, debe pertenecer a la compañía
    if (!category.is_global && category.company_id !== this.company_id) {
      throw new Error('La categoría seleccionada no está disponible para esta compañía');
    }
    
    return true;
  };

  // 🔍 MÉTODOS ESTÁTICOS DE CONSULTA

  /**
   * 🏢 MÉTODO: findByCompany - Buscar reportes por compañía
   * 🎯 Propósito: Obtener todos los reportes de no-venta de una compañía específica
   * 📋 Ejemplo de uso:
   *    const reports = await StoreNoSaleReports.findByCompany('company-uuid-123', {
   *      limit: 50,
   *      include: ['store', 'user', 'category', 'reason']
   *    });
   */
  StoreNoSaleReports.findByCompany = async function(companyId, options = {}) {
    return await this.findAll({
      where: {
        company_id: companyId,
        ...options.where
      },
      include: options.include || [
        { model: sequelize.models.stores, as: 'store' },
        { model: sequelize.models.users, as: 'user' },
        { model: sequelize.models.no_sale_categories, as: 'category' },
        { model: sequelize.models.no_sale_reasons, as: 'reason' },
        { model: sequelize.models.routes, as: 'route', required: false },
        { model: sequelize.models.store_visits, as: 'visit', required: false }
      ],
      order: options.order || [['created_at', 'DESC']],
      limit: options.limit,
      offset: options.offset
    });
  };

  /**
   * 👤 MÉTODO: findByUser - Buscar reportes por usuario
   * 🎯 Propósito: Obtener todos los reportes creados por un usuario específico
   * 📋 Ejemplo de uso:
   *    const userReports = await StoreNoSaleReports.findByUser('user-uuid-456', {
   *      where: { created_at: { [Op.gte]: new Date('2024-01-01') } }
   *    });
   */
  StoreNoSaleReports.findByUser = async function(userId, options = {}) {
    return await this.findAll({
      where: {
        user_id: userId,
        ...options.where
      },
      include: options.include || [
        { model: sequelize.models.stores, as: 'store' },
        { model: sequelize.models.no_sale_categories, as: 'category' },
        { model: sequelize.models.no_sale_reasons, as: 'reason' }
      ],
      order: options.order || [['created_at', 'DESC']],
      limit: options.limit,
      offset: options.offset
    });
  };

  /**
   * 🏪 MÉTODO: findByStore - Buscar reportes por tienda
   * 🎯 Propósito: Obtener historial de reportes de no-venta de una tienda específica
   * 📋 Ejemplo de uso:
   *    const storeReports = await StoreNoSaleReports.findByStore(123, {
   *      limit: 20,
   *      order: [['created_at', 'DESC']]
   *    });
   */
  StoreNoSaleReports.findByStore = async function(storeId, options = {}) {
    return await this.findAll({
      where: {
        store_id: storeId,
        ...options.where
      },
      include: options.include || [
        { model: sequelize.models.users, as: 'user' },
        { model: sequelize.models.no_sale_categories, as: 'category' },
        { model: sequelize.models.no_sale_reasons, as: 'reason' }
      ],
      order: options.order || [['created_at', 'DESC']],
      limit: options.limit,
      offset: options.offset
    });
  };

  /**
   * 📂 MÉTODO: findByCategory - Buscar reportes por categoría
   * 🎯 Propósito: Analizar reportes de una categoría específica de no-venta
   * 📋 Ejemplo de uso:
   *    const categoryReports = await StoreNoSaleReports.findByCategory(1, {
   *      where: { company_id: 'company-uuid' },
   *      include: ['reason', 'store']
   *    });
   */
  StoreNoSaleReports.findByCategory = async function(categoryId, options = {}) {
    return await this.findAll({
      where: {
        category_id: categoryId,
        ...options.where
      },
      include: options.include || [
        { model: sequelize.models.stores, as: 'store' },
        { model: sequelize.models.users, as: 'user' },
        { model: sequelize.models.no_sale_reasons, as: 'reason' }
      ],
      order: options.order || [['created_at', 'DESC']],
      limit: options.limit,
      offset: options.offset
    });
  };

  /**
   * 📅 MÉTODO: findByDateRange - Buscar reportes por rango de fechas
   * 🎯 Propósito: Consultar reportes en un período específico para análisis temporal
   * 📋 Ejemplo de uso:
   *    const monthlyReports = await StoreNoSaleReports.findByDateRange(
   *      new Date('2024-01-01'),
   *      new Date('2024-01-31'),
   *      { where: { company_id: 'company-uuid' } }
   *    );
   */
  StoreNoSaleReports.findByDateRange = async function(startDate, endDate, options = {}) {
    return await this.findAll({
      where: {
        created_at: {
          [sequelize.Sequelize.Op.between]: [startDate, endDate]
        },
        ...options.where
      },
      include: options.include || [
        { model: sequelize.models.stores, as: 'store' },
        { model: sequelize.models.users, as: 'user' },
        { model: sequelize.models.no_sale_categories, as: 'category' },
        { model: sequelize.models.no_sale_reasons, as: 'reason' }
      ],
      order: options.order || [['created_at', 'DESC']],
      limit: options.limit,
      offset: options.offset
    });
  };

  /**
   * 📊 MÉTODO: getStatsByCategory - Estadísticas por categoría
   * 🎯 Propósito: Generar estadísticas agregadas de reportes agrupados por categoría
   * 📋 Ejemplo de uso:
   *    const stats = await StoreNoSaleReports.getStatsByCategory('company-uuid', {
   *      startDate: new Date('2024-01-01'),
   *      endDate: new Date('2024-12-31')
   *    });
   *    // Resultado: [{category_name: 'Cliente no disponible', total_reports: 25, affected_stores: 15}]
   */
  StoreNoSaleReports.getStatsByCategory = async function(companyId, options = {}) {
    const { startDate, endDate } = options;
    
    const whereCondition = {
      company_id: companyId
    };
    
    if (startDate && endDate) {
      whereCondition.created_at = {
        [sequelize.Sequelize.Op.between]: [startDate, endDate]
      };
    }
    
    return await this.findAll({
      attributes: [
        'category_id',
        [sequelize.fn('COUNT', '*'), 'total_reports'],
        [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('store_id'))), 'affected_stores'],
        [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('user_id'))), 'reporting_users']
      ],
      where: whereCondition,
      include: [
        {
          model: sequelize.models.no_sale_categories,
          as: 'category',
          attributes: ['name', 'description']
        }
      ],
      group: ['category_id', 'category.id'],
      order: [[sequelize.literal('total_reports'), 'DESC']]
    });
  };

  /**
   * ✍️ MÉTODO: createReport - Crear reporte con validaciones completas
   * 🎯 Propósito: Crear un nuevo reporte asegurando todas las validaciones de integridad
   * 📋 Ejemplo de uso:
   *    const reportData = {
   *      store_id: 123,
   *      user_id: 'user-uuid',
   *      company_id: 'company-uuid',
   *      category_id: 1,
   *      reason_id: 3,
   *      comments: 'Cliente no estaba disponible en el momento de la visita',
   *      client_name: 'Juan Pérez',
   *      client_phone: '+573001234567'
   *    };
   *    const newReport = await StoreNoSaleReports.createReport(reportData);
   */
  StoreNoSaleReports.createReport = async function(reportData, options = {}) {
    const transaction = options.transaction || await sequelize.transaction();
    
    try {
      // Crear la instancia del reporte
      const report = this.build(reportData);
      
      // Validar categoría para la compañía
      await report.validateCategoryForCompany();
      
      // Validar que la razón pertenezca a la categoría
      await report.validateCategoryReason();
      
      // Guardar el reporte
      await report.save({ transaction });
      
      // Si no se pasó una transacción externa, hacer commit
      if (!options.transaction) {
        await transaction.commit();
      }
      
      return report;
    } catch (error) {
      // Si no se pasó una transacción externa, hacer rollback
      if (!options.transaction) {
        await transaction.rollback();
      }
      throw error;
    }
  };

  /**
   * 📈 MÉTODO: getReportsByReason - Reportes agrupados por razón
   * 🎯 Propósito: Analizar cuáles son las razones más comunes de no-venta
   * 📋 Ejemplo de uso:
   *    const reasonStats = await StoreNoSaleReports.getReportsByReason('company-uuid', {
   *      category_id: 1, // Filtrar por categoría específica
   *      limit: 10 // Top 10 razones
   *    });
   */
  StoreNoSaleReports.getReportsByReason = async function(companyId, options = {}) {
    const whereCondition = {
      company_id: companyId,
      ...options.where
    };

    return await this.findAll({
      attributes: [
        'reason_id',
        [sequelize.fn('COUNT', '*'), 'total_reports'],
        [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('store_id'))), 'unique_stores']
      ],
      where: whereCondition,
      include: [
        {
          model: sequelize.models.no_sale_reasons,
          as: 'reason',
          attributes: ['name', 'description']
        },
        {
          model: sequelize.models.no_sale_categories,
          as: 'category',
          attributes: ['name']
        }
      ],
      group: ['reason_id', 'reason.id', 'category.id'],
      order: [[sequelize.literal('total_reports'), 'DESC']],
      limit: options.limit || 20
    });
  };

  /**
   * 🚨 MÉTODO: findProblematicStores - Tiendas con más reportes de no-venta
   * 🎯 Propósito: Identificar tiendas que requieren atención especial
   * 📋 Ejemplo de uso:
   *    const problematicStores = await StoreNoSaleReports.findProblematicStores('company-uuid', {
   *      minReports: 5, // Mínimo 5 reportes para considerarse problemática
   *      days: 30 // En los últimos 30 días
   *    });
   */
  StoreNoSaleReports.findProblematicStores = async function(companyId, options = {}) {
    const { minReports = 3, days = 30 } = options;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return await this.findAll({
      attributes: [
        'store_id',
        [sequelize.fn('COUNT', '*'), 'total_reports'],
        [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('category_id'))), 'different_categories'],
        [sequelize.fn('MAX', sequelize.col('store_no_sale_reports.created_at')), 'last_report_date']
      ],
      where: {
        company_id: companyId,
        created_at: {
          [sequelize.Sequelize.Op.gte]: startDate
        }
      },
      include: [
        {
          model: sequelize.models.stores,
          as: 'store',
          attributes: ['name', 'address', 'phone']
        }
      ],
      group: ['store_id', 'store.id'],
      having: sequelize.where(sequelize.fn('COUNT', '*'), '>=', minReports),
      order: [[sequelize.literal('total_reports'), 'DESC']]
    });
  };

  /**
   * 📋 MÉTODO: findByVisit - Buscar reporte por visita específica
   * 🎯 Propósito: Obtener el reporte asociado a una visita de tienda
   * 📋 Ejemplo de uso:
   *    const visitReport = await StoreNoSaleReports.findByVisit(visitId);
   *    if (visitReport) {
   *      console.log('Esta visita ya tiene un reporte de no-venta');
   *    }
   */
  StoreNoSaleReports.findByVisit = async function(visitId) {
    return await this.findOne({
      where: { visit_id: visitId },
      include: [
        { model: sequelize.models.no_sale_categories, as: 'category' },
        { model: sequelize.models.no_sale_reasons, as: 'reason' },
        { model: sequelize.models.stores, as: 'store' },
        { model: sequelize.models.users, as: 'user' }
      ]
    });
  };

  return StoreNoSaleReports;
};