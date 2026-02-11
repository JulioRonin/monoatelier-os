import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Client, FiscalRegime, PaymentForm, PaymentMethod, CFDIUse } from '../types';
import { Search, Plus, Trash2, FileText, Check, AlertCircle, Save } from 'lucide-react';

// Catalog Descriptions
const REGIME_DESCRIPTIONS: { [key: string]: string } = {
    '601': 'General de Ley Personas Morales',
    '603': 'Personas Morales con Fines no Lucrativos',
    '605': 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
    '606': 'Arrendamiento',
    '607': 'Régimen de Enajenación o Adquisición de Bienes',
    '608': 'Demás ingresos',
    '610': 'Residentes en el Extranjero sin Establecimiento Permanente en México',
    '611': 'Ingresos por Dividendos (socios y accionistas)',
    '612': 'Personas Físicas con Actividades Empresariales y Profesionales',
    '614': 'Ingresos por intereses',
    '615': 'Régimen de los ingresos por obtención de premios',
    '616': 'Sin obligaciones fiscales',
    '620': 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos',
    '621': 'Incorporación Fiscal',
    '622': 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
    '623': 'Opcional para Grupos de Sociedades',
    '624': 'Coordinados',
    '625': 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
    '626': 'Régimen Simplificado de Confianza'
};

const CFDI_USE_DESCRIPTIONS: { [key: string]: string } = {
    'G01': 'Adquisición de mercancías',
    'G02': 'Devoluciones, descuentos o bonificaciones',
    'G03': 'Gastos en general',
    'I01': 'Construcciones',
    'I02': 'Mobiliario y equipo de oficina por inversiones',
    'I03': 'Equipo de transporte',
    'I04': 'Equipo de cómputo y accesorios',
    'I05': 'Dados, troqueles, moldes, matrices y herramental',
    'I06': 'Comunicaciones telefónicas',
    'I07': 'Comunicaciones satelitales',
    'I08': 'Otra maquinaria y equipo',
    'D01': 'Honorarios médicos, dentales y gastos hospitalarios',
    'D02': 'Gastos médicos por incapacidad o discapacidad',
    'D03': 'Gastos funerales',
    'D04': 'Donativos',
    'D05': 'Intereses reales efectivamente pagados por créditos hipotecarios',
    'D06': 'Aportaciones voluntarias al SAR',
    'D07': 'Primas por seguros de gastos médicos',
    'D08': 'Gastos de transportación escolar obligatoria',
    'D09': 'Depósitos en cuentas para el ahorro',
    'D10': 'Pagos por servicios educativos (colegiaturas)',
    'S01': 'Sin efectos fiscales',
    'CP01': 'Pagos',
    'CN01': 'Nómina'
};

const PAYMENT_METHOD_DESCRIPTIONS: { [key: string]: string } = {
    'PUE': 'Pago en una sola exhibición',
    'PPD': 'Pago en parcialidades o diferido'
};

const Invoicing: React.FC = () => {
    // State
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showClientDropdown, setShowClientDropdown] = useState(false);

    // Invoice Header Data
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [rfc, setRfc] = useState('');
    const [fiscalName, setFiscalName] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [selectedRegime, setSelectedRegime] = useState<string>('');
    const [paymentForm, setPaymentForm] = useState<PaymentForm>(PaymentForm.Transferencia);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.PUE);
    const [cfdiUse, setCfdiUse] = useState<CFDIUse>(CFDIUse.G03);

    // Concepts
    const [items, setItems] = useState<any[]>([]);

    useEffect(() => {
        loadClients();
    }, []);

    const loadClients = async () => {
        try {
            const data = await api.getClients();
            setClients(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectClient = (client: Client) => {
        setSelectedClient(client);
        setRfc(client.rfc || '');
        setFiscalName(client.fiscalName || client.fullName.toUpperCase());
        setPostalCode(client.postalCode || '');
        setSelectedRegime(client.fiscalRegime || '');
        setShowClientDropdown(false);
        setSearchTerm(client.fullName);
    };

    const addItem = () => {
        setItems([...items, {
            id: Date.now().toString(),
            productCode: '84111506', // Default service
            unitCode: 'E48', // Service unit
            description: '',
            quantity: 1,
            unitPrice: 0,
            taxObject: '02', // Sí objeto de impuesto
            taxes: [{ type: 'IVA', rate: 0.16, isRetention: false }]
        }]);
    };

    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };
        setItems(newItems);
    };

    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    // Calculations
    const calculateTotals = () => {
        let subtotal = 0;
        let totalTaxes = 0;

        items.forEach(item => {
            const amount = item.quantity * item.unitPrice;
            subtotal += amount;
            // Simple tax calc for now (assumes 16% IVA only)
            if (item.taxObject === '02') {
                totalTaxes += amount * 0.16;
            }
        });

        return {
            subtotal,
            totalTaxes,
            total: subtotal + totalTaxes
        };
    };

    const { subtotal, totalTaxes, total } = calculateTotals();

    const filteredClients = clients.filter(c =>
        c.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.rfc && c.rfc.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    // Validation
    const [errors, setErrors] = useState<{ [key: string]: string }>({});

    const validateRFC = (rfc: string) => {
        const regex = /^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$/;
        return regex.test(rfc);
    };

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};

        if (!rfc) newErrors.rfc = 'El RFC es requerido';
        else if (!validateRFC(rfc)) newErrors.rfc = 'Formato de RFC inválido (Ej: XAXX010101000)';

        if (!fiscalName) newErrors.fiscalName = 'La Razón Social es requerida';
        if (!postalCode) newErrors.postalCode = 'El Código Postal es requerido';
        if (!selectedRegime) newErrors.selectedRegime = 'El Régimen Fiscal es requerido';

        if (items.length === 0) newErrors.items = 'Debe agregar al menos un concepto';

        items.forEach((item, index) => {
            if (item.quantity <= 0) newErrors[`item_${index}_qty`] = 'Cantidad inválida';
            if (item.unitPrice < 0) newErrors[`item_${index}_price`] = 'Precio inválido';
            if (!item.description) newErrors[`item_${index}_desc`] = 'Descripción requerida';
        });

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handlePreview = async () => {
        if (!validateForm()) return;
        // logic to generate PDF preview would go here
        alert("Generando Vista Previa PDF (Simulado)...");
    };

    const handleTimbrar = async () => {
        if (!validateForm()) return;

        try {
            setLoading(true);

            // Prepare items with calculations
            const processedItems = items.map(item => ({
                ...item,
                amount: item.quantity * item.unitPrice,
                discount: item.discount || 0
            }));

            const invoiceData = {
                clientId: selectedClient?.id,
                clientName: fiscalName,
                clientRfc: rfc,
                clientFiscalRegime: selectedRegime,
                clientPostalCode: postalCode,
                clientUseCFDI: cfdiUse,
                paymentForm,
                paymentMethod,
                currency: 'MXN',
                exchangeRate: 1,
                placeOfIssue: '20000', // Example fixed or config
                exportation: '01',
                subtotal,
                totalTaxesTransferred: totalTaxes,
                totalTaxesRetained: 0,
                total,
                status: 'Draft',
                items: processedItems,
                date: new Date().toISOString(),
                series: 'A',
                folio: Math.floor(Math.random() * 1000) // Temp logic
            };

            await api.createInvoice(invoiceData);
            alert("Factura guardada y lista para timbrar (Simulación envío PAC)");
            // Here we would call the PAC API
        } catch (e) {
            console.error(e);
            alert("Error al procesar la factura");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-12 animate-fade-in">
            {/* Header */}
            <div className="flex justify-between items-end border-b border-gray-200 dark:border-gray-700 pb-6">
                <div>
                    <h1 className="font-serif text-4xl dark:text-white text-primary mb-2">Facturación 4.0</h1>
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-400">Emisión de Comprobantes Fiscales Digitales</p>
                </div>
                <div className="flex gap-4">
                    <button
                        onClick={handlePreview}
                        className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs uppercase tracking-widest font-bold text-gray-500 hover:text-primary transition-colors shadow-sm rounded-lg"
                    >
                        <FileText size={16} /> Vista Previa
                    </button>
                    <button
                        onClick={handleTimbrar}
                        className="flex items-center gap-2 px-6 py-3 bg-primary text-white text-xs uppercase tracking-widest font-bold shadow-lg hover:bg-primary/90 transition-colors rounded-lg"
                    >
                        <Check size={16} /> Timbrar Factura
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Client & Config */}
                <div className="lg:col-span-1 space-y-8">
                    {/* Client Selection */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-6 flex items-center gap-2">
                            <Search size={16} /> Datos del Cliente
                        </h3>

                        <div className="space-y-4">
                            <div className="relative">
                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Buscar Cliente</label>
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => { setSearchTerm(e.target.value); setShowClientDropdown(true); }}
                                    onFocus={() => setShowClientDropdown(true)}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
                                    placeholder="Nombre o RFC..."
                                />
                                {showClientDropdown && searchTerm && (
                                    <div className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 mt-1 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                                        {filteredClients.map(client => (
                                            <div
                                                key={client.id}
                                                onClick={() => handleSelectClient(client)}
                                                className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-50 last:border-0"
                                            >
                                                <div className="font-bold text-sm text-gray-800 dark:text-gray-200">{client.fullName}</div>
                                                <div className="text-xs text-gray-400 flex justify-between">
                                                    <span>{client.rfc || 'Sin RFC'}</span>
                                                    <span>{client.email}</span>
                                                </div>
                                            </div>
                                        ))}
                                        {filteredClients.length === 0 && (
                                            <div className="px-4 py-3 text-xs text-gray-400 italic">No se encontraron clientes</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">RFC <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={rfc}
                                    onChange={(e) => setRfc(e.target.value.toUpperCase())}
                                    className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.rfc ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:border-primary transition-colors uppercase`}
                                    placeholder="XAXX010101000"
                                />
                                {errors.rfc && <p className="text-[10px] text-red-500 mt-1">{errors.rfc}</p>}
                            </div>

                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Razón Social <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={fiscalName}
                                    onChange={(e) => setFiscalName(e.target.value.toUpperCase())}
                                    className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.fiscalName ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors uppercase`}
                                    placeholder="SIN SA DE CV"
                                />
                                <p className="text-[9px] text-gray-400 mt-1">Tal cual aparece en la Constancia de Situación Fiscal.</p>
                                {errors.fiscalName && <p className="text-[10px] text-red-500 mt-1">{errors.fiscalName}</p>}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Codigo Postal <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        value={postalCode}
                                        onChange={(e) => setPostalCode(e.target.value)}
                                        className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.postalCode ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors`}
                                    />
                                    {errors.postalCode && <p className="text-[10px] text-red-500 mt-1">{errors.postalCode}</p>}
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Régimen Fiscal <span className="text-red-500">*</span></label>
                                    <select
                                        value={selectedRegime}
                                        onChange={(e) => setSelectedRegime(e.target.value)}
                                        className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.selectedRegime ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors`}
                                    >
                                        <option value="">Seleccionar</option>
                                        {Object.values(FiscalRegime).map(regime => (
                                            <option key={regime} value={regime}>
                                                {regime} - {REGIME_DESCRIPTIONS[regime] || ''}
                                            </option>
                                        ))}
                                    </select>
                                    {errors.selectedRegime && <p className="text-[10px] text-red-500 mt-1">{errors.selectedRegime}</p>}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Payment Settings */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-6">Detalles del Pago</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Uso de CFDI</label>
                                <select
                                    value={cfdiUse}
                                    onChange={(e) => setCfdiUse(e.target.value as CFDIUse)}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
                                >
                                    {Object.entries(CFDIUse).map(([key, value]) => (
                                        <option key={key} value={value}>
                                            {value} - {CFDI_USE_DESCRIPTIONS[value] || key}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Forma de Pago</label>
                                <select
                                    value={paymentForm}
                                    onChange={(e) => setPaymentForm(e.target.value as PaymentForm)}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
                                >
                                    {Object.entries(PaymentForm).map(([key, value]) => (
                                        <option key={key} value={value}>{value} - {key}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Método de Pago</label>
                                <select
                                    value={paymentMethod}
                                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
                                >
                                    {Object.entries(PaymentMethod).map(([key, value]) => (
                                        <option key={key} value={value}>
                                            {value} - {PAYMENT_METHOD_DESCRIPTIONS[value] || key}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Concepts & Totals */}
                <div className="lg:col-span-2 space-y-8">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 min-h-[500px] flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">Conceptos</h3>
                            <button onClick={addItem} className="flex items-center gap-1 text-xs font-bold text-primary hover:text-primary/80 uppercase tracking-widest">
                                <Plus size={14} /> Agregar Concepto
                            </button>
                        </div>

                        {errors.items && <div className="mb-4 p-3 bg-red-50 text-red-500 text-xs rounded-lg flex items-center gap-2"><AlertCircle size={14} /> {errors.items}</div>}

                        <div className="flex-1 overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-gray-100 dark:border-gray-700 text-[10px] uppercase tracking-widest text-gray-400">
                                        <th className="py-2 w-20">Cant.</th>
                                        <th className="py-2">Descripción</th>
                                        <th className="py-2 w-32">P. Unitario</th>
                                        <th className="py-2 w-32 text-right">Importe</th>
                                        <th className="py-2 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                                    {items.map((item, index) => (
                                        <tr key={item.id} className="group">
                                            <td className="py-3 align-top">
                                                <input
                                                    type="number"
                                                    value={item.quantity}
                                                    onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value))}
                                                    className="w-full bg-transparent border-b border-transparent focus:border-primary focus:outline-none text-sm text-center"
                                                    min="1"
                                                />
                                                {errors[`item_${index}_qty`] && <p className="text-[9px] text-red-500 mt-1">{errors[`item_${index}_qty`]}</p>}
                                            </td>
                                            <td className="py-3 align-top">
                                                <textarea
                                                    value={item.description}
                                                    onChange={(e) => updateItem(index, 'description', e.target.value)}
                                                    className="w-full bg-transparent border-b border-gray-100 focus:border-primary focus:outline-none text-sm resize-none"
                                                    rows={2}
                                                    placeholder="Descripción del servicio..."
                                                />
                                                {errors[`item_${index}_desc`] && <p className="text-[9px] text-red-500 mt-1">{errors[`item_${index}_desc`]}</p>}
                                                <div className="flex gap-2 mt-1">
                                                    <input
                                                        type="text"
                                                        value={item.productCode}
                                                        onChange={(e) => updateItem(index, 'productCode', e.target.value)}
                                                        className="text-[10px] bg-gray-50 text-gray-500 rounded px-1 w-20 border-none"
                                                        title="Clave Prod/Serv"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={item.unitCode}
                                                        onChange={(e) => updateItem(index, 'unitCode', e.target.value)}
                                                        className="text-[10px] bg-gray-50 text-gray-500 rounded px-1 w-12 border-none"
                                                        title="Clave Unidad"
                                                    />
                                                </div>
                                            </td>
                                            <td className="py-3 align-top">
                                                <div className="relative">
                                                    <span className="absolute left-0 top-0 text-gray-400 text-sm">$</span>
                                                    <input
                                                        type="number"
                                                        value={item.unitPrice}
                                                        onChange={(e) => updateItem(index, 'unitPrice', parseFloat(e.target.value))}
                                                        className="w-full pl-3 bg-transparent border-b border-transparent focus:border-primary focus:outline-none text-sm text-right"
                                                    />
                                                </div>
                                            </td>
                                            <td className="py-3 align-top text-right text-sm font-mono text-gray-700 dark:text-gray-300">
                                                ${(item.quantity * item.unitPrice).toFixed(2)}
                                            </td>
                                            <td className="py-3 align-top text-center">
                                                <button onClick={() => removeItem(index)} className="text-gray-300 hover:text-red-500 transition-colors">
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {items.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="py-8 text-center text-sm text-gray-400 italic">
                                                Agrega conceptos a la factura
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Totals */}
                        <div className="mt-8 border-t border-gray-100 dark:border-gray-700 pt-6 flex justify-end">
                            <div className="w-64 space-y-3">
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>Subtotal</span>
                                    <span className="font-mono">${subtotal.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>IVA (16%)</span>
                                    <span className="font-mono">${totalTaxes.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-xl font-serif text-gray-900 dark:text-white pt-3 border-t border-gray-100 dark:border-gray-700">
                                    <span>Total</span>
                                    <span>${total.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Invoicing;
