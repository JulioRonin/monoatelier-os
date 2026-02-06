import { Client, Project, ProjectStatus, PhaseEnum, PriorityLevel, MonthlyFinancial } from './types';

export const MOCK_CLIENTS: Client[] = [
  { id: 'c1', fullName: 'Alejandra', email: 'alevizcaya34@gmail.com', phone: '+52 1 656 239 5485', avatarUrl: 'https://picsum.photos/100/100?random=1' },
  { id: 'c2', fullName: 'Saul Mata', email: 'saul@example.com', avatarUrl: 'https://picsum.photos/100/100?random=2' },
  { id: 'c3', fullName: 'Moises', email: 'moises@example.com', avatarUrl: 'https://picsum.photos/100/100?random=3' },
  { id: 'c4', fullName: 'Efren', email: 'efren@example.com', avatarUrl: 'https://picsum.photos/100/100?random=4' },
  { id: 'c5', fullName: 'Ivan', email: 'ivan@vitesco.com', avatarUrl: 'https://picsum.photos/100/100?random=5' },
];

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'p1',
    clientId: 'c3',
    name: 'Comedor Calacata Gris',
    status: ProjectStatus.Completed,
    budget: 28000.00,
    liveCost: 10000.00,
    downpayment: 12000.00,
    startDate: '2025-06-16',
    progress: 100,
    priority: PriorityLevel.High,
    phase: PhaseEnum.Construction_Admin,
    docsUrl: [],
    team: ['https://picsum.photos/50/50?random=10', 'https://picsum.photos/50/50?random=11'],
    projectOverview: "Fabrication and installation of Calacata Grey dining table."
  },
  {
    id: 'p2',
    clientId: 'c4',
    name: 'Cocina Minimalista',
    status: ProjectStatus.In_Progress,
    budget: 380000.00,
    liveCost: 446700.79, // Over budget!
    downpayment: 150000.00,
    startDate: '2025-05-01',
    dueDate: '2025-06-06',
    progress: 90,
    priority: PriorityLevel.High,
    phase: PhaseEnum.Construction_Docs,
    docsUrl: [],
    team: ['https://picsum.photos/50/50?random=12'],
    projectOverview: "Complete minimalist kitchen design and build with oak finish."
  },
  {
    id: 'p3',
    clientId: 'c5',
    name: 'Coffee Spot for Vitesco',
    status: ProjectStatus.In_Progress,
    budget: 57000.00,
    liveCost: 24500.00,
    downpayment: 0,
    startDate: '2025-08-12',
    dueDate: '2025-08-22',
    progress: 45,
    priority: PriorityLevel.Medium,
    phase: PhaseEnum.Design_Development,
    docsUrl: [],
    team: ['https://picsum.photos/50/50?random=13', 'https://picsum.photos/50/50?random=14'],
    projectOverview: "Corporate coffee break area renovation."
  },
  {
    id: 'p4',
    clientId: 'c1',
    name: 'Mena Institute PH1',
    status: ProjectStatus.Quote,
    budget: 120000.00,
    liveCost: 0,
    downpayment: 0,
    progress: 0,
    priority: PriorityLevel.Low,
    phase: PhaseEnum.Schematic_Design,
    docsUrl: [],
    team: [],
    projectOverview: "Initial schematic design for penthouse renovation."
  }
];

export const FINANCIAL_DATA: MonthlyFinancial[] = [
  { month: 'May', actualRevenue: 50000, projectedRevenue: 60000 },
  { month: 'Jun', actualRevenue: 75000, projectedRevenue: 70000 },
  { month: 'Jul', actualRevenue: 45000, projectedRevenue: 55000 },
  { month: 'Aug', actualRevenue: 90000, projectedRevenue: 85000 },
  { month: 'Sep', actualRevenue: 82000, projectedRevenue: 90000 },
  { month: 'Oct', actualRevenue: 60000, projectedRevenue: 80000 },
];

export const MOCK_MANAGERS = [
  "Alex Morgan",
  "Sarah Jenkins",
  "David Chen",
  "Emily Ross",
  "Michael Chang"
];

export const MOCK_QUOTES: import('./types').Quote[] = [
  {
    id: 'q1',
    projectName: 'Casa de Campo - Living Room',
    clientName: 'Alejandra Vizcaya',
    deliveryTime: '3 Weeks',
    date: '2025-10-01',
    items: [
      { description: 'Diseño y fabricación de mesa de centro en mármol Calacatta', quantity: 1, unitPrice: 25000 },
      { description: 'Sillas de comedor tapizadas en lino', quantity: 6, unitPrice: 4500 }
    ],
    notes: 'Incluye flete e instalación.',
    status: 'Sent',
    totalAmount: 52000
  },
  {
    id: 'q2',
    projectName: 'Oficinas Vitesco',
    clientName: 'Ivan (Vitesco)',
    deliveryTime: '45 Days',
    date: '2025-10-05',
    items: [
      { description: 'Estaciones de trabajo modulares', quantity: 10, unitPrice: 12000 }
    ],
    notes: 'Requiere anticipo del 50%.',
    status: 'Draft',
    totalAmount: 120000
  }
];