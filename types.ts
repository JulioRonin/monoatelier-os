export enum PhaseEnum {
  Quote = "Quote",
  Design_Review = "Design Review",
  Design_Approval = "Design Approval",
  Material_Request = "Material Request",
  Production = "Production",
  Installation = "Installation",
  Delivery = "Delivery"
}

export enum ProjectStatus {
  Quote = "Quote",
  Sent = "Sent",
  In_Progress = "In Progress",
  Completed = "Completed",
  No_Achieve = "No Achieve",
  Cancelled = "Cancelled"
}

export enum PriorityLevel {
  High = "High",
  Medium = "Medium",
  Low = "Low"
}

export enum ProjectHealth {
  Healthy = "HEALTHY",
  Red_Alert_Financial = "RED_ALERT_FINANCIAL",
  Yellow_Alert_Time = "YELLOW_ALERT_TIME"
}

export interface Client {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  rfc?: string;
  fiscalName?: string;
  fiscalRegime?: FiscalRegime;
  postalCode?: string;
}

// --- CFDI 4.0 CATALOGS ---
export enum PaymentForm {
  Efectivo = "01",
  ChequeNominativo = "02",
  Transferencia = "03",
  TarjetaCredito = "04",
  MonederoElectronico = "05",
  DineroElectronico = "06",
  ValesDespensa = "08",
  DacionPago = "12",
  PagoSubrogacion = "13",
  PagoConsignacion = "14",
  Condonacion = "15",
  Cancelacion = "16",
  Compensacion = "17",
  Novacion = "23",
  Confusion = "24",
  RemisionDeuda = "25",
  PrescripcionCaducidad = "26",
  SatisfaccionAcreedor = "27",
  TarjetaDebito = "28",
  TarjetaServicios = "29",
  AplicacionAnticipos = "30",
  IntermediarioPagos = "31",
  PorDefinir = "99"
}

export enum PaymentMethod {
  PUE = "PUE", // Pago en una sola exhibición
  PPD = "PPD"  // Pago en parcialidades o diferido
}

export enum ReferenceType {
  Factura = "Factura",
  Remision = "Remision",
  Pedido = "Pedido",
  OrdenCompra = "Orden de Compra"
}

export enum CFDIUse {
  G01 = "G01", // Adquisición de mercancías
  G02 = "G02", // Devoluciones, descuentos o bonificaciones
  G03 = "G03", // Gastos en general
  I01 = "I01", // Construcciones
  I02 = "I02", // Mobiliario y equipo de oficina por inversiones
  I03 = "I03", // Equipo de transporte
  I04 = "I04", // Equipo de cómputo y accesorios
  I05 = "I05", // Dados, troqueles, moldes, matrices y herramental
  I06 = "I06", // Comunicaciones telefónicas
  I07 = "I07", // Comunicaciones satelitales
  I08 = "I08", // Otra maquinaria y equipo
  D01 = "D01", // Honorarios médicos, dentales y gastos hospitalarios
  D02 = "D02", // Gastos médicos por incapacidad o discapacidad
  D03 = "D03", // Gastos funerales
  D04 = "D04", // Donativos
  D05 = "D05", // Intereses reales efectivamente pagados por créditos hipotecarios
  D06 = "D06", // Aportaciones voluntarias al SAR
  D07 = "D07", // Primas por seguros de gastos médicos
  D08 = "D08", // Gastos de transportación escolar obligatoria
  D09 = "D09", // Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones
  D10 = "D10", // Pagos por servicios educativos (colegiaturas)
  S01 = "S01", // Sin efectos fiscales
  CP01 = "CP01", // Pagos
  CN01 = "CN01"  // Nómina
}

export enum FiscalRegime {
  GeneralLeyPersonasMorales = "601",
  PersonasMoralesFinesNoLucrativos = "603",
  SueldosSalariosIngresosAsimilados = "605",
  Arrendamiento = "606",
  RegimenEnajenacionAdquisicionBienes = "607",
  DemasIngresos = "608",
  ResidentesExtranjeroSinEstablecimiento = "610",
  IngresosDividendosSocios = "611",
  PersonasFisicasActividadesEmpresarialesProfesionales = "612",
  IngresosIntereses = "614",
  RegimenObtencionPremios = "615",
  SinObligacionesFiscales = "616",
  SociedadesCooperativasProduccion = "620",
  IncorporacionFiscal = "621", // RIF (Legacy but still active for some)
  ActividadesAgricolasGanaderasSilvicolasPesqueras = "622",
  OpcionalGruposSociedades = "623",
  Coordinados = "624",
  RegimenActividadesEmpresarialesPlataformasTecnologicas = "625",
  RegimenSimplificadoConfianza = "626" // RESICO
}

export enum InvoiceStatus {
  Draft = "Draft",
  Stamped = "Stamped",
  Cancelled = "Cancelled",
  Error = "Error"
}

export interface InvoiceItem {
  id?: string; // Optional for new items
  productCode: string; // ClaveProdServ (e.g., 84111506)
  unitCode: string; // ClaveUnidad (e.g., E48)
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxObject: "01" | "02" | "03"; // 01: No objeto, 02: Sí objeto, 03: Sí objeto y no obligado
  // Calculated fields (optional in input, required in display/processing)
  amount?: number; // Importe (Base)
  taxes?: {
    type: 'IVA' | 'ISR';
    rate: number; // 0.16
    amount: number;
    isRetention: boolean;
  }[];
}

export interface Invoice {
  id: string;
  series?: string;
  folio?: number;
  date: string;
  clientId: string;
  clientName: string;
  clientRfc: string;
  clientFiscalRegime: FiscalRegime;
  clientPostalCode: string;
  clientUseCFDI: CFDIUse;

  paymentForm: PaymentForm;
  paymentMethod: PaymentMethod;
  currency: string;
  exchangeRate?: number;
  placeOfIssue: string; // CP Enisor
  exportation: "01" | "02" | "03" | "04"; // 01: No aplica

  items: InvoiceItem[];

  subtotal: number;
  discount: number;
  totalTaxesTransferred: number;
  totalTaxesRetained: number;
  total: number;

  status: InvoiceStatus;
  uuid?: string; // Folio Fiscal (UUID) after stamping
  xmlUrl?: string;
  pdfUrl?: string;
  cancellationReceiptUrl?: string;
}


export type TeamCategory = 'Project Manager' | 'Coordinator' | 'Leader' | 'Technical';
export type PermissionLevel = 'Lvl 1' | 'Lvl 2' | 'Lvl 3' | 'Super User';

export interface TeamMember {
  id: string;
  fullName: string;
  role: string; // Keep for display title (e.g. "Senior Architect")
  category: TeamCategory;
  permissionLevel: PermissionLevel;
  status: 'Active' | 'Inactive';
  avatarUrl?: string;
  email?: string;
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  status: ProjectStatus;
  budget: number;
  liveCost: number;
  downpayment: number;
  startDate?: string;
  dueDate?: string;
  progress: number;
  priority: PriorityLevel;
  phase: PhaseEnum;
  docsUrl: string[];
  team: string[]; // Stores TeamMember IDs
  projectOverview?: string;
  responsibleId?: string; // ID of the user responsible for the project
}

// Financial Reporting Types
export interface MonthlyFinancial {
  month: string;
  actualRevenue: number;
  projectedRevenue: number;
}

export interface QuoteItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Quote {
  id: string;
  projectName: string;
  clientName: string;
  deliveryTime: string;
  date: string;
  items: QuoteItem[];
  notes?: string;
  status: 'Draft' | 'Sent' | 'Approved' | 'Awaiting Approval' | 'Rejected';
  totalAmount: number;
  createdBy?: string;

  creatorRole?: string;
}

export interface User {
  id: string;
  email: string;
  password?: string; // Optional in frontend type
  fullName: string;
  role: 'Super User' | 'Level 2';
  avatarUrl?: string;
}