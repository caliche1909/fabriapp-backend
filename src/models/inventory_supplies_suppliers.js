const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
    const InventorySuppliesSuppliers = sequelize.define('inventory_supplies_suppliers', {
        id: { // Identificador único autoincremental para cada relación insumo-proveedor
            autoIncrement: true,
            type: DataTypes.INTEGER,
            allowNull: false,
            primaryKey: true
        },
        inventory_supply_id: {
            // ID del insumo al que se está vinculando el proveedor
            // Ejemplo: ID de "Harina Haz de Oros" de la compañía A
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'inventory_supplies',
                key: 'id'
            },
            onDelete: 'CASCADE' // Si se elimina el insumo, se elimina esta relación
        },
        supplier_id: {
            // ID del proveedor que suministra el insumo
            // Ejemplo: ID de "Harinera del Valle"
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'supplier_companies',
                key: 'id'
            },
            onDelete: 'CASCADE'
        },
        price: {
            // Precio al que este proveedor específico vende este insumo específico
            // Ejemplo: 126000 (precio del bulto de 50kg de Harina Haz de Oros)
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            validate: {
                min: 0.01 // El precio debe ser mayor que 0
            }
        },
        is_main_supplier: {
            // Indica si este es el proveedor principal para este insumo
            // Útil para saber a quién contactar primero cuando se necesita reabastecimiento
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        is_active: {
            // Indica si esta relación insumo-proveedor está activa
            // Permite "desactivar" un proveedor sin eliminarlo (mantiene historial)
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        last_purchase_date: {
            // Fecha de la última compra realizada a este proveedor para este insumo
            // Útil para análisis de frecuencia de compra y toma de decisiones
            type: DataTypes.DATE,
            allowNull: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
    }, {
        sequelize,
        tableName: 'inventory_supplies_suppliers',
        schema: 'public',
        timestamps: true,
        underscored: true,
        freezeTableName: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            {
                name: "inventory_supplies_suppliers_pkey",
                unique: true,
                fields: [{ name: "id" }]
            },
            {
                name: "idx_inventory_supplies_suppliers_supply",
                fields: [{ name: "inventory_supply_id" }]
            },
            {
                name: "idx_inventory_supplies_suppliers_supplier",
                fields: [{ name: "supplier_id" }]
            },
            {
                name: "unique_supply_supplier",
                unique: true,
                fields: [{ name: "inventory_supply_id" }, { name: "supplier_id" }]
            }
        ]
    });

    // Definir las asociaciones
    InventorySuppliesSuppliers.associate = (models) => {
        InventorySuppliesSuppliers.belongsTo(models.inventory_supplies, {
            foreignKey: 'inventory_supply_id',
            as: 'supply'
        });

        InventorySuppliesSuppliers.belongsTo(models.supplier_companies, {
            foreignKey: 'supplier_id',
            as: 'supplier'
        });
    };

    return InventorySuppliesSuppliers;
}; 