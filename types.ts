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