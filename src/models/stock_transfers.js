const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 🔄 TRASPASOS ENTRE BODEGAS. Cabecera de una transacción de inventario entre dos
  // bodegas (con estado en_transito para traslados no instantáneos). La ejecución (Fase B)
  // genera 2 patas en product_stock_movements (TRASPASO_SALIDA/TRASPASO_ENTRADA) enlazadas
  // por transfer_group_id. Paranoid + auditoría.
  const StockTransfers = sequelize.define('stock_transfers', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'companies', key: 'id' },
      onDelete: 'CASCADE'
    },
    from_location_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'inventory_locations', key: 'id' },
      onDelete: 'RESTRICT'
    },
    to_location_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'inventory_locations', key: 'id' },
      onDelete: 'RESTRICT'
    },
    status: {
      type: DataTypes.ENUM('pendiente', 'en_transito', 'completado', 'cancelado'),
      allowNull: false,
      defaultValue: 'pendiente'
    },
    transfer_number: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Número visible del traspaso, secuencial y único por compañía (asignado por el backend al crear)'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      comment: 'Usuario que emitió/creó el traspaso'
    },
    shipped_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    received_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    received_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      comment: 'Usuario que confirmó la recepción'
    },
    has_discrepancy: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'true si en la recepción hubo faltantes/novedades'
    },
    reception_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notas de la recepción (novedades)'
    },
    discrepancy_resolved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'true si la novedad (faltante/sobrante) ya fue cuadrada con un ajuste'
    },
    discrepancy_resolved_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      comment: 'Usuario que marcó la novedad como cuadrada (auditoría)'
    },
    discrepancy_resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Momento en que se marcó la novedad como cuadrada'
    },
    discrepancy_resolution_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Nota de cómo se cuadró la novedad (opcional)'
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      comment: 'Usuario que eliminó el traspaso (auditoría)'
    }
  }, {
    sequelize,
    tableName: 'stock_transfers',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    hasTrigger: true,
    validate: {
      distinctLocations() {
        if (this.from_location_id === this.to_location_id) {
          throw new Error('La bodega de origen y destino deben ser distintas.');
        }
      }
    },
    hooks: {
      beforeDestroy: (instance, options) => {
        if (options && options.userId) {
          instance.deleted_by = options.userId;
        } else {
          throw new Error('Se requiere un userId para eliminar un registro y mantener la auditoría.');
        }
      },
      beforeRestore: (instance) => {
        instance.deleted_by = null;
      }
    },
    indexes: [
      { name: 'idx_stock_transfers_company', fields: [{ name: 'company_id' }] },
      { name: 'idx_stock_transfers_from', fields: [{ name: 'from_location_id' }] },
      { name: 'idx_stock_transfers_to', fields: [{ name: 'to_location_id' }] },
      { name: 'idx_stock_transfers_status', fields: [{ name: 'status' }] },
      { name: 'uq_stock_transfers_company_number', unique: true, fields: [{ name: 'company_id' }, { name: 'transfer_number' }] }
    ]
  });

  StockTransfers.associate = (models) => {
    StockTransfers.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
    StockTransfers.belongsTo(models.inventory_locations, { foreignKey: 'from_location_id', as: 'from_location' });
    StockTransfers.belongsTo(models.inventory_locations, { foreignKey: 'to_location_id', as: 'to_location' });
    StockTransfers.belongsTo(models.users, { foreignKey: 'user_id', as: 'user' });
    StockTransfers.belongsTo(models.users, { foreignKey: 'received_by', as: 'received_by_user' });
    StockTransfers.belongsTo(models.users, { foreignKey: 'discrepancy_resolved_by', as: 'discrepancy_resolved_by_user' });
    StockTransfers.belongsTo(models.users, { foreignKey: 'deleted_by', as: 'deleted_by_user' });

    StockTransfers.hasMany(models.stock_transfer_items, { foreignKey: 'transfer_id', as: 'items' });
  };

  return StockTransfers;
};
